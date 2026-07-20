-- =================================================================
-- LogMax — Fix de dado: filiais ativas com nicho errado
-- =================================================================
-- Contexto: em 2026-07-13 foram criados 3 registros novos em `filiais`
-- ("SuperMax", "MaxLook", "TechMax") com dados operacionais completos
-- (aluguel, m², equipamentos etc.), mas `detalhes.nicho` gravou
-- "Matriz" — provavelmente porque o save aconteceu com o topbar em
-- Modo Matriz (o campo nicho vem da unidade ativa, sem seletor
-- explícito no form). Em 2026-07-19 os registros originais e
-- corretamente tagueados ("SuperMax Supermercado" etc., sem dados
-- operacionais) foram inativados por parecerem duplicados.
--
-- Resultado: gerente/colaborador da própria unidade não via a filial
-- em "Modo Filiais" (filtro client-side por nicho não batia com o
-- único registro ativo), embora RLS liberasse a leitura — admin em
-- Modo Matriz via normalmente por não filtrar por nicho.
--
-- Corrige o `nicho` dos 3 registros ativos pro valor certo. Os 3
-- registros antigos inativos (sem dados) ficam como estão.
--
-- Idempotente.
-- =================================================================

BEGIN;

UPDATE public.filiais SET detalhes = jsonb_set(detalhes, '{nicho}', '"SuperMax"')
  WHERE id = '9169df99-68e0-4c17-9abd-f5d9e16ae200' AND nome = 'SuperMax';

UPDATE public.filiais SET detalhes = jsonb_set(detalhes, '{nicho}', '"MaxLook"')
  WHERE id = '72bde701-3bb6-4915-9fcd-e2661b6dfcb0' AND nome = 'MaxLook';

UPDATE public.filiais SET detalhes = jsonb_set(detalhes, '{nicho}', '"TechMax"')
  WHERE id = 'b9d21ee5-3018-461c-9e45-91b6b1be6b63' AND nome = 'TechMax';

COMMIT;
