-- ============================================================
--  Controle de Caixa — índice único parcial por linhas ativas
-- ============================================================
-- Problema:
--   O índice `uq_controle_caixa_data` era único apenas por `data`,
--   sem filtrar por `ativo`. Quando o usuário fazia soft-delete
--   (ativo=false) de uma sessão e tentava abrir uma nova no mesmo
--   dia, o INSERT batia em 23505 ("Já existe sessão aberta hoje").
--
-- Solução:
--   Recriar o índice como UNIQUE PARTIAL, válido apenas para
--   linhas ativas. Sessões soft-deletadas deixam de bloquear.
-- ============================================================

DROP INDEX IF EXISTS uq_controle_caixa_data;

CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_caixa_data_ativo
  ON controle_caixa (data)
  WHERE ativo = true;
