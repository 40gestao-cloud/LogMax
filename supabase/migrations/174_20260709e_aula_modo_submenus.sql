-- =================================================================
-- LogMax — Modo Aula: whitelist granular de submenus
-- =================================================================
-- Extensão do 20260709d_aula_modo. Além de escolher módulos top-level,
-- o professor pode limitar submenus específicos dentro de um módulo
-- (ex.: dentro de Compras liberar só Requisições e Pedidos).
--
-- Modelo: `submenus_ativos text[]` guarda viewIds completos tipo
-- 'compras-requisições'. Se algum item começar com `<mod>-`, aquele
-- módulo entra em whitelist de submenu (só os listados aparecem).
-- Se NENHUM item de um módulo consta no array, todos os submenus dele
-- ficam liberados (comportamento pré-existente / backward-compat).
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.aula_config
  ADD COLUMN IF NOT EXISTS submenus_ativos text[] NOT NULL DEFAULT '{}';

COMMIT;
