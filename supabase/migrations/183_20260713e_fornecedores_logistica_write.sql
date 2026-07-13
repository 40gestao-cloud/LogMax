-- =================================================================
-- LogMax — Fornecedores: libera escrita pro setor logística
-- =================================================================
-- Contexto: o módulo Cadastros (Categorias/Produtos/Fornecedores/
-- Serviços) é liberado no front pra admin/CEO e setor logística
-- (sectorAccess.ts SETOR_MODULES.logistica inclui 'cadastros'; ver
-- comentário em App.tsx no menuModules['cadastros']). A policy de
-- escrita em `fornecedores`, porém, ficou travada em
-- auth_in_setor('compras', 'financeiro') desde 20260516_rls_hardening
-- (reafirmada em 20260708d_rls_por_filial) — nunca acompanhou a
-- liberação do módulo pra logística. Resultado: colaborador de
-- logística vê a tela de Fornecedores mas RLS rejeita o INSERT/UPDATE.
--
-- Isolamento por filial (auth_pode_filial) não muda.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP POLICY IF EXISTS "write_fornecedores" ON public.fornecedores;
CREATE POLICY "write_fornecedores" ON public.fornecedores FOR ALL TO authenticated
  USING (auth_in_setor('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('compras', 'financeiro', 'logistica') AND auth_pode_filial(filial));

COMMIT;
