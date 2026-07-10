-- =================================================================
-- MaxBank — Produtos elegíveis a benefícios + RPC debitar (Fase 5)
-- =================================================================
-- Habilita o lado "colaborador" da Fase 5:
--   • produtos.elegivel_beneficios — toggle em ProdutosView; PDV usa
--     pra calcular quanto do carrinho cabe em saldo_beneficios.
--   • debitar_maxbank_beneficios — RPC SECURITY DEFINER chamada pelo
--     MaxBank stand-alone na instância do colaborador autenticado.
--     Idempotente via UNIQUE parcial em (origem_id, carteira)
--     WHERE origem='pdv_beneficios'.
--
-- IMPORTANTE: roda APENAS NAS INSTÂNCIAS 1-4 com colaboradores
-- (ERP, Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS (5) —
-- lá não há user_profiles nem maxbank_contas.
--
-- DEPENDÊNCIAS:
--   • 20260605_maxbank_carteira.sql  (maxbank_contas/transacoes)
--   • 20260605b_maxbank_credito_folha.sql (bridge funcionarios)
--   • 20260607_folha_valor_beneficios.sql (saldo_beneficios cresce)
--
-- IDEMPOTENTE.
-- =================================================================

BEGIN;

-- =================================================================
-- 1. produtos.elegivel_beneficios
-- =================================================================
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS elegivel_beneficios boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_produtos_elegivel_beneficios
  ON produtos (elegivel_beneficios)
  WHERE elegivel_beneficios = true;

-- =================================================================
-- 2. UNIQUE parcial: idempotência do débito por pendente_id
-- =================================================================
-- Mesmo padrão de uq_maxbank_transacoes_folha. Garantia: chamar a
-- RPC 2 vezes pro mesmo p_pendente_id resulta em 1 débito só.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_pdv_beneficios
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'pdv_beneficios';

-- =================================================================
-- 3. RPC debitar_maxbank_beneficios
-- =================================================================
-- Retorna jsonb:
--   { transacao_id, saldo_apos, status }   status = 'debitado' | 'ja_debitado'
-- Falha (RAISE EXCEPTION):
--   • Não autenticado.
--   • Conta MaxBank inexistente.
--   • Saldo insuficiente.
--   • valor <= 0.
-- =================================================================

CREATE OR REPLACE FUNCTION public.debitar_maxbank_beneficios(
  p_valor       numeric,
  p_descricao   text,
  p_pendente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_conta_id     uuid;
  v_saldo_atual  numeric(15,2);
  v_transacao_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de débito deve ser positivo.';
  END IF;

  IF p_pendente_id IS NULL THEN
    RAISE EXCEPTION 'pendente_id obrigatório para idempotência.';
  END IF;

  -- Conta do colaborador (auth.uid() == user_profiles.id).
  SELECT id, saldo_beneficios INTO v_conta_id, v_saldo_atual
    FROM maxbank_contas WHERE colaborador_id = v_uid;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Conta MaxBank não encontrada para este colaborador.';
  END IF;

  IF v_saldo_atual < p_valor THEN
    RAISE EXCEPTION 'Saldo de benefícios insuficiente. Disponível: R$ %.', v_saldo_atual;
  END IF;

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'beneficios', p_valor,
       COALESCE(p_descricao, 'Pagamento no PDV'),
       'pdv_beneficios', p_pendente_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_beneficios = saldo_beneficios - p_valor
     WHERE id = v_conta_id;

    SELECT saldo_beneficios INTO v_saldo_atual
      FROM maxbank_contas WHERE id = v_conta_id;

    RETURN jsonb_build_object(
      'status',         'debitado',
      'transacao_id',   v_transacao_id,
      'saldo_apos',     v_saldo_atual
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Já debitado pra esse pendente_id (retry idempotente).
      -- Devolve saldo atual sem aplicar nada.
      SELECT saldo_beneficios INTO v_saldo_atual
        FROM maxbank_contas WHERE id = v_conta_id;
      RETURN jsonb_build_object(
        'status',     'ja_debitado',
        'saldo_apos', v_saldo_atual
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.debitar_maxbank_beneficios(numeric, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_beneficios(numeric, text, uuid) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Coluna existe?
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'produtos' AND column_name = 'elegivel_beneficios';
--
--   -- RPC publicada?
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = 'debitar_maxbank_beneficios';
--
--   -- UNIQUE parcial criado?
--   SELECT indexname FROM pg_indexes
--    WHERE indexname = 'uq_maxbank_transacoes_pdv_beneficios';
-- =================================================================
