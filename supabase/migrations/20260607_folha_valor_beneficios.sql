-- =================================================================
-- MaxBank — Split de Benefícios na Folha (mini-fase entre Fase 4 e 5)
-- =================================================================
-- Adiciona campo valor_beneficios na folha e estende a RPC
-- creditar_folha_maxbank para creditar 2 carteiras simultaneamente:
--   • saldo_salario     += salario_liquido    (já fazia)
--   • saldo_beneficios  += valor_beneficios   (novo)
--
-- Idempotência preservada pelo UNIQUE parcial uq_maxbank_transacoes_folha
-- em (origem_id, carteira) WHERE origem='folha_pagamento' — mesmo folha_id
-- com carteiras 'salario' e 'beneficios' são linhas distintas, sem violação.
--
-- Habilita Fase 5 (PDV consumindo benefícios) sem mexer no PDV ainda.
--
-- DEPENDÊNCIAS:
--   - 20260605_maxbank_carteira.sql        (Fase 1 — maxbank_contas/transacoes + uq parcial)
--   - 20260605b_maxbank_credito_folha.sql  (Fase 2 — bridge + RPC original)
--
-- NÃO MUDA:
--   • recalcular_folha_do_ponto — valor_beneficios é intocado por descontos
--     de atraso/falta (decisão pedagógica: benefícios são verba separada).
--   • trg_contas_pagar_avancar_folha — Conta a Pagar segue 1 conta com
--     salario_liquido apenas. Benefícios vão direto na carteira.
--
-- IDEMPOTENTE. Rodar nas 4 instâncias com colaboradores (ERP, Contabilidade,
-- Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. Novo campo na folha
-- =================================================================
ALTER TABLE folha_pagamento
  ADD COLUMN IF NOT EXISTS valor_beneficios numeric(12,2) NOT NULL DEFAULT 0
  CHECK (valor_beneficios >= 0);

-- =================================================================
-- 2. RPC creditar_folha_maxbank — agora credita 2 carteiras
-- =================================================================
-- Postgres não permite CREATE OR REPLACE mudando o tipo de retorno
-- (uuid → jsonb), então damos DROP + CREATE.
DROP FUNCTION IF EXISTS public.creditar_folha_maxbank(uuid);

CREATE FUNCTION public.creditar_folha_maxbank(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funcionario_id    uuid;
  v_user_profile_id   uuid;
  v_salario_liquido   numeric(15,2);
  v_valor_beneficios  numeric(15,2);
  v_mes_ref           text;
  v_ativo             boolean;
  v_conta_id          uuid;
  v_t_salario         uuid;
  v_t_beneficios      uuid;
  v_descricao         text;
BEGIN
  -- 1. Lê folha (com o novo valor_beneficios).
  SELECT funcionario_id, salario_liquido, COALESCE(valor_beneficios, 0),
         mes_ref, COALESCE(ativo, true)
    INTO v_funcionario_id, v_salario_liquido, v_valor_beneficios,
         v_mes_ref, v_ativo
    FROM folha_pagamento
   WHERE id = p_folha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_ativo = false THEN
    RAISE EXCEPTION 'Folha inativa (soft-deleted) não pode ser creditada.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_salario_liquido IS NULL OR v_salario_liquido <= 0 THEN
    RAISE EXCEPTION 'Salário líquido inválido (% para folha %).',
      v_salario_liquido, p_folha_id;
  END IF;

  -- 2. Bridge funcionário → user_profile.
  SELECT user_profile_id INTO v_user_profile_id
    FROM funcionarios
   WHERE id = v_funcionario_id;

  IF v_user_profile_id IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem conta de colaborador. Confira o email cadastrado em RH e em user_profiles.';
  END IF;

  -- 3. Garante conta MaxBank (fallback caso o backfill da Fase 1 tenha
  --    perdido alguém criado depois).
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_user_profile_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id
    FROM maxbank_contas
   WHERE colaborador_id = v_user_profile_id;

  -- 4. Crédito SALÁRIO (idempotente pelo UNIQUE parcial).
  v_descricao := 'Folha ' || COALESCE(v_mes_ref, '?') || ' — salário líquido';
  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'credito', 'salario', v_salario_liquido,
       v_descricao, 'folha_pagamento', p_folha_id, auth.uid())
    RETURNING id INTO v_t_salario;

    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario + v_salario_liquido
     WHERE id = v_conta_id;
  EXCEPTION
    WHEN unique_violation THEN
      v_t_salario := NULL;
  END;

  -- 5. Crédito BENEFÍCIOS (só se folha tem valor_beneficios > 0).
  IF v_valor_beneficios > 0 THEN
    v_descricao := 'Folha ' || COALESCE(v_mes_ref, '?') || ' — benefícios';
    BEGIN
      INSERT INTO maxbank_transacoes
        (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
      VALUES
        (v_conta_id, 'credito', 'beneficios', v_valor_beneficios,
         v_descricao, 'folha_pagamento', p_folha_id, auth.uid())
      RETURNING id INTO v_t_beneficios;

      UPDATE maxbank_contas
         SET saldo_beneficios = saldo_beneficios + v_valor_beneficios
       WHERE id = v_conta_id;
    EXCEPTION
      WHEN unique_violation THEN
        v_t_beneficios := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'transacao_salario_id',    v_t_salario,
    'transacao_beneficios_id', v_t_beneficios,
    'valor_beneficios',        v_valor_beneficios
  );
END;
$$;

REVOKE ALL ON FUNCTION public.creditar_folha_maxbank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(uuid) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar após a migração em cada instância)
-- =================================================================
--   -- Coluna existe e default zero?
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'folha_pagamento' AND column_name = 'valor_beneficios';
--
--   -- RPC agora retorna jsonb?
--   SELECT pg_get_function_result(p.oid) AS retorno
--     FROM pg_proc p
--    WHERE proname = 'creditar_folha_maxbank';
--   -- Esperado: jsonb.
--
--   -- Smoke test (substitua o uuid):
--   --   SELECT creditar_folha_maxbank('<folha_paga_anterior>');
--   --   -- Como já foi creditada antes, deve retornar
--   --   -- {transacao_salario_id: null, transacao_beneficios_id: null, valor_beneficios: 0}
-- =================================================================
