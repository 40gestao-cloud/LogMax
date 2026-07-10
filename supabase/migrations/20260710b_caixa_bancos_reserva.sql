-- Marca uma conta/caixa como "reserva de emergência".
-- A soma dos saldos das contas com is_reserva=true representa o dinheiro
-- guardado pra emergências dentro da filial; o resto e' operacional.
-- CaixaBancosView usa essa flag pra colorir a linha e calcular o resumo
-- "Reserva" no card do topo.

BEGIN;

-- Pré-requisitos idempotentes (ambientes atrasados podem não ter
-- 20260517_soft_delete.sql ou 20260707b_caixa_bancos_filial_bloqueio.sql).
ALTER TABLE public.caixa_bancos ADD COLUMN IF NOT EXISTS ativo  boolean NOT NULL DEFAULT true;
ALTER TABLE public.caixa_bancos ADD COLUMN IF NOT EXISTS filial text;

ALTER TABLE public.caixa_bancos
  ADD COLUMN IF NOT EXISTS is_reserva boolean NOT NULL DEFAULT false;

-- Index parcial pra acelerar o "somar reserva por filial" no card resumo.
CREATE INDEX IF NOT EXISTS idx_caixa_bancos_reserva_filial
  ON public.caixa_bancos (filial) WHERE is_reserva = true AND ativo = true;

COMMIT;
