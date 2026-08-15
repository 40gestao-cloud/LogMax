-- 425_20260814_a_filial_passa_a_saber_se_deu_lucro.sql
--
-- A FILIAL SABE QUANTO ENTROU E QUANTO SAIU. NÃO SABE SE DEU LUCRO.
--
-- `RelatoriosFinanceirosView` é lista de lançamento; o Painel BI mostra
-- volume. Nenhum dos dois responde a única pergunta que o dono faz: *no mês
-- passado a loja ganhou ou perdeu dinheiro?* Sem DRE, a turma fecha o mês
-- olhando saldo de banco — que é caixa, não resultado, e confunde as duas
-- coisas por 90 dias seguidos.
--
-- Ficou por último de propósito: DRE sem CMV confiável é enfeite, e o CMV só
-- passou a existir na migr. 417 (custo médio apurado no recebimento).
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS DUAS PEÇAS QUE FALTAVAM
--
-- 1. **Custo no momento da venda.** `itens_venda` guarda preço de venda e não
--    guarda custo. Calcular CMV com o custo de hoje faria o resultado do mês
--    passado mudar sozinho quando o fornecedor reajustasse o preço. Agora uma
--    trigger carimba `custo_unitario` na linha da venda, no instante em que ela
--    nasce.
--
--    Trigger e não reescrita da `criar_venda_pdv`: a função de venda tem 10 KB,
--    é o caminho de toda venda das 4 turmas e já levou a 415 a decidir o mesmo.
--    A trigger vale para o PDV, para a loja online e para o F12.
--
--    Venda ANTERIOR a esta migração fica sem carimbo. A RPC cai no custo atual
--    para essas, e o relatório avisa quantas linhas estão nessa situação — em
--    vez de fingir precisão que o dado não tem.
--
-- 2. **Classificação de despesa.** `centros_custo` não diz a que grupo do DRE
--    cada centro pertence. Em vez de eu escolher no lugar da turma, o campo
--    nasce vazio e o que não foi classificado aparece como linha própria
--    ("Não classificado") no relatório. O professor classifica em Financeiro →
--    Centros de Custo e o número se organiza — que é a aula.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS REGRAS QUE O RELATÓRIO PRECISA ACERTAR
--
-- **Compra de mercadoria não é despesa.** A conta a pagar de um pedido de
-- compra vira ESTOQUE, e só vira resultado quando o produto é vendido — aí
-- pelo CMV. Somar as duas contaria o mesmo dinheiro duas vezes e faria toda
-- filial que comprou no fim do mês parecer deficitária. Por isso as despesas
-- ignoram `contas_pagar` com `pedido_id` preenchido.
--
-- **Competência, não caixa.** A venda entra na data da venda; a despesa, na
-- data de vencimento. Quem quiser saber de dinheiro no bolso olha o Controle de
-- Caixa — a diferença entre os dois é exatamente o que o DRE existe para
-- ensinar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Custo carimbado na linha da venda
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.itens_venda
  ADD COLUMN IF NOT EXISTS custo_unitario numeric(15,4);

COMMENT ON COLUMN public.itens_venda.custo_unitario IS
  'Custo do produto no instante da venda (migr. 425). NULL = venda anterior ao carimbo; o DRE cai no custo atual e avisa.';

CREATE OR REPLACE FUNCTION public.fn_itens_venda_carimba_custo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Já veio preenchido (importação, correção manual): respeita.
  IF NEW.custo_unitario IS NOT NULL OR NEW.produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT preco_custo INTO NEW.custo_unitario
    FROM public.produtos_custo WHERE produto_id = NEW.produto_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_itens_venda_carimba_custo ON public.itens_venda;
CREATE TRIGGER trg_itens_venda_carimba_custo
  BEFORE INSERT ON public.itens_venda
  FOR EACH ROW EXECUTE FUNCTION public.fn_itens_venda_carimba_custo();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O centro de custo passa a ter endereço no DRE
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.centros_custo
  ADD COLUMN IF NOT EXISTS grupo_dre text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.centros_custo'::regclass
       AND conname  = 'centros_custo_grupo_dre_valido'
  ) THEN
    ALTER TABLE public.centros_custo
      ADD CONSTRAINT centros_custo_grupo_dre_valido
      CHECK (grupo_dre IS NULL OR grupo_dre IN
        ('Pessoal', 'Comerciais', 'Administrativas', 'Ocupação', 'Outras'));
  END IF;
END $$;

COMMENT ON COLUMN public.centros_custo.grupo_dre IS
  'Grupo de despesa no DRE. NULL = não classificado, e aparece como linha própria no relatório até alguém decidir (migr. 425).';

-- O formulário genérico de cadastro manda string vazia quando o select fica em
-- "Selecione...", e '' não é NULL: passaria pelo CHECK como valor inválido e,
-- pior, viraria um grupo de nome vazio no relatório. Normalizar aqui vale para
-- todo caminho de escrita — a tela, a importação e o F12.
CREATE OR REPLACE FUNCTION public.fn_centro_custo_normaliza_grupo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.grupo_dre := NULLIF(btrim(COALESCE(NEW.grupo_dre, '')), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_centro_custo_normaliza_grupo ON public.centros_custo;
CREATE TRIGGER trg_centro_custo_normaliza_grupo
  BEFORE INSERT OR UPDATE ON public.centros_custo
  FOR EACH ROW EXECUTE FUNCTION public.fn_centro_custo_normaliza_grupo();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O demonstrativo
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gerar_dre(
  p_filial text,
  p_inicio date,
  p_fim    date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receita_bruta   numeric(15,2);
  v_descontos       numeric(15,2);
  v_devolucoes      numeric(15,2);
  v_receita_liquida numeric(15,2);
  v_cmv             numeric(15,2);
  v_lucro_bruto     numeric(15,2);
  v_despesas        numeric(15,2);
  v_resultado       numeric(15,2);
  v_grupos          jsonb;
  v_sem_custo       integer;
  v_itens           integer;
BEGIN
  PERFORM public._assert_rpc();

  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Resultado de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o gerente da filial abrem o resultado da unidade.'
      USING ERRCODE = '42501';
  END IF;

  -- ── Receita ──
  -- `total` é antes do desconto; `total_final` é o que o cliente pagou. O DRE
  -- mostra os dois lados para o desconto virar uma linha visível, e não um
  -- pedaço de receita que sumiu sem explicação.
  SELECT COALESCE(SUM(v.total), 0),
         COALESCE(SUM(COALESCE(v.desconto, 0) + COALESCE(v.cupom_desconto, 0)), 0)
    INTO v_receita_bruta, v_descontos
    FROM public.vendas v
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  SELECT COALESCE(SUM(d.valor_devolvido), 0)
    INTO v_devolucoes
    FROM public.devolucoes d
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_receita_liquida := ROUND(v_receita_bruta - v_descontos - v_devolucoes, 2);

  -- ── CMV ──
  -- Custo carimbado na venda; se a linha é anterior à migr. 425, cai no custo
  -- atual do produto. `v_sem_custo` conta quantas precisaram desse socorro.
  SELECT COALESCE(SUM(iv.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0),
         COUNT(*) FILTER (WHERE iv.custo_unitario IS NULL),
         COUNT(*)
    INTO v_cmv, v_sem_custo, v_itens
    FROM public.itens_venda iv
    JOIN public.vendas v ON v.id = iv.venda_id
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = iv.produto_id
   WHERE v.ativo = true
     AND v.filial = p_filial
     AND v.status <> 'Cancelada'
     AND v.created_at::date BETWEEN p_inicio AND p_fim;

  v_cmv         := ROUND(v_cmv, 2);
  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- ── Despesas por grupo ──
  -- `pedido_id IS NULL` tira a compra de mercadoria: ela é estoque, e já entra
  -- no resultado pelo CMV (ver cabeçalho).
  SELECT COALESCE(SUM(t.valor), 0),
         COALESCE(jsonb_agg(jsonb_build_object('grupo', t.grupo, 'valor', t.valor)
                            ORDER BY t.valor DESC), '[]'::jsonb)
    INTO v_despesas, v_grupos
    FROM (
      -- NULLIF junto do COALESCE: cinto e suspensório contra a string vazia
      -- que possa ter entrado antes da trigger de normalização existir.
      SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
             ROUND(SUM(cp.valor), 2) AS valor
        FROM public.contas_pagar cp
        LEFT JOIN public.centros_custo cc ON cc.id = cp.centro_custo_id
       WHERE cp.ativo = true
         AND cp.filial = p_filial
         AND cp.status <> 'Cancelado'
         AND cp.pedido_id IS NULL
         AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim
       GROUP BY COALESCE(cc.grupo_dre, 'Não classificado')
    ) t;

  v_resultado := ROUND(v_lucro_bruto - v_despesas, 2);

  RETURN jsonb_build_object(
    'filial',           p_filial,
    'inicio',           p_inicio,
    'fim',              p_fim,
    'receita_bruta',    v_receita_bruta,
    'descontos',        v_descontos,
    'devolucoes',       v_devolucoes,
    'receita_liquida',  v_receita_liquida,
    'cmv',              v_cmv,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_dre(text, date, date) FROM public;
REVOKE ALL ON FUNCTION public.gerar_dre(text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.gerar_dre(text, date, date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
