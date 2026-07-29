-- 283 — Requisição de compra: quem precisa é quem pede
--
-- Fecha a outra metade do achado da Etapa 8. A 282 tirou de Compras o poder de
-- aprovar a própria requisição; faltava o começo do fluxo: na empresa, quem
-- abre a requisição é a área que precisa do item — vendas, RH, marketing —, e
-- Compras recebe, cota e executa junto com o Financeiro.
--
-- O que muda:
--
--   1. Criação aberta a qualquer setor, presa à filial do usuário
--      (`auth_pode_filial`). Compras deixa de ser a única porta — e deixa de
--      ter porta própria: pede pela mesma tela que todo mundo.
--   2. O autor enxerga as próprias requisições. A policy de SELECT só
--      contemplava compras/logística/financeiro/gerente, então quem pedia de
--      outro setor não via o próprio pedido.
--   3. A requisição passa a ter os campos que ela tem no mercado:
--      **quem pediu, de que setor, por quê e para quando**. Sem justificativa
--      não existe requisição — é o que o aprovador lê para decidir, e era
--      exatamente o que faltava na tela.
--   4. Solicitante e setor passam a ser derivados do usuário autenticado, não
--      do que a tela mandou. Campo de texto livre para "quem pediu" é a porta
--      da requisição fantasma.
--
-- A autoridade não muda: quem decide continua sendo o gerente da filial
-- (trigger `requisicao_decisao_guard`, migr. 282).

BEGIN;

-- ── 1. Campos que faltavam ───────────────────────────────────────────────────

ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS setor_solicitante text,
  ADD COLUMN IF NOT EXISTS justificativa     text,
  ADD COLUMN IF NOT EXISTS data_necessidade  date,
  ADD COLUMN IF NOT EXISTS unidade           text;

COMMENT ON COLUMN public.requisicoes.setor_solicitante IS
  'Setor de quem abriu, derivado do user_profile no momento da criação.';
COMMENT ON COLUMN public.requisicoes.justificativa IS
  'Por que o item é necessário. É o que o gerente lê para decidir.';
COMMENT ON COLUMN public.requisicoes.data_necessidade IS
  'Para quando o item é necessário. Orienta a urgência da cotação.';
COMMENT ON COLUMN public.requisicoes.unidade IS
  'Unidade de medida do item (un, cx, kg, L, m, pct, sv).';

-- ── 2. Criação aberta ao setor que precisa ───────────────────────────────────
--
-- As assinaturas antigas são DROPADAS, não substituídas: acrescentar parâmetro
-- cria uma sobrecarga nova e deixa a versão velha executável ao lado — foi
-- exatamente assim que a `criar_venda_pdv` de 7 argumentos sobreviveu sem
-- conhecer filial até a migr. 274.

DROP FUNCTION IF EXISTS public.criar_requisicao_compra(text, text, integer, text, text, text);
DROP FUNCTION IF EXISTS public.criar_requisicoes_compra_lote(jsonb, text, text, text, text);

CREATE OR REPLACE FUNCTION public.criar_requisicao_compra(
  p_item             text,
  p_solicitante      text,
  p_qtd              integer DEFAULT 1,
  p_urgencia         text DEFAULT 'Normal',
  p_centro_custo     text DEFAULT NULL,
  p_filial           text DEFAULT 'SuperMax',
  p_justificativa    text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL,
  p_unidade          text DEFAULT 'un'
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
  -- Era _assert_rpc('compras','logistica'). Quem precisa do item é quem pede;
  -- a trava que importa é a filial.
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

  -- Quem pediu é quem está autenticado. O parâmetro só sobra como fallback
  -- para chamadas de service_role (seed, importação).
  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes (
    item, solicitante, setor_solicitante, qtd, unidade, urgencia,
    centro_custo, justificativa, data_necessidade, status, data, filial
  ) VALUES (
    trim(p_item),
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    COALESCE(NULLIF(trim(COALESCE(p_unidade,'')), ''), 'un'),
    p_urgencia,
    NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
    trim(p_justificativa),
    p_data_necessidade,
    'Pendente', public.acre_today(), p_filial
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

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
  v_elem      jsonb;
  v_req       requisicoes;
  v_resultado jsonb := '[]'::jsonb;
  v_qtd       integer;
  v_texto     text;
  v_unidade   text;
  v_nome      text;
  v_setor     text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE = 'P0001';
  END IF;
  IF p_justificativa IS NULL OR length(trim(p_justificativa)) < 10 THEN
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
      trim(p_justificativa),
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

-- Superfície de execução explícita (a função nova nasceria com EXECUTE para
-- PUBLIC, desfazendo em silêncio o lockdown das migr. 260/261).
REVOKE ALL ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text, text, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text, text, text, date, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date)
  TO authenticated;

-- ── 3. O autor acompanha o que pediu ─────────────────────────────────────────
-- Policy adicional (PERMISSIVE): soma-se à `compras_select`, não a substitui.
-- Quem é de vendas/RH/marketing passa a ver as próprias linhas — e só elas.

DROP POLICY IF EXISTS requisicoes_autor_select ON public.requisicoes;
CREATE POLICY requisicoes_autor_select ON public.requisicoes
  FOR SELECT TO authenticated
  USING (criado_por = auth.uid());

COMMIT;

NOTIFY pgrst, 'reload schema';
