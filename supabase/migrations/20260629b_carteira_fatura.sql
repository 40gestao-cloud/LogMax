-- Adiciona 'fatura' às carteiras permitidas em maxbank_transacoes
-- Necessário para registrar compras Cartão Crédito (não debita saldo, vai pra fatura)

ALTER TABLE maxbank_transacoes
  DROP CONSTRAINT IF EXISTS maxbank_transacoes_carteira_check;

ALTER TABLE maxbank_transacoes
  ADD CONSTRAINT maxbank_transacoes_carteira_check
  CHECK (carteira IN ('salario', 'beneficios', 'bonificacoes', 'fatura'));
