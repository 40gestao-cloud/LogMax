-- 663_20260929_furos_da_revisao_pre_push.sql
--
-- Revisão antes do push da formação de preço (656–662). Três furos pequenos:
--
-- 1. A trava da 661 olhava só `status` e `ativo`. Quem grava em `vendas`
--    (setor Vendas, pela RLS) podia primeiro zerar `pedido_venda_id` e depois
--    cancelar a venda como se fosse de PDV — de volta ao pedido vivo com a
--    receita fora do DRE. O vínculo com o pedido agora também só muda pelas
--    RPCs (conversão grava no INSERT; ninguém troca depois).
--
-- 2. Conta do DAS ou do frete com status 'Cancelado'. A saída prevista é
--    excluir (inativar), que desfaz a apuração / devolve o frete do custo.
--    Cancelar pelo status deixava a apuração de pé (o DAS sumia da fila de
--    pagamento sem ninguém refazer) e o frete dentro do custo da mercadoria.
--    Recusado, com a instrução do caminho certo.
--
-- 3. `vendas_pagamentos` lia com "qualquer um da filial"; a venda de que ela
--    é parte (`vendas_select`) é só de Vendas, Financeiro e gerente. Alinhada.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ════ 1. Vínculo venda ↔ pedido ═════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_venda_de_pedido_so_pelo_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- a conferência do pedido apagado não pode depender da RLS de quem grava
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.cancelando_pedido_venda', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  -- MIGR 663: o vínculo não se troca depois de gravado. Exceção: o pedido
  -- foi apagado (reset da unidade) e a FK zera o campo — aí não há mais o
  -- que proteger.
  IF NEW.pedido_venda_id IS DISTINCT FROM OLD.pedido_venda_id
     AND NOT (NEW.pedido_venda_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.pedidos_venda pv WHERE pv.id = OLD.pedido_venda_id)) THEN
    RAISE EXCEPTION 'O pedido de venda de uma venda não se troca: ele nasce na conversão do orçamento.'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.pedido_venda_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada')
     OR (OLD.status = 'Cancelada' AND NEW.status IS DISTINCT FROM 'Cancelada')
     OR (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RAISE EXCEPTION
      'Esta venda nasceu de um pedido de venda. Cancele pelo pedido (Vendas › Pedidos de Venda): é ele que desfaz a cobrança e o estoque junto com a venda.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_venda_de_pedido_so_pelo_pedido() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_venda_de_pedido_so_pelo_pedido ON public.vendas;
CREATE TRIGGER trg_venda_de_pedido_so_pelo_pedido
  BEFORE UPDATE OF status, ativo, pedido_venda_id ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.fn_venda_de_pedido_so_pelo_pedido();

-- ════ 2. DAS e frete não se cancelam pelo status ═════════════════════════════
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.fn_conta_de_das_congela()'::regprocedure);
  IF position('MIGR 663' in d) = 0 THEN
    n := replace(d,
      '  IF OLD.origem = ''das''',
      '  -- MIGR 663: cancelar pelo status deixaria a apuração de pé.
  IF OLD.origem = ''das'' AND NEW.status = ''Cancelado'' AND OLD.status IS DISTINCT FROM ''Cancelado'' THEN
    RAISE EXCEPTION ''O DAS não se cancela pelo status. Para desfazer a apuração, exclua a conta; para corrigir o valor, reapure em Financeiro › Precificação › Tributação.''
      USING ERRCODE = ''42501'';
  END IF;

  IF OLD.origem = ''das''');
    IF n = d THEN RAISE EXCEPTION '663: âncora não achada em fn_conta_de_das_congela'; END IF;
    EXECUTE n;
  END IF;

  d := pg_get_functiondef('public.fn_conta_de_frete_congela()'::regprocedure);
  IF position('MIGR 663' in d) = 0 THEN
    n := replace(d,
      '  IF OLD.origem = ''frete_compra''',
      '  -- MIGR 663: cancelar pelo status deixaria o frete dentro do custo.
  IF OLD.origem = ''frete_compra'' AND NEW.status = ''Cancelado'' AND OLD.status IS DISTINCT FROM ''Cancelado'' THEN
    RAISE EXCEPTION ''Conta de frete não se cancela pelo status: use "Cancelar frete" em Contas a pagar, que tira o frete do custo dos pedidos.''
      USING ERRCODE = ''42501'';
  END IF;

  IF OLD.origem = ''frete_compra''');
    IF n = d THEN RAISE EXCEPTION '663: âncora não achada em fn_conta_de_frete_congela'; END IF;
    EXECUTE n;
  END IF;
END $$;

-- ════ 3. Partes do pagamento: quem lê a venda ════════════════════════════════
DROP POLICY IF EXISTS vendas_pagamentos_select ON public.vendas_pagamentos;
CREATE POLICY vendas_pagamentos_select ON public.vendas_pagamentos
  FOR SELECT TO authenticated
  USING (COALESCE((
          ( SELECT auth_in_setor(VARIADIC ARRAY['vendas'::text, 'financeiro'::text]) AS auth_in_setor)
          OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text)
              AND (( SELECT auth_user_filial() AS auth_user_filial) = filial)))
        AND (( SELECT auth_is_admin() AS auth_is_admin)
              OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

NOTIFY pgrst, 'reload schema';
