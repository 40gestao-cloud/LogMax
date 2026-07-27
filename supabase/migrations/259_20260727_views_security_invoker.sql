-- =================================================================
-- LogMax — Fecha alertas CRITICAL do Supabase Advisor
--          (Security Definer View) — 2026-07-27
-- =================================================================
-- CONTEXTO
-- --------
-- Views criadas em migrations herdam o owner = postgres. Por padrão
-- Postgres, uma view roda com privilégio do OWNER, não do caller —
-- ou seja, RLS das tabelas base é bypassado. Colaborador consegue
-- `SELECT` na view e ler dados que a policy da tabela subjacente
-- proibiria em SELECT direto.
--
-- Fix: `security_invoker=true` em cada view faz ela rodar com
-- privilégio de QUEM consulta — RLS das tabelas base volta a valer.
--
-- Views afetadas (todas em public):
--   v_pedido_saldo, v_venda_saldo_devolucao,
--   avaliacoes_matriz_agregado, avaliacoes_matriz_placar_filial,
--   frequencia_trabalho_com_filial
--
-- Idempotente. Aplicar no Supabase SQL Editor.
-- =================================================================

BEGIN;

ALTER VIEW public.v_pedido_saldo                 SET (security_invoker = true);
ALTER VIEW public.v_venda_saldo_devolucao        SET (security_invoker = true);
ALTER VIEW public.avaliacoes_matriz_agregado     SET (security_invoker = true);
ALTER VIEW public.avaliacoes_matriz_placar_filial SET (security_invoker = true);
ALTER VIEW public.frequencia_trabalho_com_filial SET (security_invoker = true);

COMMIT;
