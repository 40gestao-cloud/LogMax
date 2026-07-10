-- Item 5: Corrige vendas históricas sem filial (null → 'SuperMax').
-- Vendas anteriores à migration 20260517_holding_filial foram gravadas
-- sem filial; o fallback ?? 'SuperMax' em HistoricoVendasView já trata
-- o runtime, mas o estorno de movimentação também usava esse fallback.
UPDATE public.vendas
SET filial = 'SuperMax'
WHERE filial IS NULL;

-- Item 6: Corrige user_profiles sem filial ou com 'Matriz' (valor legado).
-- Usuários criados antes de 20260703f_user_profiles_ativo.sql ficaram
-- com filial NULL; 'Matriz' nunca foi uma filial operacional válida.
-- Padrão conservador: atribui 'SuperMax'. Ajuste manual necessário para
-- colaboradores reais de MaxLook/TechMax.
UPDATE public.user_profiles
SET filial = 'SuperMax'
WHERE filial IS NULL OR filial = 'Matriz';
