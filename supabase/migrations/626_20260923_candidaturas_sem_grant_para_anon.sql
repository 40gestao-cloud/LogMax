-- 626 — candidaturas: anon não tem nada a fazer aqui.
--
-- Achado da varredura dos buckets depois da 625: `curriculos_read` libera o
-- arquivo para quem enxerga uma candidatura apontando para ele — a mesma forma
-- do furo de `contratos` (624) e `documentos` (625). Hoje não vaza porque
-- `candidaturas` só tem policy de SELECT (para authenticated) e a única escrita
-- é a RPC `responder_convite_vaga`, que exige o currículo na pasta de quem
-- responde. Exercitado como gerente em transação revertida: INSERT barrado
-- pela RLS, UPDATE com 0 linhas.
--
-- Mas o anon seguia com SELECT/INSERT/UPDATE na tabela (grant padrão do
-- schema). Barrado só pela falta de policy — uma policy de escrita criada
-- amanhã sem `TO authenticated` reabre o caminho. Nenhuma tela lê ou grava
-- candidaturas antes do login.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

REVOKE ALL ON TABLE public.candidaturas FROM PUBLIC, anon;

COMMIT;
