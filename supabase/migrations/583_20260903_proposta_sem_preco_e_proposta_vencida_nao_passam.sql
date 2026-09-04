-- ════════════════════════════════════════════════════════════════════════════
-- 583 — Proposta sem preço não existe, e proposta vencida não se aprova
--
-- Três buracos que a tela de Cotações prometia fechar e não fechava:
--
-- 1. VALOR ZERO. A validação do formulário só olhava requisição e fornecedor;
--    `parseBRL('')` é 0, não havia CHECK na tabela e nenhuma RPC conferia. Dava
--    para enviar proposta de R$ 0,00 ao Financeiro — e ela ainda ganhava o
--    comparativo, porque zero é o menor preço. Uma dessas chegou a ser criada
--    na turma (cotação cancelada de 24/08 na MaxLook). A `reenviar_cotacao_
--    corrigida` já recusava zero; faltava a porta de entrada.
--
-- 2. VALIDADE DECORATIVA. O campo era gravado, exibido na lista e no
--    comparativo, e nada mais: ninguém comparava com hoje. O Financeiro
--    aprovava preço vencido sem um aviso. Pedir a data e depois ignorá-la é
--    pior do que não pedir — ensina que a data é enfeite.
--
-- 3. SEM ONDE ESCREVER A CONDIÇÃO. Frete incluso, garantia, instalação, prazo
--    de troca: a proposta real vem com isso, e não havia campo. Tanto que a
--    busca da tela já filtrava por `observacao` — uma coluna que não existia.
--    É também onde a diferença dos três nichos cabe sem criar campo por nicho:
--    garantia e IMEI no TechMax, grade e composição no MaxLook, validade e
--    lote no SuperMax.
--
-- O bloqueio da validade fica na APROVAÇÃO, não na geração do pedido: proposta
-- aprovada ontem e virada em pedido hoje não pode travar sem saída, porque
-- cotação já aprovada não volta para correção.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cotacoes ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN public.cotacoes.observacao IS
  'O que o fornecedor incluiu na proposta além do preço: frete, garantia, instalação, prazo de troca.';

-- NOT VALID de propósito: a proposta zerada que já existe é histórico de uma
-- turma, e reescrever histórico para satisfazer regra nova é pior do que
-- conviver com ele. A partir daqui, toda escrita passa pela régua.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cotacoes'::regclass
       AND conname  = 'chk_cotacoes_valor_positivo'
  ) THEN
    ALTER TABLE public.cotacoes
      ADD CONSTRAINT chk_cotacoes_valor_positivo CHECK (valor_total > 0) NOT VALID;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Aprovar exige preço vivo
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.decidir_cotacao(p_cotacao_id uuid, p_decisao text, p_feedback text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot        cotacoes;
  v_canceladas integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisao = 'Negado' AND COALESCE(trim(p_feedback), '') = '' THEN
    RAISE EXCEPTION 'Reprovar exige motivo — é o que Compras lê para cotar de novo.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Sem esta trava, dois cliques simultâneos (ou o F5 de quem achou que não
  -- salvou) decidiam duas vezes e o segundo cancelava concorrentes de novo.
  IF v_cot.status <> 'Aguardando Financeiro' THEN
    RAISE EXCEPTION 'Esta cotação já está %.', v_cot.status USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 583: preço de fornecedor vence. Aprovar depois da validade é comprar
  -- por um preço que o fornecedor já não pratica — o caminho é devolver para
  -- Compras revalidar, que é o que um comprador faz na vida real.
  IF p_decisao = 'Aprovado'
     AND v_cot.validade IS NOT NULL
     AND v_cot.validade < public.acre_today() THEN
    RAISE EXCEPTION 'Esta proposta venceu em %. Preço vencido não se aprova: devolva para correção e peça a Compras revalidar com o fornecedor.',
      to_char(v_cot.validade, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.cotacoes
     SET status       = p_decisao,
         feedback     = NULLIF(trim(COALESCE(p_feedback, '')), ''),
         aprovado_por = auth.uid(),
         aprovado_em  = now()
   WHERE id = p_cotacao_id;

  -- Aprovar uma proposta encerra a concorrência: as demais da MESMA requisição
  -- saem da fila do Financeiro no mesmo COMMIT.
  IF p_decisao = 'Aprovado' AND v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.cotacoes
       SET status   = 'Cancelado',
           feedback = COALESCE(NULLIF(trim(COALESCE(feedback, '')), ''),
                               'Cancelada automaticamente: outra proposta foi aprovada para esta requisição.')
     WHERE requisicao_id = v_cot.requisicao_id
       AND id <> p_cotacao_id
       AND COALESCE(ativo, true)
       AND status = 'Aguardando Financeiro';
    GET DIAGNOSTICS v_canceladas = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decisao,
    'canceladas', v_canceladas,
    'requisicao_id', v_cot.requisicao_id
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- A correção grava a condição e não devolve proposta vencida
--
-- DROP + CREATE porque a assinatura ganha `p_observacao`.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text);

CREATE FUNCTION public.reenviar_cotacao_corrigida(
  p_cotacao_id uuid,
  p_valor_total numeric,
  p_prazo_entrega text DEFAULT NULL::text,
  p_validade text DEFAULT NULL::text,
  p_marca text DEFAULT NULL::text,
  p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot      public.cotacoes;
  v_validade date;
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

  -- MIGR 583: reenviar é revalidar. Devolver a mesma proposta com a validade
  -- vencida só empurraria o problema para a mesa do Financeiro, que agora a
  -- recusa — e a requisição ficaria girando entre as duas telas.
  v_validade := NULLIF(trim(COALESCE(p_validade, '')), '')::date;
  IF v_validade IS NOT NULL AND v_validade < public.acre_today() THEN
    RAISE EXCEPTION 'A validade informada (%) já passou. Reenviar é revalidar: confirme com o fornecedor até quando o preço vale.',
      to_char(v_validade, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET valor_total   = p_valor_total,
         prazo_entrega = COALESCE(NULLIF(trim(COALESCE(p_prazo_entrega, '')), ''), prazo_entrega),
         validade      = v_validade,
         marca         = NULLIF(btrim(COALESCE(p_marca, '')), ''),
         observacao    = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         status        = 'Aguardando Financeiro',
         feedback      = NULL
   WHERE id = p_cotacao_id
  RETURNING * INTO v_cot;

  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
