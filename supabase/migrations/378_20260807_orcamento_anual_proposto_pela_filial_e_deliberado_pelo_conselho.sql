-- =================================================================
-- 378 — Orçamento: a filial propõe, o Conselho delibera, o gasto responde.
--
-- Item #G1 do backlog de governança. Exceção à trava aberta pelo usuário
-- em 2026-08-07.
--
-- O buraco: hoje a filial gasta sem teto. `centros_custo.orcamento` existe,
-- mas é um número solto — sem período, sem quem aprovou, sem confronto com
-- o que foi de fato gasto. Ou seja, não é orçamento, é anotação.
--
-- O processo real que isto passa a ensinar:
--   1. A filial monta a proposta por centro de custo           (rascunho)
--   2. Submete ao Conselho                                     (submetido)
--   3. O Conselho aprova, corta linha a linha, devolve ou reprova
--   4. Durante o período, contas a pagar são confrontadas com o aprovado
--
-- O passo 4 é o que dá sentido aos outros três, e é onde estava a peça
-- que faltava: `contas_pagar` NÃO tinha centro de custo. Sem isso não há
-- como dizer quanto de cada rubrica já foi consumido — o orçamento
-- viraria de novo um número solto, só que em tabela nova. Por isso a
-- coluna entra aqui, nullable: conta antiga fica sem rubrica e simplesmente
-- não conta no confronto, em vez de quebrar tela existente.
--
-- Decisões que valem estar escritas:
--   • O corte do Conselho é POR LINHA (`valor_aprovado` por centro de
--     custo), não um "aprovado/negado" no total. Cortar é o que um
--     conselho faz de verdade, e o aluno precisa ver a linha que caiu.
--   • `valor_aprovado` NULL enquanto não deliberado. O confronto usa
--     COALESCE(valor_aprovado, 0): antes de aprovar, o teto é zero, não
--     é o que a filial pediu. Pedir não é ter.
--   • Devolvido volta pra 'rascunho' editável — é devolução pra ajuste,
--     não reprovação. Reprovado é terminal.
--   • Um orçamento vigente por filial+período (índice parcial com
--     `ativo`, senão o soft-delete colide).
--
-- Leitura aberta a quem loga: a competição entre filiais só é honesta se
-- todo mundo enxerga o teto de todo mundo. Escrita da proposta fica com a
-- filial dona; a deliberação, só com o Conselho.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Centro de custo na conta a pagar ───────────────────────────
-- A peça que faltava pro confronto orçado × realizado existir.
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS centro_custo_id uuid
    REFERENCES public.centros_custo(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contas_pagar.centro_custo_id IS
  'Rubrica orcamentaria da despesa. NULL = conta sem rubrica: nao entra no confronto com o orcamento aprovado.';

CREATE INDEX IF NOT EXISTS idx_contas_pagar_centro_custo
  ON public.contas_pagar (centro_custo_id) WHERE ativo = true;

-- ── 2. Orçamento do período ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamentos_periodo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial          text NOT NULL,
  nome            text NOT NULL,
  periodo_inicio  date NOT NULL,
  periodo_fim     date NOT NULL,
  status          text NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho','submetido','aprovado','devolvido','reprovado')),
  observacao      text,
  proposto_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submetido_em    timestamptz,
  deliberado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deliberado_em   timestamptz,
  parecer         text,
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (periodo_fim >= periodo_inicio)
);

COMMENT ON TABLE public.orcamentos_periodo IS
  'Proposta orcamentaria de uma filial para um periodo. Filial propoe, Conselho delibera linha a linha em orcamento_itens.';

-- Partial unique: sem o WHERE, o soft-delete impede recriar o orçamento
-- do mesmo período depois de inativar um.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orcamento_filial_periodo
  ON public.orcamentos_periodo (filial, periodo_inicio, periodo_fim)
  WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.orcamento_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id    uuid NOT NULL REFERENCES public.orcamentos_periodo(id) ON DELETE CASCADE,
  centro_custo_id uuid NOT NULL REFERENCES public.centros_custo(id) ON DELETE RESTRICT,
  valor_proposto  numeric(14,2) NOT NULL CHECK (valor_proposto >= 0),
  valor_aprovado  numeric(14,2) CHECK (valor_aprovado IS NULL OR valor_aprovado >= 0),
  justificativa   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orcamento_id, centro_custo_id)
);

COMMENT ON COLUMN public.orcamento_itens.valor_aprovado IS
  'Teto deliberado pelo Conselho. NULL = ainda nao deliberado; o confronto trata como zero (pedir nao e ter).';

-- ── 3. RLS ────────────────────────────────────────────────────────
ALTER TABLE public.orcamentos_periodo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_itens    ENABLE ROW LEVEL SECURITY;

-- Leitura: todo mundo que loga enxerga o teto de todo mundo.
DROP POLICY IF EXISTS orcamento_read ON public.orcamentos_periodo;
CREATE POLICY orcamento_read ON public.orcamentos_periodo
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS orcamento_item_read ON public.orcamento_itens;
CREATE POLICY orcamento_item_read ON public.orcamento_itens
  FOR SELECT TO authenticated USING (true);

-- Escrita da proposta: a filial dona, e só enquanto for rascunho.
-- Depois de submetido, a proposta congela — quem mexe é o Conselho, via RPC.
DROP POLICY IF EXISTS orcamento_propor_insert ON public.orcamentos_periodo;
CREATE POLICY orcamento_propor_insert ON public.orcamentos_periodo
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(NOT auth_desligado(), false)
    AND COALESCE(auth_pode_filial(filial), false)
    AND status = 'rascunho'
  );

DROP POLICY IF EXISTS orcamento_propor_update ON public.orcamentos_periodo;
CREATE POLICY orcamento_propor_update ON public.orcamentos_periodo
  FOR UPDATE TO authenticated
  USING (
    COALESCE(NOT auth_desligado(), false)
    AND COALESCE(auth_pode_filial(filial), false)
    AND status IN ('rascunho','devolvido')
  )
  WITH CHECK (status IN ('rascunho','devolvido'));

DROP POLICY IF EXISTS orcamento_item_write ON public.orcamento_itens;
CREATE POLICY orcamento_item_write ON public.orcamento_itens
  FOR ALL TO authenticated
  USING (
    COALESCE(NOT auth_desligado(), false)
    AND EXISTS (
      SELECT 1 FROM public.orcamentos_periodo o
       WHERE o.id = orcamento_itens.orcamento_id
         AND COALESCE(auth_pode_filial(o.filial), false)
         AND o.status IN ('rascunho','devolvido')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orcamentos_periodo o
       WHERE o.id = orcamento_itens.orcamento_id
         AND COALESCE(auth_pode_filial(o.filial), false)
         AND o.status IN ('rascunho','devolvido')
    )
  );

-- ── 4. Submeter ao Conselho ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submeter_orcamento(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_o     orcamentos_periodo;
  v_itens int;
BEGIN
  SELECT * INTO v_o FROM orcamentos_periodo
   WHERE id = p_orcamento_id AND ativo = true;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(auth_pode_filial(v_o.filial), false) THEN
    RAISE EXCEPTION 'Você não responde por % .', v_o.filial USING ERRCODE = '42501';
  END IF;

  IF v_o.status NOT IN ('rascunho','devolvido') THEN
    RAISE EXCEPTION 'Só rascunho ou devolvido pode ser submetido (atual: %).', v_o.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_itens FROM orcamento_itens WHERE orcamento_id = p_orcamento_id;
  IF v_itens = 0 THEN
    RAISE EXCEPTION 'Orçamento sem nenhuma rubrica — nada a deliberar.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE orcamentos_periodo
     SET status = 'submetido', submetido_em = now(), updated_at = now(),
         proposto_por = COALESCE(proposto_por, auth.uid())
   WHERE id = p_orcamento_id;

  -- Notação nomeada de propósito: a assinatura tem 9 parâmetros e o 3º
  -- posicional é p_titulo, não a mensagem. Chamada posicional curta aqui
  -- gravaria o título no lugar do tipo e estouraria o CHECK de `tipo`.
  PERFORM notificar_setor(
    p_setor     => 'financeiro',
    p_tipo      => 'aprovacao_pendente',
    p_titulo    => 'Orçamento submetido ao Conselho',
    p_mensagem  => format('%s enviou o orçamento "%s" para deliberação.', v_o.filial, v_o.nome),
    -- O slug da rota vem do rótulo do submenu e NÃO tira acento
    -- (`compras-cotações` é a convenção da casa). Escrever sem cedilha aqui
    -- geraria uma notificação com link morto.
    p_link_view => 'financeiro-orçamentoanual',
    p_ref_id    => p_orcamento_id,
    p_filial    => v_o.filial);

  RETURN jsonb_build_object('sucesso', true, 'status', 'submetido', 'rubricas', v_itens);
END;
$$;

REVOKE ALL ON FUNCTION public.submeter_orcamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submeter_orcamento(uuid) TO authenticated;

-- ── 5. Deliberar (só Conselho) ────────────────────────────────────
-- p_itens: [{"item_id":"…","valor_aprovado":1234.56}, …]
-- Em 'aprovado', toda linha precisa de valor — inclusive zero, que é o
-- corte total daquela rubrica. Deixar NULL seria "esqueci", e o confronto
-- trataria como zero sem ninguém ter decidido isso.
CREATE OR REPLACE FUNCTION public.deliberar_orcamento(
  p_orcamento_id uuid,
  p_decisao      text,
  p_parecer      text DEFAULT NULL,
  p_itens        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_o        orcamentos_periodo;
  v_sem_nota int;
  v_total    numeric(14,2);
BEGIN
  -- `auth_is_admin()` já É o teste de Conselho: admin, CEO, conselheiro puro
  -- ou gerente com is_conselheiro — e ainda exclui quem foi desligado.
  -- Criar um auth_is_conselho() seria duplicar a régua em dois lugares.
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho delibera orçamento.' USING ERRCODE = '42501';
  END IF;

  IF p_decisao NOT IN ('aprovado','devolvido','reprovado') THEN
    RAISE EXCEPTION 'Decisão inválida: %.', p_decisao USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_o FROM orcamentos_periodo
   WHERE id = p_orcamento_id AND ativo = true;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_o.status <> 'submetido' THEN
    RAISE EXCEPTION 'Só orçamento submetido vai a deliberação (atual: %).', v_o.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Corte linha a linha.
  UPDATE orcamento_itens i
     SET valor_aprovado = (e->>'valor_aprovado')::numeric
    FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) e
   WHERE i.orcamento_id = p_orcamento_id
     AND i.id = (e->>'item_id')::uuid;

  IF p_decisao = 'aprovado' THEN
    SELECT count(*) INTO v_sem_nota
      FROM orcamento_itens
     WHERE orcamento_id = p_orcamento_id AND valor_aprovado IS NULL;
    IF v_sem_nota > 0 THEN
      RAISE EXCEPTION 'Aprovação exige valor em todas as % rubrica(s) — zero é corte, vazio é omissão.', v_sem_nota
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Devolução e reprovação zeram o teto: nada foi autorizado.
    UPDATE orcamento_itens SET valor_aprovado = NULL WHERE orcamento_id = p_orcamento_id;
  END IF;

  UPDATE orcamentos_periodo
     SET status         = CASE WHEN p_decisao = 'devolvido' THEN 'devolvido' ELSE p_decisao END,
         parecer        = p_parecer,
         deliberado_por = auth.uid(),
         deliberado_em  = now(),
         updated_at     = now()
   WHERE id = p_orcamento_id;

  SELECT COALESCE(sum(valor_aprovado), 0) INTO v_total
    FROM orcamento_itens WHERE orcamento_id = p_orcamento_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'status', p_decisao, 'total_aprovado', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.deliberar_orcamento(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliberar_orcamento(uuid,text,text,jsonb) TO authenticated;

-- ── 6. Execução orçamentária ──────────────────────────────────────
-- Orçado × realizado por rubrica. Realizado = contas a pagar ativas da
-- filial, com aquele centro de custo, vencendo dentro do período.
CREATE OR REPLACE FUNCTION public.orcamento_execucao(p_orcamento_id uuid)
RETURNS TABLE (
  item_id         uuid,
  centro_custo_id uuid,
  centro_codigo   text,
  centro_nome     text,
  valor_proposto  numeric,
  valor_aprovado  numeric,
  realizado       numeric,
  saldo           numeric,
  consumo_pct     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    i.id,
    cc.id,
    cc.codigo,
    cc.nome,
    i.valor_proposto,
    i.valor_aprovado,
    COALESCE(r.gasto, 0) AS realizado,
    COALESCE(i.valor_aprovado, 0) - COALESCE(r.gasto, 0) AS saldo,
    CASE WHEN COALESCE(i.valor_aprovado, 0) = 0 THEN NULL
         ELSE round(COALESCE(r.gasto, 0) * 100 / i.valor_aprovado, 1)
    END AS consumo_pct
  FROM orcamento_itens i
  JOIN orcamentos_periodo o ON o.id = i.orcamento_id
  JOIN centros_custo cc     ON cc.id = i.centro_custo_id
  LEFT JOIN LATERAL (
    SELECT sum(cp.valor) AS gasto
      FROM contas_pagar cp
     WHERE cp.ativo = true
       AND cp.centro_custo_id = i.centro_custo_id
       AND cp.filial = o.filial
       AND cp.vencimento BETWEEN o.periodo_inicio AND o.periodo_fim
  ) r ON true
  WHERE i.orcamento_id = p_orcamento_id
  ORDER BY cc.codigo;
$$;

REVOKE ALL ON FUNCTION public.orcamento_execucao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_execucao(uuid) TO authenticated;

-- ── 7. Realtime ───────────────────────────────────────────────────
-- A tela é compartilhada: a filial vê a decisão do Conselho sem recarregar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'orcamentos_periodo'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orcamentos_periodo;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Estrutura:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='contas_pagar' AND column_name='centro_custo_id';
--
-- 2) anon não alcança as RPCs novas (vide feedback_rpc_nova_nasce_aberta_anon):
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('submeter_orcamento','deliberar_orcamento',
--                      'orcamento_execucao');
-- Esperado: anon_pode = false nas três.
--
-- 3) Fim a fim: gerente de SuperMax cria orçamento > adiciona rubricas >
--    Submeter. Conselheiro abre, corta uma linha para 0, aprova. A filial
--    vê o teto novo. Lançar conta a pagar com aquela rubrica e conferir o
--    consumo:
-- SELECT * FROM orcamento_execucao('<id>');
