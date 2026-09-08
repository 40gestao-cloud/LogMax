-- ════════════════════════════════════════════════════════════════════════════
-- 591 — A compra eventual também vem em fardo
--
-- A migr. 589 abriu o pedido em embalagem fechada só para a REPOSIÇÃO, com o
-- argumento de que o fator tem de vir do banco e não do navegador — a lição da
-- marca (582) e do nome do item (344).
--
-- O argumento não vale aqui, e a pergunta certa foi feita: "não posso comprar
-- um fardo de 30 na eventual?". Pode, e é o caso comum — sacola plástica vem em
-- fardo de 500 e não está no catálogo de ninguém. Na eventual o item, a
-- unidade, a marca e a justificativa JÁ vêm do solicitante: é isso que
-- "eventual" quer dizer. Não existe cadastro do qual o fator possa divergir,
-- então não há verdade do servidor a proteger — a declaração de quem pede É o
-- documento, e é ela que Compras vai cotar.
--
-- O que sobrava era o aluno escrever o fardo no NOME do item ("Sacola 50x60 —
-- fardo com 500") e digitar a quantidade em unidades, ou em fardos, ou no que
-- lhe parecesse. Está nos dados desta base: requisições como "Òleo de Soja
-- (900 ml) 20 UN" com quantidade "1 PCT". Ninguém consegue cotar isso sem
-- perguntar de volta.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
-- A eventual passa a declarar a embalagem junto do item: FARDO, 30 UN em cada,
-- 20 fardos. Grava `qtd = 600` como sempre, com o par ao lado — as mesmas três
-- colunas da 589, as mesmas restrições, e o gatilho da 590 continua tomando
-- conta da coerência quando alguém corrigir a quantidade.
--
-- ── A régua da lista, agora com nome ────────────────────────────────────────
--
-- `embalagem_compra_valida()` nasce aqui porque a lista fechada passa a ser
-- consultada em dois lugares (o CHECK de `produtos` e esta RPC). Mesma solução
-- da migr. 456 com `unidade_fracionaria()`: régua duplicada sem nome é como a
-- ficha do produto foi parar em três arquivos. O CHECK de `produtos` é
-- reescrito para usá-la — nenhuma linha existente viola, porque a lista é a
-- mesma.
--
-- ── Serviço não vem em caixa ────────────────────────────────────────────────
--
-- A unidade SV é a forma de pedir manutenção, frete, licença, dedetização
-- (migr. 358). Nada disso se compra em fardo, e deixar passar produziria
-- "3 CAIXAS de dedetização" na fila do comprador.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A lista fechada, com nome ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.embalagem_compra_valida(p_nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Espelho de EMBALAGENS_COMPRA em src/lib/unidades.ts. Mudou lá, muda aqui —
  -- e vice-versa.
  SELECT upper(btrim(COALESCE(p_nome, ''))) IN
    ('FARDO', 'CAIXA', 'PACOTE', 'SACO', 'ENGRADADO', 'DÚZIA')
$function$;

COMMENT ON FUNCTION public.embalagem_compra_valida(text) IS
  'Embalagem de compra reconhecida (migr. 591). Espelho de EMBALAGENS_COMPRA em src/lib/unidades.ts — usada pelo CHECK de produtos e pela criação de requisição eventual.';

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_embalagem_nome;
ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_embalagem_nome
  CHECK (embalagem_compra IS NULL OR public.embalagem_compra_valida(embalagem_compra));

COMMENT ON CONSTRAINT chk_produtos_embalagem_nome ON public.produtos IS
  'Embalagem de compra vem da lista fechada (migr. 589, régua nomeada na 591). Texto livre viraria "fardo"/"Fardo"/"fd" na mesma coluna.';

-- ── 2. A eventual declara a própria embalagem ───────────────────────────────
--
-- Sucede a definição da migr. 589 (copiada do banco). Só o ramo da Eventual
-- muda; o da Reposição continua lendo o fator do cadastro, porque lá o cadastro
-- existe e é ele que manda.

CREATE OR REPLACE FUNCTION public.criar_requisicoes_compra_lote(
  p_itens jsonb,
  p_solicitante text,
  p_urgencia text DEFAULT 'Normal'::text,
  p_centro_custo text DEFAULT NULL::text,
  p_filial text DEFAULT 'SuperMax'::text,
  p_justificativa text DEFAULT NULL::text,
  p_data_necessidade date DEFAULT NULL::date,
  p_tipo_requisicao text DEFAULT 'Eventual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_elem      jsonb;
  v_req       requisicoes;
  v_prod      produtos;
  v_resultado jsonb := '[]'::jsonb;
  v_qtd       numeric;
  v_texto     text;
  v_unidade   text;
  v_marca     text;
  v_just_item text;
  v_just_cab  text;
  v_nome      text;
  v_setor     text;
  v_reposicao boolean;
  v_emb_qtd   numeric;
  v_emb_nome  text;
  v_emb_fator numeric;
BEGIN
  PERFORM public._assert_rpc();

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo_requisicao IS NULL OR p_tipo_requisicao NOT IN ('Reposição','Eventual') THEN
    RAISE EXCEPTION 'Tipo de requisição inválido: %. Use Reposição ou Eventual.', p_tipo_requisicao
      USING ERRCODE = 'P0001';
  END IF;
  v_reposicao := p_tipo_requisicao = 'Reposição';

  v_just_cab := NULLIF(trim(COALESCE(p_justificativa, '')), '');
  IF v_just_cab IS NOT NULL AND length(v_just_cab) < 10 THEN
    RAISE EXCEPTION 'A justificativa é obrigatória — é o que o gerente lê para decidir.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;
  IF p_data_necessidade IS NOT NULL AND p_data_necessidade < public.acre_today() THEN
    RAISE EXCEPTION 'A data de necessidade não pode estar no passado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := COALESCE(NULLIF(replace(btrim(COALESCE(v_elem->>'qtd', '')), ',', '.'), '')::numeric, 1);
    IF v_qtd <= 0 THEN v_qtd := 1; END IF;
    v_emb_qtd   := NULLIF(replace(btrim(COALESCE(v_elem->>'qtd_embalagens', '')), ',', '.'), '')::numeric;
    v_emb_nome  := NULL;
    v_emb_fator := NULL;

    IF v_reposicao THEN
      IF (v_elem->>'produto_id') IS NULL THEN
        RAISE EXCEPTION 'Reposição precisa de um produto do catálogo. Para item que não existe no cadastro, use Compra eventual.'
          USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_prod FROM public.produtos
       WHERE id = (v_elem->>'produto_id')::uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado no catálogo.' USING ERRCODE = 'P0002';
      END IF;
      IF v_prod.filial IS NOT NULL AND v_prod.filial <> p_filial THEN
        RAISE EXCEPTION 'O produto "%" é de outra unidade.', v_prod.nome USING ERRCODE = '42501';
      END IF;

      IF v_prod.ativo IS NOT TRUE OR COALESCE(v_prod.status, 'Ativo') = 'Inativo' THEN
        RAISE EXCEPTION '"%" foi tirado do catálogo desta unidade e não pode ser reposto. Reative-o em Cadastros > Lixeira antes de pedir, ou peça outro item.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;
      IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
        RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não se repõe: ele não tem saldo de estoque. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado — o bem aparece em Financeiro > Patrimônio, com vida útil e depreciação. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo dele em Cadastros > Produtos.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;

      -- MIGR 589: na reposição o fator é o do CADASTRO. A tela manda quantos
      -- fardos; quantas unidades cabem em um, quem diz é o catálogo.
      IF v_emb_qtd IS NOT NULL THEN
        IF v_prod.embalagem_compra IS NULL OR COALESCE(v_prod.embalagem_qtd, 0) <= 1 THEN
          RAISE EXCEPTION '"%" não tem embalagem de compra cadastrada, então não dá para pedir por fardo. Informe a embalagem no cadastro do produto (Cadastros > Produtos > Estoque) ou peça na unidade solta.',
            v_prod.nome USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_qtd <= 0 THEN
          RAISE EXCEPTION 'Quantas embalagens de "%"? O número tem de ser maior que zero.', v_prod.nome
            USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_qtd <> trunc(v_emb_qtd) THEN
          RAISE EXCEPTION 'Embalagem fechada não se parte: peça um número inteiro de % de "%", não %.',
            v_prod.embalagem_compra, v_prod.nome, v_emb_qtd USING ERRCODE = 'P0001';
        END IF;
        v_emb_nome  := v_prod.embalagem_compra;
        v_emb_fator := v_prod.embalagem_qtd;
        v_qtd := v_emb_qtd * v_emb_fator;
      END IF;

      v_texto     := v_prod.nome;
      v_unidade   := COALESCE(NULLIF(upper(btrim(COALESCE(v_prod.unidade,''))), ''), 'UN');
      v_marca     := NULLIF(btrim(COALESCE(v_prod.marca, '')), '');
      v_just_item := NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), '');

      INSERT INTO public.requisicoes (
        item, marca, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao, produto_id, saldo_no_pedido, minimo_no_pedido,
        qtd_embalagens, embalagem_nome, embalagem_fator
      ) VALUES (
        v_texto, v_marca,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Reposição', v_prod.id, v_prod.estoque, v_prod.estoque_minimo,
        v_emb_qtd, v_emb_nome, v_emb_fator
      )
      RETURNING * INTO v_req;

    ELSE
      v_texto := trim(COALESCE(v_elem->>'item', ''));
      IF v_texto = '' THEN
        RAISE EXCEPTION 'Todo item da requisição precisa de uma descrição.' USING ERRCODE = 'P0001';
      END IF;
      v_unidade := COALESCE(NULLIF(upper(btrim(COALESCE(v_elem->>'unidade',''))), ''), 'UN');
      v_marca   := NULLIF(btrim(COALESCE(v_elem->>'marca','')), '');

      -- MIGR 591: aqui o fator vem de quem pede, e está certo assim — não há
      -- cadastro do qual ele pudesse divergir. O que a régua cobra é que a
      -- declaração seja completa e faça sentido.
      IF v_emb_qtd IS NOT NULL OR (v_elem->>'embalagem_nome') IS NOT NULL THEN
        v_emb_nome  := upper(btrim(COALESCE(v_elem->>'embalagem_nome', '')));
        v_emb_fator := NULLIF(replace(btrim(COALESCE(v_elem->>'embalagem_fator', '')), ',', '.'), '')::numeric;

        IF NOT public.embalagem_compra_valida(v_emb_nome) THEN
          RAISE EXCEPTION 'Embalagem "%" não é uma das reconhecidas (fardo, caixa, pacote, saco, engradado, dúzia).', v_emb_nome
            USING ERRCODE = 'P0001';
        END IF;
        -- Serviço não vem em caixa: a unidade SV é manutenção, frete, licença,
        -- dedetização (migr. 358).
        IF v_unidade = 'SV' THEN
          RAISE EXCEPTION 'Serviço não se compra em embalagem fechada. Peça "%" pela quantidade contratada, sem embalagem.', v_texto
            USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_fator IS NULL OR v_emb_fator <= 1 THEN
          RAISE EXCEPTION 'Diga quantas % vêm em cada % de "%" — mais de uma, senão a embalagem é a própria unidade.',
            v_unidade, lower(v_emb_nome), v_texto USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_qtd IS NULL OR v_emb_qtd <= 0 THEN
          RAISE EXCEPTION 'Quantos % de "%"? O número tem de ser maior que zero.', lower(v_emb_nome), v_texto
            USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_qtd <> trunc(v_emb_qtd) THEN
          RAISE EXCEPTION 'Embalagem fechada não se parte: peça um número inteiro de % de "%", não %.',
            lower(v_emb_nome), v_texto, v_emb_qtd USING ERRCODE = 'P0001';
        END IF;
        -- Fração no fator é legítima só onde a unidade é fracionária: saco de
        -- 60 KG existe; fardo de 30,5 UN não.
        IF NOT public.unidade_fracionaria(v_unidade) AND v_emb_fator <> trunc(v_emb_fator) THEN
          RAISE EXCEPTION 'Não existe % com % — a unidade % não aceita meia.',
            lower(v_emb_nome), v_emb_fator, v_unidade USING ERRCODE = 'P0001';
        END IF;

        v_qtd := v_emb_qtd * v_emb_fator;
      ELSE
        v_emb_qtd := NULL;
      END IF;

      v_just_item := COALESCE(NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), ''), v_just_cab);
      IF v_just_item IS NULL OR length(v_just_item) < 10 THEN
        RAISE EXCEPTION 'Falta justificar o item "%" — explique por que a empresa precisa dele.', v_texto
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.requisicoes (
        item, marca, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao, qtd_embalagens, embalagem_nome, embalagem_fator
      ) VALUES (
        v_texto, v_marca,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Eventual', v_emb_qtd, v_emb_nome, v_emb_fator
      )
      RETURNING * INTO v_req;
    END IF;

    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', p_filial);

    v_resultado := v_resultado || to_jsonb(v_req);
  END LOOP;

  RETURN v_resultado;
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date, text)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- a régua nomeada existe e o CHECK usa ela
--   SELECT public.embalagem_compra_valida('FARDO'), public.embalagem_compra_valida('CX');
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.produtos'::regclass AND conname='chk_produtos_embalagem_nome';
--
--   -- mesmo hash de função nos quatro
--   SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
--     JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='criar_requisicoes_compra_lote';
-- =================================================================
