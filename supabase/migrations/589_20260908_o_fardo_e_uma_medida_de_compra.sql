-- ════════════════════════════════════════════════════════════════════════════
-- 589 — O fardo é medida de COMPRA, não de estoque
--
-- "ARROZ 1 KG CAMIL, 30 UN NO FARDO, 20 FARDOS" NÃO CABIA NO CADASTRO.
--
-- O produto já sabia declarar duas medidas, e as duas estão certas:
--
--   * como o item ENTRA E SAI do estoque  → `unidade`             (UN)
--   * o CONTEÚDO da embalagem de venda    → `peso`/`peso_unidade` (1 KG, migr. 438)
--
-- Falta a terceira, que é a que o fornecedor usa para vender:
--
--   * como o item é COMPRADO              → fardo com 30 UN
--
-- Sem ela, a turma tinha duas saídas e as duas estragam dado:
--
--   1. Pôr `unidade = 'PCT'`. Aí o estoque conta 20 fardos, o PDV vende "1
--      fardo" ao cliente, o estoque mínimo passa a ser em fardo e o custo
--      unitário fica 30× maior. É trocar a medida do negócio inteiro para
--      resolver a medida de uma nota de entrada.
--   2. Cadastrar "Arroz Camil fardo 30" como um SEGUNDO produto. Catálogo
--      duplicado, saldo partido em dois — exatamente o que a migr. 480 fechou
--      quando amarrou o item do pedido ao cadastro.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
--   1. `produtos.embalagem_compra` + `produtos.embalagem_qtd` — o cadastro
--      passa a dizer "FARDO com 30 UN". O estoque continua em UN.
--   2. A reposição pode pedir EM FARDO: o aluno digita 20, o banco grava
--      `qtd = 600` (a medida de estoque, como sempre) e guarda ao lado quantos
--      fardos foram pedidos e qual era o fator NAQUELE DIA.
--
-- ── Por que o fator vai em SNAPSHOT ─────────────────────────────────────────
--
-- `embalagem_fator` é copiado para a requisição, não lido por JOIN. Se amanhã o
-- fornecedor mudar o fardo de 30 para 24 e alguém corrigir o cadastro, a
-- requisição de ontem não pode se reescrever para "20 fardos = 480". Mesma
-- razão do `saldo_no_pedido` da migr. 358 e do snapshot de item da migr. 480:
-- documento emitido é foto, não consulta.
--
-- ── Por que o granel também tem embalagem ───────────────────────────────────
--
-- A régua da migr. 456 proíbe CONTEÚDO de embalagem em item vendido a granel —
-- banana a KG não tem "peso por embalagem". Aqui é outra coisa: café vendido a
-- KG é comprado em saco de 60 KG, e isso é rotina de mercearia. Embalagem de
-- compra vale para qualquer unidade; o fator é expresso NA unidade de estoque
-- do produto (60, em KG), e é por isso que `embalagem_qtd` é numeric e não
-- integer.
--
-- ── O que NÃO muda ──────────────────────────────────────────────────────────
--
-- `FD` não entra em `UNIDADES_PRODUTO`. Fardo não é unidade de estoque, é
-- embalagem de compra — misturar as duas é o defeito que esta migração corrige,
-- e acrescentar a sigla à lista de unidades seria cometê-lo de novo com nome
-- melhor.
--
-- Compra eventual fica de fora: não há catálogo de onde tirar o fator, e o
-- solicitante já descreve a embalagem no texto do item ("sacola 50x60 — fardo
-- com 500"). Quando o item passa a existir no cadastro, ele vira reposição.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O cadastro declara a embalagem de compra ─────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS embalagem_compra text,
  ADD COLUMN IF NOT EXISTS embalagem_qtd    numeric(15,3);

COMMENT ON COLUMN public.produtos.embalagem_compra IS
  'Como o FORNECEDOR vende este item (FARDO, CAIXA, PACOTE, SACO, ENGRADADO, DÚZIA). Não é unidade de estoque — o estoque continua contando em produtos.unidade. Migr. 589.';
COMMENT ON COLUMN public.produtos.embalagem_qtd IS
  'Quantas UNIDADES DE ESTOQUE vêm em uma embalagem de compra: fardo de arroz com 30 (unidade UN), saco de café com 60 (unidade KG). Migr. 589.';

DO $$
BEGIN
  -- Lista fechada: embalagem digitada livre viraria "fardo"/"Fardo"/"fd" na
  -- mesma coluna, que é como `un` e `UN` conviveram até a régua de unidades.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_embalagem_nome') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT chk_produtos_embalagem_nome
      CHECK (embalagem_compra IS NULL
             OR embalagem_compra IN ('FARDO','CAIXA','PACOTE','SACO','ENGRADADO','DÚZIA'));
  END IF;

  -- Simétrico, pela lição da migr. 456: nome sem fator é rótulo órfão, e fator
  -- sem nome é número que ninguém sabe ler.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_embalagem_par') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT chk_produtos_embalagem_par
      CHECK ((embalagem_compra IS NULL) = (embalagem_qtd IS NULL));
  END IF;

  -- Fardo com 1 não é embalagem, é a própria unidade — e deixar passar faria a
  -- tela oferecer "pedir em FARDO" para converter 20 em 20.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_embalagem_qtd') THEN
    ALTER TABLE public.produtos
      ADD CONSTRAINT chk_produtos_embalagem_qtd
      CHECK (embalagem_qtd IS NULL OR embalagem_qtd > 1);
  END IF;
END $$;

-- ── 2. A view do catálogo enxerga a embalagem ───────────────────────────────
--
-- `produtos_com_custo` é o que a tela de Cadastros lê. CREATE OR REPLACE só
-- aceita coluna nova NO FIM (42P16 se entrar no meio), e `security_invoker` vai
-- DENTRO do CREATE — sem ele a view volta a security definer e o custo vaza
-- pela RLS de `produtos_custo`. Lista conferida nos 4 projetos antes de mexer
-- (hash de colunas idêntico: 012866e4…).

CREATE OR REPLACE VIEW public.produtos_com_custo
WITH (security_invoker = true) AS
  SELECT p.id,
         p.codigo,
         p.nome,
         p.categoria,
         p.estoque,
         p.preco,
         p.unidade,
         p.status,
         p.created_at,
         p.ativo,
         p.estoque_minimo,
         p.ean,
         p.fornecedor,
         p.filial,
         p.imagem_url,
         p.tipo,
         p.patrimonio_numero,
         p.patrimonio_responsavel,
         p.patrimonio_localizacao,
         p.criado_por,
         p.atualizado_por,
         p.updated_at,
         p.elegivel_beneficios,
         p.vitrine_publica,
         p.categoria_id,
         p.subcategoria_id,
         p.marca,
         p.peso,
         p.peso_unidade,
         p.atributos,
         p.imagem_url_2,
         p.imagem_url_3,
         p.codigo_seq,
         p.loja_online,
         c.preco_custo,
         c.origem              AS custo_origem,
         c.ultima_compra_em    AS custo_ultima_compra_em,
         c.ultimo_custo_compra AS custo_ultima_compra_valor,
         p.correcao_pendente,
         p.correcao_motivo,
         p.correcao_solicitada_por,
         p.correcao_solicitada_em,
         p.correcao_responsavel_id,
         p.patrimonio_vida_util_meses,
         p.patrimonio_baixado_em,
         p.patrimonio_baixa_motivo,
         p.patrimonio_valor_venda,
         p.embalagem_compra,
         p.embalagem_qtd
    FROM public.produtos p
    LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

COMMENT ON VIEW public.produtos_com_custo IS
  'Produtos + custo mascarado pela RLS de produtos_custo (migr. 262). Definição canônica das 4 turmas — vide migr. 589, que sucede a 438 acrescentando embalagem_compra e embalagem_qtd no fim.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_com_custo TO authenticated;
GRANT ALL                            ON public.produtos_com_custo TO service_role;

-- ── 3. A requisição registra o que foi pedido EM FARDO ──────────────────────

ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS qtd_embalagens  numeric(15,3),
  ADD COLUMN IF NOT EXISTS embalagem_nome  text,
  ADD COLUMN IF NOT EXISTS embalagem_fator numeric(15,3);

COMMENT ON COLUMN public.requisicoes.qtd_embalagens IS
  'Quantas embalagens de compra foram pedidas (20 fardos). NULL quando o pedido foi feito na unidade solta. `qtd` continua SEMPRE na unidade de estoque — 20 fardos de 30 gravam qtd = 600. Migr. 589.';
COMMENT ON COLUMN public.requisicoes.embalagem_nome IS
  'Nome da embalagem no momento do pedido (FARDO, CAIXA...). Snapshot: o cadastro pode mudar depois, o documento emitido não. Migr. 589.';
COMMENT ON COLUMN public.requisicoes.embalagem_fator IS
  'Quantas unidades de estoque tinha a embalagem NO DIA DO PEDIDO. Snapshot, pela mesma razão de saldo_no_pedido (migr. 358). Migr. 589.';

DO $$
BEGIN
  -- Os três juntos ou nenhum: fator sem nome não se lê, nome sem fator não
  -- converte, e qtd_embalagens sozinho é a conta sem as parcelas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_requisicoes_embalagem') THEN
    ALTER TABLE public.requisicoes
      ADD CONSTRAINT chk_requisicoes_embalagem
      CHECK (num_nulls(qtd_embalagens, embalagem_nome, embalagem_fator) IN (0, 3));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_requisicoes_embalagem_valores') THEN
    ALTER TABLE public.requisicoes
      ADD CONSTRAINT chk_requisicoes_embalagem_valores
      CHECK ((qtd_embalagens IS NULL OR qtd_embalagens > 0)
             AND (embalagem_fator IS NULL OR embalagem_fator > 1));
  END IF;
END $$;

-- Trilha do documento: trocar 20 fardos por 25 é trocar o que se compra, e a
-- migr. 582 já pôs item/marca/qtd na trilha pela mesma razão. `qtd` sozinho
-- registraria "600 → 750" sem dizer que a conversa foi em fardo.
DROP TRIGGER IF EXISTS trg_historico ON public.requisicoes;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'item', 'marca', 'qtd', 'qtd_embalagens', 'urgencia', 'centro_custo');

-- ── 4. A RPC converte, e a conversão é do BANCO ─────────────────────────────
--
-- Sucede a definição da migr. 582 (copiada do banco, não do arquivo — hash
-- 25079a91…, idêntico nos 4). Só o ramo da Reposição muda.
--
-- O front manda `qtd_embalagens`; o FATOR ele não manda. Mesma lição da marca
-- na 582 e do nome do item na 344: campo que o navegador envia, o navegador
-- inventa — e aqui inventar o fator seria inventar a quantidade comprada.

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
    v_emb_qtd   := NULL;
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

      -- MIGR 589: pedido em embalagem fechada. Quem manda o número de fardos é
      -- a tela; quantas unidades cabem em um é o cadastro que diz.
      v_emb_qtd := NULLIF(replace(btrim(COALESCE(v_elem->>'qtd_embalagens', '')), ',', '.'), '')::numeric;
      IF v_emb_qtd IS NOT NULL THEN
        IF v_prod.embalagem_compra IS NULL OR COALESCE(v_prod.embalagem_qtd, 0) <= 1 THEN
          RAISE EXCEPTION '"%" não tem embalagem de compra cadastrada, então não dá para pedir por fardo. Informe a embalagem no cadastro do produto (Cadastros > Produtos > Estoque) ou peça na unidade solta.',
            v_prod.nome USING ERRCODE = 'P0001';
        END IF;
        IF v_emb_qtd <= 0 THEN
          RAISE EXCEPTION 'Quantas embalagens de "%"? O número tem de ser maior que zero.', v_prod.nome
            USING ERRCODE = 'P0001';
        END IF;
        -- Fornecedor não abre fardo: 2,5 fardos é pedido que ninguém atende, e
        -- deixar passar produziria saldo quebrado sem nota que o explique.
        IF v_emb_qtd <> trunc(v_emb_qtd) THEN
          RAISE EXCEPTION 'Embalagem fechada não se parte: peça um número inteiro de % de "%", não %.',
            v_prod.embalagem_compra, v_prod.nome, v_emb_qtd USING ERRCODE = 'P0001';
        END IF;
        v_emb_nome  := v_prod.embalagem_compra;
        v_emb_fator := v_prod.embalagem_qtd;
        -- A quantidade gravada continua sendo a de ESTOQUE. Todo o resto da
        -- cadeia (cotação, pedido, recebimento, three-way match) já fala essa
        -- língua, e nada disso precisa saber o que é um fardo.
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

      v_just_item := COALESCE(NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), ''), v_just_cab);
      IF v_just_item IS NULL OR length(v_just_item) < 10 THEN
        RAISE EXCEPTION 'Falta justificar o item "%" — explique por que a empresa precisa dele.', v_texto
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.requisicoes (
        item, marca, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao
      ) VALUES (
        v_texto, v_marca,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Eventual'
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
--   -- 1. colunas e restrições no lugar — esperado: 2 colunas, 3 checks
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='produtos'
--      AND column_name IN ('embalagem_compra','embalagem_qtd');
--   SELECT conname FROM pg_constraint WHERE conrelid='public.produtos'::regclass
--     AND conname LIKE 'chk_produtos_embalagem%' ORDER BY 1;
--
--   -- 2. a view continua security_invoker e com as colunas no fim
--   SELECT reloptions FROM pg_class WHERE relname='produtos_com_custo';
--   SELECT md5(string_agg(column_name, ',' ORDER BY ordinal_position))
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='produtos_com_custo';
--
--   -- 3. mesmo hash de função nos quatro
--   SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
--     JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='criar_requisicoes_compra_lote';
-- =================================================================
