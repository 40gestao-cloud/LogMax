-- 435_20260816_a_divida_do_cliente_nao_e_de_todo_mundo.sql
--
-- Última pendência técnica da auditoria de 16/08.
--
-- `cliente_saldo_devedor` e `cliente_titulos_vencidos` somam os títulos do
-- cliente sem recortar por filial e sem guard nenhum. Qualquer aluno logado
-- enumerava `cliente_id` (a tabela `clientes` é legível) e lia a dívida de
-- cliente de qualquer unidade.
--
-- A auditoria deixou isso em aberto de propósito, porque recortar por filial
-- mudaria o NÚMERO que o limite de crédito enxerga. Decisão tomada em 16/08:
-- **o crédito continua considerando a exposição total do cliente na holding** —
-- é o comportamento certo para crédito, e o cliente é da rede, não da loja.
--
-- Então o recorte não é do dado, é de quem pergunta. Sai a filial, entra o
-- setor: quem vende e quem cobra podem consultar; o resto da turma, não.
--
-- Por que isso não quebra nada:
--   • os únicos consumidores são `PDVView` e `PDVViewSupermax`, via
--     `lib/credito.ts` — operador é vendas ou financeiro;
--   • o gatilho `venda_fiado_respeita_credito` roda como o vendedor, que já
--     passou pelo `_assert_rpc('vendas','financeiro')` do `criar_venda_pdv`;
--   • `consultarCreditoCliente` já degrada para "não sei" quando a RPC falha
--     (o comentário no `credito.ts` chama isso de "migração pendente na
--     turma"): a tela some, o gatilho não trava, e o comportamento é o de
--     antes da 416. Ou seja, se algum caminho não previsto chamar sem
--     permissão, o efeito é a UI omitir o painel de crédito, não estourar.
--
-- Vem junto o blackout, que estas duas também ignoravam — `_assert_rpc` traz.
-- Na prática o apagão já barrava a venda (`vendas` tem `zz_blackout`), mas ler
-- a dívida durante o exercício continuava possível.
--
-- As duas são `LANGUAGE sql` e viram plpgsql, como `apurar_resultado_periodo`
-- na 431 e `orcamento_execucao` na 434. Assinatura e tipo de retorno idênticos,
-- então o CREATE OR REPLACE passa sem 42P13.


BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_saldo_devedor(p_cliente_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric(15,2);
BEGIN
  -- Sem setores extras de propósito: a soma continua global (exposição total
  -- na holding). O que se restringe é a audiência, não o cálculo.
  PERFORM public._assert_rpc('vendas', 'financeiro');

  SELECT COALESCE(SUM(
           GREATEST(
             cr.valor - COALESCE((
               SELECT SUM(b.principal)
                 FROM public.contas_receber_baixas b
                WHERE b.conta_id = cr.id
             ), 0),
             0)
         ), 0)::numeric(15,2)
    INTO v_total
    FROM public.contas_receber cr
   WHERE cr.cliente_id = p_cliente_id
     AND cr.ativo = true
     AND cr.status <> 'Pago';

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cliente_titulos_vencidos(p_cliente_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qtd integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  SELECT COUNT(*)::integer
    INTO v_qtd
    FROM public.contas_receber
   WHERE cliente_id = p_cliente_id
     AND ativo = true
     AND status <> 'Pago'
     AND vencimento IS NOT NULL
     AND vencimento < public.acre_today();

  RETURN v_qtd;
END;
$function$;

DO $do$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.cliente_saldo_devedor(uuid)',
    'public.cliente_titulos_vencidos(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4 — espera 2, e md5 igual entre as turmas)
--
--   SELECT proname, md5(pg_get_functiondef(oid)),
--          has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname IN ('cliente_saldo_devedor','cliente_titulos_vencidos')
--      AND pg_get_functiondef(oid) ~ '_assert_rpc'
--    ORDER BY 1;
--
-- TESTE MANUAL:
--   • PDV, venda fiado a cliente com título em aberto → o painel de crédito
--     aparece e o bloqueio por limite continua funcionando;
--   • cliente com dívida em DUAS unidades → o valor tem de somar as duas
--     (é a decisão desta migração; se somar só uma, algo saiu errado);
--   • aluno de outro setor chamando a RPC pelo F12 → 42501.
-- ════════════════════════════════════════════════════════════════════════════
