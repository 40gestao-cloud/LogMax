-- 511_20260822_patrimonio_depreciacao_e_fase_4.sql
--
-- Fase 4 do plano de desembolso da montagem de filial
-- (docs/plano-montagem-filial-investimentos.md), pedida junto com
-- depreciação/baixa de bem no Patrimônio — exceção à trava (mesma sessão
-- que já abriu exceção para as Fases 0-3).
--
-- ── O que existia ───────────────────────────────────────────────────────
-- `produtos` já tinha `tipo='patrimonio'` (migr. 046) e `PatrimonioView`
-- já listava esses itens — mas só listava. Sem vida útil, sem depreciação
-- no DRE, sem baixa. A tela de Contas a Pagar manda criar o produto à mão
-- quando marca uma conta como `imobilizado`; aqui esse passo passa a
-- acontecer sozinho quando o item de investimento vira conta (Fase 3).
--
-- ── O modelo (simplificado, didático) ───────────────────────────────────
-- Linear, sem valor residual: `vida_util_meses` é quantos meses até o bem
-- valer zero no livro. Sem isso não há como somar depreciação. Item
-- criado pela Fase 4 nasce com 60 meses (5 anos) — heurística única para
-- uma grade que mistura gôndola e computador; editável depois em
-- Empresa → Produtos, item a item.
--
-- Baixa (venda/descarte) grava `patrimonio_baixado_em` + `valor_venda`
-- opcional. Resultado = valor contábil no dia da baixa − valor de venda:
-- positivo é perda (despesa), negativo é ganho (reduz despesa) — mesmo
-- sinal que a migr. 473 já usa pra separar juro de amortização.
--
-- ── Onde entra no DRE ────────────────────────────────────────────────────
-- Dois grupos novos no bloco de despesas de `gerar_dre` (cirúrgico via
-- `pg_get_functiondef` + `replace()`, mesma régua das migr. 499/507/508):
--   • "Depreciação" — quota linear pró-rata pelos dias do bem dentro do
--     período pedido, zerada se o bem já saiu do livro (baixa ou fim da
--     vida útil) antes do início do período.
--   • "Baixa de imobilizado" — só aparece no mês em que a baixa aconteceu.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. filial_investimentos ganha o vínculo com o produto de patrimônio
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.filial_investimentos
  ADD COLUMN IF NOT EXISTS produto_patrimonio_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.filial_investimentos.produto_patrimonio_id IS
  'Fase 4 (migr. 511). FK para o produto tipo=patrimonio gerado a partir deste item — mesma lógica de idempotência de conta_pagar_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. produtos ganha vida útil e baixa
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS patrimonio_vida_util_meses integer,
  ADD COLUMN IF NOT EXISTS patrimonio_baixado_em      date,
  ADD COLUMN IF NOT EXISTS patrimonio_baixa_motivo    text,
  ADD COLUMN IF NOT EXISTS patrimonio_valor_venda     numeric(15,2);

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_patrimonio_vida_util;
ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_patrimonio_vida_util
  CHECK (patrimonio_vida_util_meses IS NULL OR patrimonio_vida_util_meses > 0);

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_patrimonio_valor_venda;
ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_patrimonio_valor_venda
  CHECK (patrimonio_valor_venda IS NULL OR patrimonio_valor_venda >= 0);

COMMENT ON COLUMN public.produtos.patrimonio_vida_util_meses IS
  'Migr. 511. Meses até depreciar 100% pelo método linear, sem valor residual. Só relevante em tipo=patrimonio. NULL = bem não entra na depreciação do DRE.';
COMMENT ON COLUMN public.produtos.patrimonio_baixado_em IS
  'Migr. 511. Data da baixa (venda/descarte) — só gravada por dar_baixa_patrimonio(). Para a depreciação e tira o bem do livro ativo.';
COMMENT ON COLUMN public.produtos.patrimonio_valor_venda IS
  'Migr. 511. Quanto entrou na baixa (NULL = descarte sem venda). Resultado no DRE = valor contábil na baixa − este valor.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. `produtos_com_custo` precisa enxergar as colunas novas — é dela que
--    `PatrimonioView` lê (`/api/patrimonioview`). CREATE OR REPLACE VIEW
--    perde `security_invoker` se não for redeclarado no próprio CREATE
--    (lição já registrada: lê RLS do dono, não de quem consulta).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.produtos_com_custo
WITH (security_invoker = true) AS
 SELECT p.id,
    p.codigo,
    p.nome,
    p.categoria,
    p.estoque,
    p.preco,
    p.unidade,
    p.status,
    p.created_at,
    p.ativo,
    p.estoque_minimo,
    p.ean,
    p.fornecedor,
    p.filial,
    p.imagem_url,
    p.tipo,
    p.patrimonio_numero,
    p.patrimonio_responsavel,
    p.patrimonio_localizacao,
    p.criado_por,
    p.atualizado_por,
    p.updated_at,
    p.elegivel_beneficios,
    p.vitrine_publica,
    p.categoria_id,
    p.subcategoria_id,
    p.marca,
    p.peso,
    p.peso_unidade,
    p.atributos,
    p.imagem_url_2,
    p.imagem_url_3,
    p.codigo_seq,
    p.loja_online,
    c.preco_custo,
    c.origem AS custo_origem,
    c.ultima_compra_em AS custo_ultima_compra_em,
    c.ultimo_custo_compra AS custo_ultima_compra_valor,
    p.correcao_pendente,
    p.correcao_motivo,
    p.correcao_solicitada_por,
    p.correcao_solicitada_em,
    p.correcao_responsavel_id,
    -- Migr. 511 — acrescentadas no FIM da lista de propósito: CREATE OR
    -- REPLACE VIEW recusa mudar a posição de coluna existente (42P16),
    -- então coluna nova só pode nascer no fim.
    p.patrimonio_vida_util_meses,
    p.patrimonio_baixado_em,
    p.patrimonio_baixa_motivo,
    p.patrimonio_valor_venda
   FROM public.produtos p
     LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. `gerar_contas_da_montagem` — CREATE OR REPLACE direto (não cirúrgico):
--    é função da migr. 510, escrita e verificada nos 4 projetos nesta mesma
--    sessão, sem histórico de terceiros mexendo nela. Acrescenta: item de
--    equipamento também vira produto tipo=patrimonio, idempotente por
--    produto_patrimonio_id.
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

  SELECT filial INTO v_filial
    FROM public.filial_investimentos
   WHERE filial_id = p_filial_id AND ativo
   LIMIT 1;

  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Nenhum item de investimento ativo para esta filial.' USING ERRCODE = 'P0001';
  END IF;

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

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Baixa de bem — cancela contabilmente, não apaga a linha.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dar_baixa_patrimonio(
  p_produto_id  uuid,
  p_motivo      text,
  p_valor_venda numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prod public.produtos;
BEGIN
  PERFORM public._assert_rpc('financeiro', 'logistica');

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id FOR UPDATE;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Bem não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_prod.tipo <> 'patrimonio' THEN
    RAISE EXCEPTION 'Só item de patrimônio pode ser baixado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Bem de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_prod.patrimonio_baixado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este bem já foi baixado em %.', to_char(v_prod.patrimonio_baixado_em, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da baixa.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_venda IS NOT NULL AND p_valor_venda < 0 THEN
    RAISE EXCEPTION 'Valor de venda não pode ser negativo.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.produtos SET
    status                  = 'Baixado',
    patrimonio_baixado_em   = public.acre_today(),
    patrimonio_baixa_motivo = btrim(p_motivo),
    patrimonio_valor_venda  = p_valor_venda
  WHERE id = p_produto_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.dar_baixa_patrimonio(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_baixa_patrimonio(uuid, text, numeric) TO authenticated;

COMMENT ON FUNCTION public.dar_baixa_patrimonio(uuid, text, numeric) IS
  'Migr. 511. Baixa (venda/descarte) de bem de patrimônio. Não apaga a linha — grava data/motivo/valor de venda; o resultado (ganho ou perda) aparece no DRE do mês da baixa.';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. `gerar_dre` ganha depreciação e resultado de baixa — cirúrgico via
--    pg_get_functiondef + replace(), mesma régua da migr. 499/507/508.
--    Fora da transação acima de propósito: se esta parte falhar, as seções
--    1-5 (que não dependem dela) já ficam de pé.
-- ────────────────────────────────────────────────────────────────────────────

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
    RAISE EXCEPTION 'MIGR 511: gerar_dre não existe neste projeto.';
  END IF;

  IF position('Depreciação' in v_def) > 0 THEN
    RAISE NOTICE 'MIGR 511: gerar_dre já soma depreciação — nada a fazer.';
    RETURN;
  END IF;

  IF position($anc$HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0
    ) t;$anc$ in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 511: âncora (fim do bloco de despesas) não encontrada — abortando.';
  END IF;

  v_novo := replace(v_def,
    $anc$HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0
    ) t;$anc$,
    $rep$HAVING ROUND(SUM(COALESCE(pe.juros, 0)), 2) > 0

      UNION ALL

      -- Migr. 511: depreciação linear, sem residual, pró-rata pelos dias do
      -- bem dentro de [p_inicio, p_fim]. Zera sozinha se o bem já saiu do
      -- livro (baixa ou fim da vida útil) antes do início do período.
      SELECT 'Depreciação'::text AS grupo, ROUND(SUM(dep.valor_dia), 2) AS valor
        FROM (
          SELECT GREATEST(0,
                   LEAST(p_fim,
                         COALESCE(p.patrimonio_baixado_em, 'infinity'::date),
                         (p.created_at::date + (p.patrimonio_vida_util_meses || ' months')::interval - '1 day'::interval)::date)
                   - GREATEST(p_inicio, p.created_at::date) + 1
                 ) * COALESCE(pc.preco_custo, 0)
                   / p.patrimonio_vida_util_meses / 30.0 AS valor_dia
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND p.filial = p_filial
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
             AND p.created_at::date <= p_fim
             AND (p.patrimonio_baixado_em IS NULL OR p.patrimonio_baixado_em >= p_inicio)
        ) dep
      HAVING ROUND(SUM(dep.valor_dia), 2) > 0

      UNION ALL

      -- Resultado da baixa no mês em que ela caiu: valor contábil no dia
      -- menos o valor de venda. Positivo = perda (despesa); negativo =
      -- ganho (reduz despesa) — mesmo sinal da migr. 473 pro mútuo.
      SELECT 'Baixa de imobilizado'::text AS grupo, ROUND(SUM(bx.resultado), 2) AS valor
        FROM (
          SELECT COALESCE(pc.preco_custo, 0)
                 * GREATEST(0, 1 - (p.patrimonio_baixado_em - p.created_at::date)::numeric
                                   / (p.patrimonio_vida_util_meses * 30.0))
                 - COALESCE(p.patrimonio_valor_venda, 0) AS resultado
            FROM public.produtos p
            LEFT JOIN public.produtos_custo pc ON pc.produto_id = p.id
           WHERE p.tipo = 'patrimonio'
             AND p.filial = p_filial
             AND p.patrimonio_baixado_em BETWEEN p_inicio AND p_fim
             AND COALESCE(p.patrimonio_vida_util_meses, 0) > 0
        ) bx
      HAVING ROUND(SUM(bx.resultado), 2) <> 0
    ) t;$rep$);

  EXECUTE v_novo;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('dar_baixa_patrimonio', 'gerar_contas_da_montagem');
--
--   SELECT prosrc ~ 'Depreciação' AND prosrc ~ 'Baixa de imobilizado'
--     FROM pg_proc WHERE proname = 'gerar_dre';
--   -- true
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'produtos_com_custo'
--      AND column_name LIKE 'patrimonio_%';
--   -- 7 (numero, responsavel, localizacao, vida_util_meses, baixado_em,
--   --    baixa_motivo, valor_venda) — conferir que nenhuma sumiu na
--   --    reescrita da view.
--
--   -- Gerar a montagem de uma filial de teste e conferir que equipamento
--   -- vira produto:
--   SELECT p.nome, p.tipo, pc.preco_custo, p.patrimonio_vida_util_meses
--     FROM produtos p JOIN produtos_custo pc ON pc.produto_id = p.id
--    WHERE p.codigo LIKE 'PAT-%' ORDER BY p.created_at DESC LIMIT 5;
-- ════════════════════════════════════════════════════════════════════════
