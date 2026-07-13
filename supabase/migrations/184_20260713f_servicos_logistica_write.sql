-- =================================================================
-- LogMax — Serviços: libera escrita pro setor logística
-- =================================================================
-- Mesmo caso de fornecedores (20260713e_fornecedores_logistica_write):
-- o módulo Cadastros (Categorias/Produtos/Fornecedores/Serviços) é
-- liberado no front pra admin/CEO e setor logística (sectorAccess.ts),
-- mas `write_servicos` ficou travado em auth_is_admin() desde
-- 20260516_rls_hardening — nunca acompanhou a liberação do módulo.
--
-- Isolamento por filial (auth_pode_filial) já estava correto desde
-- 20260708d_rls_por_filial (read_servicos); write passa a usar o
-- mesmo gate.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "write_servicos" ON public.servicos;
CREATE POLICY "write_servicos" ON public.servicos FOR ALL TO authenticated
  USING (auth_in_setor('logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('logistica') AND auth_pode_filial(filial));

COMMIT;
