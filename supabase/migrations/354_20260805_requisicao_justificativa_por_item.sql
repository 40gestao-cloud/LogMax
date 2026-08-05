-- 354 — Requisição de compra: justificativa por item
--
-- Buraco de usabilidade da tela "Requisições → Do Setor". O formulário aceita
-- vários itens de uma vez e a 283 fez cada item virar uma **requisição
-- própria** (é assim que Compras cota e fecha um a um). Só que a justificativa
-- era **uma só**, do cabeçalho, copiada igual para todas as linhas.
--
-- Na prática o aluno pede "papel A4" e "troca do compressor da câmara fria" no
-- mesmo envio e não tem onde dizer que os motivos são diferentes. Aí ou ele
-- escreve uma justificativa genérica que não explica nenhum dos dois — e o
-- gerente aprova no escuro —, ou abre dois envios separados sem entender por
-- quê. Os dois caminhos ensinam a coisa errada.
--
-- O que muda: cada elemento de `p_itens` pode trazer sua própria
-- `justificativa`. Quando vier, é ela que é gravada naquela requisição; quando
-- não vier, cai na do cabeçalho — que continua sendo o caso comum ("compra do
-- material de escritório do mês"). O cabeçalho passa a ser opcional **desde
-- que** todo item se justifique sozinho; nenhuma requisição nasce sem motivo,
-- que é a regra que a 283 estabeleceu e esta migração preserva item a item.
--
-- Assinatura inalterada (jsonb, text, text, text, text, text, date), só o
-- corpo muda — por isso CREATE OR REPLACE sem DROP.

BEGIN;

CREATE OR REPLACE FUNCTION public.criar_requisicoes_compra_lote(
  p_itens            jsonb,
  p_solicitante      text,
  p_urgencia         text DEFAULT 'Normal',
  p_centro_custo     text DEFAULT NULL,
  p_filial           text DEFAULT 'SuperMax',
  p_justificativa    text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_elem        jsonb;
  v_req         requisicoes;
  v_resultado   jsonb := '[]'::jsonb;
  v_qtd         integer;
  v_texto       text;
  v_unidade     text;
  v_just_item   text;
  v_just_cab    text;
  v_nome        text;
  v_setor       text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE = 'P0001';
  END IF;

  -- O cabeçalho vira o *padrão*, não a única fonte. Vazio é permitido; a
  -- cobrança desceu para o item, logo abaixo.
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
    v_texto := trim(COALESCE(v_elem->>'item', ''));
    IF v_texto = '' THEN
      RAISE EXCEPTION 'Todo item da requisição precisa de uma descrição.' USING ERRCODE = 'P0001';
    END IF;
    v_qtd := COALESCE((v_elem->>'qtd')::integer, 1);
    IF v_qtd < 1 THEN
      v_qtd := 1;
    END IF;
    v_unidade := COALESCE(NULLIF(trim(COALESCE(v_elem->>'unidade','')), ''), 'un');

    -- Justificativa própria manda sobre a do cabeçalho. Sem nenhuma das duas,
    -- a requisição não nasce: o gerente decide lendo isto.
    v_just_item := COALESCE(NULLIF(trim(COALESCE(v_elem->>'justificativa', '')), ''), v_just_cab);
    IF v_just_item IS NULL OR length(v_just_item) < 10 THEN
      RAISE EXCEPTION 'Falta justificar o item "%" — explique por que a empresa precisa dele.', v_texto
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.requisicoes (
      item, solicitante, setor_solicitante, qtd, unidade, urgencia,
      centro_custo, justificativa, data_necessidade, status, data, filial
    ) VALUES (
      v_texto,
      COALESCE(v_nome, trim(p_solicitante)),
      v_setor,
      v_qtd,
      v_unidade,
      p_urgencia,
      NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
      v_just_item,
      p_data_necessidade,
      'Pendente', public.acre_today(), p_filial
    )
    RETURNING * INTO v_req;

    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', p_filial);

    v_resultado := v_resultado || to_jsonb(v_req);
  END LOOP;

  RETURN v_resultado;
END;
$function$;

-- CREATE OR REPLACE preserva os GRANTs da 283, mas repetir é barato e cobre o
-- caso de a função ter sido recriada à mão em alguma turma (vide feedback
-- "RPC nova nasce aberta pro anon").
REVOKE ALL ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
