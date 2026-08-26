-- 550 — O EAN de 12 dígitos pulava a checagem de repetido.
--
-- `fn_produto_ean_valido` faz três coisas, nesta ordem: completa o dígito
-- verificador quando vêm 12 dígitos, valida o EAN-13, e recusa código de barras
-- já usado por outro produto da mesma unidade. A terceira é a que interessa —
-- "dois produtos com o mesmo EAN fazem o PDV vender o errado" são as palavras
-- dela.
--
-- Só que o caminho dos 12 dígitos termina em `RETURN NEW`:
--
--     IF length(v_digitos) = 12 THEN
--       NEW.ean := v_digitos || (SELECT ...dígito verificador...);
--       RETURN NEW;                     <── sai aqui
--     END IF;
--     ...
--     IF EXISTS (SELECT 1 FROM produtos p WHERE p.ean = v_digitos ...)  <── nunca chega
--
-- E 12 dígitos é o caso COMUM, não o exótico: é o que está impresso na caixa do
-- fornecedor. O comentário da própria função diz isso ("é o que vem impresso na
-- caixa do fornecedor sem o verificador"). Quem digita os 13 completos é quem
-- copiou de outro cadastro.
--
-- Então: o aluno cadastra o mesmo item duas vezes digitando os 12 dígitos da
-- caixa, o guard amigável não roda, e quem barra é o índice
-- `uq_produtos_ean_filial` — com a mensagem crua do Postgres, no Salvar, com o
-- formulário inteiro preenchido, foto de capa e ficha de nicho incluídas.
--
-- Há um segundo detalhe no mesmo bloco: o EXISTS compara `p.ean = v_digitos`, e
-- `v_digitos` no caminho de 13 é o número completo — certo. Mas se o caminho de
-- 12 caísse aqui sem ajuste, ele compararia 12 contra 13 e nunca acharia nada.
-- Por isso a correção não é só apagar o `RETURN`: é normalizar PRIMEIRO e
-- comparar depois, uma vez só, para os dois caminhos.
--
-- ─── E A GRADE ─────────────────────────────────────────────────────────────
--
-- `uq_produtos_variante` (filial + modelo_codigo + tamanho + cor) é o terceiro
-- índice único do catálogo e o único que ainda não tem tradução em lugar
-- nenhum — nem gatilho, nem `MSG_POR_CONSTRAINT` no front. O gerador de grade
-- da tela já pula o que existe ("O que já existe não é recriado"), mas o
-- cadastro manual de uma variante não passa por ele. Ganha a mesma frase que os
-- outros dois têm, nomeando o cadastro que já ocupa a combinação.
--
-- ─── A DIVISÃO DE SEMPRE ───────────────────────────────────────────────────
--
-- Quem GARANTE continua sendo o índice — a mesma régua da migr. 481, repetida
-- na 535 e na 538. O gatilho existe só para que a pessoa saiba o que fazer em
-- seguida, e para poder NOMEAR o cadastro que está no caminho, coisa que um
-- índice nunca faz.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. fn_produto_ean_valido — normaliza primeiro, confere depois
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_produto_ean_valido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_digitos text;
  v_dono    text;
BEGIN
  v_digitos := regexp_replace(COALESCE(NEW.ean, ''), '\D', '', 'g');

  IF v_digitos = '' THEN
    -- Mercadoria sem código de barras é digitação à mão na fila do caixa. Só
    -- não se cobra do que já estava assim antes desta regra.
    IF COALESCE(NEW.tipo, 'estoque_venda') = 'estoque_venda'
       AND (TG_OP = 'INSERT'
            OR regexp_replace(COALESCE(OLD.ean, ''), '\D', '', 'g') <> '') THEN
      RAISE EXCEPTION
        'Código de barras é obrigatório em mercadoria: é ele que o PDV lê. Patrimônio e material de uso e consumo não precisam.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.ean := NULL;
    RETURN NEW;
  END IF;

  -- 12 dígitos é o que vem impresso na caixa do fornecedor sem o verificador.
  -- Completar aqui é o mesmo que a tela faz, e evita gravar um número que
  -- nenhum leitor aceita.
  --
  -- MIGR 550: isto era um `RETURN NEW` — o caminho mais comum de todos saía da
  -- função antes da checagem de repetido logo abaixo, e quem barrava era o
  -- índice, com a mensagem do Postgres. Agora completa e SEGUE.
  IF length(v_digitos) = 12 THEN
    v_digitos := v_digitos || (
      SELECT ((10 - (SUM(substr(v_digitos, i, 1)::int
                         * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END) % 10)) % 10)::text
        FROM generate_series(1, 12) AS i
    );
  ELSIF NOT public.ean13_valido(v_digitos) THEN
    RAISE EXCEPTION
      'EAN-13 inválido: "%". São 12 dígitos (o verificador é calculado) ou 13 com o dígito verificador correto.',
      NEW.ean USING ERRCODE = 'P0001';
  END IF;

  -- Repetido dentro da MESMA loja: o leitor do caixa devolveria dois produtos.
  -- A comparação é sempre contra o número JÁ normalizado — era o outro lado do
  -- mesmo defeito: 12 dígitos nunca casariam com os 13 gravados.
  SELECT COALESCE(p.codigo || ' — ', '') || p.nome
    INTO v_dono
    FROM public.produtos p
   WHERE p.ean = v_digitos
     AND p.filial IS NOT DISTINCT FROM NEW.filial
     AND COALESCE(p.ativo, true)
     AND p.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF v_dono IS NOT NULL THEN
    RAISE EXCEPTION
      'O código de barras % já é do produto "%" nesta unidade. Dois produtos com o mesmo EAN fazem o PDV vender o errado. Se é o MESMO item, use o cadastro que já existe em vez de criar outro; se é outro produto, confira o número na embalagem — ou clique em "Gerar" para um código interno.',
      v_digitos, v_dono USING ERRCODE = 'P0001';
  END IF;

  NEW.ean := v_digitos;
  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A variante repetida ganha nome
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_produto_variante_ja_existe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tam  text;
  v_cor  text;
  v_dono text;
BEGIN
  IF NEW.modelo_codigo IS NULL OR COALESCE(NEW.ativo, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_tam := lower(btrim(COALESCE(NEW.atributos->>'tamanho', '')));
  v_cor := lower(btrim(COALESCE(NEW.atributos->>'cor', '')));

  SELECT COALESCE(p.codigo || ' — ', '') || p.nome
    INTO v_dono
    FROM public.produtos p
   WHERE p.filial = NEW.filial
     AND p.modelo_codigo = NEW.modelo_codigo
     AND lower(btrim(COALESCE(p.atributos->>'tamanho', ''))) = v_tam
     AND lower(btrim(COALESCE(p.atributos->>'cor', '')))     = v_cor
     AND p.ativo
     AND p.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF v_dono IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta variante já existe nesta unidade: "%"%. Cada combinação de tamanho e cor do modelo é um cadastro só — dois partem o estoque da peça em dois. Edite a que já existe, ou escolha outra combinação.',
      v_dono,
      CASE WHEN v_tam <> '' OR v_cor <> ''
           THEN ' (' || btrim(concat_ws(' / ', NULLIF(upper(v_tam), ''), NULLIF(initcap(v_cor), ''))) || ')'
           ELSE '' END
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_produto_variante_ja_existe ON public.produtos;
CREATE TRIGGER trg_produto_variante_ja_existe
  BEFORE INSERT OR UPDATE OF modelo_codigo, atributos, ativo, filial ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_variante_ja_existe();

COMMIT;
