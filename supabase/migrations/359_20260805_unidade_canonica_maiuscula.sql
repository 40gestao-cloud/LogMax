-- 359 — Unidade de medida: uma grafia só
--
-- Defeito introduzido pela 358 e exposto ao perguntar se o formulário de
-- requisição deveria mudar por nicho de filial.
--
-- `produtos.unidade` sempre foi MAIÚSCULA ('UN','KG','L') — é o que o cadastro
-- grava e o que o PDV assume (`String(p.unidade).toUpperCase()`). Mas a tela de
-- Requisições tinha lista própria em minúscula ('un','cx','kg'). Enquanto os
-- dois caminhos eram texto livre, ninguém percebeu. Quando a Reposição passou a
-- ler a unidade do catálogo, a mesma coluna ficou com as duas grafias:
--
--     un → 19 linhas     UN → 8 linhas
--
-- Mesma unidade, dois valores. Qualquer GROUP BY por unidade passa a mentir, e
-- o modelo de planilha ensinava a grafia errada a quem importa dados.
--
-- ── Sobre o nicho ───────────────────────────────────────────────────────────
--
-- A pergunta original era se o formulário deveria variar por filial. Não deve:
-- requisição de compra é documento corporativo único, e ramificar campos por
-- unidade de negócio faria a tela mentir sobre o processo. O que varia é o
-- vocabulário, e ele já variava nos dados sem ninguém ter escrito a regra:
-- só o SuperMax tem produto em KG (15) e L (5); MaxLook e TechMax são 100% UN.
-- Isso agora tem nome em `src/lib/unidades.ts` — `unidadesDeProduto()` e
-- `unidadesDeRequisicao()`, com KG/L/M/M³ só para mercearia.
--
-- ── O que muda aqui ─────────────────────────────────────────────────────────
--
--   1. Backfill: `requisicoes.unidade` normalizada para maiúscula.
--   2. As duas RPCs de criação normalizam na escrita, para o banco não voltar a
--      depender de o cliente mandar certo.
--
-- Idempotente.

BEGIN;

-- ── 1. Backfill ──────────────────────────────────────────────────────────────

UPDATE public.requisicoes
   SET unidade = upper(btrim(unidade))
 WHERE unidade IS NOT NULL
   AND unidade <> upper(btrim(unidade));

-- Mesma limpeza no catálogo: barato e garante que o snapshot da Reposição
-- nunca copie uma grafia torta que tenha entrado por importação.
UPDATE public.produtos
   SET unidade = upper(btrim(unidade))
 WHERE unidade IS NOT NULL
   AND unidade <> upper(btrim(unidade));

-- ── 2. A normalização passa a ser do banco ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.criar_requisicoes_compra_lote(
  p_itens            jsonb,
  p_solicitante      text,
  p_urgencia         text DEFAULT 'Normal',
  p_centro_custo     text DEFAULT NULL,
  p_filial           text DEFAULT 'SuperMax',
  p_justificativa    text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL,
  p_tipo_requisicao  text DEFAULT 'Eventual'
)
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
  v_qtd       integer;
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

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := COALESCE((v_elem->>'qtd')::integer, 1);
    IF v_qtd < 1 THEN v_qtd := 1; END IF;

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

REVOKE ALL ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date, text)
  TO authenticated;

-- A RPC de item único (migr. 283) tem a mesma origem de grafia torta.
CREATE OR REPLACE FUNCTION public.criar_requisicao_compra(
  p_item             text,
  p_solicitante      text,
  p_qtd              integer DEFAULT 1,
  p_urgencia         text DEFAULT 'Normal',
  p_centro_custo     text DEFAULT NULL,
  p_filial           text DEFAULT 'SuperMax',
  p_justificativa    text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL,
  p_unidade          text DEFAULT 'UN'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req    requisicoes;
  v_nome   text;
  v_setor  text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_justificativa IS NULL OR length(trim(p_justificativa)) < 10 THEN
    RAISE EXCEPTION 'A justificativa é obrigatória — é o que o gerente lê para decidir.'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
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

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes (
    item, solicitante, setor_solicitante, qtd, unidade, urgencia,
    centro_custo, justificativa, data_necessidade, status, data, filial,
    tipo_requisicao
  ) VALUES (
    trim(p_item),
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    COALESCE(NULLIF(upper(btrim(COALESCE(p_unidade,''))), ''), 'UN'),
    p_urgencia,
    NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
    trim(p_justificativa),
    p_data_necessidade,
    'Pendente', public.acre_today(), p_filial,
    'Eventual'
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text, text, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text, text, text, date, text)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação — esperado: nenhuma linha.
SELECT 'requisicoes' AS tabela, unidade FROM public.requisicoes
 WHERE unidade IS NOT NULL AND unidade <> upper(btrim(unidade))
UNION ALL
SELECT 'produtos', unidade FROM public.produtos
 WHERE unidade IS NOT NULL AND unidade <> upper(btrim(unidade));
