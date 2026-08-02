-- =================================================================
-- LogMax — Caixa / Bancos da Matriz + coerência banco × filial na baixa
-- =================================================================
-- Contexto: a migr. 323 deu à Matriz capital próprio, folha da diretoria e
-- custo corporativo, e a holding passou a ter contas a pagar de verdade
-- (`contas_pagar.filial = 'Matriz'`, DEFAULT desde a 053). Faltava a outra
-- ponta: de onde sai o dinheiro. `caixa_bancos` só tinha conta de filial —
-- na hora de dar baixa, o seletor de origem oferecia caixa/banco das
-- unidades, e a Matriz acabava pagando com dinheiro da filial.
--
-- Duas coisas aqui:
--
--  1) CONVENÇÃO DE `caixa_bancos.filial`. A partir de agora conta da holding
--     grava o literal 'Matriz', igual a `contas_pagar`/`capital_filial`.
--     `filial IS NULL` continua significando "global/legado" e segue visível
--     a todo mundo (a policy `caixa_bancos_select` da migr. 196 depende
--     disso, e a turma LogMax-Adm tem 3 contas nesse estado). NÃO há backfill
--     de NULL → 'Matriz': isso esconderia dessas turmas o banco que elas usam
--     hoje. Só o que for criado daqui pra frente nasce com 'Matriz'.
--
--  2) A FILIAL NÃO ENXERGA O CAIXA DA MATRIZ. A policy `caixa_bancos_select`
--     (196) liberava QUALQUER usuário do setor financeiro a ler TODAS as
--     contas, de todas as unidades. Pelas telas nunca apareceu (a view filtra
--     por filial no servidor), mas pelo F12 aparecia — e com o caixa próprio
--     da holding isso passou a expor o dinheiro dos sócios pra filial. O gate
--     vira `auth_pode_filial(filial)`, a mesma régua canônica do resto:
--     admin/CEO/conselheiro veem tudo, o restante só a própria unidade.
--     `filial IS NULL` (global/legado) segue visível a todos — ver item 1.
--
--  3) COERÊNCIA BANCO × FILIAL NA BAIXA. `registrar_pagamento_conta` (267)
--     conferia a filial da CONTA mas não a do BANCO — nada impedia quitar
--     uma conta da SuperMax debitando o caixa da Matriz (ou vice-versa). O
--     seletor do frontend agora filtra, mas filtro de UI não é controle:
--     a régua vai pro banco de dados. Banco com filial NULL (global/legado)
--     segue aceito em qualquer conta, senão as turmas que só têm conta NULL
--     param de conseguir pagar.
--
-- Idempotente.
-- =================================================================

BEGIN;

COMMENT ON COLUMN public.caixa_bancos.filial IS
  'Unidade dona da conta/caixa. ''Matriz'' = holding (migr. 325). NULL = global/legado, visível a todas as unidades.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. caixa_bancos_select — a filial só vê o caixa da própria unidade
-- ═══════════════════════════════════════════════════════════════════
-- Escrita (insert/update/delete) já estava certa desde a 196: exige
-- `p.filial = caixa_bancos.filial` ou admin/CEO. Só a leitura vazava.

DROP POLICY IF EXISTS "caixa_bancos_select" ON public.caixa_bancos;
CREATE POLICY "caixa_bancos_select" ON public.caixa_bancos FOR SELECT TO authenticated
  USING (
    public.auth_pode_filial(caixa_bancos.filial)
    OR caixa_bancos.filial IS NULL
  );

-- ═══════════════════════════════════════════════════════════════════
-- 3. registrar_pagamento_conta — origem tem de ser da mesma unidade
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_pagamento_conta(
  p_tipo     text,
  p_conta_id uuid,
  p_banco_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_calc         jsonb;
  v_total        numeric(15,2);
  v_juros        numeric(15,2);
  v_multa        numeric(15,2);
  v_status       text;
  v_filial       text;
  v_banco_filial text;
  v_banco_ok     boolean;
BEGIN
  -- Sem lista de setores: a régua real é verificada abaixo, depois de saber a
  -- filial da conta — Financeiro OU gerente daquela filial (régua canônica
  -- "gerente opera a filial inteira").
  PERFORM public._assert_rpc();

  IF p_tipo NOT IN ('pagar', 'receber') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_pagar WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;
  ELSE
    SELECT status, filial INTO v_status, v_filial
      FROM public.contas_receber WHERE id = p_conta_id AND COALESCE(ativo, true) FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IN ('Pago', 'Recebido') THEN
    RAISE EXCEPTION 'Esta conta já está quitada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_filial IS NOT NULL AND NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.auth_in_setor('financeiro')
          OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial registram baixa de conta.'
      USING ERRCODE = '42501';
  END IF;

  -- A origem do dinheiro tem de ser da mesma unidade da conta (migr. 325).
  -- Banco global/legado (filial NULL) passa em qualquer uma.
  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);

  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL
     AND v_banco_filial IS DISTINCT FROM COALESCE(v_filial, 'Matriz') THEN
    RAISE EXCEPTION 'A origem escolhida é caixa/banco de % e esta conta é de %. Use uma conta da própria unidade.',
      v_banco_filial, COALESCE(v_filial, 'Matriz') USING ERRCODE = 'P0001';
  END IF;

  v_calc  := public.calcular_valor_atualizado(p_tipo, p_conta_id);
  v_total := (v_calc->>'total')::numeric;
  v_juros := COALESCE((v_calc->>'juros')::numeric, 0);
  v_multa := COALESCE((v_calc->>'multa')::numeric, 0);

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Valor da conta inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'pagar' THEN
    UPDATE public.contas_pagar
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  ELSE
    UPDATE public.contas_receber
       SET status = 'Pago', banco_id = p_banco_id,
           valor_pago = v_total, juros_pago = v_juros, multa_pago = v_multa,
           pago_em = public.acre_today()
     WHERE id = p_conta_id;
  END IF;

  RETURN v_calc;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_conta(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_conta(text, uuid, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
