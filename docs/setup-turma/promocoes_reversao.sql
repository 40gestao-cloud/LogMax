-- ============================================================
-- LogMax — Reversão automática de promoções expiradas
-- Execute este script no SQL Editor do Supabase
-- ============================================================
--
-- Problema resolvido:
--   Ao aprovar uma promoção, `produtos.preco` é setado para `preco_promocional`.
--   Não havia mecanismo para restaurar o preço original ao fim da campanha,
--   causando erosão silenciosa de margem.
--
-- Solução:
--   `marketing_promocoes.preco_atual` já guarda o snapshot do preço no
--   momento da proposta. Esta RPC encontra promoções aprovadas cuja
--   `data_fim` já passou e restaura o preço a partir do snapshot.
--
-- Guard contra ajuste manual:
--   Só restaura se `produtos.preco` ainda é igual ao `preco_promocional`.
--   Se alguém ajustou o preço manualmente durante a campanha (sem revogar),
--   esse ajuste é preservado. A promoção é marcada como Encerrada de
--   qualquer forma para fechar o ciclo de vida.
-- ============================================================

CREATE OR REPLACE FUNCTION reverter_promocoes_expiradas()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec   RECORD;
  total INT := 0;
BEGIN
  FOR rec IN
    SELECT id, produto_id, preco_atual, preco_promocional
    FROM marketing_promocoes
    WHERE status     = 'Aprovado'
      AND data_fim IS NOT NULL
      AND data_fim   < CURRENT_DATE
      AND produto_id IS NOT NULL
  LOOP
    -- Restaura preço apenas se ainda é o promocional (respeita ajuste manual).
    UPDATE produtos
       SET preco = rec.preco_atual
     WHERE id    = rec.produto_id
       AND preco = rec.preco_promocional;

    -- Fecha o ciclo de vida da campanha independentemente do guard acima.
    UPDATE marketing_promocoes
       SET status = 'Encerrada'
     WHERE id     = rec.id;

    total := total + 1;
  END LOOP;

  RETURN total;
END;
$$;

-- authenticated → frontend pode disparar reversão sob demanda ao abrir tela.
-- service_role (usado pelo Vercel Cron) já bypassa permissões.
GRANT EXECUTE ON FUNCTION reverter_promocoes_expiradas() TO authenticated;
