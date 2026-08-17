-- 447_20260817_a_conta_passa_a_dizer_no_que_virou.sql
--
-- O DRE DECIDIA DESPESA POR UMA PROXY, E A PROXY ERRA EM DOIS CASOS.
--
-- A régua da migr. 425 é: conta a pagar sem `pedido_id` é despesa. Ela responde
-- "veio de compra?" quando a pergunta do DRE é outra: **este dinheiro virou
-- ativo ou virou gasto?** Ter pedido é só o sintoma mais comum de ter virado
-- estoque, e por isso a proxy erra duas vezes:
--
--   1. CONTAGEM DUPLA DO CONSUMO. Conta avulsa de material de limpeza (sem
--      pedido) entra como despesa; o material entra no estoque por lançamento
--      manual; quando o setor requisita, a migr. 442 lança despesa de novo.
--      O mesmo dinheiro sai do resultado duas vezes.
--
--   2. PATRIMÔNIO VIRANDO DESPESA. Comprar um freezer por conta avulsa lança o
--      valor inteiro como despesa do mês. Freezer é bem, não gasto — e este
--      erro estava aqui desde a 425, sem ninguém notar, porque a proxy não tem
--      como distinguir um freezer de uma conta de luz.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CONTA PASSA A DIZER NO QUE ELA VIRA
--
--   despesa      (padrão)  entra no DRE no vencimento, por competência
--   estoque                não entra: vira resultado na venda (CMV, migr. 425)
--                          ou na requisição (consumo, migr. 442)
--   imobilizado            não entra: é bem, e bem não é gasto
--
-- NENHUM NÚMERO MUDA NO DIA DA MIGRAÇÃO. O backfill reproduz exatamente o que
-- o DRE já fazia: conta com pedido vira 'estoque', todo o resto vira 'despesa'.
-- O que muda é o que passa a ser POSSÍVEL dizer a partir de agora — e o erro,
-- que deixa de ser silencioso e passa a ser uma escolha errada de campo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O GATILHO FORÇA 'estoque' EM CONTA COM PEDIDO
--
-- Sem isso, marcar "despesa" numa conta de pedido criaria a duplicação no
-- sentido inverso: despesa agora + CMV na venda. A regra da 425 continua
-- valendo inteira; ela só deixou de ser a ÚNICA maneira de chegar a ela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO NÃO RESOLVE
--
-- Conta avulsa marcada 'estoque' não apura custo médio: `fn_custo_medio_da_entrada`
-- (417) só apura no recebimento de um pedido, porque é lá que existe valor e
-- quantidade. O produto fica com o custo digitado no cadastro. É mais um motivo
-- para a compra passar por pedido — mas agora o DRE não mente por causa disso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 425 e da 442.

BEGIN;

-- ── 1. A coluna ─────────────────────────────────────────────────────────────

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS natureza text;

-- Backfill ANTES do CHECK e do DEFAULT: a tabela tem linhas, e um CHECK sobre
-- coluna nula recém-criada passaria hoje e barraria o UPDATE de amanhã.
UPDATE public.contas_pagar
   SET natureza = CASE WHEN pedido_id IS NOT NULL THEN 'estoque' ELSE 'despesa' END
 WHERE natureza IS NULL;

ALTER TABLE public.contas_pagar
  ALTER COLUMN natureza SET DEFAULT 'despesa';

ALTER TABLE public.contas_pagar DROP CONSTRAINT IF EXISTS chk_contas_pagar_natureza;
ALTER TABLE public.contas_pagar
  ADD CONSTRAINT chk_contas_pagar_natureza
  CHECK (natureza IS NULL OR natureza IN ('despesa', 'estoque', 'imobilizado'));

COMMENT ON COLUMN public.contas_pagar.natureza IS
  'No que este pagamento se transforma (migr. 447). despesa = entra no DRE por competência. estoque = vira mercadoria ou material, e só afeta o resultado no CMV ou no consumo. imobilizado = bem, não gasto. Conta com pedido_id é sempre estoque (gatilho).';

CREATE INDEX IF NOT EXISTS idx_contas_pagar_natureza
  ON public.contas_pagar (filial, natureza) WHERE ativo;

-- ── 2. O gatilho ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_conta_pagar_natureza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Compra com pedido é estoque, sempre: o pedido comprou mercadoria ou
  -- material, e o resultado dela vem pelo CMV ou pelo consumo. Aceitar
  -- 'despesa' aqui duplicaria a saída.
  IF NEW.pedido_id IS NOT NULL THEN
    NEW.natureza := 'estoque';
    RETURN NEW;
  END IF;

  -- Folha e rescisão são despesa por natureza — não há o que escolher.
  IF NEW.folha_pagamento_id IS NOT NULL OR NEW.rescisao_id IS NOT NULL THEN
    NEW.natureza := 'despesa';
    RETURN NEW;
  END IF;

  NEW.natureza := COALESCE(NULLIF(btrim(COALESCE(NEW.natureza, '')), ''), 'despesa');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_conta_pagar_natureza ON public.contas_pagar;
CREATE TRIGGER trg_conta_pagar_natureza
  BEFORE INSERT OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_pagar_natureza();

-- ── 3. O DRE passa a ler a natureza ─────────────────────────────────────────
--
-- Corpo copiado do banco (a versão da 442, com CMV devolvido e consumo de
-- material), com uma linha trocada no WHERE das despesas.

CREATE OR REPLACE FUNCTION public.gerar_dre(p_filial text, p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receita_bruta   numeric(15,2);
  v_descontos       numeric(15,2);
  v_devolucoes      numeric(15,2);
  v_receita_liquida numeric(15,2);
  v_cmv             numeric(15,2);
  v_cmv_devolvido   numeric(15,2);
  v_lucro_bruto     numeric(15,2);
  v_despesas        numeric(15,2);
  v_consumo         numeric(15,2);
  v_consumo_sem     integer;
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

  -- Mercadoria devolvida voltou para a prateleira: o custo dela sai do CMV.
  -- O custo usado é o carimbado na LINHA DA VENDA original (mesma venda, mesmo
  -- produto), e não o de hoje — senão devolver um item viraria lucro ou
  -- prejuízo contábil só porque o fornecedor reajustou no meio.
  SELECT COALESCE(SUM(idev.qtd * COALESCE(iv.custo_unitario, pc.preco_custo, 0)), 0)
    INTO v_cmv_devolvido
    FROM public.itens_devolucao idev
    JOIN public.devolucoes d ON d.id = idev.devolucao_id
    LEFT JOIN LATERAL (
      SELECT iv2.custo_unitario
        FROM public.itens_venda iv2
       WHERE iv2.venda_id = d.venda_id
         AND iv2.produto_id IS NOT DISTINCT FROM idev.produto_id
       LIMIT 1
    ) iv ON true
    LEFT JOIN public.produtos_custo pc ON pc.produto_id = idev.produto_id
   WHERE d.ativo = true
     AND d.filial = p_filial
     AND d.created_at::date BETWEEN p_inicio AND p_fim;

  v_cmv         := ROUND(GREATEST(v_cmv - v_cmv_devolvido, 0), 2);
  v_lucro_bruto := ROUND(v_receita_liquida - v_cmv, 2);

  -- Migr. 442: o material de consumo que saiu para os setores no período.
  SELECT COALESCE(SUM(cm.valor), 0),
         COUNT(*) FILTER (WHERE cm.custo_unitario IS NULL)
    INTO v_consumo, v_consumo_sem
    FROM public.consumos_material cm
   WHERE cm.ativo = true
     AND cm.filial = p_filial
     AND cm.data BETWEEN p_inicio AND p_fim;

  -- Despesas por grupo, de duas fontes:
  --
  --   1. contas a pagar de natureza `despesa`. As de `estoque` viram resultado
  --      pelo CMV (venda) ou pelo consumo (requisição); as de `imobilizado` são
  --      bem, não gasto. `origem <> 'devolucao_pdv'` tira o estorno de
  --      devolução de venda, que já foi subtraído da receita.
  --   2. o consumo de material (442), que é a outra ponta da mesma exceção: a
  --      compra saiu das despesas pelo `pedido_id`, e é aqui que ela volta —
  --      no mês em que o material foi de fato usado, e não no da compra.
  SELECT COALESCE(SUM(t.valor), 0),
         COALESCE(jsonb_agg(jsonb_build_object('grupo', t.grupo, 'valor', t.valor)
                            ORDER BY t.valor DESC), '[]'::jsonb)
    INTO v_despesas, v_grupos
    FROM (
      SELECT u.grupo, ROUND(SUM(u.valor), 2) AS valor
        FROM (
          SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
                 cp.valor
            FROM public.contas_pagar cp
            LEFT JOIN public.centros_custo cc ON cc.id = cp.centro_custo_id
           WHERE cp.ativo = true
             AND cp.filial = p_filial
             AND cp.status <> 'Cancelado'
             -- Migr. 447: era `pedido_id IS NULL`, que respondia por proxy.
             -- A pergunta do DRE é o que o dinheiro VIROU, e agora a conta diz.
             AND COALESCE(cp.natureza, 'despesa') = 'despesa'
             AND COALESCE(cp.origem, '') <> 'devolucao_pdv'
             AND COALESCE(cp.vencimento, cp.created_at::date) BETWEEN p_inicio AND p_fim

          UNION ALL

          SELECT COALESCE(NULLIF(btrim(cc.grupo_dre), ''), 'Não classificado') AS grupo,
                 cm.valor
            FROM public.consumos_material cm
            LEFT JOIN public.centros_custo cc ON cc.id = cm.centro_custo_id
           WHERE cm.ativo = true
             AND cm.filial = p_filial
             AND cm.data BETWEEN p_inicio AND p_fim
        ) u
       GROUP BY u.grupo
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
    'cmv_devolvido',    v_cmv_devolvido,
    'lucro_bruto',      v_lucro_bruto,
    'margem_bruta_pct', CASE WHEN v_receita_liquida > 0
                             THEN ROUND(100 * v_lucro_bruto / v_receita_liquida, 1) END,
    'despesas',         v_despesas,
    'despesas_grupos',  v_grupos,
    'consumo_material', v_consumo,
    'consumos_sem_custo', v_consumo_sem,
    'resultado',        v_resultado,
    'margem_liquida_pct', CASE WHEN v_receita_liquida > 0
                               THEN ROUND(100 * v_resultado / v_receita_liquida, 1) END,
    'itens_vendidos',   v_itens,
    'itens_sem_custo',  v_sem_custo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_dre(text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gerar_dre(text, date, date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. o backfill reproduziu a régua antiga: nenhuma linha fora do lugar
--   SELECT natureza, count(*), count(*) FILTER (WHERE pedido_id IS NOT NULL) com_pedido
--     FROM contas_pagar WHERE ativo GROUP BY 1;
--   -- esperado: 'estoque' com todas as de pedido, 'despesa' sem nenhuma.
--
--   -- 2. o gatilho recusa contrariar o pedido
--   --    (num pedido qualquer: o UPDATE passa, mas a coluna volta a 'estoque')
--   -- UPDATE contas_pagar SET natureza='despesa' WHERE pedido_id IS NOT NULL;
--   -- SELECT natureza FROM contas_pagar WHERE pedido_id IS NOT NULL LIMIT 1;
--
--   -- 3. o DRE nao mudou de valor por causa desta migração
--   SELECT gerar_dre('SuperMax', date_trunc('month', now())::date, public.acre_today()) -> 'despesas';
--   -- esperado: o mesmo número de antes de aplicar.
--
-- E o teste que vale a aula: lançar a compra de um freezer como conta avulsa,
-- marcar 'imobilizado', e ver que o DRE do mês não afunda por causa dele.
-- =================================================================
