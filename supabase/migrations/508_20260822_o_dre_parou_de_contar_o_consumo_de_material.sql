-- 508_20260822_o_dre_parou_de_contar_o_consumo_de_material.sql
--
-- Achado ao aplicar a migr. 507 (Fase 0 do plano de desembolso da montagem
-- de filial), não previsto no plano original — bug adjacente na mesma
-- função.
--
-- ── O sintoma ────────────────────────────────────────────────────────────
-- `src/views/DREView.tsx` lê `dre.consumo_material` e `dre.consumos_sem_custo`
-- desde a migr. 442 e mostra "inclui R$ X de material de consumo" quando
-- > 0. Desde 2026-08-19 esses dois campos vêm sempre 0 — silenciosamente,
-- porque o front já os trata com `?? 0`.
--
-- ── O diagnóstico ───────────────────────────────────────────────────────
-- A migr. 442 fez `gerar_dre` somar `consumos_material` (o que os setores
-- consumiram via requisição, migr. 449) como despesa do período, num
-- segundo `UNION ALL` dentro do bloco de despesas. A migr. 447 manteve isso
-- ("corpo copiado do banco (a versão da 442...)").
--
-- A migr. 473, dois dias depois, reescreveu `gerar_dre` pra separar juro de
-- amortização do mútuo — e o corpo copiado dessa vez foi o da migr. 426,
-- de ANTES da 442/447. O cálculo de `v_consumo`, a variável, o UNION e as
-- duas chaves no jsonb de retorno desapareceram junto. Mesma causa-raiz da
-- migr. 507: "corpo copiado do banco" errou a versão de origem.
--
-- ── O fix ───────────────────────────────────────────────────────────────
-- Reintroduz exatamente o que a 442/447 tinham: variável, cálculo (mesma
-- query), terceiro ramo do UNION ALL (agora com centro de custo próprio,
-- já que a 500 passou a exigir isso de toda despesa) e as duas chaves no
-- retorno. Cirúrgico via `pg_get_functiondef` + `replace()` em 4 pontos,
-- mesma régua da migr. 499/507.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Aplicar DEPOIS da 507 (a 507 muda o
-- texto do primeiro ramo do UNION, e a âncora aqui pressupõe isso).

BEGIN;

DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_dre';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 508: gerar_dre não existe neste projeto.';
  END IF;

  IF position('v_consumo' in v_def) > 0 THEN
    RAISE NOTICE 'MIGR 508: gerar_dre já soma consumos_material — nada a fazer.';
    RETURN;
  END IF;

  v_novo := v_def;

  -- 1) declara as duas variáveis novas, no fim do DECLARE
  IF position($anc1$integer;
BEGIN$anc1$ in v_novo) = 0 THEN
    RAISE EXCEPTION 'MIGR 508: âncora 1 (fim do DECLARE) não encontrada — abortando.';
  END IF;
  v_novo := replace(v_novo,
    $anc1$integer;
BEGIN$anc1$,
    $rep1$integer;
  v_consumo         numeric(15,2);
  v_consumo_sem     integer;
BEGIN$rep1$);

  -- 2) calcula v_consumo/v_consumo_sem logo após o CMV, antes das despesas
  IF position($anc2$SELECT COALESCE(SUM(t.valor), 0),$anc2$ in v_novo) = 0 THEN
    RAISE EXCEPTION 'MIGR 508: âncora 2 (select despesas) não encontrada — abortando.';
  END IF;
  v_novo := replace(v_novo,
    $anc2$SELECT COALESCE(SUM(t.valor), 0),$anc2$,
    $rep2$-- Migr. 442/447/508: material de consumo que saiu para os setores no período.
  SELECT COALESCE(SUM(cm.valor), 0),
         COUNT(*) FILTER (WHERE cm.custo_unitario IS NULL)
    INTO v_consumo, v_consumo_sem
    FROM public.consumos_material cm
   WHERE cm.ativo = true
     AND cm.filial = p_filial
     AND cm.data BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(t.valor), 0),$rep2$);

  -- 3) soma o consumo dentro do bloco de despesas, como terceiro ramo do UNION
  IF position($anc3$SELECT 'Despesas financeiras'::text AS grupo,$anc3$ in v_novo) = 0 THEN
    RAISE EXCEPTION 'MIGR 508: âncora 3 (union despesas financeiras) não encontrada — abortando.';
  END IF;
  v_novo := replace(v_novo,
    $anc3$SELECT 'Despesas financeiras'::text AS grupo,$anc3$,
    $rep3$SELECT COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cm.valor), 2) AS valor
        FROM public.consumos_material cm
        LEFT JOIN public.centros_custo cc2 ON cc2.id = cm.centro_custo_id
       WHERE cm.ativo = true
         AND cm.filial = p_filial
         AND cm.data BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(NULLIF(btrim(cc2.grupo_dre), ''), 'Não classificado')

      UNION ALL

      SELECT 'Despesas financeiras'::text AS grupo,$rep3$);

  -- 4) devolve os dois campos que o front já lê (DREView.tsx, desde a migr. 442)
  IF position($anc4$'despesas_grupos',  v_grupos,$anc4$ in v_novo) = 0 THEN
    RAISE EXCEPTION 'MIGR 508: âncora 4 (return jsonb) não encontrada — abortando.';
  END IF;
  v_novo := replace(v_novo,
    $anc4$'despesas_grupos',  v_grupos,$anc4$,
    $rep4$'despesas_grupos',  v_grupos,
    'consumo_material', v_consumo,
    'consumos_sem_custo', v_consumo_sem,$rep4$);

  EXECUTE v_novo;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT prosrc ~ 'v_consumo' FROM pg_proc WHERE proname = 'gerar_dre';
--   -- true
--
--   -- se há consumo de material recente no período: consumo_material > 0
--   SELECT gerar_dre('SuperMax', date_trunc('month', now())::date, public.acre_today())
--          -> 'consumo_material';
--
--   -- confere contra a soma direta da tabela
--   SELECT COALESCE(SUM(valor), 0) FROM consumos_material
--    WHERE ativo AND filial = 'SuperMax'
--      AND data BETWEEN date_trunc('month', now())::date AND acre_today();
-- ════════════════════════════════════════════════════════════════════════
