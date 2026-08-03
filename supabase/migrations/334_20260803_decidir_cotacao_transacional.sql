-- 334 — Decidir cotação vira uma transação só.
--
-- A tela fazia: um UPDATE na cotação escolhida e, se aprovada, um laço de
-- UPDATEs cancelando as concorrentes — cada um com `catch { }` vazio. Se um
-- falhasse (RLS, rede, alçada), a concorrente continuava 'Aguardando
-- Financeiro' e aprovável: o Financeiro decidia duas vezes a mesma compra.
--
-- Não virava compra dupla, porque `gerar_pedido_de_cotacao` (migr. 266) recusa
-- o segundo pedido da mesma requisição. Virava coisa pior de explicar numa
-- aula: uma proposta fantasma que aceita ser aprovada e depois recusa virar
-- pedido, sem que nada na tela diga por quê.
--
-- Mesmo remédio da 330: o que só faz sentido junto acontece junto.
--
-- A autoridade continua onde estava — o trigger `cotacao_decisao_guard`
-- (migr. 282) roda no UPDATE e aplica a alçada por valor. SECURITY DEFINER
-- aqui não fura esse guard: ele lê `auth.uid()` e o papel do JWT, que continuam
-- sendo os de quem clicou.

BEGIN;

CREATE OR REPLACE FUNCTION public.decidir_cotacao(
  p_cotacao_id uuid,
  p_decisao    text,
  p_feedback   text DEFAULT NULL
)
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

REVOKE ALL ON FUNCTION public.decidir_cotacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_cotacao(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- Uma assinatura só:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'decidir_cotacao';
--
--   -- Com 3 propostas na mesma requisição, aprovar uma deve devolver
--   -- "canceladas": 2 e deixar as outras duas em 'Cancelado'.
