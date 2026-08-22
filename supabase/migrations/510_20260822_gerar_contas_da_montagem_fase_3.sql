-- 510_20260822_gerar_contas_da_montagem_fase_3.sql
--
-- Fase 3 do plano de desembolso da montagem de filial
-- (docs/plano-montagem-filial-investimentos.md). Depende da Fase 1
-- (migr. 509, tabela `filial_investimentos`) e da Fase 0 (migr. 507, DRE
-- respeita `natureza`) — sem elas, cada equipamento gerado aqui afundaria
-- o resultado do mês.
--
-- Duas RPCs:
--   • gerar_contas_da_montagem — botão "Gerar contas a pagar" no formulário.
--     Nunca roda no save; é ação explícita e idempotente (item com
--     conta_pagar_id preenchido é pulado).
--   • desvincular_investimento_conta — desfaz o vínculo quando o item foi
--     editado depois de gerado. CANCELA a conta (não apaga); conta paga ou
--     parcialmente paga não desvincula.
--
-- Folha fica de fora de propósito: não existe categoria 'folha' em
-- filial_investimentos (o campo segue só como estimativa em
-- `filiais.detalhes.folhaPagamento`) — `processar_folha` já gera a conta
-- real, e gerar aqui duplicaria salário no DRE.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.gerar_contas_da_montagem(
  p_filial_id               uuid,
  p_data_vencimento         date,
  p_dia_vencimento_aluguel  integer DEFAULT NULL,
  p_parcelas_aluguel        integer DEFAULT 1,
  p_natureza_outro          text    DEFAULT 'despesa'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial  text;
  v_gerados integer := 0;
  v_pulados integer := 0;
  r         record;
  v_cp_id   uuid;
  v_venc    date;
  i         integer;
  v_desc    text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT filial INTO v_filial
    FROM public.filial_investimentos
   WHERE filial_id = p_filial_id AND ativo
   LIMIT 1;

  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Nenhum item de investimento ativo para esta filial.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma régua de autorização da RLS da tabela (migr. 509): admin/CEO/
  -- conselheiro fazem tudo, gerente só na própria unidade. COALESCE porque
  -- auth_pode_filial/auth_gerente_da devolvem NULL pra conta sem filial —
  -- sem ele, `NOT NULL` é NULL e o guard deixa passar (lição da migr. 308/495).
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Investimento de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_filial), false) THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro ou o gerente da unidade geram o desembolso.'
      USING ERRCODE = '42501';
  END IF;

  IF p_data_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe a data de vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_natureza_outro, '') NOT IN ('despesa', 'estoque', 'imobilizado') THEN
    RAISE EXCEPTION 'Natureza inválida para item "outro": %', p_natureza_outro USING ERRCODE = 'P0001';
  END IF;

  -- ── Equipamento e Outro: 1 conta por item ────────────────────────────────
  FOR r IN
    SELECT * FROM public.filial_investimentos
     WHERE filial_id = p_filial_id AND ativo AND categoria IN ('equipamento', 'outro')
     ORDER BY categoria, rotulo
  LOOP
    IF r.conta_pagar_id IS NOT NULL OR COALESCE(r.valor_total, 0) <= 0 THEN
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza)
    VALUES (
      'Montagem ' || v_filial || ' — ' || r.rotulo,
      r.valor_total, p_data_vencimento, 'Pendente', v_filial, 'montagem_filial',
      r.centro_custo_id,
      CASE WHEN r.categoria = 'equipamento' THEN 'imobilizado' ELSE p_natureza_outro END
    )
    RETURNING id INTO v_cp_id;

    UPDATE public.filial_investimentos SET conta_pagar_id = v_cp_id WHERE id = r.id;
    v_gerados := v_gerados + 1;
  END LOOP;

  -- ── Aluguel: 1 conta por mês, N parcelas ─────────────────────────────────
  -- Só a 1ª parcela recebe o vínculo (dá idempotência ao item); as demais
  -- entram soltas com a mesma `origem`, igual à Tabela Price do mútuo (473).
  FOR r IN
    SELECT * FROM public.filial_investimentos
     WHERE filial_id = p_filial_id AND ativo AND categoria = 'aluguel'
     ORDER BY rotulo
  LOOP
    IF r.conta_pagar_id IS NOT NULL OR COALESCE(r.valor_total, 0) <= 0 THEN
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;
    IF COALESCE(p_dia_vencimento_aluguel, 0) NOT BETWEEN 1 AND 28 THEN
      RAISE EXCEPTION 'Informe o dia do vencimento do aluguel (1 a 28) — há item de aluguel na lista.'
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_parcelas_aluguel, 0) < 1 THEN
      RAISE EXCEPTION 'Aluguel precisa de ao menos 1 parcela.' USING ERRCODE = 'P0001';
    END IF;

    v_venc := make_date(
      extract(year  from public.acre_today())::int,
      extract(month from public.acre_today())::int,
      p_dia_vencimento_aluguel
    );
    IF v_venc < public.acre_today() THEN
      v_venc := (v_venc + interval '1 month')::date;
    END IF;

    FOR i IN 1..p_parcelas_aluguel LOOP
      v_desc := 'Montagem ' || v_filial || ' — ' || r.rotulo || ' (' || i || '/' || p_parcelas_aluguel || ')';
      INSERT INTO public.contas_pagar
        (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza)
      VALUES (v_desc, r.valor_total, v_venc, 'Pendente', v_filial, 'montagem_filial', r.centro_custo_id, 'despesa')
      RETURNING id INTO v_cp_id;

      IF i = 1 THEN
        UPDATE public.filial_investimentos SET conta_pagar_id = v_cp_id WHERE id = r.id;
      END IF;

      v_venc := (v_venc + interval '1 month')::date;
    END LOOP;
    v_gerados := v_gerados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true, 'filial', v_filial,
    'itens_gerados', v_gerados, 'itens_pulados', v_pulados,
    'executado_em', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_contas_da_montagem(uuid, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_contas_da_montagem(uuid, date, integer, integer, text) TO authenticated;

COMMENT ON FUNCTION public.gerar_contas_da_montagem(uuid, date, integer, integer, text) IS
  'Fase 3 do plano de desembolso da montagem de filial (migr. 510). Gera contas a pagar item a item a partir de filial_investimentos — idempotente via conta_pagar_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- Desvincular: editar item já gerado não reescreve a conta em silêncio.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.desvincular_investimento_conta(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.filial_investimentos;
  v_cp   public.contas_pagar;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_item FROM public.filial_investimentos WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_item.filial), false)
     OR NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_item.filial), false) THEN
    RAISE EXCEPTION 'Permissão insuficiente.' USING ERRCODE = '42501';
  END IF;

  IF v_item.conta_pagar_id IS NULL THEN
    RAISE EXCEPTION 'Este item não tem conta gerada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cp FROM public.contas_pagar WHERE id = v_item.conta_pagar_id FOR UPDATE;
  IF v_cp.id IS NULL THEN
    -- Conta já não existe mais (limpeza manual, reset parcial) — só solta o vínculo.
    UPDATE public.filial_investimentos SET conta_pagar_id = NULL WHERE id = v_item.id;
    RETURN;
  END IF;

  IF v_cp.status IN ('Pago', 'Parcial') THEN
    RAISE EXCEPTION 'Conta já paga (total ou parcialmente) não desvincula — estorne o pagamento primeiro.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contas_pagar SET status = 'Cancelado' WHERE id = v_cp.id;
  UPDATE public.filial_investimentos SET conta_pagar_id = NULL WHERE id = v_item.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.desvincular_investimento_conta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desvincular_investimento_conta(uuid) TO authenticated;

COMMENT ON FUNCTION public.desvincular_investimento_conta(uuid) IS
  'Migr. 510. Cancela a conta a pagar ligada a um item de filial_investimentos e limpa o vínculo — não apaga a conta. Conta paga/parcial não desvincula.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('gerar_contas_da_montagem', 'desvincular_investimento_conta');
--   -- 2 linhas
--
--   -- Idempotência: rodar duas vezes seguidas na mesma filial deve gerar 0
--   -- na segunda vez (tudo pulado):
--   SELECT gerar_contas_da_montagem('<filial_id>', current_date + 30);
--   SELECT gerar_contas_da_montagem('<filial_id>', current_date + 30);
--   -- 'itens_gerados' = 0 na segunda chamada, 'itens_pulados' = total de itens
-- ════════════════════════════════════════════════════════════════════════
