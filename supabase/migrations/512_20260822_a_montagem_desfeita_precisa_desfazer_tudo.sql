-- 512_20260822_a_montagem_desfeita_precisa_desfazer_tudo.sql
--
-- Três furos achados na auditoria das Fases 1-4 (migr. 509/510/511), todos
-- na mesma costura: o vínculo entre o item de investimento e o que ele
-- gerou era um ponteiro único (`conta_pagar_id`), e um ponteiro único não
-- descreve um aluguel de 12 parcelas nem o bem de patrimônio.
--
-- ── 1. Aluguel desvinculado deixava 11 parcelas vivas ───────────────────
-- `gerar_contas_da_montagem` amarra só a 1ª parcela. `desvincular_...`
-- cancelava essa uma e soltava o vínculo; as outras 11 ficavam Pendentes,
-- órfãs, e o próximo "Gerar contas a pagar" criava mais 12 — aluguel
-- dobrado no DRE. Correção: `contas_pagar.filial_investimento_id` carimba
-- TODAS as contas do item (parcela 1..N inclusive), o desvincular cancela
-- todas e a idempotência passa a olhar o conjunto, não o ponteiro.
--
-- ── 2. Desvincular não desfazia o patrimônio ────────────────────────────
-- O produto tipo='patrimonio' criado pela Fase 4 continuava de pé depois
-- de a compra ser cancelada — bem fantasma depreciando no DRE para sempre.
-- Agora o desvincular inativa o produto junto e solta
-- `produto_patrimonio_id`. Para que inativar signifique alguma coisa,
-- `gerar_dre` passa a filtrar `p.ativo` nos dois blocos da migr. 511 (que
-- filtravam tipo/filial/vida útil/baixa, mas não o soft delete).
--
-- ── 3. Editar item já gerado mudava o valor sem tocar na conta ──────────
-- O plano exigia "editar não altera a conta em silêncio: exige
-- desvincular", mas nada impedia o UPDATE. Gatilho novo recusa mexer em
-- rótulo/quantidade/preço/categoria/centro de custo enquanto houver conta
-- gerada — a tela agora também tranca os campos, mas a regra é do banco.
--
-- De quebra, dentro das funções que já estavam sendo reescritas:
--   • a unidade sai de `filiais`, não de um `LIMIT 1` sem ORDER BY sobre os
--     itens (linhas divergentes sorteavam a filial das contas);
--   • gatilho carimba `filial_investimentos.filial` a partir de
--     `filial_id`, o que faz a policy WITH CHECK ser avaliada contra a
--     unidade real — fecha o item a item cruzado entre filiais;
--   • advisory lock por filial: duplo clique não gera o desembolso duas
--     vezes (a idempotência lia e escrevia sem trava).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O vínculo vira 1:N — uma conta por parcela, todas apontando pro item
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS filial_investimento_id uuid
    REFERENCES public.filial_investimentos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_filial_investimento
  ON public.contas_pagar (filial_investimento_id)
  WHERE filial_investimento_id IS NOT NULL;

COMMENT ON COLUMN public.contas_pagar.filial_investimento_id IS
  'Migr. 512. Item de filial_investimentos que gerou esta conta. Diferente de filial_investimentos.conta_pagar_id (ponteiro para a 1ª conta), esta coluna marca TODAS as parcelas — é por ela que o desvincular cancela o conjunto inteiro.';

-- Backfill do que a migr. 510/511 já tiver gerado (a 1ª parcela de cada item).
UPDATE public.contas_pagar cp
   SET filial_investimento_id = fi.id
  FROM public.filial_investimentos fi
 WHERE fi.conta_pagar_id = cp.id
   AND cp.filial_investimento_id IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. `filial` deixa de ser digitada pelo front — sai de `filial_id`
--    Espelha `detectarNicho` do FiliaisView: nicho explícito, senão o nome.
--    A policy WITH CHECK roda depois do BEFORE trigger, então gerente que
--    tentar lançar item na unidade do vizinho é barrado pela RLS.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_filial_investimento_carimba_filial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nicho text;
BEGIN
  IF NEW.filial_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
           CASE WHEN f.detalhes->>'nicho' IN ('SuperMax','MaxLook','TechMax','Matriz')
                THEN f.detalhes->>'nicho' END,
           CASE WHEN f.nome ILIKE '%supermax%' THEN 'SuperMax'
                WHEN f.nome ILIKE '%maxlook%'  THEN 'MaxLook'
                WHEN f.nome ILIKE '%techmax%'  THEN 'TechMax' END,
           'Matriz')
    INTO v_nicho
    FROM public.filiais f
   WHERE f.id = NEW.filial_id;

  IF v_nicho IS NOT NULL THEN
    NEW.filial := v_nicho;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_filial_investimento_carimba_filial ON public.filial_investimentos;
CREATE TRIGGER trg_filial_investimento_carimba_filial
  BEFORE INSERT OR UPDATE OF filial, filial_id ON public.filial_investimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_filial_investimento_carimba_filial();

-- Conserta o que já foi lançado com a unidade do topbar em vez da unidade
-- da filial (o bug do modo Matriz). Nenhuma linha em produção hoje, mas a
-- migração precisa convergir sozinha em qualquer turma.
UPDATE public.filial_investimentos fi
   SET filial = COALESCE(
         CASE WHEN f.detalhes->>'nicho' IN ('SuperMax','MaxLook','TechMax','Matriz')
              THEN f.detalhes->>'nicho' END,
         CASE WHEN f.nome ILIKE '%supermax%' THEN 'SuperMax'
              WHEN f.nome ILIKE '%maxlook%'  THEN 'MaxLook'
              WHEN f.nome ILIKE '%techmax%'  THEN 'TechMax' END,
         'Matriz')
  FROM public.filiais f
 WHERE f.id = fi.filial_id
   AND fi.filial IS DISTINCT FROM COALESCE(
         CASE WHEN f.detalhes->>'nicho' IN ('SuperMax','MaxLook','TechMax','Matriz')
              THEN f.detalhes->>'nicho' END,
         CASE WHEN f.nome ILIKE '%supermax%' THEN 'SuperMax'
              WHEN f.nome ILIKE '%maxlook%'  THEN 'MaxLook'
              WHEN f.nome ILIKE '%techmax%'  THEN 'TechMax' END,
         'Matriz');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Item com conta gerada não muda de valor pelas costas
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_filial_investimento_trava_gerado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Sem conta gerada não há o que travar. E a própria RPC precisa poder
  -- gerar (NULL → id) e desvincular (id → NULL): só o UPDATE que mantém o
  -- vínculo intacto é vigiado.
  IF OLD.conta_pagar_id IS NULL
     OR NEW.conta_pagar_id IS DISTINCT FROM OLD.conta_pagar_id THEN
    RETURN NEW;
  END IF;

  IF NEW.rotulo          IS DISTINCT FROM OLD.rotulo
     OR NEW.quantidade      IS DISTINCT FROM OLD.quantidade
     OR NEW.preco_unitario  IS DISTINCT FROM OLD.preco_unitario
     OR NEW.categoria       IS DISTINCT FROM OLD.categoria
     OR NEW.centro_custo_id IS DISTINCT FROM OLD.centro_custo_id THEN
    RAISE EXCEPTION 'Este item já gerou conta a pagar. Desvincule primeiro (a conta é cancelada, não apagada) e depois edite.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_filial_investimento_trava_gerado ON public.filial_investimentos;
CREATE TRIGGER trg_filial_investimento_trava_gerado
  BEFORE UPDATE ON public.filial_investimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_filial_investimento_trava_gerado();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. `gerar_contas_da_montagem` — unidade vem de `filiais`, trava por
--    advisory lock, carimba filial_investimento_id em todas as parcelas e
--    a idempotência olha o conjunto de contas, não o ponteiro.
-- ────────────────────────────────────────────────────────────────────────────

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
  v_prod_id uuid;
  v_venc    date;
  i         integer;
  v_desc    text;
BEGIN
  PERFORM public._assert_rpc();

  -- A unidade é a da FILIAL, não a de um item sorteado por LIMIT 1 sem
  -- ORDER BY: com linhas divergentes (bug do modo Matriz, corrigido acima)
  -- a conta a pagar saía numa unidade e a autorização era checada noutra.
  SELECT COALESCE(
           CASE WHEN f.detalhes->>'nicho' IN ('SuperMax','MaxLook','TechMax','Matriz')
                THEN f.detalhes->>'nicho' END,
           CASE WHEN f.nome ILIKE '%supermax%' THEN 'SuperMax'
                WHEN f.nome ILIKE '%maxlook%'  THEN 'MaxLook'
                WHEN f.nome ILIKE '%techmax%'  THEN 'TechMax' END,
           'Matriz')
    INTO v_filial
    FROM public.filiais f
   WHERE f.id = p_filial_id;

  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Filial não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Investimento de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_filial), false) THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro ou o gerente da unidade geram o desembolso.'
      USING ERRCODE = '42501';
  END IF;

  -- Duplo clique (ou dois alunos na mesma filial) passavam os dois pelo
  -- mesmo `conta_pagar_id IS NULL` antes de qualquer um gravar.
  PERFORM pg_advisory_xact_lock(hashtext('montagem_filial:' || p_filial_id::text));

  IF p_data_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe a data de vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_natureza_outro, '') NOT IN ('despesa', 'estoque', 'imobilizado') THEN
    RAISE EXCEPTION 'Natureza inválida para item "outro": %', p_natureza_outro USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_parcelas_aluguel, 1) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Parcelas do aluguel: de 1 a 60.' USING ERRCODE = 'P0001';
  END IF;

  -- ── Equipamento e Outro: 1 conta por item ────────────────────────────────
  FOR r IN
    SELECT * FROM public.filial_investimentos
     WHERE filial_id = p_filial_id AND ativo AND categoria IN ('equipamento', 'outro')
     ORDER BY categoria, rotulo
  LOOP
    IF r.conta_pagar_id IS NOT NULL
       OR COALESCE(r.valor_total, 0) <= 0
       OR EXISTS (SELECT 1 FROM public.contas_pagar cp
                   WHERE cp.filial_investimento_id = r.id
                     AND COALESCE(cp.ativo, true)
                     AND cp.status <> 'Cancelado') THEN
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza,
       filial_investimento_id)
    VALUES (
      'Montagem ' || v_filial || ' — ' || r.rotulo,
      r.valor_total, p_data_vencimento, 'Pendente', v_filial, 'montagem_filial',
      r.centro_custo_id,
      CASE WHEN r.categoria = 'equipamento' THEN 'imobilizado' ELSE p_natureza_outro END,
      r.id
    )
    RETURNING id INTO v_cp_id;

    -- Fase 4 (migr. 511): equipamento também vira linha de patrimônio, com
    -- vida útil padrão de 60 meses (editável depois). Idempotente pelo
    -- mesmo motivo do conta_pagar_id — na prática os dois nascem juntos,
    -- mas o guard fica explícito por segurança.
    IF r.categoria = 'equipamento' AND r.produto_patrimonio_id IS NULL THEN
      INSERT INTO public.produtos
        (codigo, nome, tipo, filial, estoque, preco, status,
         patrimonio_localizacao, patrimonio_vida_util_meses)
      VALUES (
        'PAT-' || to_char(public.acre_today(), 'YYYYMMDD') || '-'
               || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
        r.rotulo, 'patrimonio', v_filial, r.quantidade, 0, 'Ativo',
        v_filial, 60
      )
      RETURNING id INTO v_prod_id;

      -- `preco_custo` é o VALOR TOTAL de aquisição, não preço unitário — mesma
      -- convenção que ProdutosView já usa pra patrimônio manual ("Valor de
      -- Aquisição") e que PatrimonioView já soma direto, sem multiplicar por
      -- estoque. r.valor_total já é quantidade × preço unitário do item.
      INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
      VALUES (v_prod_id, r.valor_total, 'manual', now());

      UPDATE public.filial_investimentos SET produto_patrimonio_id = v_prod_id WHERE id = r.id;
    END IF;

    UPDATE public.filial_investimentos SET conta_pagar_id = v_cp_id WHERE id = r.id;
    v_gerados := v_gerados + 1;
  END LOOP;

  -- ── Aluguel: 1 conta por mês, N parcelas ─────────────────────────────────
  -- `conta_pagar_id` guarda a 1ª (é o que a tela mostra), mas TODAS levam
  -- `filial_investimento_id` — é por ele que o desvincular alcança o resto.
  FOR r IN
    SELECT * FROM public.filial_investimentos
     WHERE filial_id = p_filial_id AND ativo AND categoria = 'aluguel'
     ORDER BY rotulo
  LOOP
    IF r.conta_pagar_id IS NOT NULL
       OR COALESCE(r.valor_total, 0) <= 0
       OR EXISTS (SELECT 1 FROM public.contas_pagar cp
                   WHERE cp.filial_investimento_id = r.id
                     AND COALESCE(cp.ativo, true)
                     AND cp.status <> 'Cancelado') THEN
      v_pulados := v_pulados + 1;
      CONTINUE;
    END IF;
    IF COALESCE(p_dia_vencimento_aluguel, 0) NOT BETWEEN 1 AND 28 THEN
      RAISE EXCEPTION 'Informe o dia do vencimento do aluguel (1 a 28) — há item de aluguel na lista.'
        USING ERRCODE = 'P0001';
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
        (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza,
         filial_investimento_id)
      VALUES (v_desc, r.valor_total, v_venc, 'Pendente', v_filial, 'montagem_filial',
              r.centro_custo_id, 'despesa', r.id)
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

-- ────────────────────────────────────────────────────────────────────────────
-- 5. `desvincular_investimento_conta` — desfaz o item INTEIRO: todas as
--    parcelas e o bem de patrimônio.
-- ────────────────────────────────────────────────────────────────────────────

-- Passa a devolver jsonb (era void): CREATE OR REPLACE não muda tipo de
-- retorno (42P13), então o DROP com a assinatura vigente é obrigatório.
DROP FUNCTION IF EXISTS public.desvincular_investimento_conta(uuid);

CREATE OR REPLACE FUNCTION public.desvincular_investimento_conta(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item      public.filial_investimentos;
  v_paga      text;
  v_canceladas integer := 0;
  v_bem       boolean := false;
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

  -- Fecha o vínculo dos dois lados: a 1ª conta (ponteiro antigo) e todas as
  -- parcelas carimbadas. Linha gerada antes da migr. 512 só tem o ponteiro.
  UPDATE public.contas_pagar
     SET filial_investimento_id = v_item.id
   WHERE id = v_item.conta_pagar_id
     AND filial_investimento_id IS NULL;

  -- Nada gerado, nada a desfazer. (Vínculo apontando só para conta já
  -- cancelada/apagada na mão não é erro: solta o ponteiro e segue, senão o
  -- item fica preso — nem regera, nem sai da lista.)
  IF v_item.conta_pagar_id IS NULL
     AND v_item.produto_patrimonio_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.contas_pagar
                      WHERE filial_investimento_id = v_item.id) THEN
    RAISE EXCEPTION 'Este item não tem conta gerada.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma parcela paga trava o conjunto: cancelar as outras deixaria um
  -- aluguel meio pago e meio cancelado, sem quem responda pelo saldo.
  SELECT string_agg(descricao, ', ' ORDER BY vencimento) INTO v_paga
    FROM public.contas_pagar
   WHERE filial_investimento_id = v_item.id
     AND COALESCE(ativo, true)
     AND status IN ('Pago', 'Parcial');

  IF v_paga IS NOT NULL THEN
    RAISE EXCEPTION 'Conta já paga (total ou parcialmente) não desvincula — estorne o pagamento primeiro: %', v_paga
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contas_pagar
     SET status = 'Cancelado'
   WHERE filial_investimento_id = v_item.id
     AND COALESCE(ativo, true)
     AND status <> 'Cancelado';
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  -- O bem só existia porque a compra existia. Inativado (não apagado), sai
  -- da depreciação do DRE. Bem já baixado fica: teve vida contábil própria.
  IF v_item.produto_patrimonio_id IS NOT NULL THEN
    UPDATE public.produtos
       SET ativo = false
     WHERE id = v_item.produto_patrimonio_id
       AND patrimonio_baixado_em IS NULL
       AND COALESCE(ativo, true);
    v_bem := FOUND;
  END IF;

  UPDATE public.filial_investimentos
     SET conta_pagar_id = NULL, produto_patrimonio_id = NULL
   WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'contas_canceladas', v_canceladas,
    'bem_inativado', v_bem
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.desvincular_investimento_conta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desvincular_investimento_conta(uuid) TO authenticated;

COMMENT ON FUNCTION public.desvincular_investimento_conta(uuid) IS
  'Migr. 510, reescrita na 512. Cancela TODAS as contas a pagar do item (parcela 1..N via contas_pagar.filial_investimento_id), inativa o bem de patrimônio gerado e limpa os dois vínculos. Nada é apagado. Qualquer parcela paga/parcial trava a operação.';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. `gerar_dre` respeita o soft delete do bem — cirúrgico via
--    pg_get_functiondef + replace(), mesma régua das migr. 499/507/508/511.
--    Sem isto, inativar o produto na seção 5 não tira a depreciação do
--    resultado, e "desfazer a compra" continua custando todo mês.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
  v_anc  text := E'           WHERE p.tipo = ''patrimonio''\n             AND p.filial = p_filial';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_dre';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 512: gerar_dre não existe neste projeto.';
  END IF;

  IF v_def ~ 'COALESCE\(p\.ativo' THEN
    RAISE NOTICE 'MIGR 512: gerar_dre já filtra o soft delete do patrimônio.';
    RETURN;
  END IF;

  IF position(v_anc in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 512: âncora dos blocos de patrimônio não encontrada — abortando.';
  END IF;

  -- Duas ocorrências (Depreciação e Baixa de imobilizado); replace() pega as duas.
  v_novo := replace(v_def, v_anc,
    E'           WHERE p.tipo = ''patrimonio''\n             AND COALESCE(p.ativo, true)\n             AND p.filial = p_filial');

  EXECUTE v_novo;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'contas_pagar' AND column_name = 'filial_investimento_id';
--   -- 1
--
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.filial_investimentos'::regclass
--     AND NOT tgisinternal ORDER BY tgname;
--   -- trg_auditoria, trg_filial_investimento_carimba_filial,
--   -- trg_filial_investimento_trava_gerado, trg_historico
--
--   SELECT prosrc ~ 'COALESCE\(p\.ativo' FROM pg_proc WHERE proname = 'gerar_dre';
--   -- true
--
--   -- Nenhum item pode divergir da unidade da própria filial:
--   SELECT count(*) FROM filial_investimentos fi JOIN filiais f ON f.id = fi.filial_id
--    WHERE fi.filial IS DISTINCT FROM COALESCE(f.detalhes->>'nicho', 'Matriz')
--      AND COALESCE(f.detalhes->>'nicho','') IN ('SuperMax','MaxLook','TechMax','Matriz');
--   -- 0
--
--   -- Aluguel de 12 parcelas: desvincular tem de cancelar as 12.
--   SELECT status, count(*) FROM contas_pagar
--    WHERE filial_investimento_id = '<item_id>' GROUP BY status;
-- ════════════════════════════════════════════════════════════════════════
