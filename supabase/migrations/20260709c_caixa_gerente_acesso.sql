-- =================================================================
-- LogMax — Controle de Caixa: libera acesso pra gerente
-- =================================================================
-- Contexto: `caixa_filial_select`/`caixa_filial_write` (controle_caixa)
-- e `mov_caixa_all` (movimentacoes_caixa) exigiam auth_in_setor(
-- 'financeiro', 'vendas'). Gerente de setor diferente (ex.: logística,
-- RH) ficava travado do Caixa da própria filial, mesmo sendo quem
-- responde pela unidade. Front (ControleCaixaView) já libera a tela
-- pra role='gerente' — RLS precisa acompanhar. Isolamento por filial
-- continua garantido por `auth_pode_filial(filial)`.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "caixa_filial_select" ON public.controle_caixa;
DROP POLICY IF EXISTS "caixa_filial_write"  ON public.controle_caixa;

CREATE POLICY "caixa_filial_select"
  ON public.controle_caixa
  FOR SELECT TO authenticated
  USING (
    (auth_in_setor('financeiro', 'vendas') OR auth_user_role() = 'gerente')
    AND auth_pode_filial(filial)
  );

CREATE POLICY "caixa_filial_write"
  ON public.controle_caixa
  FOR ALL TO authenticated
  USING (
    (auth_in_setor('financeiro', 'vendas') OR auth_user_role() = 'gerente')
    AND auth_pode_filial(filial)
  )
  WITH CHECK (
    (auth_in_setor('financeiro', 'vendas') OR auth_user_role() = 'gerente')
    AND auth_pode_filial(filial)
  );

DROP POLICY IF EXISTS "mov_caixa_all" ON public.movimentacoes_caixa;
CREATE POLICY "mov_caixa_all" ON public.movimentacoes_caixa
  FOR ALL TO authenticated
  USING      (auth_in_setor('financeiro', 'vendas') OR auth_user_role() = 'gerente')
  WITH CHECK (auth_in_setor('financeiro', 'vendas') OR auth_user_role() = 'gerente');

COMMIT;
