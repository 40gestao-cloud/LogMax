-- Folha: o vínculo deixa de ser texto e o crédito deixa de sumir em silêncio.
--
-- Dois achados da Etapa 2 do plano de auditoria de veracidade (docs/):
--
--   F1  O vínculo folha↔conta a pagar era uma REGEX em campo livre.
--       `conta_pagar_avancar_folha_e_creditar` extraía o UUID de
--       '[folha:<uuid>]' dentro de `contas_pagar.descricao` — campo que a tela
--       de Contas a Pagar deixa editar. Corrigir a descrição matava o vínculo
--       sem aviso: a folha nunca avançava e ninguém era creditado. Agora existe
--       `contas_pagar.folha_pagamento_id`, com FK. O marcador continua sendo
--       gravado, mas só como rótulo — quem manda é a coluna.
--
--   F2  O crédito engolia o próprio erro: `EXCEPTION WHEN OTHERS THEN RAISE
--       NOTICE`. Pior, o status virava 'Paga' ANTES da tentativa de crédito.
--       Resultado: folha 'Paga', conta debitada, funcionário sem receber, e
--       zero rastro fora do log do Postgres. Agora a ordem é invertida —
--       credita primeiro, e só avança para 'Paga' se o crédito passou. Quando
--       falha, a folha fica em 'Processada' (que é a verdade), o erro vira
--       linha em `folha_credito_falhas` e o setor RH recebe notificação.
--
-- A transição Processada → Paga passa a morar numa RPC única
-- (`pagar_folha`), usada pela tela de RH e pelo retry. O trigger de
-- contas_pagar chama a mesma rotina interna. Antes a regra estava em três
-- lugares: no .tsx, no trigger, e em lugar nenhum.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos com colaboradores
-- (ERP, Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. contas_pagar.folha_pagamento_id — o vínculo vira relacional
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS folha_pagamento_id uuid
    REFERENCES public.folha_pagamento(id) ON DELETE SET NULL;

-- Backfill a partir do marcador histórico. Uma conta por folha: a ATIVA mais
-- antiga. A precedência de `ativo` importa — onde o check-then-insert da tela
-- correu duas vezes (race de ~100ms, caso real em 2026-07), a linha mais antiga
-- é justamente a que o operador inativou. Vincular por data pura amarraria a
-- folha à conta morta. As demais ficam sem vínculo e aparecem na verificação.
WITH candidatas AS (
  SELECT cp.id,
         substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')::uuid AS folha_id,
         row_number() OVER (
           PARTITION BY substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')
           ORDER BY COALESCE(cp.ativo, true) DESC, cp.created_at, cp.id
         ) AS rn
    FROM public.contas_pagar cp
   WHERE cp.folha_pagamento_id IS NULL
     AND cp.descricao ~ '\[folha:[0-9a-fA-F-]{36}\]'
)
UPDATE public.contas_pagar cp
   SET folha_pagamento_id = c.folha_id
  FROM candidatas c
 WHERE cp.id = c.id
   AND c.rn = 1
   AND EXISTS (SELECT 1 FROM public.folha_pagamento f WHERE f.id = c.folha_id);

-- Uma folha ativa gera no máximo uma conta a pagar ativa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_folha_ativa
  ON public.contas_pagar (folha_pagamento_id)
  WHERE folha_pagamento_id IS NOT NULL AND COALESCE(ativo, true) = true;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. folha_credito_falhas — o rastro que o RAISE NOTICE não deixava
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.folha_credito_falhas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folha_id        uuid NOT NULL REFERENCES public.folha_pagamento(id) ON DELETE CASCADE,
  conta_pagar_id  uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  filial          text,
  erro            text NOT NULL,
  origem          text NOT NULL DEFAULT 'trigger_contas_pagar',
  resolvido_em    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folha_credito_falhas_abertas
  ON public.folha_credito_falhas (folha_id)
  WHERE resolvido_em IS NULL;

ALTER TABLE public.folha_credito_falhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folha_falhas_read" ON public.folha_credito_falhas;

-- Só leitura, e só para quem opera a folha. Escrita é exclusiva das rotinas
-- SECURITY DEFINER abaixo — não existe policy de INSERT/UPDATE/DELETE de
-- propósito: auditoria que o operador apaga não é auditoria (P11).
CREATE POLICY "folha_falhas_read" ON public.folha_credito_falhas
  FOR SELECT TO authenticated USING (
    public.auth_is_admin()
    OR (public.auth_in_setor('rh') AND public.auth_pode_filial(filial))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Rotina interna: credita e SÓ ENTÃO avança o status
-- ────────────────────────────────────────────────────────────────────────────
-- Não é exposta a `authenticated`: quem chama é a RPC pública (com RBAC) ou o
-- trigger de contas_pagar. Nunca levanta exceção por falha de crédito — ela
-- devolve o erro em `ok`/`erro` para o chamador decidir, e sempre deixa rastro.

CREATE OR REPLACE FUNCTION public._folha_creditar_e_avancar(
  p_folha_id uuid,
  p_conta_id uuid DEFAULT NULL,
  p_origem   text DEFAULT 'rpc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credito  jsonb;
  v_erro     text;
  v_filial   text;
  v_status   text;
BEGIN
  SELECT status, filial INTO v_status, v_filial
    FROM public.folha_pagamento
   WHERE id = p_folha_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Folha não encontrada.');
  END IF;

  BEGIN
    v_credito := public.creditar_folha_maxbank(p_folha_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_erro := SQLERRM;
  END;

  IF v_erro IS NOT NULL THEN
    -- A folha NÃO avança. 'Processada' é a verdade enquanto ninguém recebeu.
    INSERT INTO public.folha_credito_falhas
      (folha_id, conta_pagar_id, filial, erro, origem)
    VALUES (p_folha_id, p_conta_id, v_filial, v_erro, p_origem);

    -- Notificação é conveniência; o rastro persistente já está gravado acima.
    BEGIN
      PERFORM public.notificar_setor(
        'rh',
        'alerta',
        'Folha sem crédito no MaxBank',
        'O pagamento foi lançado, mas o crédito na carteira falhou: ' || v_erro
          || ' A folha continua em Processada até o crédito passar.',
        'folha-pagamento',
        'Alta',
        p_folha_id,
        v_erro
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'notificar_setor falhou para folha %: %', p_folha_id, SQLERRM;
    END;

    RETURN jsonb_build_object('ok', false, 'erro', v_erro, 'status', v_status);
  END IF;

  -- Crédito ok (ou já creditado antes — a RPC é idempotente).
  UPDATE public.folha_pagamento
     SET status = 'Paga'
   WHERE id = p_folha_id
     AND status = 'Processada';

  UPDATE public.folha_credito_falhas
     SET resolvido_em = now()
   WHERE folha_id = p_folha_id
     AND resolvido_em IS NULL;

  RETURN COALESCE(v_credito, '{}'::jsonb) || jsonb_build_object('ok', true, 'status', 'Paga');
END;
$$;

REVOKE ALL ON FUNCTION public._folha_creditar_e_avancar(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public._folha_creditar_e_avancar(uuid, uuid, text) FROM authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC pública: a única porta de entrada da transição Processada → Paga
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pagar_folha(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filial text;
BEGIN
  PERFORM public._assert_rpc('rh');

  SELECT filial INTO v_filial FROM public.folha_pagamento WHERE id = p_folha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Folha de outra filial.' USING ERRCODE = '42501';
  END IF;

  RETURN public._folha_creditar_e_avancar(p_folha_id, NULL, 'rpc_rh');
END;
$$;

REVOKE ALL ON FUNCTION public.pagar_folha(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.pagar_folha(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trigger de contas_pagar: usa a coluna, e não mente mais sobre o status
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conta_pagar_avancar_folha_e_creditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folha_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Pago' OR OLD.status = 'Pago' THEN
    RETURN NEW;
  END IF;

  v_folha_id := NEW.folha_pagamento_id;

  -- Fallback só para linhas anteriores à coluna que o backfill não alcançou.
  IF v_folha_id IS NULL THEN
    BEGIN
      v_folha_id := substring(NEW.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_folha_id := NULL;
    END;
  END IF;

  IF v_folha_id IS NULL THEN
    RETURN NEW;  -- conta a pagar comum, não derivada de folha.
  END IF;

  -- O pagamento da conta não é bloqueado por falha de crédito, mas a falha
  -- passa a existir em algum lugar: folha_credito_falhas + notificação ao RH.
  PERFORM public._folha_creditar_e_avancar(v_folha_id, NEW.id, 'trigger_contas_pagar');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contas_pagar_avancar_folha ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_avancar_folha
  AFTER UPDATE OF status ON public.contas_pagar
  FOR EACH ROW
  WHEN (NEW.status = 'Pago' AND OLD.status <> 'Pago')
  EXECUTE FUNCTION public.conta_pagar_avancar_folha_e_creditar();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Reversão passa a enxergar a coluna (a descrição virou rótulo)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverter_folha_maxbank(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx           record;
  v_revertidas   integer := 0;
  v_contas       integer := 0;
  v_perda_total  numeric(15,2) := 0;
  v_res          jsonb;
BEGIN
  IF NOT public._maxbank_pode_reverter() THEN
    RAISE EXCEPTION 'Apenas admin, CEO ou RH podem reverter folha no MaxBank.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v_tx IN
    SELECT id
      FROM public.maxbank_transacoes
     WHERE origem = 'folha_pagamento'
       AND origem_id = p_folha_id
  LOOP
    v_res := public.excluir_transacao_maxbank(v_tx.id);
    v_revertidas := v_revertidas + 1;
    v_perda_total := v_perda_total + COALESCE((v_res->>'perda_por_saldo_insuficiente')::numeric, 0);
  END LOOP;

  -- Vínculo relacional primeiro; marcador só para linhas antigas sem coluna.
  WITH inativadas AS (
    UPDATE public.contas_pagar
       SET ativo = false
     WHERE COALESCE(ativo, true) = true
       AND (
         folha_pagamento_id = p_folha_id
         OR (folha_pagamento_id IS NULL
             AND descricao LIKE '%[folha:' || p_folha_id::text || ']%')
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_contas FROM inativadas;

  RETURN jsonb_build_object(
    'transacoes_revertidas',                v_revertidas,
    'contas_pagar_inativadas',              v_contas,
    'perda_total_por_saldo_insuficiente',   v_perda_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverter_folha_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reverter_folha_maxbank(uuid) TO authenticated;

COMMIT;

-- Recarrega o cache do PostgREST — sem isso `pagar_folha` devolve PGRST202.
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rodar após aplicar, em cada projeto)
-- ════════════════════════════════════════════════════════════════════════════
--   -- 1. Backfill: quantas contas de folha ficaram sem vínculo?
--   SELECT count(*) FILTER (WHERE folha_pagamento_id IS NOT NULL) AS vinculadas,
--          count(*) FILTER (WHERE folha_pagamento_id IS NULL)     AS sem_vinculo
--     FROM contas_pagar
--    WHERE descricao ~ '\[folha:[0-9a-fA-F-]{36}\]';
--
--   -- 2. Duplicidade de efeito (S5): mais de uma conta para a mesma folha.
--   SELECT substring(descricao FROM '\[folha:([0-9a-fA-F-]{36})\]') AS folha,
--          count(*), array_agg(id)
--     FROM contas_pagar
--    WHERE descricao ~ '\[folha:[0-9a-fA-F-]{36}\]'
--    GROUP BY 1 HAVING count(*) > 1;
--
--   -- 3. Vítimas históricas do RAISE NOTICE: folha 'Paga' sem transação
--   --    de salário no MaxBank. Cada linha é alguém que não recebeu.
--   SELECT f.id, f.mes_ref, f.filial, f.salario_liquido
--     FROM folha_pagamento f
--    WHERE f.status = 'Paga'
--      AND COALESCE(f.ativo, true)
--      AND NOT EXISTS (
--        SELECT 1 FROM maxbank_transacoes t
--         WHERE t.origem = 'folha_pagamento' AND t.origem_id = f.id
--           AND t.carteira = 'salario');
--
--   -- 4. Corrigir cada uma delas (idempotente):
--   --    SELECT pagar_folha('<folha_id>');
--
--   -- 5. Falhas abertas dali em diante:
--   SELECT * FROM folha_credito_falhas WHERE resolvido_em IS NULL ORDER BY created_at DESC;
-- ════════════════════════════════════════════════════════════════════════════
