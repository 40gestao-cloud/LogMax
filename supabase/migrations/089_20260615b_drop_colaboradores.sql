-- ============================================================================
-- DROP TABLE colaboradores (2026-06-15)
-- ============================================================================
-- Motivo: redundância com `funcionarios`. As duas tabelas representavam a
-- mesma entidade conceitual (pessoa que trabalha na empresa). `funcionarios`
-- é a tabela real, usada por Ponto, Folha, Férias, Afastamentos, Relatórios
-- RH, Gerenciamento RH e useUserProfile (11 arquivos). `colaboradores` era
-- usada APENAS pela própria ColaboradoresView — nenhum FK de produção
-- aponta pra ela.
--
-- Confirmação via grep: `REFERENCES colaboradores` retornou 0 matches em
-- supabase/migrations/. Todas as ocorrências de `colaborador_id` em outras
-- tabelas (MaxBank, metas, transferências) referenciam `user_profiles(id)`,
-- NÃO `colaboradores(id)`. Logo, drop não cascateia nada além da própria
-- tabela e suas policies/índices.
--
-- Frente 3.1 do refino — consolidação UX (sem feature nova).
-- ============================================================================

-- Idempotente: aceita re-aplicação sem erro. CASCADE remove qualquer
-- policy/índice/trigger residual.
DROP TABLE IF EXISTS public.colaboradores CASCADE;

-- ============================================================================
-- Rollback (manual, NÃO automatizar): restaurar a partir de
-- 20260516_colaboradores_celular.sql + 20260517_soft_delete.sql se necessário.
-- ============================================================================
