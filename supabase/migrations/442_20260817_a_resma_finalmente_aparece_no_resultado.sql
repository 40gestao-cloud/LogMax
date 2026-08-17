-- 442_20260817_a_resma_finalmente_aparece_no_resultado.sql
--
-- A COMPRA DE MATERIAL DE CONSUMO SOME DO RESULTADO. ESTA MIGRAÇÃO FECHA ISSO.
--
-- O buraco que a migr. 440 mapeou e deixou aberto de propósito: a conta a pagar
-- de um pedido de compra tem `pedido_id`, e a 425 tira essas contas das
-- despesas (`AND cp.pedido_id IS NULL`) porque compra de mercadoria vira
-- ESTOQUE e só entra no resultado como CMV, na venda. Certo para mercadoria.
--
-- Só que a resma de papel nunca é vendida. Não vira CMV, e a exceção da 425 já
-- a tinha tirado das despesas: R$ 300 de papel entram no estoque e desaparecem
-- do DRE para sempre. A filial fecha o mês com lucro maior do que teve.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A POLÍTICA ESCOLHIDA: DESPESA NO CONSUMO
--
-- Duas eram defensáveis. A escolhida é a que um ERP de verdade usa:
--
--   material de consumo é ESTOQUE enquanto está na prateleira e vira DESPESA
--   quando sai para o setor que o pediu, valorizado pelo custo médio, no
--   centro de custo de quem pediu.
--
-- A recusada era "despesa na compra" — trocar a exceção da 425 por "exceto se
-- o item for de consumo". Uma regra só, migração pequena, e ensina errado:
-- R$ 300 de papel virariam despesa integral no mês da compra com 9 resmas
-- ainda na prateleira. É a diferença entre comprar e consumir, que é
-- exatamente a aula que o DRE existe para dar.
--
-- Simetria com o CMV, e é assim que se lê:
--
--   mercadoria  compra → estoque → venda      → CMV
--   consumo     compra → estoque → requisição → despesa
--
-- A metade difícil já estava construída desde a migr. 283: `requisicoes_estoque`
-- + `criar_requisicao_estoque` + `liberar_requisicao_estoque` fazem "setor pede
-- → Estoque libera → sai do saldo", com aprovação e anti-privesc, gravando
-- `movimentacoes_estoque` tipo 'Saída' origem 'Requisição de Estoque'. O que
-- faltava era o evento financeiro e o endereço no DRE.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE UM GATILHO, E NÃO UM IF DENTRO DA `liberar_requisicao_estoque`
--
-- Mesmo argumento das migrs. 425 e 440: a regra que precisa valer em toda
-- saída mora no gatilho. `movimentacoes_estoque` com `requisicao_estoque_id`
-- preenchido é o fato "material saiu para um setor" — venha da RPC, venha do
-- F12, venha de um caminho que ainda não existe. Um IF na RPC cobriria só a RPC.
--
-- POR QUE UMA TABELA NOVA, E NÃO UMA CONTA A PAGAR
--
-- Consumo não é obrigação com ninguém: o dinheiro já saiu na compra, e a conta
-- a pagar dela já existe. Lançar uma segunda conta a pagar criaria uma dívida
-- que ninguém deve, apareceria no Contas a Pagar como boleto a vencer e
-- contaria o mesmo dinheiro duas vezes no caixa. `consumos_material` é evento
-- de RESULTADO, não de caixa — como o CMV, que também não é conta a pagar.
--
-- POR QUE NÃO PRECISA ENTRAR NO TRUNCATE DO RESET
--
-- A FK para `requisicoes_estoque`, que já está nomeada no TRUNCATE do
-- `resetar_dados_operacionais` (393/394/395), e aquele TRUNCATE termina em
-- `RESTART IDENTITY CASCADE`: a filha vem junto sem tocar no corpo da função —
-- que é o que a 412 e a 413 evitaram fazer às cegas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
--
-- Não trata devolução de material ao almoxarifado: não existe esse caminho no
-- produto hoje. Se um dia existir, o estorno é uma linha `ativo = false` aqui.
--
-- Não exige centro de custo na requisição. Nasce opcional, como `grupo_dre`
-- nasceu na 425: o que ninguém classificou aparece como "Não classificado" no
-- DRE, e alguém decide. Obrigar no primeiro dia travaria o almoxarifado por um
-- cadastro que a turma ainda não fez.
--
-- Vale para TODA requisição de material, não só para item tipo 'consumo'.
-- Mercadoria que sai por requisição interna (a loja levou uma caixa para o
-- refeitório) também nunca vira CMV — some do resultado pelo mesmo motivo e
-- pela mesma porta.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 425 e da 440.

BEGIN;

-- ── 1. A requisição passa a saber de quem é a despesa ───────────────────────

ALTER TABLE public.requisicoes_estoque
  ADD COLUMN IF NOT EXISTS centro_custo_id uuid REFERENCES public.centros_custo(id);

COMMENT ON COLUMN public.requisicoes_estoque.centro_custo_id IS
  'Centro de custo de quem pediu o material (migr. 442). Define o grupo do DRE em que o consumo entra. NULL = "Não classificado" no relatório.';

CREATE INDEX IF NOT EXISTS idx_requisicoes_estoque_centro
  ON public.requisicoes_estoque (centro_custo_id);

-- ── 2. O evento de resultado ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.consumos_material (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisicao_estoque_id uuid NOT NULL REFERENCES public.requisicoes_estoque(id) ON DELETE CASCADE,
  movimentacao_id       uuid REFERENCES public.movimentacoes_estoque(id) ON DELETE SET NULL,
  produto_id            uuid REFERENCES public.produtos(id),
  filial                text NOT NULL,
  centro_custo_id       uuid REFERENCES public.centros_custo(id),
  setor_solicitante     text,
  qtd                   numeric(15,3) NOT NULL,
  -- NULL = o produto não tinha custo apurado no momento da saída. Fica NULL em
  -- vez de virar zero: zero é um número, e number errado é pior que buraco
  -- declarado. O DRE conta essas linhas e avisa (`consumos_sem_custo`).
  custo_unitario        numeric(15,4),
  valor                 numeric(15,2) NOT NULL DEFAULT 0,
  data                  date NOT NULL DEFAULT public.acre_today(),
  ativo                 boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consumos_material IS
  'Baixa de material de consumo como DESPESA (migr. 442), valorizada pelo custo médio no momento da saída. Não é conta a pagar: o dinheiro saiu na compra. Escrita exclusiva do gatilho fn_consumo_material_do_estoque.';

-- Uma liberação, um consumo. Parcial em `ativo` porque estorno é soft-delete e
-- um índice único cheio impediria o relançamento depois dele.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumos_material_requisicao
  ON public.consumos_material (requisicao_estoque_id) WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_consumos_material_filial_data
  ON public.consumos_material (filial, data) WHERE ativo;

ALTER TABLE public.consumos_material ENABLE ROW LEVEL SECURITY;

-- Leitura pela régua de filial da migr. 436. Escrita não tem policy nenhuma: o
-- gatilho é SECURITY DEFINER e não passa por RLS, e ninguém mais escreve aqui.
DROP POLICY IF EXISTS "consumo_material_read" ON public.consumos_material;
CREATE POLICY "consumo_material_read" ON public.consumos_material
  FOR SELECT TO authenticated
  USING (public.auth_is_admin() OR COALESCE(public.auth_pode_filial(filial), false));

-- ── 3. O gatilho: saída para setor vira despesa ─────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_consumo_material_do_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req   public.requisicoes_estoque;
  v_custo numeric(15,4);
BEGIN
  IF NEW.requisicao_estoque_id IS NULL
     OR COALESCE(NEW.tipo, '') <> 'Saída'
     OR COALESCE(NEW.qtd, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque WHERE id = NEW.requisicao_estoque_id;

  -- Custo médio ponderado mantido pela migr. 417 no recebimento. Se o produto
  -- nunca teve compra apurada, `preco_custo` é NULL e a linha nasce sem valor —
  -- ver o COMMENT da coluna.
  SELECT preco_custo INTO v_custo
    FROM public.produtos_custo WHERE produto_id = NEW.produto_id;

  INSERT INTO public.consumos_material (
    requisicao_estoque_id, movimentacao_id, produto_id, filial, centro_custo_id,
    setor_solicitante, qtd, custo_unitario, valor, data
  ) VALUES (
    NEW.requisicao_estoque_id, NEW.id, NEW.produto_id,
    COALESCE(NEW.filial, v_req.filial), v_req.centro_custo_id,
    v_req.setor_solicitante, NEW.qtd, v_custo,
    ROUND(NEW.qtd * COALESCE(v_custo, 0), 2),
    COALESCE(NEW.data, public.acre_today())
  )
  ON CONFLICT (requisicao_estoque_id) WHERE ativo DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_consumo_material_do_estoque ON public.movimentacoes_estoque;
CREATE TRIGGER trg_consumo_material_do_estoque
  AFTER INSERT ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_consumo_material_do_estoque();

-- ── 4. A requisição de material passa a aceitar o centro de custo ───────────
--
-- Assinatura muda: DROP da vigente antes do CREATE, senão a sobrecarga faz o
-- PostgREST recusar a chamada por ambiguidade. Corpo copiado do banco, com o
-- parâmetro novo e a gravação dele — nada mais mudou.

DROP FUNCTION IF EXISTS public.criar_requisicao_estoque(uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.criar_requisicao_estoque(
  p_produto_id      uuid,
  p_solicitante     text,
  p_qtd             numeric DEFAULT 1,
  p_destino         text    DEFAULT NULL::text,
  p_filial          text    DEFAULT 'SuperMax'::text,
  p_centro_custo_id uuid    DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req   requisicoes_estoque;
  v_nome  text;
  v_setor text;
BEGIN
  -- Era _assert_rpc('estoque','logistica'). Material do almoxarifado é pedido
  -- por quem precisa dele — igual à requisição de compra (migr. 283).
  PERFORM public._assert_rpc();

  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    p_qtd := 1;
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  IF NOT public.auth_pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  -- Migr. 442. Centro de custo inexistente ou inativo entra como NULL em vez de
  -- derrubar o pedido: o material é urgente, a classificação não é.
  IF p_centro_custo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.centros_custo
     WHERE id = p_centro_custo_id AND COALESCE(ativo, true)
  ) THEN
    p_centro_custo_id := NULL;
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, setor_solicitante, qtd, destino, status, filial,
    centro_custo_id
  ) VALUES (
    p_produto_id,
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente', p_filial,
    p_centro_custo_id
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text, uuid) TO authenticated, service_role;

-- ── 5. O DRE passa a enxergar o consumo ─────────────────────────────────────
--
-- Corpo copiado do banco (que já traz o CMV devolvido da 428 e o filtro de
-- `devolucao_pdv`), com a despesa passando a somar duas fontes. A régua de
-- grupo é a mesma nas duas: `grupo_dre` do centro de custo, "Não classificado"
-- quando ninguém decidiu.

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
  --   1. contas a pagar que NÃO são compra de mercadoria. `pedido_id IS NULL`
  --      tira a compra (vira CMV na venda, ou consumo na requisição);
  --      `origem <> 'devolucao_pdv'` tira o estorno de devolução de venda, que
  --      já foi subtraído da receita.
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
             AND cp.pedido_id IS NULL
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
--   -- 1. a tabela e o gatilho existem
--   SELECT to_regclass('public.consumos_material');
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.movimentacoes_estoque'::regclass
--      AND tgname = 'trg_consumo_material_do_estoque';
--
--   -- 2. a RPC não ficou com sobrecarga (esperado: UMA linha, 6 argumentos)
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'criar_requisicao_estoque';
--
--   -- 3. o DRE devolve as chaves novas
--   --    (rodar logado como financeiro; anon não passa do _assert_rpc)
--   SELECT gerar_dre('SuperMax', date_trunc('month', now())::date, public.acre_today())
--            -> 'consumo_material';
--
-- E o teste que vale a aula: comprar 10 resmas por R$ 300 e receber (o DRE não
-- muda — virou estoque), depois requisitar 1 resma para o Administrativo e
-- liberar. O DRE do mês passa a mostrar R$ 30 em despesa, no grupo do centro
-- de custo que pediu.
-- =================================================================
