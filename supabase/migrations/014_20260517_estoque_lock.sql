-- =================================================================
-- LogMax — Trava de estoque (defesa em profundidade)
-- =================================================================
-- A UI passa a tratar `produtos.estoque` como read-only após criação.
-- Esta migration adiciona um trigger BEFORE UPDATE que reverte
-- silenciosamente qualquer tentativa de alterar `estoque` fora do
-- contexto da função `fn_atualiza_estoque_produto` (a via oficial
-- via movimentacoes_estoque).
--
-- Mecânica:
--   fn_atualiza_estoque_produto seta uma variável de sessão
--   `app.allow_estoque_update = 'true'` antes do seu próprio UPDATE.
--   O trigger guard só permite mudança quando essa flag está ligada.
--   Como a flag é local à transação (terceiro arg de set_config = true),
--   o efeito não vaza para queries subsequentes do mesmo client.
--
-- Idempotente.
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_atualiza_estoque_produto()
RETURNS TRIGGER AS $$
BEGIN
  -- Marca a transação atual como "permitida a mexer no estoque". A flag
  -- é resetada ao fim da transação (3º arg = true → is_local).
  PERFORM set_config('app.allow_estoque_update', 'true', true);

  IF NEW.tipo = 'Saída' THEN
    UPDATE produtos
       SET estoque = GREATEST(0, estoque - NEW.qtd)
     WHERE id = NEW.produto_id;
  ELSE
    UPDATE produtos
       SET estoque = estoque + NEW.qtd
     WHERE id = NEW.produto_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Guard: reverte silenciosamente qualquer UPDATE manual em produtos.estoque
-- vindo de fora do trigger oficial. Não levanta erro pra não quebrar fluxos
-- que enviem o valor antigo junto (UI editando outros campos).
CREATE OR REPLACE FUNCTION fn_block_estoque_manual()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estoque IS DISTINCT FROM OLD.estoque
     AND COALESCE(current_setting('app.allow_estoque_update', true), '') <> 'true' THEN
    NEW.estoque := OLD.estoque;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_block_estoque_manual ON produtos;
CREATE TRIGGER trg_block_estoque_manual
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION fn_block_estoque_manual();

COMMIT;
