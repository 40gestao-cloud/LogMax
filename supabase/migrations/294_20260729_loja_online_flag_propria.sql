-- 294 — A loja da filial ganha a própria flag, em vez de pegar emprestada.
--
-- ERRO DA 293. Ela mandou o endpoint da loja filtrar por `produtos.vitrine_publica`.
-- Essa coluna já tinha dono desde 24/07: é o carrossel da TELA DE LOGIN,
-- institucional da holding, controlado só pela Matriz em Sessões Gerais →
-- Marketing (vide `get_vitrine_publica` e VitrinePublicaView).
--
-- Reusar a flag produzia três defeitos:
--   1. publicar um produto na loja da MaxLook o jogava no carrossel de login
--      de todo mundo;
--   2. tirar do carrossel tirava da loja, sem ninguém entender por quê;
--   3. a filial não decide o que entra na própria loja — a Matriz decide,
--      o que contradiz a régua de quem opera a venda.
--
-- `loja_online` é decisão da filial sobre o próprio catálogo. `vitrine_publica`
-- continua sendo decisão da Matriz sobre a vitrine institucional. Duas
-- perguntas diferentes, duas colunas.
--
-- Sem backfill a partir de `vitrine_publica`: os 3 produtos marcados hoje
-- foram escolhidos para o carrossel de login, não para vender online. Herdar
-- essa escolha seria assumir uma decisão que ninguém tomou — a loja começa
-- vazia e a filial publica o que quiser.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS loja_online boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.produtos.loja_online IS
  'Produto publicado na loja pública da própria filial (hub). Decisão da '
  'filial. NÃO confundir com `vitrine_publica`, que é o carrossel da tela de '
  'login e é decisão da Matriz. Migração 294.';

-- O endpoint da loja consulta sempre por (filial, loja_online, estoque).
CREATE INDEX IF NOT EXISTS idx_produtos_loja_online
  ON public.produtos (filial, loja_online)
  WHERE loja_online AND COALESCE(ativo, true);

-- ────────────────────────────────────────────────────────────────────────────
-- Quem publica na loja
--
-- Mesma régua de quem atende o pedido (auth_opera_loja): vendas ou marketing
-- da filial, gerente da filial, Matriz. Um colaborador de outro setor não
-- decide o que vai para o público.
--
-- A checagem mora num trigger e não numa policy porque `produtos` já tem RLS
-- de escrita própria (logística cadastra produto) — o que muda aqui é só
-- quem pode virar ESTA chave, não quem pode editar o produto.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.produto_loja_online_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.loja_online IS NOT DISTINCT FROM OLD.loja_online THEN
    RETURN NEW;
  END IF;

  IF NOT public.auth_opera_loja(COALESCE(NEW.filial, OLD.filial)) THEN
    RAISE EXCEPTION 'Publicar na loja pública é de vendas, marketing, gerente da filial ou Matriz.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_produto_loja_online_guard ON public.produtos;
CREATE TRIGGER trg_produto_loja_online_guard
  BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.produto_loja_online_guard();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- As duas flags são independentes (loja começa zerada):
--   SELECT filial,
--          count(*) FILTER (WHERE vitrine_publica) AS no_carrossel_login,
--          count(*) FILTER (WHERE loja_online)     AS na_loja_da_filial
--     FROM produtos WHERE COALESCE(ativo,true) GROUP BY 1 ORDER BY 1;
-- ────────────────────────────────────────────────────────────────────────────
