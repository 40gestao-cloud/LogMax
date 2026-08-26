-- 547 — A conta a pagar do pedido não se exclui sozinha.
--
-- `gerar_pedido_de_cotacao` termina inserindo a conta a pagar. É o elo que faz a
-- compra virar dinheiro: sem ela o fornecedor nunca é cobrado, o custo não entra
-- no DRE (migr. 425/426) e o three-way match (migr. 490/491) não tem o que
-- conferir contra a nota.
--
-- E em Financeiro > Contas a Pagar ela some com isto:
--
--     if (!await confirm('Excluir esta conta?')) return;
--     await dbDelete('/api/contaspagarview', id);
--
-- Do lado do banco, `conta_com_dinheiro_nao_exclui` (que existe exatamente para
-- este tipo de coisa) só protege conta `Pago`, `Parcial` ou `Recebido`. A conta
-- nascida do pedido está `Pendente` — é justamente o estado em que ela passa a
-- vida inteira até alguém pagar. Ela é a menos protegida das contas, e é a
-- única que outro documento depende.
--
-- O formulário da mesma tela já sabe que ela é especial: esconde os campos
-- quando `editItem.pedido_id` existe, porque descrição e valor são do pedido,
-- não da digitação. Só o Excluir não foi avisado.
--
-- ─── ESTADO NA BASE (ERP, 26/08) ───────────────────────────────────────────
--
--   PC-SM-2026-0150 · SuperMax · R$ 2.576,00 · pedido 'Recebido'
--   Sabonete Líquido Antibacteriano 250ml Dettol (REQ-SM-2026-0235)
--   conta ativo = false, status 'Pendente', sem motivo registrado
--
-- A mercadoria está no estoque. O fornecedor não tem cobrança. O custo sumiu do
-- resultado do período. Nenhuma tela acusa.
--
-- (A outra conta inativa da base, do PC-ML-2026-0048, é legítima: a descrição
-- dela termina em "cancelada por devolução ao fornecedor" — foi a migr. 423
-- fazendo o trabalho dela.)
--
-- ─── QUEM PODE INATIVAR, ENTÃO ─────────────────────────────────────────────
--
-- Duas RPCs, e só elas:
--
--   cancelar_pedido_compra         — o pedido morreu, a obrigação morre junto
--   registrar_devolucao_fornecedor — a mercadoria voltou inteira, idem
--
-- As duas rodam SECURITY DEFINER mas com o `auth.uid()` de quem clicou, então
-- `auth_is_service_role()` é falso nelas e o guard as barraria também. Elas
-- avisam por uma flag de transação (`is_local = true`, morre no COMMIT) — o
-- mesmo desenho de `app.cotacao_correcao` na migr. 467, e pela mesma razão: a
-- alternativa seria afrouxar o guard até ele não guardar mais nada.
--
-- Service role e o professor passam direto, como em `documento_sem_exclusao` e
-- na própria `conta_com_dinheiro_nao_exclui` — são quem conserta a base, e o
-- APAGAR TUDO (migr. 504-506) depende disso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O guard
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conta_de_pedido_nao_exclui()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_num text;
BEGIN
  -- Só a transição ativa → inativa.
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NEW;
  END IF;

  -- Conta avulsa (digitada em Financeiro, sem pedido atrás) não é assunto deste
  -- guard — quem cuida dela é `conta_com_dinheiro_nao_exclui`.
  IF OLD.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_service_role() OR public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  -- As duas RPCs que têm o direito de fazer isto se anunciam.
  IF COALESCE(current_setting('app.conta_pedido_baixa', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
    INTO v_num FROM public.pedidos p WHERE p.id = OLD.pedido_id;

  RAISE EXCEPTION
    'Esta conta nasceu do % — ela é a obrigação com o fornecedor, não um lançamento digitado aqui. Excluí-la deixaria a mercadoria no estoque, o fornecedor sem cobrança e o custo fora do resultado do período, sem nada na tela dizendo o porquê. Se a compra não vai acontecer, cancele o pedido em Compras > Pedidos (a conta é inativada junto); se a carga voltou, registre a devolução ao fornecedor em Estoque > Recebimentos.',
    COALESCE(v_num, 'pedido de compra')
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_conta_de_pedido_nao_exclui ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_pedido_nao_exclui
  BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_pedido_nao_exclui();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. cancelar_pedido_compra — a porta legítima se anuncia
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco, com uma linha a mais.
CREATE OR REPLACE FUNCTION public.cancelar_pedido_compra(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ped    public.pedidos;
  v_pagas  integer;
  v_contas integer;
  v_receb  integer;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_ped.filial), false) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_ped.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Este pedido ja esta cancelado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_receb FROM public.recebimentos r
   WHERE r.pedido_id = v_ped.id AND COALESCE(r.ativo, true) AND r.status <> 'Pendente';
  IF v_receb > 0 THEN
    RAISE EXCEPTION
      'Este pedido ja teve recebimento confirmado - a mercadoria entrou no estoque. Registre uma devolucao ao fornecedor em vez de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 'Parcial' conta como dinheiro que já saiu (migr. 427).
  SELECT count(*) INTO v_pagas FROM public.contas_pagar c
   WHERE c.pedido_id = v_ped.id AND COALESCE(c.ativo, true) AND c.status IN ('Pago', 'Parcial');
  IF v_pagas > 0 THEN
    RAISE EXCEPTION
      'Existe conta a pagar ja quitada ou com pagamento parcial para este pedido. Estorne o pagamento antes de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pedidos SET status = 'Cancelado' WHERE id = v_ped.id;

  -- MIGR 547: esta é uma das duas portas por onde a conta do pedido pode ser
  -- inativada. A flag morre no fim da transação (3º arg = true → is_local).
  PERFORM set_config('app.conta_pedido_baixa', 'true', true);

  UPDATE public.contas_pagar
     SET ativo = false
   WHERE pedido_id = v_ped.id AND COALESCE(ativo, true) AND status NOT IN ('Pago', 'Parcial');
  GET DIAGNOSTICS v_contas = ROW_COUNT;

  -- A requisicao volta a poder ser cotada. Sem isto ela fica 'Atendida' por um
  -- pedido cancelado: fora do dropdown de nova cotacao e impossivel de refazer.
  IF v_ped.requisicao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pedidos p
                      WHERE p.requisicao_id = v_ped.requisicao_id
                        AND p.id <> v_ped.id AND COALESCE(p.ativo, true)
                        AND p.status <> 'Cancelado') THEN
    UPDATE public.requisicoes SET status = 'Aprovado'
     WHERE id = v_ped.requisicao_id AND status = 'Atendida';
  END IF;

  RETURN jsonb_build_object('ok', true, 'contas_inativadas', v_contas, 'motivo', p_motivo);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. registrar_devolucao_fornecedor — a outra porta
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_devolucao_fornecedor(
  p_recebimento_id uuid, p_qtd numeric, p_motivo text,
  p_reenvio_esperado boolean DEFAULT true, p_observacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receb        recebimentos;
  v_pedido       pedidos;
  v_produto_id   uuid;
  v_ja_devolvido numeric;
  v_disponivel   numeric;
  v_unitario     numeric(15,4);
  v_valor        numeric(15,2);
  v_conta        contas_pagar;
  v_conta_novo   numeric(15,2);
  v_conta_efeito text := 'nenhum';
  v_saldo        numeric;
  v_pedido_fecha boolean := false;
  v_devolucao_id uuid;
  v_lote         record;
  v_restante     numeric;
  v_tira         numeric;
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
    RAISE EXCEPTION 'Este recebimento tem % disponível para devolução (recebeu %, já devolveu %).',
      trim_scale(v_disponivel), trim_scale(COALESCE(v_receb.qtd_recebida, 0)),
      trim_scale(v_ja_devolvido) USING ERRCODE = 'P0001';
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
                        'Devolvido ao fornecedor: ' || trim_scale(v_tira) || ' em ' ||
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
        -- MIGR 547: a segunda porta legítima. A flag morre no COMMIT.
        PERFORM set_config('app.conta_pedido_baixa', 'true', true);
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
$function$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Para o professor: as contas de pedido já inativadas fora das duas portas
-- ────────────────────────────────────────────────────────────────────────────
-- Não são restauradas automaticamente — reativar uma conta é criar uma
-- obrigação financeira, e isso é decisão de quem ensina, não de uma migração.
-- A consulta que as encontra (a de descrição terminada em "devolução ao
-- fornecedor" é legítima e fica de fora):
--
--   SELECT p.numero, p.status, c.valor, c.descricao
--     FROM contas_pagar c JOIN pedidos p ON p.id = c.pedido_id
--    WHERE c.ativo IS FALSE
--      AND c.status NOT IN ('Pago', 'Parcial')
--      AND p.status <> 'Cancelado'
--      AND c.descricao NOT LIKE '%devolução ao fornecedor%';
--
-- Para reativar uma delas:  UPDATE contas_pagar SET ativo = true WHERE id = '...';
