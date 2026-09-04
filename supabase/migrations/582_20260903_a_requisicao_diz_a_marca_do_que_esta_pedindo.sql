-- ════════════════════════════════════════════════════════════════════════════
-- 582 — A requisição diz QUAL produto e de QUE marca
--
-- O formulário do setor tinha um campo só: uma linha de texto livre onde cabia
-- "papel", "caneta", "arroz". Compras recebia isso e tinha de adivinhar o que
-- comprar — e o aluno de Compras só descobria o buraco na hora de cotar, sem
-- ter como perguntar de volta a não ser devolvendo a requisição.
--
-- Aqui a requisição passa a carregar a MARCA junto do nome do item. Não é
-- burocracia: é a informação mínima que faz o comprador achar o produto certo,
-- e é a mesma régua da migr. 526 vista do outro lado — lá a marca é o que o
-- fornecedor OFERECE na proposta; aqui é o que o solicitante PEDE.
--
--   • Eventual  → a marca é digitada (opcional: "qualquer marca" é uma decisão
--                 legítima, mas agora é declarada, não um silêncio).
--   • Reposição → a marca é a do produto do catálogo. Quem repõe não escolhe
--                 marca: o item já existe, e a marca dele é o que está cadastrado.
--
-- Requisições antigas ficam sem marca — ninguém informou, e inventar valor
-- histórico seria mentir na trilha de auditoria.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.requisicoes ADD COLUMN IF NOT EXISTS marca text;

COMMENT ON COLUMN public.requisicoes.marca IS
  'Marca pedida. Na Eventual é digitada pelo solicitante; na Reposição é copiada do produto do catálogo no momento do pedido.';

-- A trilha do documento passa a guardar a marca: trocar a marca pedida é
-- trocar o que se está comprando, e isso tem de aparecer na auditoria.
DROP TRIGGER IF EXISTS trg_historico ON public.requisicoes;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'item', 'marca', 'qtd', 'urgencia', 'centro_custo');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Criação em lote grava a marca
-- ════════════════════════════════════════════════════════════════════════════

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
    -- Vírgula decimal chega de teclado pt-BR se o front escapar; `numeric` não
    -- aceita, e o erro sairia como "invalid input syntax" sem dizer qual item.
    v_qtd := COALESCE(NULLIF(replace(btrim(COALESCE(v_elem->>'qtd', '')), ',', '.'), '')::numeric, 1);
    IF v_qtd <= 0 THEN v_qtd := 1; END IF;

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

      -- MIGR 549: as duas checagens que só existiam no filtro da tela.
      --
      -- Inativo: o Gerar Pedido recusaria ("Produto não encontrado ou
      -- inativo") três etapas adiante, depois de o gerente e o Financeiro já
      -- terem decidido.
      IF v_prod.ativo IS NOT TRUE OR COALESCE(v_prod.status, 'Ativo') = 'Inativo' THEN
        RAISE EXCEPTION '"%" foi tirado do catálogo desta unidade e não pode ser reposto. Reative-o em Cadastros > Lixeira antes de pedir, ou peça outro item.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;
      -- Patrimônio: mesmo texto de `vincular_produto_requisicao` e do Gerar
      -- Pedido (migr. 515). Bem de uso não tem saldo, então não há o que repor.
      IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
        RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não se repõe: ele não tem saldo de estoque. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado — o bem aparece em Financeiro > Patrimônio, com vida útil e depreciação. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo dele em Cadastros > Produtos.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;

      v_texto     := v_prod.nome;
      v_unidade   := COALESCE(NULLIF(upper(btrim(COALESCE(v_prod.unidade,''))), ''), 'UN');
      -- MIGR 582: na reposição a marca é a do cadastro. Deixar o navegador
      -- mandar a marca aqui seria deixar o solicitante reescrever o catálogo
      -- pela requisição.
      v_marca     := NULLIF(btrim(COALESCE(v_prod.marca, '')), '');
      v_just_item := NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), '');

      INSERT INTO public.requisicoes (
        item, marca, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao, produto_id, saldo_no_pedido, minimo_no_pedido
      ) VALUES (
        v_texto, v_marca,
        COALESCE(v_nome, trim(p_solicitante)),
        v_setor, v_qtd, v_unidade, p_urgencia,
        NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
        v_just_item, p_data_necessidade,
        'Pendente', public.acre_today(), p_filial,
        'Reposição', v_prod.id, v_prod.estoque, v_prod.estoque_minimo
      )
      RETURNING * INTO v_req;

    ELSE
      v_texto := trim(COALESCE(v_elem->>'item', ''));
      IF v_texto = '' THEN
        RAISE EXCEPTION 'Todo item da requisição precisa de uma descrição.' USING ERRCODE = 'P0001';
      END IF;
      -- A grafia é do banco, não do cliente: era daqui que vinha o 'un'.
      v_unidade := COALESCE(NULLIF(upper(btrim(COALESCE(v_elem->>'unidade',''))), ''), 'UN');
      -- MIGR 582: opcional de propósito. Há compra em que a marca é indiferente
      -- (cimento, areia); o que não pode é o comprador não saber se ela é
      -- indiferente ou se o solicitante esqueceu de dizer.
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

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O setor corrige a marca junto com o item
--
-- DROP + CREATE porque a assinatura ganha parâmetro, e CREATE OR REPLACE não
-- muda lista de argumentos. Semântica do novo parâmetro:
--   p_marca NULL  → não mexe (chamada antiga continua valendo)
--   p_marca ''    → limpa a marca (voltar para "qualquer marca" é decisão)
-- Na Reposição o parâmetro é ignorado: a marca é a do catálogo.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date);

CREATE FUNCTION public.reenviar_requisicao_corrigida(
  p_id uuid,
  p_item text,
  p_qtd numeric,
  p_unidade text DEFAULT NULL::text,
  p_justificativa text DEFAULT NULL::text,
  p_urgencia text DEFAULT NULL::text,
  p_centro_custo text DEFAULT NULL::text,
  p_data_necessidade date DEFAULT NULL::date,
  p_marca text DEFAULT NULL::text)
 RETURNS requisicoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req   public.requisicoes;
  v_marca text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Só requisição devolvida para correção pode ser reenviada (esta está %).',
      v_req.status USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_is_admin(), false)
     AND NOT COALESCE(public.auth_gerente_da(v_req.filial), false)
     AND COALESCE(v_req.criado_por, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RAISE EXCEPTION 'Quem corrige a requisição é quem a abriu.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(trim(p_item), '') = '' THEN
    RAISE EXCEPTION 'O item não pode ficar em branco.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade tem de ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 582. Com produto vinculado a marca é do catálogo — corrigir a
  -- requisição não reescreve o cadastro.
  IF v_req.produto_id IS NOT NULL THEN
    SELECT NULLIF(btrim(COALESCE(marca, '')), '') INTO v_marca
      FROM public.produtos WHERE id = v_req.produto_id;
  ELSE
    v_marca := CASE WHEN p_marca IS NULL THEN v_req.marca
                    ELSE NULLIF(btrim(p_marca), '') END;
  END IF;

  UPDATE public.requisicoes
     SET item                    = trim(p_item),
         marca                   = v_marca,
         qtd                     = p_qtd,
         unidade                 = COALESCE(NULLIF(trim(COALESCE(p_unidade, '')), ''), unidade),
         urgencia                = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         justificativa           = NULLIF(trim(COALESCE(p_justificativa, '')), ''),
         centro_custo            = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         data_necessidade        = COALESCE(p_data_necessidade, data_necessidade),
         status                  = 'Pendente',
         correcao_motivo         = NULL,
         correcao_solicitada_em  = NULL,
         correcao_solicitada_por = NULL,
         reenviada_em            = now()
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  PERFORM public.notificar_setor(
    'gerencia',
    'aprovacao_pendente',
    'Requisição corrigida e reenviada',
    COALESCE(v_req.numero, 'Requisição') || ' — ' || COALESCE(v_req.item, 'item')
      || COALESCE(' (' || v_req.marca || ')', '')
      || ' · ' || trim(to_char(v_req.qtd, 'FM999999990.999')) || ' ' || COALESCE(v_req.unidade, ''),
    'requisicoes-aprovações',
    'Média',
    v_req.id,
    NULL,
    v_req.filial
  );

  RETURN v_req;
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Compras corrige a marca — e isso volta para o gerente
--
-- Mudar a marca é mudar o que se está comprando (é o mesmo argumento da migr.
-- 526: proposta de outra marca não é a mesma compra). Então, numa requisição
-- já aprovada, trocar a marca reabre a aprovação, exatamente como trocar o
-- item ou a quantidade.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean);

CREATE FUNCTION public.corrigir_requisicao_compra(
  p_id uuid,
  p_item text,
  p_qtd numeric,
  p_urgencia text DEFAULT NULL::text,
  p_centro_custo text DEFAULT NULL::text,
  p_produto_id uuid DEFAULT NULL::uuid,
  p_vincula boolean DEFAULT false,
  p_marca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req        requisicoes;
  v_prod       produtos;
  v_prod_novo  uuid;
  v_marca_nova text;
  v_troca_prod boolean := false;
  v_reabre     boolean := false;
  v_cot        text;
  v_nome       text;
  v_ap_id      uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.auth_is_admin()
          OR public.auth_in_setor('compras')
          OR public.auth_gerente_da(v_req.filial)) THEN
    RAISE EXCEPTION 'Só Compras ou o gerente da filial corrige a requisição.'
      USING ERRCODE = '42501';
  END IF;

  IF v_req.status NOT IN ('Pendente', 'Aprovado') THEN
    RAISE EXCEPTION
      'Requisição % não pode ser corrigida: já está %. Depois de virar pedido a correção é no pedido; negada, quem reabre é o setor solicitante.',
      v_req.item, v_req.status
      USING ERRCODE = 'P0001';
  END IF;

  -- ── MIGR 545: o vínculo com o catálogo ────────────────────────────────────
  -- Sem a flag, a chamada é a antiga: preserva o que estava lá.
  v_prod_novo  := CASE WHEN p_vincula THEN p_produto_id ELSE v_req.produto_id END;
  v_troca_prod := p_vincula AND (v_prod_novo IS DISTINCT FROM v_req.produto_id);

  IF v_troca_prod THEN
    IF v_req.servico_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta requisição é de um SERVIÇO contratado. Produto e serviço não se trocam um pelo outro no meio do fluxo — negue esta e abra a certa.'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_prod_novo IS NULL THEN
      IF COALESCE(v_req.tipo_requisicao, '') = 'Reposição' THEN
        RAISE EXCEPTION 'Reposição É o vínculo com o catálogo: sem produto ela deixa de ser uma reposição. Escolha outro produto, ou negue esta requisição e abra uma Compra eventual.'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- Mesmas checagens de `vincular_produto_requisicao` (migr. 494/515).
      SELECT * INTO v_prod FROM public.produtos WHERE id = v_prod_novo;
      IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE
         OR COALESCE(v_prod.status, 'Ativo') = 'Inativo' THEN
        RAISE EXCEPTION 'Produto não encontrado ou inativo. Um cadastro excluído não pode ser comprado — reative-o em Cadastros > Lixeira, ou escolha outro.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_prod.filial IS DISTINCT FROM v_req.filial THEN
        RAISE EXCEPTION 'O produto "%" é do catálogo da %, e esta requisição é da %. Amarrar no produto da vizinha faria a entrada do recebimento mexer no estoque dela.',
          v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
      END IF;
      IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
        RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não entra pelo fluxo de compra: ele não tem saldo de estoque, então o Gerar Pedido recusaria. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo dele em Cadastros > Produtos.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- MIGR 582. Item vinculado ao catálogo tem a marca do catálogo; item de
  -- texto livre tem a marca que o solicitante pediu e Compras pode ajustar.
  IF v_prod_novo IS NOT NULL THEN
    SELECT NULLIF(btrim(COALESCE(marca, '')), '') INTO v_marca_nova
      FROM public.produtos WHERE id = v_prod_novo;
  ELSE
    v_marca_nova := CASE WHEN p_marca IS NULL THEN v_req.marca
                         ELSE NULLIF(btrim(p_marca), '') END;
  END IF;

  -- Item, quantidade, PRODUTO e MARCA são a decisão do gerente. Trocar o
  -- centro de custo ou a urgência não muda o que ele autorizou comprar.
  v_reabre := v_req.status = 'Aprovado'
              AND (trim(p_item) IS DISTINCT FROM v_req.item
                   OR p_qtd IS DISTINCT FROM v_req.qtd
                   OR v_marca_nova IS DISTINCT FROM v_req.marca
                   OR v_troca_prod);

  IF v_reabre THEN
    -- Cotação viva nasceu do item antigo. Reabrir por baixo dela deixaria o
    -- Financeiro decidindo o preço de uma coisa que já não é a pedida.
    SELECT c.id::text INTO v_cot
      FROM public.cotacoes c
     WHERE c.requisicao_id = v_req.id
       AND COALESCE(c.ativo, true)
       AND c.status IN ('Aguardando Financeiro', 'Aprovado')
     LIMIT 1;

    IF v_cot IS NOT NULL THEN
      RAISE EXCEPTION
        'Já existe cotação em andamento para esta requisição. Cancele a cotação antes de mudar o item, a marca, o produto ou a quantidade.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.requisicoes
     SET item         = trim(p_item),
         marca        = v_marca_nova,
         qtd          = p_qtd,
         urgencia     = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         centro_custo = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         produto_id   = v_prod_novo,
         status       = CASE WHEN v_reabre THEN 'Pendente' ELSE status END
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF v_reabre THEN
    SELECT id INTO v_ap_id FROM public.aprovacoes_compras
     WHERE requisicao_id = v_req.id
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;

    IF v_ap_id IS NULL THEN
      INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
      VALUES (v_req.id, 'Pendente', v_req.filial);
    ELSE
      UPDATE public.aprovacoes_compras
         SET status     = 'Pendente',
             aprovador  = NULL,
             observacao = format('Reaberta: %s corrigiu o item, a marca, o produto ou a quantidade após a aprovação.',
                                 COALESCE(v_nome, 'Compras'))
       WHERE id = v_ap_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'requisicao',      to_jsonb(v_req),
    'reaberta',        v_reabre,
    'produto_trocado', v_troca_prod
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
