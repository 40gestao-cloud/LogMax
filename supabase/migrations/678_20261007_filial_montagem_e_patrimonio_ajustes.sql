-- 678 — Ajustes de montagem de filial e patrimônio (pendências da migr. 634)
--
-- 1. Aluguel é sempre quantidade 1. O valor do item é mensal e se repete em
--    cada parcela; com quantidade 3, `lancar_investimento_filial` cobrava
--    3 × o aluguel todo mês. Gatilho normaliza + backfill do que não foi lançado.
--
-- 2. Item "Outro" lançado como imobilizado vira bem. Antes só a categoria
--    'equipamento' criava o produto de patrimônio; o "Outro" com natureza
--    imobilizado saía do DRE (contas imobilizado não são despesa) e não entrava
--    na depreciação — o gasto sumia do resultado para sempre. Nas 4 turmas não
--    havia nenhum caso em 2026-10-07, então não há backfill.
--    De quebra: o nome do bem desvia se já existir produto ativo com o mesmo
--    nome na unidade (uq_produtos_nome_filial_ativo derrubava o lançamento).
--
-- 3. Venda de PARTE de um lote. `vender_patrimonio` ganha `p_quantidade`:
--    menor que o lote, o bem se divide — a parte vendida vira um bem irmão
--    (mesma data de aquisição, custo proporcional, `patrimonio_origem_id`
--    apontando para o lote) e é esse irmão que é baixado e vai a Contas a
--    Receber. O lote original fica com o resto da quantidade e do custo, e
--    segue depreciando. Soma dos custos não muda, então o DRE não muda.
--
-- 4. Depreciação pelo calendário. A taxa diária era custo / (meses × 30), mas
--    a vida útil corre até a mesma data N meses depois (~30,44 dias/mês): ao fim
--    da vida o bem tinha depreciado ~101,4%. O divisor passa a ser o número
--    real de dias da vida útil, nos dois blocos de `_dre_calculo` (Depreciação e
--    Baixa de imobilizado). Cirúrgico via replace(), régua das migr. 499/507/508.

BEGIN;

-- ── 1. Aluguel = quantidade 1 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_filial_investimento_aluguel_qtd_um()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.categoria = 'aluguel' AND NEW.quantidade IS DISTINCT FROM 1 THEN
    NEW.quantidade := 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_filial_investimento_aluguel_qtd_um() FROM public, anon;

DROP TRIGGER IF EXISTS trg_filial_investimento_aluguel_qtd_um ON public.filial_investimentos;
CREATE TRIGGER trg_filial_investimento_aluguel_qtd_um
  BEFORE INSERT OR UPDATE OF categoria, quantidade ON public.filial_investimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_filial_investimento_aluguel_qtd_um();

UPDATE public.filial_investimentos
   SET quantidade = 1
 WHERE categoria = 'aluguel' AND quantidade <> 1 AND conta_pagar_id IS NULL;

-- ── 3a. Elo do bem dividido com o lote de origem ─────────────────────────
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS patrimonio_origem_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_patrimonio_origem
  ON public.produtos (patrimonio_origem_id) WHERE patrimonio_origem_id IS NOT NULL;

-- ── 2. lancar_investimento_filial: imobilizado vira bem ─────────────────
CREATE OR REPLACE FUNCTION public.lancar_investimento_filial(p_item_id uuid, p_primeiro_vencimento date, p_parcelas integer DEFAULT 1, p_intervalo_dias integer DEFAULT 30, p_natureza_outro text DEFAULT 'despesa'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item     public.filial_investimentos;
  v_total    numeric;
  v_parcela  numeric;
  v_valor    numeric;
  v_soma     numeric := 0;
  v_venc     date;
  v_cp_id    uuid;
  v_primeira uuid;
  v_prod_id  uuid;
  v_natureza text;
  v_desc     text;
  v_codigo   text;
  v_nome     text;
  i          integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_item FROM public.filial_investimentos WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR NOT v_item.ativo THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_item.filial), false)
     OR NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_item.filial), false) THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro ou o gerente da unidade lançam a montagem.'
      USING ERRCODE = '42501';
  END IF;

  -- Mesmo lock da RPC de lote: um lançamento por item e o lote não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtext('montagem_filial:' || v_item.filial_id::text));

  IF v_item.conta_pagar_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.contas_pagar cp
                 WHERE cp.filial_investimento_id = v_item.id
                   AND COALESCE(cp.ativo, true) AND cp.status <> 'Cancelado') THEN
    RAISE EXCEPTION 'Este item já foi lançado no Financeiro.' USING ERRCODE = 'P0001';
  END IF;

  v_total := COALESCE(v_item.valor_total, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Item sem valor — informe quantidade e preço antes de lançar.' USING ERRCODE = 'P0001';
  END IF;
  IF p_primeiro_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe o primeiro vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_parcelas, 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Parcelas: de 1 a 60.' USING ERRCODE = 'P0001';
  END IF;
  IF v_item.categoria <> 'aluguel' AND COALESCE(p_intervalo_dias, 0) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Intervalo entre parcelas: de 1 a 365 dias.' USING ERRCODE = 'P0001';
  END IF;

  v_natureza := CASE v_item.categoria
                  WHEN 'equipamento' THEN 'imobilizado'
                  WHEN 'aluguel'     THEN 'despesa'
                  ELSE p_natureza_outro END;
  IF COALESCE(v_natureza, '') NOT IN ('despesa', 'estoque', 'imobilizado') THEN
    RAISE EXCEPTION 'Natureza inválida: %', p_natureza_outro USING ERRCODE = 'P0001';
  END IF;

  -- Aluguel: o valor é mensal e se repete. Compra: o total se divide.
  v_parcela := CASE WHEN v_item.categoria = 'aluguel' THEN v_total
                    ELSE round(v_total / p_parcelas, 2) END;

  FOR i IN 1..p_parcelas LOOP
    IF v_item.categoria = 'aluguel' THEN
      v_valor := v_parcela;
      v_venc  := (p_primeiro_vencimento + make_interval(months => i - 1))::date;
    ELSE
      -- O centavo que a divisão não fecha vai na última parcela.
      v_valor := CASE WHEN i = p_parcelas THEN v_total - v_soma ELSE v_parcela END;
      v_venc  := p_primeiro_vencimento + (i - 1) * p_intervalo_dias;
    END IF;
    v_soma := v_soma + v_valor;

    v_desc := 'Montagem ' || v_item.filial || ' — ' || v_item.rotulo
              || CASE WHEN p_parcelas > 1 THEN ' (' || i || '/' || p_parcelas || ')' ELSE '' END;

    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza,
       filial_investimento_id)
    VALUES (v_desc, v_valor, v_venc, 'Pendente', v_item.filial, 'montagem_filial',
            v_item.centro_custo_id, v_natureza, v_item.id)
    RETURNING id INTO v_cp_id;

    IF i = 1 THEN v_primeira := v_cp_id; END IF;
  END LOOP;

  -- Imobilizado vira bem (migr. 511) pelo valor TOTAL de aquisição — parcelar
  -- a compra não muda quanto o bem custou. MIGR 678: vale para qualquer item
  -- imobilizado, não só 'equipamento' — o "Outro" imobilizado sumia do DRE.
  IF v_natureza = 'imobilizado' AND v_item.produto_patrimonio_id IS NULL THEN
    v_codigo := 'PAT-' || to_char(public.acre_today(), 'YYYYMMDD') || '-'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    v_nome := v_item.rotulo;
    IF EXISTS (SELECT 1 FROM public.produtos p
                WHERE p.filial = v_item.filial AND p.ativo
                  AND public.nome_item_normalizado(p.nome) = public.nome_item_normalizado(v_nome)) THEN
      v_nome := v_item.rotulo || ' — ' || v_codigo;
    END IF;

    INSERT INTO public.produtos
      (codigo, nome, tipo, filial, estoque, preco, status,
       patrimonio_localizacao, patrimonio_vida_util_meses)
    VALUES (v_codigo, v_nome, 'patrimonio', v_item.filial, v_item.quantidade, 0, 'Ativo',
            v_item.filial, 60)
    RETURNING id INTO v_prod_id;

    INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
    VALUES (v_prod_id, v_total, 'manual', now());
  END IF;

  UPDATE public.filial_investimentos
     SET conta_pagar_id        = v_primeira,
         produto_patrimonio_id = COALESCE(v_prod_id, produto_patrimonio_id)
   WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'parcelas', p_parcelas,
    'valor_total', CASE WHEN v_item.categoria = 'aluguel' THEN v_total * p_parcelas ELSE v_total END,
    'bem_criado', v_prod_id IS NOT NULL
  );
END;
$function$;

-- ── 3b. vender_patrimonio com quantidade ─────────────────────────────────
-- Assinatura muda (parâmetro novo): DROP + CREATE, senão vira sobrecarga
-- ambígua para o PostgREST.
DROP FUNCTION IF EXISTS public.vender_patrimonio(uuid, numeric, date, integer, integer, uuid, text);

CREATE OR REPLACE FUNCTION public.vender_patrimonio(p_produto_id uuid, p_valor numeric, p_primeiro_vencimento date, p_parcelas integer DEFAULT 1, p_intervalo_dias integer DEFAULT 30, p_cliente_id uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text, p_quantidade numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prod    public.produtos;
  v_alvo    uuid;
  v_custo   numeric;
  v_parte   numeric;
  v_codigo  text;
  v_parcela numeric;
  v_valor   numeric;
  v_soma    numeric := 0;
  v_desc    text;
  v_nome    text;
  i         integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bem não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_prod.tipo <> 'patrimonio' THEN
    RAISE EXCEPTION 'Só item de patrimônio pode ser vendido por aqui.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Bem de outra filial.' USING ERRCODE = '42501';
  END IF;
  -- Quem já baixava (financeiro/logística) e quem lança a montagem
  -- (admin ou gerente da unidade) vendem.
  IF NOT COALESCE(public.auth_in_setor('financeiro', 'logistica')
                  OR public.auth_is_admin()
                  OR public.auth_gerente_da(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Permissão insuficiente para vender bem.' USING ERRCODE = '42501';
  END IF;
  IF v_prod.patrimonio_baixado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este bem já foi baixado em %.', to_char(v_prod.patrimonio_baixado_em, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da venda.' USING ERRCODE = 'P0001';
  END IF;
  IF p_primeiro_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe o primeiro vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_parcelas, 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Parcelas: de 1 a 60.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_intervalo_dias, 0) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Intervalo entre parcelas: de 1 a 365 dias.' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantidade IS NOT NULL AND (p_quantidade <= 0 OR p_quantidade > v_prod.estoque) THEN
    RAISE EXCEPTION 'Quantidade vendida: de 1 a % (o lote tem % un.).', v_prod.estoque, v_prod.estoque
      USING ERRCODE = 'P0001';
  END IF;

  v_alvo := v_prod.id;
  v_nome := v_prod.nome;

  -- MIGR 678: venda de parte do lote. A parte vendida vira um bem irmão com a
  -- mesma data de aquisição (a depreciação dela corre igual à do lote até a
  -- baixa) e o custo proporcional; o lote fica com o resto.
  IF p_quantidade IS NOT NULL AND p_quantidade < v_prod.estoque THEN
    SELECT COALESCE(preco_custo, 0) INTO v_custo FROM public.produtos_custo WHERE produto_id = v_prod.id;
    v_custo := COALESCE(v_custo, 0);
    v_parte := round(v_custo * p_quantidade / v_prod.estoque, 2);
    v_codigo := 'PAT-' || to_char(public.acre_today(), 'YYYYMMDD') || '-'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    v_nome := v_prod.nome || ' — ' || trim(to_char(p_quantidade, 'FM999999990.###')) || ' un. vendidas (' || v_codigo || ')';

    INSERT INTO public.produtos
      (codigo, nome, tipo, filial, estoque, preco, status, created_at,
       patrimonio_localizacao, patrimonio_responsavel, patrimonio_vida_util_meses,
       patrimonio_origem_id)
    VALUES (v_codigo, v_nome, 'patrimonio', v_prod.filial, p_quantidade, 0, 'Ativo', v_prod.created_at,
            v_prod.patrimonio_localizacao, v_prod.patrimonio_responsavel, v_prod.patrimonio_vida_util_meses,
            v_prod.id)
    RETURNING id INTO v_alvo;

    INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
    VALUES (v_alvo, v_parte, 'manual', now());

    UPDATE public.produtos_custo SET preco_custo = v_custo - v_parte, updated_at = now()
     WHERE produto_id = v_prod.id;

    -- `estoque` só muda com a flag (fn_block_estoque_manual), local à transação.
    PERFORM set_config('app.allow_estoque_update', 'true', true);
    UPDATE public.produtos SET estoque = v_prod.estoque - p_quantidade WHERE id = v_prod.id;
    PERFORM set_config('app.allow_estoque_update', '', true);
  END IF;

  UPDATE public.produtos SET
    status                  = 'Baixado',
    patrimonio_baixado_em   = public.acre_today(),
    patrimonio_baixa_motivo = COALESCE(NULLIF(btrim(p_motivo), ''), 'Venda do bem'),
    patrimonio_valor_venda  = p_valor
  WHERE id = v_alvo;

  v_parcela := round(p_valor / p_parcelas, 2);
  FOR i IN 1..p_parcelas LOOP
    v_valor := CASE WHEN i = p_parcelas THEN p_valor - v_soma ELSE v_parcela END;
    v_soma  := v_soma + v_valor;
    v_desc  := 'Venda de bem — ' || v_nome
               || CASE WHEN p_parcelas > 1 THEN ' (' || i || '/' || p_parcelas || ')' ELSE '' END;
    INSERT INTO public.contas_receber
      (descricao, valor, vencimento, status, filial, origem, cliente_id, produto_patrimonio_id)
    VALUES (v_desc, v_valor, p_primeiro_vencimento + (i - 1) * p_intervalo_dias, 'Aberto',
            v_prod.filial, 'venda_patrimonio', p_cliente_id, v_alvo);
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'parcelas', p_parcelas, 'valor', p_valor,
                            'produto_vendido_id', v_alvo, 'parcial', v_alvo <> v_prod.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.vender_patrimonio(uuid, numeric, date, integer, integer, uuid, text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vender_patrimonio(uuid, numeric, date, integer, integer, uuid, text, numeric) TO authenticated;

-- ── 4. Depreciação pelo calendário em _dre_calculo ───────────────────────
DO $do$
DECLARE
  v_def  text;
  v_dias text := 'NULLIF(((p.created_at AT TIME ZONE ''America/Rio_Branco'')::date + (p.patrimonio_vida_util_meses || '' months'')::interval)::date - (p.created_at AT TIME ZONE ''America/Rio_Branco'')::date, 0)';
  v_old1 text := '/ p.patrimonio_vida_util_meses / 30.0 AS valor_dia';
  v_old2 text := '/ (p.patrimonio_vida_util_meses * 30.0))';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p WHERE p.proname = '_dre_calculo' AND p.pronamespace = 'public'::regnamespace;

  -- Idempotente: já aplicada, nada a fazer.
  IF position('patrimonio_vida_util_meses || '' months'')::interval)::date - (p.created_at' IN v_def) > 0
     AND position(v_old1 IN v_def) = 0 AND position(v_old2 IN v_def) = 0 THEN
    RETURN;
  END IF;
  IF position(v_old1 IN v_def) = 0 OR position(v_old2 IN v_def) = 0 THEN
    RAISE EXCEPTION 'migr. 678: trecho da depreciação não encontrado em _dre_calculo — conferir a versão vigente.';
  END IF;

  v_def := replace(v_def, v_old1, '/ ' || v_dias || ' AS valor_dia');
  v_def := replace(v_def, v_old2, '/ ' || v_dias || ')');
  EXECUTE v_def;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';
