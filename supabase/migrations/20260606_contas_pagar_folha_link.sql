-- =================================================================
-- MaxBank — Link contas_pagar → folha_pagamento → carteira (mini-fix UX)
-- =================================================================
-- Gap encontrado em produção (2026-06-06): RH marcava conta_pagar
-- derivada da folha como Pago, achando que isso fechava o ciclo.
-- Mas folha continuava em Processada → RPC creditar_folha_maxbank
-- nunca rodava → carteira do colaborador zerada.
--
-- Esta migração liga os fluxos via trigger:
--   • Quando uma conta_pagar transita pra 'Pago' e a descrição
--     contém o marcador [folha:<uuid>] (gerado por handleStatusCycle
--     em FolhaPagamentoView.tsx), o trigger:
--       1. Extrai o folha_id da descrição.
--       2. Avança folha_pagamento.status pra 'Paga' (se ainda Processada).
--       3. Chama creditar_folha_maxbank(folha_id).
--   • Erros da RPC NÃO bloqueiam o UPDATE de contas_pagar — folha
--     pode ficar Paga mas sem crédito (ex.: funcionário sem vínculo).
--     RH ajusta cadastro depois e re-executa a RPC manualmente.
--
-- DEPENDÊNCIAS:
--   • 20260605b_maxbank_credito_folha.sql (RPC creditar_folha_maxbank).
--   • FolhaPagamentoView.tsx gera descrição com [folha:<uuid>].
--
-- IDEMPOTENTE: rodar várias vezes nas 4 instâncias com colaboradores
-- (ERP, Contabilidade, Aprendiz, ADM). NÃO rodar no MaxPOS-PDV.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION conta_pagar_avancar_folha_e_creditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folha_id   uuid;
  v_match      text;
BEGIN
  -- Só reage à transição → 'Pago'.
  IF NEW.status IS DISTINCT FROM 'Pago' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'Pago' THEN
    RETURN NEW;  -- já estava Pago, evita re-disparo.
  END IF;

  -- Extrai UUID da descrição: pattern '[folha:<uuid>]'.
  v_match := substring(NEW.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]');
  IF v_match IS NULL THEN
    RETURN NEW;  -- conta a pagar comum, não derivada de folha.
  END IF;

  BEGIN
    v_folha_id := v_match::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NEW;  -- marcador malformado, ignora.
  END;

  -- Avança folha pra Paga (só se ainda Processada — não força Paga em
  -- Pendente porque pula a etapa de gerar contas_pagar pra outra folha).
  UPDATE folha_pagamento
     SET status = 'Paga'
   WHERE id = v_folha_id
     AND status = 'Processada';

  -- Credita MaxBank. Erros (funcionário sem vínculo, salário inválido)
  -- NÃO bloqueiam o pagamento da conta — RH ajusta e re-executa.
  BEGIN
    PERFORM creditar_folha_maxbank(v_folha_id);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'creditar_folha_maxbank(%) falhou: %', v_folha_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contas_pagar_avancar_folha ON contas_pagar;
CREATE TRIGGER trg_contas_pagar_avancar_folha
  AFTER UPDATE OF status ON contas_pagar
  FOR EACH ROW
  WHEN (NEW.status = 'Pago' AND OLD.status <> 'Pago')
  EXECUTE FUNCTION conta_pagar_avancar_folha_e_creditar();

COMMIT;

-- =================================================================
-- VERIFICAÇÃO (rodar após a migração)
-- =================================================================
--   -- 1. Trigger registrado?
--   SELECT tgname FROM pg_trigger
--    WHERE tgname = 'trg_contas_pagar_avancar_folha';
--
--   -- 2. Recuperar casos antigos: contas_pagar Pago de folhas que
--   --    ainda estão em Processada (e podem render crédito MaxBank):
--   SELECT cp.id           AS conta_id,
--          substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')::uuid AS folha_id,
--          cp.status       AS conta_status,
--          fp.status       AS folha_status
--     FROM contas_pagar cp
--     JOIN folha_pagamento fp
--       ON fp.id = substring(cp.descricao FROM '\[folha:([0-9a-fA-F-]{36})\]')::uuid
--    WHERE cp.status = 'Pago'
--      AND fp.status = 'Processada';
--
--   -- 3. Forçar avanço + crédito retroativo nesses casos:
--   --    UPDATE contas_pagar SET status='Pago' WHERE id IN (...);  -- re-dispara trigger
--   --    OU chamar a RPC direto:
--   --    SELECT creditar_folha_maxbank('<folha_id>');
-- =================================================================
