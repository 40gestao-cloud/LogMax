-- 682 — Cotação aprovada que venceu não vira pedido; Compras devolve para revalidar.
--
-- decidir_cotacao (migr. 583) recusa aprovar preço vencido, mas
-- gerar_pedido_de_cotacao não olhava a validade: a proposta aprovada no dia 22
-- com validade até o dia 7 virava pedido no dia 30 pelo preço velho. Na
-- auditoria de 08/10 eram 182 aprovadas paradas sem pedido nas 4 turmas, todas
-- vencidas — e o único caminho de volta era "reabrir", que é da direção.
--
--  1. gerar_pedido_de_cotacao: recusa validade < hoje (replace cirúrgico — o
--     corpo vigente tem ajustes das 584/596/627/628/676).
--  2. revalidar_cotacao_vencida(cotação, motivo): Compras da filial devolve a
--     aprovada-e-vencida, sem pedido vivo, para 'Em correção'. Dali segue o
--     caminho que já existe: "Corrigir e reenviar" (exige validade viva) →
--     Financeiro decide de novo.

-- ── 1 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def  text;
  v_old  text := $o$  -- MIGR 544: `status <> 'Cancelado'`, e não só `ativo`. Pedido cancelado é$o$;
  v_new  text := $n$  -- MIGR 682: preço vencido não vira pedido. A aprovação já recusava
  -- (decidir_cotacao, migr. 583); faltava esta ponta, e a proposta aprovada
  -- ficava esperando até virar pedido pelo preço que o fornecedor não honra mais.
  IF v_cot.validade IS NOT NULL AND v_cot.validade < public.acre_today() THEN
    RAISE EXCEPTION 'O preço desta cotação venceu em %. Pedido não sai com preço vencido: use "Revalidar" na fila de Gerar pedidos, confirme o preço e a nova validade com o fornecedor e reenvie ao Financeiro.',
      to_char(v_cot.validade, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 544: `status <> 'Cancelado'`, e não só `ativo`. Pedido cancelado é$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.gerar_pedido_de_cotacao(uuid, uuid, uuid)'::regprocedure), E'\r', '');
  IF position('MIGR 682' IN v_def) > 0 THEN
    RETURN;  -- já aplicada
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'gerar_pedido_de_cotacao: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revalidar_cotacao_vencida(p_cotacao_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot public.cotacoes;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_cot.filial), false) THEN
    RAISE EXCEPTION 'Cotação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_cot.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só cotação aprovada volta para revalidar (esta está %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_cot.validade IS NULL OR v_cot.validade >= public.acre_today() THEN
    RAISE EXCEPTION 'O preço desta cotação ainda vale — gere o pedido normalmente.'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedidos
              WHERE cotacao_id = v_cot.id AND COALESCE(ativo, true) AND status <> 'Cancelado') THEN
    RAISE EXCEPTION 'Esta cotação já virou pedido.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma porta de devolver_cotacao_para_correcao: o guard de decisão só
  -- aceita entrar em 'Em correção' com esta flag.
  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET status       = 'Em correção',
         feedback     = COALESCE(NULLIF(btrim(COALESCE(p_motivo, '')), ''),
                          format('O preço aprovado venceu em %s. Confirme com o fornecedor o preço e a nova validade e reenvie.',
                                 to_char(v_cot.validade, 'DD/MM/YYYY'))),
         aprovado_por = NULL,
         aprovado_em  = NULL
   WHERE id = v_cot.id
  RETURNING * INTO v_cot;

  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.revalidar_cotacao_vencida(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revalidar_cotacao_vencida(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
