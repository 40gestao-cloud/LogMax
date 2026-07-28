-- MaxBank: o saldo volta a ter razão que o explique.
--
-- Sonda S2 (razão × agregado) no LogMax-ERP, 2026-07-28: 10 das 10 carteiras
-- divergentes. Uma delas com R$ 33.695,30 de saldo e R$ 0,00 de extrato.
--
-- A causa não é bug de escrita — as 9 RPCs que mexem em saldo registram
-- transação. É a migração 096 (reset de dados operacionais, 2026-06-18): ela
-- apagou `maxbank_transacoes` e preservou `maxbank_contas` de propósito
-- ("saldo preservado"). O dinheiro ficou; a explicação dele, não.
--
-- Duas consequências:
--
--   M1  O extrato do colaborador mente por omissão. A carteira mostra um saldo
--       que nenhum lançamento visível produz.
--
--   M2  `recompute_saldos_maxbank` reescreve o saldo com a soma do extrato.
--       Chamada hoje, pelo botão que existe no modal de carteira da Folha, ela
--       zera o saldo do colaborador — e o texto de confirmação promete o
--       oposto ("zerar drift de testes antigos"). É uma trava de segurança
--       apontada para o próprio pé.
--
-- A correção não move dinheiro: dá lastro ao que já existe, com um crédito de
-- abertura por carteira divergente. Depois disso razão = saldo, e a recompute
-- volta a ser a operação inócua que a tela promete.
--
-- IDEMPOTENTE: reaplicar não duplica (índice único por conta+carteira) e vira
-- no-op quando não há divergência. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Abertura só pode existir uma vez por carteira
-- ────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_tx_saldo_anterior
  ON public.maxbank_transacoes (conta_id, carteira)
  WHERE origem = 'saldo_anterior';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Crédito de abertura = saldo atual − razão existente
-- ────────────────────────────────────────────────────────────────────────────
-- Só entra onde o saldo é MAIOR que o razão, que é a forma que o reset da 096
-- produz. O caso inverso (razão maior que saldo) seria perda de saldo, não
-- falta de lastro — esse não se conserta às cegas, e a verificação abaixo o
-- denuncia se existir.

WITH razao AS (
  SELECT conta_id, carteira,
         sum(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END) AS total
    FROM public.maxbank_transacoes
   GROUP BY 1, 2
),
saldos AS (
  SELECT c.id AS conta_id, x.carteira, x.saldo
    FROM public.maxbank_contas c
    CROSS JOIN LATERAL (VALUES
      ('salario',      c.saldo_salario),
      ('beneficios',   c.saldo_beneficios),
      ('bonificacoes', c.saldo_bonificacoes)
    ) AS x(carteira, saldo)
)
INSERT INTO public.maxbank_transacoes
  (conta_id, tipo, carteira, valor, descricao, origem, origem_id)
SELECT s.conta_id, 'credito', s.carteira,
       s.saldo - COALESCE(r.total, 0),
       'Saldo anterior — histórico anterior ao reset de dados (migr. 096)',
       'saldo_anterior', s.conta_id
  FROM saldos s
  LEFT JOIN razao r ON r.conta_id = s.conta_id AND r.carteira = s.carteira
 WHERE s.saldo - COALESCE(r.total, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.maxbank_transacoes t
      WHERE t.conta_id = s.conta_id AND t.carteira = s.carteira
        AND t.origem = 'saldo_anterior');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A abertura não pode ser apagada pela UI
-- ────────────────────────────────────────────────────────────────────────────
-- `excluir_transacao_maxbank` debita o saldo ao remover o lançamento. Aplicada
-- à abertura, ela recriaria exatamente a divergência que esta migração fecha —
-- e o modal de carteira oferece o botão de excluir em toda linha do extrato.

CREATE OR REPLACE FUNCTION public.maxbank_tx_protege_abertura()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- auth.uid() nulo = SQL editor / service role: manutenção continua possível.
  IF OLD.origem = 'saldo_anterior' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'O saldo anterior é lastro do saldo atual e não pode ser excluído pela tela.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_maxbank_tx_protege_abertura ON public.maxbank_transacoes;
CREATE TRIGGER trg_maxbank_tx_protege_abertura
  BEFORE DELETE ON public.maxbank_transacoes
  FOR EACH ROW EXECUTE FUNCTION public.maxbank_tx_protege_abertura();

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (S2 do plano — deve voltar zero divergentes)
-- ════════════════════════════════════════════════════════════════════════════
--   WITH led AS (
--     SELECT conta_id, carteira,
--            sum(CASE WHEN tipo='credito' THEN valor ELSE -valor END) AS ledger
--       FROM maxbank_transacoes GROUP BY 1,2)
--   SELECT c.id, c.saldo_salario, COALESCE(s.ledger,0) AS razao_salario,
--          c.saldo_beneficios, COALESCE(b.ledger,0) AS razao_beneficios,
--          c.saldo_bonificacoes, COALESCE(o.ledger,0) AS razao_bonificacoes
--     FROM maxbank_contas c
--     LEFT JOIN led s ON s.conta_id=c.id AND s.carteira='salario'
--     LEFT JOIN led b ON b.conta_id=c.id AND b.carteira='beneficios'
--     LEFT JOIN led o ON o.conta_id=c.id AND o.carteira='bonificacoes'
--    WHERE c.saldo_salario      <> COALESCE(s.ledger,0)
--       OR c.saldo_beneficios   <> COALESCE(b.ledger,0)
--       OR c.saldo_bonificacoes <> COALESCE(o.ledger,0);
--
--   -- Aberturas criadas:
--   SELECT count(*), sum(valor) FROM maxbank_transacoes WHERE origem='saldo_anterior';
-- ════════════════════════════════════════════════════════════════════════════
