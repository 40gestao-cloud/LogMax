-- 526_20260824_a_marca_e_da_proposta_quando_o_item_ainda_nao_existe.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Na compra EVENTUAL, a marca é atributo da proposta — não cópia do cadastro
-- ═══════════════════════════════════════════════════════════════════════════
-- Hoje `produtos.marca` é texto livre, digitado no cadastro, muitas vezes dias
-- depois da compra e de memória. Nos dados de 24/08: 40 produtos ativos, 39
-- marcas distintas — 38 depois de normalizar caixa e espaço. Já nasceu o
-- primeiro par que só difere por digitação.
--
-- ── Por que a marca entra na COTAÇÃO, e só na eventual ──────────────────────
-- Compra eventual (migr. 358): o setor pede em texto livre ("camisa de linho
-- masculina") sem saber marca — e nem deve saber, quem pede descreve a
-- necessidade. Compras vai ao mercado e é NA PROPOSTA que a marca aparece pela
-- primeira vez: o fornecedor A oferece Foxton a R$ X, o B oferece Hering a
-- R$ Y. Ali a marca não é cópia de nada: o produto ainda não existe.
--
-- Isso conserta de quebra a comparação de propostas, que hoje põe lado a lado
-- fornecedor, valor, prazo e validade — e não diz O QUE está sendo comprado.
-- Duas marcas diferentes apareciam como se fossem o mesmo item, e a mais
-- barata ganhava sem ninguém ver que era outro produto.
--
-- Na REPOSIÇÃO (migr. 358: a requisição já tem `produto_id`) a regra é a
-- oposta: o produto existe e a marca é dele. Deixar a cotação guardar marca
-- ali criaria duas fontes para a mesma verdade — o defeito que a migr. 453
-- catalogou entre `produtos.status` e `produtos.ativo`, na mesma linha,
-- discordando. Por isso a trava é do BANCO e não da tela: a cotação nasce sem
-- marca quando a requisição aponta para o catálogo, venha de onde vier.
--
-- ── O que a marca da proposta NÃO faz ───────────────────────────────────────
-- Não escreve em `produtos.marca` sozinha. Ela SUGERE: quando o produto for
-- cadastrado com aquela requisição como origem, o campo Marca vem preenchido
-- e editável, e só a partir da cotação APROVADA — sugerir a marca de uma
-- proposta reprovada seria pior que o texto livre de hoje. Mesma régua do
-- fornecedor na migr. 488: a compra sugere, o cadastro confirma.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

ALTER TABLE public.cotacoes
  ADD COLUMN IF NOT EXISTS marca text;

COMMENT ON COLUMN public.cotacoes.marca IS
  'Migr. 526. Marca oferecida NESTA proposta. Só existe na compra eventual — na reposição a marca é do produto do catálogo, e o gatilho trg_cotacao_marca_so_na_eventual zera este campo.';

-- ────────────────────────────────────────────────────────────────────────────
-- A régua, no banco
-- ────────────────────────────────────────────────────────────────────────────
-- A cotação é criada por INSERT direto (PostgREST), não por RPC — então quem
-- garante a regra é gatilho, não guard de função. Ele também normaliza: espaço
-- sobrando e string vazia viram NULL, para "Foxton " e "" não virarem marcas.
CREATE OR REPLACE FUNCTION public.fn_cotacao_marca_so_na_eventual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_produto_id uuid;
BEGIN
  NEW.marca := NULLIF(btrim(COALESCE(NEW.marca, '')), '');

  IF NEW.marca IS NOT NULL THEN
    SELECT produto_id INTO v_produto_id
      FROM public.requisicoes WHERE id = NEW.requisicao_id;

    -- Reposição: o item já está no catálogo e a marca é dele. A proposta de
    -- outra marca não é a mesma compra — é outro item, e o caminho para isso
    -- é outra requisição, não um campo divergente aqui.
    IF v_produto_id IS NOT NULL THEN
      NEW.marca := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_cotacao_marca_so_na_eventual() IS
  'Migr. 526. Normaliza cotacoes.marca e a zera quando a requisição já aponta para um produto do catálogo — marca de item cadastrado é do cadastro.';

DROP TRIGGER IF EXISTS trg_cotacao_marca_so_na_eventual ON public.cotacoes;
CREATE TRIGGER trg_cotacao_marca_so_na_eventual
  BEFORE INSERT OR UPDATE OF marca, requisicao_id ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_cotacao_marca_so_na_eventual();

-- ────────────────────────────────────────────────────────────────────────────
-- A correção da proposta devolvida também corrige a marca
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco, com `p_marca` no fim e DEFAULT NULL — assim
-- a chamada de 4 argumentos do bundle antigo continua válida enquanto a PWA
-- não atualiza. Vide [feedback_replace_function_copiar_do_banco]: a assinatura
-- nova é OUTRA função, e a antiga tem de sair para não virar sobrecarga morta
-- (foi o que a migr. 518 fez com `reservar_codigo_produto` e a 523 desfez).
--
-- Diferente dos outros campos, marca em branco LIMPA: "tirei a marca da
-- proposta" é correção legítima, e o COALESCE guardaria o valor antigo dizendo
-- que deu certo — o defeito que a migr. 518 corrigiu no centro de custo.
DROP FUNCTION IF EXISTS public.reenviar_cotacao_corrigida(uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.reenviar_cotacao_corrigida(
  p_cotacao_id   uuid,
  p_valor_total  numeric,
  p_prazo_entrega text DEFAULT NULL::text,
  p_validade      text DEFAULT NULL::text,
  p_marca         text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot public.cotacoes;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Esta cotação não está em correção (está %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_is_service_role(), false) THEN
    IF NOT COALESCE(
         v_cot.criado_por = auth.uid()
         OR (public.auth_in_setor('compras', 'logistica')
             AND public.auth_pode_filial(v_cot.filial)), false) THEN
      RAISE EXCEPTION 'Só quem cadastrou a proposta (ou Compras da filial) corrige e reenvia.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(p_valor_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor da proposta precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET valor_total   = p_valor_total,
         prazo_entrega = COALESCE(NULLIF(trim(COALESCE(p_prazo_entrega, '')), ''), prazo_entrega),
         validade      = NULLIF(trim(COALESCE(p_validade, '')), '')::date,
         -- MIGR 526. O gatilho ainda passa por cima disto na reposição.
         marca         = NULLIF(btrim(COALESCE(p_marca, '')), ''),
         status        = 'Aguardando Financeiro',
         feedback      = NULL
   WHERE id = p_cotacao_id
  RETURNING * INTO v_cot;

  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ─────────────────────────────────────────────────────────────
--   -- UMA assinatura, com 5 argumentos:
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'reenviar_cotacao_corrigida';
--
--   -- a marca só sobrevive onde a requisição não aponta para o catálogo:
--   SELECT c.numero, c.marca, r.produto_id
--     FROM cotacoes c JOIN requisicoes r ON r.id = c.requisicao_id
--    WHERE c.marca IS NOT NULL AND r.produto_id IS NOT NULL;  -- espera zero linhas
