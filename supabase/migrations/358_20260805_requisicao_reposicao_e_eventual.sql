-- 358 — Requisição: reposição x compra eventual
--
-- A 354 deixou a justificativa mais flexível (por item ou do cabeçalho), mas
-- manteve a premissa errada: **toda** requisição precisa de justificativa
-- escrita. Os dados mostraram no que isso deu. O último envio da turma
-- `logmax-aprendiz` tem 18 itens, todos com a mesma justificativa:
--
--     "nao temos ou acabou"
--
-- que é o texto do próprio hint do botão "Comprar" na tela. O aluno copiou a
-- UI para vencer o campo obrigatório. No agregado a justificativa média tem
-- 2 a 19 caracteres nas duas turmas ativas — o campo que existe para o gerente
-- decidir não decide nada.
--
-- E as 32 requisições pendentes batem **exatamente** com o nome de um produto
-- do catálogo: era reposição de prateleira, digitada à mão, item por item.
--
-- ── O que o mercado faz ─────────────────────────────────────────────────────
--
-- Não é lista de motivos prontos. É distinguir o **tipo de requisição** e
-- cobrar redação só onde ela decide algo:
--
--   • Reposição — item estocável do catálogo, disparada pelo ponto de pedido.
--     Não tem justificativa redigida: o motivo É o saldo. O que o comprador
--     usa para decidir é o saldo no momento do pedido contra o mínimo, e isso
--     o sistema sabe sozinho.
--   • Compra eventual — item fora do catálogo, serviço, algo novo. Aqui sim a
--     justificativa é obrigatória, porque o comprador não tem histórico para
--     decidir por conta própria.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
--   1. `tipo_requisicao` ('Reposição' | 'Eventual'). Fica NULL nas linhas
--      antigas de propósito: reclassificar histórico seria chute — as pendentes
--      *parecem* reposição, mas foram abertas sob outra regra.
--   2. `produto_id` + `saldo_no_pedido` + `minimo_no_pedido`. O snapshot é o
--      que transforma "acabou" em evidência: o comprador vê que no dia do
--      pedido havia 3 unidades para um mínimo de 20, sem depender da redação.
--   3. Reposição exige produto do catálogo e dispensa justificativa. Eventual
--      exige justificativa e mantém o item em texto livre.
--
-- A trava da 354 não some — vira condicional ao tipo.

BEGIN;

-- ── 1. Colunas ───────────────────────────────────────────────────────────────

ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS tipo_requisicao  text,
  ADD COLUMN IF NOT EXISTS produto_id       uuid REFERENCES public.produtos(id),
  ADD COLUMN IF NOT EXISTS saldo_no_pedido  numeric,
  ADD COLUMN IF NOT EXISTS minimo_no_pedido numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requisicoes_tipo_requisicao_check') THEN
    ALTER TABLE public.requisicoes
      ADD CONSTRAINT requisicoes_tipo_requisicao_check
      CHECK (tipo_requisicao IS NULL OR tipo_requisicao IN ('Reposição','Eventual'));
  END IF;
END $$;

COMMENT ON COLUMN public.requisicoes.tipo_requisicao IS
  'Reposição = item do catálogo, motivo é o saldo, sem justificativa escrita. Eventual = fora do catálogo, justificativa obrigatória. NULL = aberta antes da migr. 358.';
COMMENT ON COLUMN public.requisicoes.saldo_no_pedido IS
  'Saldo do produto no instante do pedido. É a evidência que substitui a justificativa na reposição.';
COMMENT ON COLUMN public.requisicoes.minimo_no_pedido IS
  'Estoque mínimo do produto no instante do pedido — o ponto de pedido contra o qual o saldo é lido.';

CREATE INDEX IF NOT EXISTS idx_requisicoes_produto_id
  ON public.requisicoes (produto_id) WHERE produto_id IS NOT NULL;

-- ── 2. A RPC ─────────────────────────────────────────────────────────────────
-- Assinatura muda (ganha p_tipo_requisicao): DROP explícito da anterior, senão
-- fica sobrecarga viva ao lado e o PostgREST recusa a chamada por ambiguidade
-- (o caso da `criar_venda_pdv` de 7 argumentos, migr. 274).

DROP FUNCTION IF EXISTS public.criar_requisicoes_compra_lote(jsonb, text, text, text, text, text, date);

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
      -- Item vem do catálogo, e o nome vem do BANCO — não do cliente. Mesma
      -- lição da 344: campo que o navegador manda, o navegador inventa.
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
      v_unidade   := COALESCE(NULLIF(trim(COALESCE(v_prod.unidade,'')), ''), 'un');
      -- Sem justificativa escrita: o motivo é o saldo, gravado logo abaixo.
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
      v_unidade := COALESCE(NULLIF(trim(COALESCE(v_elem->>'unidade','')), ''), 'un');

      -- Compra eventual: aqui a justificativa decide, e continua obrigatória.
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

COMMIT;

NOTIFY pgrst, 'reload schema';
