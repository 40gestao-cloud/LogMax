-- 661_20260929_venda_de_pedido_so_pelo_pedido_e_data_do_acre.sql
--
-- Revisão da 660 (pedido de venda virou venda) e duas pendências da formação
-- de preço:
--
-- 1. A VENDA DO PEDIDO SÓ SE DESFAZ PELO PEDIDO. O Histórico de Vendas marca
--    'Cancelada' (ou inativa) direto na venda. Numa venda de PDV o gatilho
--    `fn_venda_cancelada_desfaz` desfaz tudo; numa venda de pedido não: a
--    cobrança é do pedido (`contas_receber.pedido_venda_id`), o estoque é da
--    separação, e o pedido seguia vivo com a receita já fora do DRE. Gatilho
--    novo recusa cancelar, reabrir ou inativar a venda de pedido — só
--    `cancelar_pedido_venda` passa (marca `app.cancelando_pedido_venda`).
--
-- 2. DEVOLUÇÃO DE VENDA DE PEDIDO. `criar_devolucao_venda`:
--      • recusa pedido ainda não separado (ou cancelado): nada saiu do
--        estoque, e a devolução daria entrada do que nunca saiu;
--      • em "cancelar pendências" enxerga também as contas do pedido — antes
--        procurava só por `venda_id`, não achava nada e lançava uma saída
--        'Pago' em contas a pagar: dinheiro devolvido que nunca entrou.
--    E `cancelar_pedido_venda` recusa pedido que já teve devolução: o estorno
--    de estoque dele somaria de novo o que a devolução já trouxe.
--
-- 3. `converter_orcamento_em_pedido` confere o serviço do orçamento com a
--    mesma régua do PDV (659): prestado, ativo, da unidade do orçamento.
--
-- 4. Reset geral mantém `filial_precificacao` (regime, RBT12 e taxas/despesas
--    manuais) — é configuração da unidade, como `financeiro_config`.
--
-- 5. DATA NO FUSO DO ACRE. O banco roda em UTC: `created_at::date` punha a
--    venda feita depois das 19h do Acre no dia seguinte — e, no último dia do
--    mês, no DAS e no RBT12 do mês seguinte. Troca por
--    `(created_at AT TIME ZONE 'America/Rio_Branco')::date` em _dre_calculo,
--    _receita_simples, _receita_servico, _simples_rbt12, _taxa_pelo_mix,
--    parametros_precificacao e gerar_painel_bi.
--
-- As trocas em função viva são cirúrgicas (replace no corpo lido do banco) e
-- conferidas: âncora não achada derruba a migração. IDEMPOTENTE. Aplicar nos
-- 4 projetos.

-- ════ 1. Venda de pedido só se desfaz pelo pedido ═══════════════════════════

CREATE OR REPLACE FUNCTION public.fn_venda_de_pedido_so_pelo_pedido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.pedido_venda_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.cancelando_pedido_venda', true), '') = 'true' THEN
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
  BEFORE UPDATE OF status, ativo ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.fn_venda_de_pedido_so_pelo_pedido();

-- cancelar_pedido_venda: abre a porta só para o próprio UPDATE da venda, e
-- recusa pedido que já teve devolução.
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.cancelar_pedido_venda(uuid, text)'::regprocedure);
  IF position('MIGR 661' in d) > 0 THEN
    RETURN;
  END IF;

  n := replace(d,
    '  IF v_ped.separado_em IS NOT NULL THEN',
    '  -- MIGR 661: devolução já trouxe de volta o que voltou; o estorno abaixo
  -- somaria de novo. Pedido com devolução não se cancela.
  IF EXISTS (SELECT 1 FROM public.devolucoes d
               JOIN public.vendas v ON v.id = d.venda_id
              WHERE v.pedido_venda_id = v_ped.id
                AND COALESCE(d.ativo, true)
                AND d.status = ''Concluída'') THEN
    RAISE EXCEPTION ''Este pedido já teve devolução em Vendas › Devoluções. O que voltou já entrou no estoque e a cobrança já foi acertada lá — cancelar agora estornaria de novo.''
      USING ERRCODE = ''P0001'';
  END IF;

  IF v_ped.separado_em IS NOT NULL THEN');
  IF n = d THEN RAISE EXCEPTION '661: âncora do separado_em não achada em cancelar_pedido_venda'; END IF;
  d := n;

  n := replace(d,
    '  UPDATE public.vendas SET status = ''Cancelada''',
    '  PERFORM set_config(''app.cancelando_pedido_venda'', ''true'', true);  -- MIGR 661
  UPDATE public.vendas SET status = ''Cancelada''');
  IF n = d THEN RAISE EXCEPTION '661: âncora do UPDATE vendas não achada em cancelar_pedido_venda'; END IF;
  d := n;

  n := replace(d,
    '   WHERE pedido_venda_id = v_ped.id AND status <> ''Cancelada'';',
    '   WHERE pedido_venda_id = v_ped.id AND status <> ''Cancelada'';
  PERFORM set_config(''app.cancelando_pedido_venda'', ''false'', true);');
  IF n = d THEN RAISE EXCEPTION '661: âncora do WHERE vendas não achada em cancelar_pedido_venda'; END IF;

  EXECUTE n;
END $$;

-- ════ 2. Devolução de venda de pedido ════════════════════════════════════════
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.criar_devolucao_venda(uuid, jsonb, text, text, text)'::regprocedure);
  IF position('MIGR 661' in d) > 0 THEN
    RETURN;
  END IF;

  n := replace(d,
    '    v_short_id := UPPER(RIGHT(v_venda.id::text, 6));',
    '    -- MIGR 661: venda de pedido de venda. Antes da separação nada saiu do
    -- estoque — devolver daria entrada do que nunca saiu. Desistência de
    -- pedido não separado é cancelamento do pedido.
    IF v_venda.pedido_venda_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.pedidos_venda pv
          WHERE pv.id = v_venda.pedido_venda_id
            AND pv.separado_em IS NOT NULL
            AND pv.status <> ''Cancelado'') THEN
        RAISE EXCEPTION ''Esta venda é de um pedido de venda que ainda não foi separado (ou foi cancelado): nada saiu do estoque. Para desistir, cancele o pedido em Vendas › Pedidos de Venda.''
          USING ERRCODE = ''P0001'';
    END IF;

    v_short_id := UPPER(RIGHT(v_venda.id::text, 6));');
  IF n = d THEN RAISE EXCEPTION '661: âncora do v_short_id não achada em criar_devolucao_venda'; END IF;
  d := n;

  -- A cobrança do pedido mora em `pedido_venda_id`, não em `venda_id`.
  n := replace(d,
    'AND c.venda_id = p_venda_id',
    'AND (c.venda_id = p_venda_id  -- MIGR 661: + as contas do pedido de venda
                   OR (v_venda.pedido_venda_id IS NOT NULL AND c.pedido_venda_id = v_venda.pedido_venda_id))');
  IF n = d THEN RAISE EXCEPTION '661: âncora das contas não achada em criar_devolucao_venda'; END IF;

  EXECUTE n;
END $$;

-- ════ 3. Serviço do orçamento pela régua do PDV ══════════════════════════════
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.converter_orcamento_em_pedido(uuid)'::regprocedure);
  IF position('MIGR 661' in d) > 0 THEN
    RETURN;
  END IF;

  n := replace(d,
    '  INSERT INTO public.pedidos_venda (',
    '  -- MIGR 661: serviço do orçamento pela régua do PDV (659) — prestado,
  -- ativo, da unidade. `v_desc` é reaproveitada: ganha o valor dela abaixo.
  SELECT COALESCE(NULLIF(x->>''nome'', ''''), ''(sem nome)'') INTO v_desc
    FROM jsonb_array_elements(COALESCE(v_orc.itens, ''[]''::jsonb)) x
   WHERE NULLIF(x->>''servico_id'', '''') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.servicos s
        WHERE s.id = (x->>''servico_id'')::uuid
          AND s.filial = v_orc.filial
          AND COALESCE(s.natureza, ''prestado'') = ''prestado''
          AND COALESCE(s.ativo, true)
          AND s.excluido_em IS NULL
          AND COALESCE(s.status, ''Ativo'') = ''Ativo'')
   LIMIT 1;
  IF v_desc IS NOT NULL THEN
    RAISE EXCEPTION ''O serviço "%" do orçamento não é um serviço prestado ativo desta unidade. Edite o orçamento e escolha o serviço de novo.'', v_desc
      USING ERRCODE = ''P0001'';
  END IF;

  INSERT INTO public.pedidos_venda (');
  IF n = d THEN RAISE EXCEPTION '661: âncora do INSERT pedidos_venda não achada em converter_orcamento_em_pedido'; END IF;

  EXECUTE n;
END $$;

-- ════ 4. Reset geral mantém a precificação da unidade ════════════════════════
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.resetar_geral_admin(text)'::regprocedure);
  IF position('''filial_precificacao''' in d) > 0 THEN
    RETURN;
  END IF;

  n := replace(d,
    '''modo_visitante_config'', ''redes_sociais_links'', ''ti_relogio_maquinas''',
    '''modo_visitante_config'', ''redes_sociais_links'', ''ti_relogio_maquinas'',
    ''filial_precificacao''  -- MIGR 661');
  IF n = d THEN RAISE EXCEPTION '661: âncora do v_manter não achada em resetar_geral_admin'; END IF;

  EXECUTE n;
END $$;

-- ════ 5. Data no fuso do Acre ════════════════════════════════════════════════
-- `x.created_at::date` → `(x.created_at AT TIME ZONE 'America/Rio_Branco')::date`.
-- Toda `created_at` do schema é timestamptz (conferido), então a troca vale
-- para qualquer tabela que a função leia. Rodar de novo não acha mais o
-- padrão: idempotente por construção.
DO $$
DECLARE
  f  regprocedure;
  d  text;
  n  text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('_dre_calculo', '_receita_simples', '_receita_servico', '_simples_rbt12',
                         '_taxa_pelo_mix', 'parametros_precificacao', 'gerar_painel_bi')
  LOOP
    d := pg_get_functiondef(f);
    n := regexp_replace(d, '(\m[a-z0-9_]+\.)?\mcreated_at::date',
                        '(\1created_at AT TIME ZONE ''America/Rio_Branco'')::date', 'g');
    -- Início de atividade do Simples: o mês da primeira venda, no Acre.
    n := replace(n, 'MIN(v.created_at))::date',
                    'MIN(v.created_at AT TIME ZONE ''America/Rio_Branco''))::date');
    IF n <> d THEN
      EXECUTE n;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('_dre_calculo', '_receita_simples', '_receita_servico', '_simples_rbt12',
                         '_taxa_pelo_mix', 'parametros_precificacao', 'gerar_painel_bi')
       AND (pg_get_functiondef(p.oid) ~ '\mcreated_at::date'
            OR pg_get_functiondef(p.oid) LIKE '%MIN(v.created_at))::date%')) THEN
    RAISE EXCEPTION '661: sobrou created_at::date em UTC';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
