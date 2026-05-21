-- =================================================================
-- LogMax — Inclui setor 'logistica' nos CHECKs de TI/notificações
-- =================================================================
-- Bug fix de 2026-05-20: o setor 'logistica' existe em user_profiles
-- (gerente/colaborador da malha estoque+compras) mas estava de fora
-- de chk_ti_setor (ti_chamados.setor_origem) e chk_notif_setor
-- (notificacoes.setor). Resultado: usuário logística não conseguia
-- abrir chamado e a notificação de retorno também explodia.
--
-- Idempotente — drop + recreate de cada constraint.
-- =================================================================

BEGIN;

-- ti_chamados.setor_origem
ALTER TABLE ti_chamados DROP CONSTRAINT IF EXISTS chk_ti_setor;
ALTER TABLE ti_chamados
  ADD CONSTRAINT chk_ti_setor
  CHECK (setor_origem IN (
    'empresa','compras','estoque','financeiro','rh',
    'vendas','marketing','logistica','ia','equipamentos'
  ));

-- notificacoes.setor
ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS chk_notif_setor;
ALTER TABLE notificacoes
  ADD CONSTRAINT chk_notif_setor
  CHECK (setor IN (
    'empresa','compras','estoque','financeiro','rh',
    'vendas','marketing','logistica','ti','all'
  ));

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   Como user setor='logistica':
--     SELECT notificar_setor('ti', 'ti_chamado', 'teste');  -- deve passar
--   INSERT em ti_chamados com setor_origem='logistica' agora aceita.
-- =================================================================
