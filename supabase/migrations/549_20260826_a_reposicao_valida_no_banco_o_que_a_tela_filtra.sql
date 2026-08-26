-- 549 — A reposição valida no banco o que a tela filtra.
--
-- `criar_requisicoes_compra_lote`, no caminho da Reposição, confere duas coisas
-- do produto: que ele existe, e que é da filial certa. Só isso.
--
-- A tela confere mais três, e são as que importam (`catalogoRepo`, em
-- RequisicoesSetorView.tsx):
--
--     .filter(p => (p.status ?? 'Ativo') !== 'Inativo' && temEstoque(p.tipo))
--
-- Produto inativo e patrimônio nunca aparecem no seletor. Mas o seletor não é a
-- régua — a RPC é. É o padrão que a migr. 440 catalogou: "todas as checagens
-- eram BLACKLIST, a forma que faz o tipo novo nascer vendável". Aqui é pior que
-- blacklist: é ausência.
--
-- ─── POR QUE ISTO IMPORTA MESMO SEM NINGUÉM ABRIR O F12 ────────────────────
--
-- Porque a falha é TARDIA. Uma requisição de patrimônio criada por fora
-- atravessa a aprovação do gerente e a decisão do Financeiro inteiras — as duas
-- pessoas gastam a decisão delas — e só morre no Gerar Pedido, na mensagem que
-- a migr. 515 escreveu:
--
--     '"X" está cadastrado como Patrimônio (bem de uso), e bem não entra pelo
--      pedido de compra...'
--
-- Que é a mensagem certa, no lugar errado. Quem lê ela é Compras, três etapas
-- depois de quem errou, e a essa altura o único caminho é negar tudo e começar
-- de novo. `vincular_produto_requisicao` já entendeu isso e antecipa a mesma
-- régua na hora do vínculo, com o mesmo texto. Falta a porta de entrada.
--
-- O produto INATIVO tem o mesmo problema, com um agravante que a migr. 548
-- acabou de fechar do outro lado: um cadastro podia ser excluído depois de a
-- requisição nascer. Agora não pode — e esta migração garante que ela também
-- não NASÇA apontando para um que já estava fora.
--
-- ─── ESCOPO ────────────────────────────────────────────────────────────────
--
-- Só o ramo da Reposição muda. O ramo Eventual continua de texto livre, que é
-- o desenho da migr. 358: quem pede descreve a necessidade, e quem amarra ao
-- catálogo é Compras, mais tarde, pela porta da `vincular_produto_requisicao`
-- (que já valida tudo isto).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

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
      v_just_item := NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), '');

      INSERT INTO public.requisicoes (
        item, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao, produto_id, saldo_no_pedido, minimo_no_pedido
      ) VALUES (
        v_texto,
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

      v_just_item := COALESCE(NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), ''), v_just_cab);
      IF v_just_item IS NULL OR length(v_just_item) < 10 THEN
        RAISE EXCEPTION 'Falta justificar o item "%" — explique por que a empresa precisa dele.', v_texto
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.requisicoes (
        item, solicitante, setor_solicitante, qtd, unidade, urgencia,
        centro_custo, justificativa, data_necessidade, status, data, filial,
        tipo_requisicao
      ) VALUES (
        v_texto,
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

COMMIT;
