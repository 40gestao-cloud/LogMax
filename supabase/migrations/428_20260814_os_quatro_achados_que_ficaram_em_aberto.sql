-- 428_20260814_os_quatro_achados_que_ficaram_em_aberto.sql
--
-- Os quatro itens que a revisão das migrações 416–427 encontrou e deixou
-- anotados em `docs/backlog-pos-freeze.md` por serem anteriores àquele
-- trabalho. Um deles é grave e estava calado havia meses.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. PAINEL BI: "A PAGAR" SEMPRE MOSTROU R$ 0,00
--
-- `gerar_painel_bi` soma `contas_pagar` com `status = 'Aberto'`. Esse status
-- **não existe** nessa tabela — o vocabulário dela é 'Pendente' (o de
-- `contas_receber` é que é 'Aberto'). Copiar a linha de cima e trocar a tabela
-- sem trocar o status deixou o indicador zerado desde sempre.
--
-- Não é um painel decorativo: a RPC alimenta `api/ai-bi.ts` e
-- `api/ai-briefing.ts`. A IA vinha escrevendo para a turma que a holding não
-- tem nada a pagar, todo santo dia.
--
-- Na mesma passada o bloco aprende o status 'Parcial' (migrs. 422/427): conta
-- pela metade não some do "a pagar"/"a receber" — entra pelo SALDO —, e o
-- realizado passa a contar o que de fato saiu ou entrou.
--
-- Fica como está, de propósito: o recorte por `vencimento` (e não por data de
-- pagamento) no bloco de realizados. É discutível, mas é o critério que os dois
-- períodos comparados já usam, e mudar isso é outra conversa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. EXCLUIR CONTA JÁ PAGA DEVOLVIA O DINHEIRO AO BANCO, EM SILÊNCIO
--
-- O botão Excluir das telas de Contas faz soft delete (`ativo = false`), e o
-- gatilho de saldo interpreta isso como "o pagamento não vale mais" e estorna
-- o valor no caixa. Para uma conta ainda pendente está certo; para uma que já
-- foi paga, é dinheiro reaparecendo do nada.
--
-- Com o status 'Parcial' isso ficou mais fácil de alcançar, então vira trava:
-- conta com dinheiro movimentado não se exclui. Admin (o professor) ainda
-- passa, porque é quem conserta a base quando a turma erra.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3. O SELO DO FORNECEDOR MEDIA PONTUALIDADE E CHAMAVA ISSO DE DESEMPENHO
--
-- Quem entrega no prazo e manda mercadoria avariada tinha selo verde. A view
-- ganha a taxa de devolução ao lado da pontualidade — as duas coisas, separadas,
-- porque são defeitos diferentes e se resolvem com conversas diferentes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 4. DEVOLVER AO FORNECEDOR NÃO BAIXAVA O LOTE
--
-- A devolução tirava do estoque e deixava o lote de validade intacto, então a
-- tela de Validades acusava divergência (âmbar) que ninguém tinha como
-- resolver senão à mão. Agora a devolução consome os lotes do próprio
-- recebimento em ordem FEFO — o que vence primeiro sai primeiro, inclusive
-- para voltar ao fornecedor.
--
-- A função é reescrita por inteiro aqui, consolidando o que a 423 criou e o
-- que a 427 alterou por cirurgia de texto. Duas cirurgias empilhadas na mesma
-- função é dívida esperando cobrança.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Painel BI — bloco financeiro
--
-- O bloco é delimitado por marcadores únicos (`WITH f_atual AS (` … `INTO
-- v_financeiro FROM f_atual;`), conferidos antes da troca. Substituição que
-- não encontra o alvo vira no-op silencioso — que num indicador é pior que o
-- erro original, porque ninguém volta a olhar.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_src   text;
  v_args  text;
  v_ret   text;
  v_novo  text;
  v_qtd   integer;
BEGIN
  SELECT p.prosrc, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    INTO v_src, v_args, v_ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_painel_bi';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'gerar_painel_bi não existe neste banco.' USING ERRCODE = 'P0001';
  END IF;

  -- Já corrigida (reexecução).
  IF position('saldo_a_pagar' IN v_src) > 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM regexp_matches(v_src, 'WITH f_atual AS \(.*?INTO v_financeiro\s*FROM f_atual;', 'gns');
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION
      'Esperava exatamente 1 bloco financeiro em gerar_painel_bi e achei %. Ajuste manual necessário.', v_qtd
      USING ERRCODE = 'P0001';
  END IF;

  v_novo := $bloco$WITH saldo_a_pagar AS (
    -- 'Pendente'/'Atrasado'/'Parcial': o vocabulário de contas_pagar. A versão
    -- anterior procurava 'Aberto', que é o de contas_receber, e por isso o
    -- indicador "a pagar" ficou em zero desde sempre (migr. 428).
    SELECT COALESCE(SUM(GREATEST(cp.valor - COALESCE((
             SELECT SUM(b.principal) FROM contas_pagar_baixas b WHERE b.conta_id = cp.id
           ), 0), 0)), 0) AS v
      FROM contas_pagar cp
     WHERE COALESCE(cp.ativo, true)
       AND cp.status IN ('Pendente', 'Parcial', 'Atrasado')
       AND cp.vencimento BETWEEN p_inicio AND p_fim
  ),
  saldo_a_receber AS (
    SELECT COALESCE(SUM(GREATEST(cr.valor - COALESCE((
             SELECT SUM(b.principal) FROM contas_receber_baixas b WHERE b.conta_id = cr.id
           ), 0), 0)), 0) AS v
      FROM contas_receber cr
     WHERE COALESCE(cr.ativo, true)
       AND cr.status IN ('Aberto', 'Parcial', 'Atrasado')
       AND cr.vencimento BETWEEN p_inicio AND p_fim
  ),
  f_atual AS (
    SELECT
      -- Realizado: 'Pago' entra pelo valor do documento (como sempre entrou) e
      -- 'Parcial' pelo que efetivamente saiu/entrou.
      COALESCE((SELECT SUM(CASE WHEN status = 'Pago' THEN valor ELSE COALESCE(valor_pago, 0) END)
                  FROM contas_pagar
                 WHERE COALESCE(ativo,true)
                   AND status IN ('Pago', 'Parcial')
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS despesas,
      COALESCE((SELECT SUM(CASE WHEN status = 'Pago' THEN valor ELSE COALESCE(valor_pago, 0) END)
                  FROM contas_receber
                 WHERE COALESCE(ativo,true)
                   AND status IN ('Pago', 'Parcial')
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS receitas,
      (SELECT v FROM saldo_a_receber) AS a_receber,
      (SELECT v FROM saldo_a_pagar)   AS a_pagar
  ),
  f_anterior AS (
    SELECT
      COALESCE((SELECT SUM(CASE WHEN status = 'Pago' THEN valor ELSE COALESCE(valor_pago, 0) END)
                  FROM contas_pagar
                 WHERE COALESCE(ativo,true)
                   AND status IN ('Pago', 'Parcial')
                   AND vencimento BETWEEN v_inicio_anterior AND v_fim_anterior), 0) AS despesas_ant,
      COALESCE((SELECT SUM(CASE WHEN status = 'Pago' THEN valor ELSE COALESCE(valor_pago, 0) END)
                  FROM contas_receber
                 WHERE COALESCE(ativo,true)
                   AND status IN ('Pago', 'Parcial')
                   AND vencimento BETWEEN v_inicio_anterior AND v_fim_anterior), 0) AS receitas_ant
  )
  SELECT jsonb_build_object(
    'receitas',  ROUND(receitas, 2),
    'despesas',  ROUND(despesas, 2),
    'saldo',     ROUND(receitas - despesas, 2),
    'a_receber', ROUND(a_receber, 2),
    'a_pagar',   ROUND(a_pagar, 2),
    'margem_pct', CASE WHEN receitas > 0
                       THEN ROUND(((receitas - despesas) / receitas) * 100, 1)
                       ELSE NULL END,
    'receitas_anterior',  ROUND((SELECT receitas_ant FROM f_anterior), 2),
    'despesas_anterior',  ROUND((SELECT despesas_ant FROM f_anterior), 2),
    'variacao_saldo_pct', CASE
      WHEN (SELECT receitas_ant - despesas_ant FROM f_anterior) > 0
      THEN ROUND((((receitas - despesas) - (SELECT receitas_ant - despesas_ant FROM f_anterior))
                  / (SELECT receitas_ant - despesas_ant FROM f_anterior)) * 100, 1)
      ELSE NULL
    END
  )
  INTO v_financeiro
  FROM f_atual;$bloco$;

  v_src := regexp_replace(v_src,
    'WITH f_atual AS \(.*?INTO v_financeiro\s*FROM f_atual;',
    replace(v_novo, '\', '\\'),
    'ns');

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.gerar_painel_bi(%s) RETURNS %s '
    || 'LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_args, v_ret, v_src);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Conta com dinheiro movimentado não se exclui
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conta_com_dinheiro_nao_exclui()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só a transição ativa → inativa interessa.
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NEW;
  END IF;

  IF OLD.status NOT IN ('Pago', 'Recebido', 'Parcial') THEN
    RETURN NEW;
  END IF;

  -- Service role e admin (o professor) passam: são quem conserta a base.
  IF public.auth_is_service_role() OR public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Esta conta já teve dinheiro movimentado (status %). Excluí-la devolveria o valor ao saldo do caixa sem nenhum registro. Cancele ou ajuste o lançamento em vez de excluir.',
    OLD.status
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_receber_nao_exclui ON public.contas_receber;
CREATE TRIGGER trg_conta_receber_nao_exclui
  BEFORE UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.conta_com_dinheiro_nao_exclui();

DROP TRIGGER IF EXISTS trg_conta_pagar_nao_exclui ON public.contas_pagar;
CREATE TRIGGER trg_conta_pagar_nao_exclui
  BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.conta_com_dinheiro_nao_exclui();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Desempenho do fornecedor ganha qualidade, não só pontualidade
--
-- Colunas novas no fim (CREATE OR REPLACE VIEW não reordena).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_fornecedor_desempenho
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    p.id AS pedido_id,
    p.fornecedor_id,
    p.filial,
    p.status,
    p.valor_total,
    p.prazo_entrega,
    p.recebido_em,
    (p.status = 'Recebido'
      AND p.prazo_entrega IS NOT NULL
      AND p.recebido_em   IS NOT NULL) AS avaliavel,
    (p.status NOT IN ('Recebido', 'Cancelado')
      AND p.prazo_entrega IS NOT NULL
      AND p.prazo_entrega < public.acre_today()) AS atrasado_agora
    FROM public.pedidos p
   WHERE p.ativo = true
     AND p.fornecedor_id IS NOT NULL
),
dev AS (
  SELECT d.pedido_id,
         SUM(d.qtd)            AS qtd,
         SUM(d.valor_estimado) AS valor
    FROM public.devolucoes_fornecedor d
   WHERE d.ativo
   GROUP BY d.pedido_id
)
SELECT
  b.fornecedor_id,
  b.filial,
  COUNT(*) FILTER (WHERE b.avaliavel)::integer AS entregas,
  COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)::integer AS entregas_no_prazo,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              100.0 * COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)
              / COUNT(*) FILTER (WHERE b.avaliavel), 0)
  END AS pontualidade_pct,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              AVG(GREATEST(b.recebido_em - b.prazo_entrega, 0))
                FILTER (WHERE b.avaliavel), 1)
  END AS atraso_medio_dias,
  COALESCE(MAX(GREATEST(b.recebido_em - b.prazo_entrega, 0))
             FILTER (WHERE b.avaliavel), 0)::integer AS pior_atraso_dias,
  COUNT(*) FILTER (WHERE b.atrasado_agora)::integer AS em_atraso_agora,
  COUNT(*) FILTER (WHERE b.status NOT IN ('Recebido', 'Cancelado'))::integer AS pedidos_em_aberto,
  MAX(b.recebido_em) FILTER (WHERE b.avaliavel) AS ultima_entrega_em,
  COALESCE(SUM(b.valor_total) FILTER (WHERE b.status = 'Recebido'), 0)::numeric(15,2) AS total_comprado,
  -- Qualidade (migr. 428): pontualidade e devolução são defeitos diferentes.
  -- Quem entrega no prazo e manda avariado tinha selo verde até aqui.
  COUNT(DISTINCT b.pedido_id) FILTER (WHERE dv.qtd IS NOT NULL)::integer AS pedidos_com_devolucao,
  COALESCE(SUM(dv.valor), 0)::numeric(15,2) AS devolucoes_valor,
  CASE WHEN COUNT(*) FILTER (WHERE b.status = 'Recebido') > 0
       THEN ROUND(
              100.0 * COUNT(DISTINCT b.pedido_id) FILTER (WHERE dv.qtd IS NOT NULL)
              / COUNT(*) FILTER (WHERE b.status = 'Recebido'), 0)
  END AS taxa_devolucao_pct
  FROM base b
  LEFT JOIN dev dv ON dv.pedido_id = b.pedido_id
 GROUP BY b.fornecedor_id, b.filial;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. A devolução ao fornecedor baixa o lote junto (FEFO)
--
-- Função reescrita por inteiro: consolida o que a migr. 423 criou, o que a 427
-- alterou por cirurgia de texto e a baixa de lote nova. Duas cirurgias
-- empilhadas na mesma função é dívida esperando cobrança.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_devolucao_fornecedor(
  p_recebimento_id   uuid,
  p_qtd              integer,
  p_motivo           text,
  p_reenvio_esperado boolean DEFAULT true,
  p_observacao       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receb        recebimentos;
  v_pedido       pedidos;
  v_produto_id   uuid;
  v_ja_devolvido integer;
  v_disponivel   integer;
  v_unitario     numeric(15,4);
  v_valor        numeric(15,2);
  v_conta        contas_pagar;
  v_conta_novo   numeric(15,2);
  v_conta_efeito text := 'nenhum';
  v_saldo        integer;
  v_pedido_fecha boolean := false;
  v_devolucao_id uuid;
  v_lote         record;
  v_restante     integer;
  v_tira         integer;
  v_lotes_baixados integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade devolvida precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_motivo, '') = '' THEN
    RAISE EXCEPTION 'Informe o motivo da devolução.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_receb FROM public.recebimentos
   WHERE id = p_recebimento_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_receb.id IS NULL THEN
    RAISE EXCEPTION 'Recebimento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_receb.status NOT IN ('Concluído', 'Parcial') THEN
    RAISE EXCEPTION 'Este recebimento ainda não foi confirmado. Se a carga chegou errada, não confirme — a divergência aqui é para o que já entrou no estoque.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_receb.filial), false) THEN
    RAISE EXCEPTION 'Recebimento de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('logistica'), false)
          OR COALESCE(public.auth_gerente_da(v_receb.filial), false)) THEN
    RAISE EXCEPTION 'Apenas a Logística ou o gerente da filial registram devolução ao fornecedor.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_receb.pedido_id FOR UPDATE;
  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido do recebimento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(qtd), 0) INTO v_ja_devolvido
    FROM public.devolucoes_fornecedor
   WHERE recebimento_id = p_recebimento_id AND ativo;

  v_disponivel := COALESCE(v_receb.qtd_recebida, 0) - v_ja_devolvido;
  IF p_qtd > v_disponivel THEN
    RAISE EXCEPTION 'Este recebimento tem % unidade(s) disponível(is) para devolução (recebeu %, já devolveu %).',
      v_disponivel, COALESCE(v_receb.qtd_recebida, 0), v_ja_devolvido USING ERRCODE = 'P0001';
  END IF;

  SELECT produto_id INTO v_produto_id
    FROM public.movimentacoes_estoque
   WHERE recebimento_id = p_recebimento_id AND tipo = 'Entrada'
   ORDER BY created_at LIMIT 1;

  IF COALESCE(v_pedido.item_qtd, 0) > 0 AND COALESCE(v_pedido.valor_total, 0) > 0 THEN
    v_unitario := ROUND(v_pedido.valor_total / v_pedido.item_qtd, 4);
    v_valor    := ROUND(v_unitario * p_qtd, 2);
  ELSE
    v_valor := 0;
  END IF;

  INSERT INTO public.devolucoes_fornecedor
    (pedido_id, recebimento_id, produto_id, qtd, motivo, observacao,
     reenvio_esperado, valor_estimado, filial, criado_por)
  VALUES
    (v_pedido.id, p_recebimento_id, v_produto_id, p_qtd, p_motivo, p_observacao,
     COALESCE(p_reenvio_esperado, true), v_valor, v_receb.filial, auth.uid())
  RETURNING id INTO v_devolucao_id;

  -- ── Estoque ──
  IF v_produto_id IS NOT NULL THEN
    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_produto_id, 'Saída', p_qtd, 'Almoxarifado',
       'Devolução ao fornecedor — ' || COALESCE(v_pedido.numero, 'Pedido #' || upper(right(v_pedido.id::text, 6))),
       public.acre_today(), v_receb.filial);
  END IF;

  -- ── Lote (migr. 428) ──
  -- A mercadoria voltou para o fornecedor, então o lote que ela formou também
  -- encolhe. Ordem FEFO: o que vence primeiro é o primeiro a sair, inclusive
  -- numa devolução. Sem isto, a tela de Validades acusava divergência entre
  -- lote e saldo que ninguém tinha como resolver.
  v_restante := p_qtd;
  FOR v_lote IN
    SELECT * FROM public.vencimentos_estoque
     WHERE recebimento_id = p_recebimento_id
       AND COALESCE(ativo, true)
       AND status = 'OK'
       AND COALESCE(qtd, 0) > 0
     ORDER BY vencimento
     FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tira := LEAST(v_lote.qtd, v_restante);

    UPDATE public.vencimentos_estoque
       SET qtd = v_lote.qtd - v_tira,
           status = CASE WHEN v_lote.qtd - v_tira <= 0 THEN 'Consumido' ELSE 'OK' END,
           observacao = COALESCE(observacao || ' | ', '') ||
                        'Devolvido ao fornecedor: ' || v_tira || ' un. em ' ||
                        to_char(public.acre_today(), 'DD/MM/YYYY'),
           updated_at = now()
     WHERE id = v_lote.id;

    v_restante := v_restante - v_tira;
    v_lotes_baixados := v_lotes_baixados + 1;
  END LOOP;

  -- ── Financeiro ──
  IF v_valor > 0 THEN
    SELECT * INTO v_conta
      FROM public.contas_pagar
     WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status IN ('Pendente', 'Parcial')
     ORDER BY created_at LIMIT 1
     FOR UPDATE;

    IF v_conta.id IS NOT NULL THEN
      -- O piso é o que já foi pago: abater abaixo disso faria a conta dever
      -- menos do que já saiu do caixa (migr. 427).
      v_conta_novo := ROUND(GREATEST(v_conta.valor - v_valor, COALESCE(v_conta.valor_pago, 0)), 2);
      IF v_conta_novo <= 0.005 THEN
        UPDATE public.contas_pagar
           SET ativo = false,
               descricao = descricao || ' — cancelada por devolução ao fornecedor',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'cancelada';
      ELSE
        UPDATE public.contas_pagar
           SET valor = v_conta_novo,
               descricao = descricao || ' — abatido R$ ' || to_char(v_valor, 'FM999G999G990D00') || ' (devolução)',
               updated_at = now()
         WHERE id = v_conta.id;
        v_conta_efeito := 'abatida';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.contas_pagar
       WHERE pedido_id = v_pedido.id AND COALESCE(ativo, true) AND status = 'Pago'
    ) THEN
      v_conta_efeito := 'ja_paga';
    END IF;
  END IF;

  -- ── Pedido ──
  SELECT qtd_saldo INTO v_saldo FROM public.v_pedido_saldo WHERE pedido_id = v_pedido.id;

  IF COALESCE(v_saldo, 0) <= 0 AND v_pedido.status NOT IN ('Recebido', 'Cancelado') THEN
    UPDATE public.pedidos SET status = 'Recebido' WHERE id = v_pedido.id;
    v_pedido_fecha := true;
  ELSIF COALESCE(p_reenvio_esperado, true) AND v_pedido.status = 'Recebido' THEN
    UPDATE public.pedidos SET status = 'Em Entrega' WHERE id = v_pedido.id;
  END IF;

  RETURN jsonb_build_object(
    'devolucao_id',    v_devolucao_id,
    'qtd',             p_qtd,
    'valor',           v_valor,
    'conta_efeito',    v_conta_efeito,
    'saldo_pedido',    COALESCE(v_saldo, 0),
    'pedido_fechado',  v_pedido_fecha,
    'estoque_baixado', v_produto_id IS NOT NULL,
    'lotes_baixados',  v_lotes_baixados
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
