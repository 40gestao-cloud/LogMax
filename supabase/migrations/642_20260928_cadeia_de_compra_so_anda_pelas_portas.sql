-- 642_20260928_cadeia_de_compra_so_anda_pelas_portas.sql
--
-- Auditoria de 28/09 do fluxo Requisição → … → Confirmar recebimento. Pela
-- tela a cadeia está certa (28 sondas de consistência zeradas nas 4 turmas).
-- O furo era o F12: as RPCs cobram as regras, mas as policies deixavam gravar
-- nas mesmas tabelas por fora delas, e os gatilhos só vigiavam o STATUS.
-- Provado com o JWT de alunos da turma Contabilidade, em transação revertida:
--
--   1. Logística mudou valor (R$ 99.999) e fornecedor de cotação já APROVADA
--      pelo Financeiro — o pedido sairia com o valor novo, sem alçada.
--   2. Financeiro aprovou por UPDATE direto uma proposta vencida (a RPC
--      recusa), sem registrar quem aprovou nem cancelar as concorrentes.
--   3. Logística mudou quantidade e valor de pedido vivo (teto do recebimento
--      e custo médio), inseriu pedido sem cotação e APAGOU pedido de vez.
--   4. Financeiro desligou o pedido_id da conta e a pagou sem recebimento nem
--      nota; mudou o valor (500 → 1) e carimbou "nota conferida" à mão.
--   5. Entrada de 5.000 unidades contra um recebimento Pendente de 80.
--
-- E um defeito de ordem na tela: o Confirmar gravava a entrada no estoque
-- ANTES de o banco aceitar a confirmação; recusada a confirmação (segregação,
-- nota, data), o estoque ficava subido com o recebimento Pendente.
--
-- A validação desta migração achou mais dois, antigos:
--   6. Cancelar pedido falhava para quem compra: cancelar_pedido_compra
--      devolve a requisição de Atendida para Aprovado, e o guard da
--      requisição tratava isso como decisão de gerente. Nenhum pedido chegou
--      a ser cancelado nas 4 turmas.
--   7. Duas cargas registradas (80 + 70 de 150): confirmar a primeira fechava
--      o pedido e liberava a conta inteira, porque o status contava também a
--      carga ainda Pendente.
--
-- O QUE MUDA
--   • pedidos: a policy deixa de dar INSERT/DELETE (pedido nasce em
--     gerar_pedido_de_cotacao e sai por cancelar_pedido_compra, ambas SECURITY
--     DEFINER). fn_pedido_congela_compra congela o que foi comprado.
--   • cotacoes: fn_cotacao_aprovada_congela congela a proposta aprovada; o
--     guard exige decidir_cotacao para Aprovado/Negado (flag da sessão).
--   • contas_pagar: fn_conta_de_pedido_congela — pedido_id não se desliga, e
--     valor/nota de conta de pedido só mudam por conferir_nota_fiscal ou pela
--     devolução ao fornecedor (que já se anunciava por app.conta_pedido_baixa).
--   • recebimentos: a ENTRADA no estoque nasce no banco, na mesma transação
--     da confirmação (fn_recebimento_da_entrada). Recebimento conferido não
--     muda de quantidade nem de pedido (fn_recebimento_conferido_congela).
--   • movimentacoes_estoque: entrada manual ligada a recebimento só com a
--     quantidade dele (compatível com a PWA antiga, que ainda grava primeiro).
--   • requisicao_decisao_guard: Atendida → Aprovado sem pedido vivo passa.
--   • fn_recebimento_status_pelo_saldo fecha pelo CONFERIDO; v_pedido_saldo
--     ganha qtd_conferida (no fim) para a tela prever o mesmo status.
--
-- Quem passa por cima de tudo: service_role e o professor (role = 'admin'
-- literal, eh_perfil_admin) — é quem conserta base. auth_is_admin() NÃO serve:
-- inclui CEO e conselheiro, que são alunos.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ═══ 1. Funções existentes, com a inserção marcada "MIGR 642" ══════════════

CREATE OR REPLACE FUNCTION public.decidir_cotacao(p_cotacao_id uuid, p_decisao text, p_feedback text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cot        cotacoes;
  v_canceladas integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  -- MIGR 642: a decisão só vale por aqui. O guard da tabela recusa Aprovado /
  -- Negado gravado direto, que pulava a validade e o cancelamento das
  -- propostas concorrentes.
  PERFORM set_config('app.cotacao_decisao', 'true', true);

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisao = 'Negado' AND COALESCE(trim(p_feedback), '') = '' THEN
    RAISE EXCEPTION 'Reprovar exige motivo — é o que Compras lê para cotar de novo.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status <> 'Aguardando Financeiro' THEN
    RAISE EXCEPTION 'Esta cotação já está %.', v_cot.status USING ERRCODE = 'P0001';
  END IF;

  IF p_decisao = 'Aprovado'
     AND v_cot.validade IS NOT NULL
     AND v_cot.validade < public.acre_today() THEN
    RAISE EXCEPTION 'Esta proposta venceu em %. Preço vencido não se aprova: devolva para correção e peça a Compras revalidar com o fornecedor.',
      to_char(v_cot.validade, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.cotacoes
     SET status       = p_decisao,
         feedback     = NULLIF(trim(COALESCE(p_feedback, '')), ''),
         aprovado_por = auth.uid(),
         aprovado_em  = now()
   WHERE id = p_cotacao_id;

  IF p_decisao = 'Aprovado' AND v_cot.requisicao_id IS NOT NULL THEN
    UPDATE public.cotacoes
       SET status   = 'Cancelado',
           feedback = COALESCE(NULLIF(trim(COALESCE(feedback, '')), ''),
                               'Cancelada automaticamente: outra proposta foi aprovada para esta requisição.')
     WHERE requisicao_id = v_cot.requisicao_id
       AND id <> p_cotacao_id
       AND COALESCE(ativo, true)
       AND status = 'Aguardando Financeiro';
    GET DIAGNOSTICS v_canceladas = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decisao,
    'canceladas', v_canceladas,
    'requisicao_id', v_cot.requisicao_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.conferir_nota_fiscal(p_conta_id uuid, p_nf_valor numeric, p_observacao text DEFAULT NULL::text)
 RETURNS contas_pagar
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta       public.contas_pagar;
  v_pedido      public.pedidos;
  v_nf_numero   text;
  v_divergencia numeric;
  v_fixo        numeric(15,2);
  v_restante    numeric(15,2);
  v_n           integer;
  v_i           integer := 0;
  v_acum        numeric(15,2) := 0;
  v_parcela     numeric(15,2);
  v_row         record;
BEGIN
  PERFORM public._assert_rpc('financeiro');

  -- MIGR 642: valor e campos da nota de conta de pedido só mudam por aqui (e
  -- pela devolução ao fornecedor). `fn_conta_de_pedido_congela` recusa o resto.
  PERFORM set_config('app.conta_pedido_nf', 'true', true);

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF v_conta.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_conta.filial), false) THEN
    RAISE EXCEPTION 'Conta de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_conta.ativo, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Conta inativa.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.pedido_id IS NULL THEN
    RAISE EXCEPTION 'Esta conta não vem de pedido de compra — não há pedido nem nota para conferir.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.status = 'Pago' THEN
    RAISE EXCEPTION 'Conta já quitada — conferir a nota agora não mudaria o que saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_nf_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da nota fiscal.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = v_conta.pedido_id;

  SELECT MAX(r.nf_numero) INTO v_nf_numero
    FROM public.recebimentos r
   WHERE r.pedido_id = v_conta.pedido_id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');

  IF v_nf_numero IS NULL THEN
    RAISE EXCEPTION 'Ainda não há recebimento conferido com nota para este pedido. O estoque confere a carga e registra a nota antes de o financeiro conferir o valor.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Divergência entre o combinado e o cobrado. Não bloqueia — em compra real
  -- ela acontece (frete, imposto, reajuste, entrega a menor). O que não pode é
  -- passar calada.
  v_divergencia := p_nf_valor - COALESCE(v_pedido.valor_total, 0);
  IF abs(v_divergencia) > 0.005
     AND COALESCE(btrim(COALESCE(p_observacao, '')), '') = '' THEN
    RAISE EXCEPTION 'A nota (R$ %) não bate com o pedido (R$ %). Escreva o motivo da diferença antes de liberar o pagamento.',
      to_char(p_nf_valor, 'FM999G999G990D00'),
      to_char(COALESCE(v_pedido.valor_total, 0), 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 584: a nota cobre o pedido inteiro, e o pedido pode ter virado 2 ou 3
  -- títulos. Parcela que já recebeu dinheiro não se mexe (o que saiu do caixa
  -- saiu); o valor da nota se distribui entre as que ainda não foram tocadas.
  SELECT COALESCE(sum(valor), 0) INTO v_fixo
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND (COALESCE(valor_pago, 0) > 0 OR status IN ('Pago', 'Parcial'));

  SELECT count(*) INTO v_n
    FROM public.contas_pagar
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true)
     AND COALESCE(valor_pago, 0) = 0
     AND status NOT IN ('Pago', 'Parcial');

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Todas as parcelas deste pedido já têm pagamento. A diferença da nota tem de ser resolvida com o fornecedor, não reescrevendo o que já saiu do caixa.'
      USING ERRCODE = 'P0001';
  END IF;

  v_restante := ROUND(p_nf_valor - v_fixo, 2);
  IF v_restante <= 0 THEN
    RAISE EXCEPTION 'A nota (R$ %) é menor do que o que já foi pago deste pedido (R$ %). Confira o valor com o fornecedor.',
      to_char(p_nf_valor, 'FM999G999G990D00'), to_char(v_fixo, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT id FROM public.contas_pagar
     WHERE pedido_id = v_conta.pedido_id
       AND COALESCE(ativo, true)
       AND COALESCE(valor_pago, 0) = 0
       AND status NOT IN ('Pago', 'Parcial')
     ORDER BY vencimento, created_at
     FOR UPDATE
  LOOP
    v_i := v_i + 1;
    v_parcela := CASE WHEN v_i < v_n THEN ROUND(v_restante / v_n, 2)
                      ELSE v_restante - v_acum END;
    v_acum := v_acum + v_parcela;

    UPDATE public.contas_pagar
       SET valor = v_parcela
     WHERE id = v_row.id;
  END LOOP;

  -- A conferência é do documento: carimba em todas as parcelas vivas, para
  -- qualquer uma delas mostrar que a nota deste pedido já foi conferida.
  UPDATE public.contas_pagar
     SET nf_valor         = p_nf_valor,
         nf_conferida_em  = now(),
         nf_conferida_por = auth.uid(),
         nf_observacao    = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE pedido_id = v_conta.pedido_id
     AND COALESCE(ativo, true);

  SELECT * INTO v_conta FROM public.contas_pagar WHERE id = p_conta_id;
  RETURN v_conta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cotacao_decisao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limite numeric;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND 'Em correção' IN (NEW.status, OLD.status)
     AND NEW.status <> 'Cancelado'
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true'
     AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND (p.role IN ('admin', 'ceo', 'conselheiro')
               OR (p.role = 'gerente' AND p.is_conselheiro = true))
     ) THEN
    RAISE EXCEPTION 'Devolver para correção e reenviar passam pelas ações da tela de Cotações.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'Em correção'
     AND (NEW.valor_total IS DISTINCT FROM OLD.valor_total
          OR NEW.prazo_entrega IS DISTINCT FROM OLD.prazo_entrega)
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Use "Corrigir e reenviar" para alterar a proposta devolvida.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- MIGR 642: aprovar ou reprovar gravando o status direto pulava tudo o que
  -- decidir_cotacao cobra — validade viva, origem 'Aguardando Financeiro',
  -- quem aprovou e o cancelamento das outras propostas. Vale para todo cargo:
  -- o CEO também decide pelo botão. Só o professor passa (conserto de base).
  IF COALESCE(current_setting('app.cotacao_decisao', true), '') <> 'true'
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Aprovar ou reprovar cotação é pelo botão da tela de Cotações — é lá que a validade da proposta é conferida e as propostas concorrentes são canceladas.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = auth.uid()
       AND (p.role IN ('admin', 'ceo', 'conselheiro')
            OR (p.role = 'gerente' AND p.is_conselheiro = true))
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem cadastra a proposta não a aprova.'
      USING ERRCODE = '42501';
  END IF;

  SELECT valor_limite_financeiro INTO v_limite
    FROM public.alcadas_compra
   WHERE filial = NEW.filial AND COALESCE(ativo, true);

  IF v_limite IS NULL OR COALESCE(NEW.valor_total, 0) <= v_limite THEN
    IF NOT COALESCE(public.auth_in_setor('financeiro'), false) THEN
      RAISE EXCEPTION 'Dentro da alçada, quem decide a cotação é o Financeiro.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT COALESCE(public.auth_gerente_da(NEW.filial), false) THEN
      RAISE EXCEPTION 'Acima da alçada da filial, quem decide é o gerente (ou a Matriz).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mov_estoque_casa_com_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_produto_pedido uuid;
  v_numero         text;
  v_esperado       text;
  v_qtd_rec        numeric;
  v_rec_ativo      boolean;
BEGIN
  -- Movimentação que não vem de recebimento (venda, ajuste de inventário,
  -- requisição de material) não tem pedido pra comparar.
  IF NEW.recebimento_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- MIGR 642: a entrada de um recebimento nasce no banco, quando ele é
  -- confirmado (fn_recebimento_da_entrada, que se anuncia pela flag). Entrada
  -- digitada à parte só passa com a MESMA quantidade do recebimento ativo —
  -- antes, 5.000 unidades entravam contra um recebimento Pendente de 80. A
  -- porta fica entreaberta, e não fechada, pela PWA com o bundle antigo, que
  -- ainda grava a entrada antes de confirmar.
  IF COALESCE(NEW.tipo, '') = 'Entrada'
     AND COALESCE(current_setting('app.entrada_recebimento', true), '') <> 'true'
     AND NOT (public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid())) THEN
    SELECT r.qtd_recebida, COALESCE(r.ativo, true)
      INTO v_qtd_rec, v_rec_ativo
      FROM public.recebimentos r
     WHERE r.id = NEW.recebimento_id;
    IF v_rec_ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'Recebimento inexistente ou excluído — não há carga para dar entrada.'
        USING ERRCODE = 'P0001';
    END IF;
    IF abs(COALESCE(NEW.qtd, 0) - COALESCE(v_qtd_rec, 0)) > 0.0005 THEN
      RAISE EXCEPTION 'A entrada tem de ser a quantidade do recebimento (%), não %. A entrada de uma carga é feita pelo Confirmar em Estoque > Recebimentos.',
        trim_scale(COALESCE(v_qtd_rec, 0)), trim_scale(COALESCE(NEW.qtd, 0))
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT p.produto_id, COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
    INTO v_produto_pedido, v_numero
    FROM public.recebimentos r
    JOIN public.pedidos p ON p.id = r.pedido_id
   WHERE r.id = NEW.recebimento_id;

  -- Compra eventual (produto_id NULL) segue livre: não nasceu do catálogo,
  -- não há produto declarado pra cobrar.
  IF v_produto_pedido IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.produto_id IS DISTINCT FROM v_produto_pedido THEN
    SELECT nome INTO v_esperado FROM public.produtos WHERE id = v_produto_pedido;
    RAISE EXCEPTION
      'Entrada não confere com o pedido: % foi comprado para "%". Dê entrada nesse produto ou registre a divergência.',
      v_numero, COALESCE(v_esperado, 'produto do pedido')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requisicao_decisao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só a transição de decisão é gate. Demais updates seguem a policy.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- MIGR 642: Atendida → Aprovado não é decisão do gerente — é a requisição
  -- voltando à fila porque o pedido dela foi cancelado (cancelar_pedido_compra
  -- faz exatamente isto). Sem esta saída o guard recusava o cancelamento para
  -- quem compra, e nenhum pedido chegou a ser cancelado nas 4 turmas. Vale só
  -- quando não resta pedido vivo: a regra é o fato, não o cargo de quem grava.
  IF OLD.status = 'Atendida' AND NEW.status = 'Aprovado'
     AND NOT EXISTS (
       SELECT 1 FROM public.pedidos p
        WHERE p.requisicao_id = NEW.id
          AND COALESCE(p.ativo, true)
          AND p.status <> 'Cancelado'
     ) THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é do gerente da filial.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.auth_gerente_da(NEW.filial), false) THEN
    RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recebimento_status_pelo_saldo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedida   numeric;
  v_recebido numeric;
  v_reenvio  numeric;
  v_ja       numeric;
  v_total    numeric;
  v_saldo    numeric;
BEGIN
  IF COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;
  IF NEW.pedido_id IS NULL OR COALESCE(NEW.ativo, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT qtd_pedida, qtd_devolvida_reenvio
    INTO v_pedida, v_reenvio
    FROM public.v_pedido_saldo
   WHERE pedido_id = NEW.pedido_id;

  -- MIGR 642: fecha pelo que já foi CONFERIDO, não pelo que foi registrado.
  -- `qtd_recebida_total` soma também a carga ainda Pendente: com duas cargas
  -- lançadas (80 + 70 de 150), confirmar a primeira fechava o pedido e
  -- liberava a conta inteira com 70 unidades sem conferência. O registro
  -- continua contando a Pendente — é o teto de fn_recebimento_nao_estoura_pedido.
  SELECT COALESCE(sum(r.qtd_recebida), 0)
    INTO v_recebido
    FROM public.recebimentos r
   WHERE r.pedido_id = NEW.pedido_id
     AND r.id <> NEW.id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Concluído', 'Parcial');

  IF COALESCE(v_pedida, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- A própria linha já está fora da soma acima (r.id <> NEW.id).
  v_total := COALESCE(v_recebido, 0) + COALESCE(NEW.qtd_recebida, 0);
  v_saldo := (v_pedida + COALESCE(v_reenvio, 0)) - v_total;

  IF v_saldo <= 0.0005 THEN
    NEW.status              := 'Concluído';
    NEW.encerrado_com_saldo := false;
    NEW.motivo_encerramento := NULL;
  ELSIF COALESCE(NEW.encerrado_com_saldo, false) THEN
    IF COALESCE(btrim(NEW.motivo_encerramento), '') = '' THEN
      RAISE EXCEPTION 'Encerrar a entrega com saldo em aberto exige o motivo — escreva o que aconteceu com as % unidade(s) que faltam.',
        to_char(v_saldo, 'FM999999990.999') USING ERRCODE = 'P0001';
    END IF;
    NEW.status := 'Concluído';
  ELSE
    NEW.status              := 'Parcial';
    NEW.motivo_encerramento := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- MIGR 642: coluna nova no FIM (CREATE OR REPLACE VIEW não aceita outra
-- posição). O REPLACE derruba security_invoker; ele volta logo abaixo.
CREATE OR REPLACE VIEW public.v_pedido_saldo AS
 SELECT p.id AS pedido_id,
    p.filial,
    COALESCE(p.item_qtd, (0)::numeric) AS qtd_pedida,
    COALESCE(sum(r.qtd_recebida) FILTER (WHERE (r.ativo = true)), (0)::numeric) AS qtd_recebida_total,
    GREATEST(((COALESCE(p.item_qtd, (0)::numeric) - COALESCE(sum(r.qtd_recebida) FILTER (WHERE (r.ativo = true)), (0)::numeric)) + COALESCE(( SELECT sum(d.qtd) AS sum
           FROM devolucoes_fornecedor d
          WHERE ((d.pedido_id = p.id) AND d.ativo AND d.reenvio_esperado)), (0)::numeric)), (0)::numeric) AS qtd_saldo,
    COALESCE(( SELECT sum(d.qtd) AS sum
           FROM devolucoes_fornecedor d
          WHERE ((d.pedido_id = p.id) AND d.ativo)), (0)::numeric) AS qtd_devolvida,
    COALESCE(( SELECT sum(d.qtd) AS sum
           FROM devolucoes_fornecedor d
          WHERE ((d.pedido_id = p.id) AND d.ativo AND d.reenvio_esperado)), (0)::numeric) AS qtd_devolvida_reenvio,
    COALESCE(sum(r.qtd_recebida) FILTER (WHERE ((r.ativo = true) AND (r.status = ANY (ARRAY['Concluído'::text, 'Parcial'::text])))), (0)::numeric) AS qtd_conferida
   FROM (pedidos p
     LEFT JOIN recebimentos r ON ((r.pedido_id = p.id)))
  WHERE (p.ativo = true)
  GROUP BY p.id, p.filial, p.item_qtd;
ALTER VIEW public.v_pedido_saldo SET (security_invoker = true);

-- ═══ 2. Pedido: nasce e sai só pelas RPCs; o que foi comprado não muda ══════

DROP POLICY IF EXISTS compras_all    ON public.pedidos;
DROP POLICY IF EXISTS compras_select ON public.pedidos;
DROP POLICY IF EXISTS compras_update ON public.pedidos;

-- Mesma expressão da antiga compras_all, agora só para ler e para mudar de
-- status. Sem INSERT (pedido sem cotação e sem conta a pagar) e sem DELETE
-- (a conta ficava viva com pedido_id nulo e fugia do three-way match).
CREATE POLICY compras_select ON public.pedidos
  FOR SELECT TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

CREATE POLICY compras_update ON public.pedidos
  FOR UPDATE TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

CREATE OR REPLACE FUNCTION public.fn_pedido_congela_compra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- O pedido é o que a cotação aprovada disse. Quantidade é o teto do
  -- recebimento e, com o valor, o custo médio da entrada; produto e
  -- fornecedor são o que o almoxarifado e o financeiro conferem. Status e
  -- prazo seguem livres (Em Entrega, Recebido, prazo renegociado).
  IF NEW.item_qtd           IS DISTINCT FROM OLD.item_qtd
  OR NEW.valor_total        IS DISTINCT FROM OLD.valor_total
  OR NEW.produto_id         IS DISTINCT FROM OLD.produto_id
  OR NEW.servico_id         IS DISTINCT FROM OLD.servico_id
  OR NEW.fornecedor_id      IS DISTINCT FROM OLD.fornecedor_id
  OR NEW.cotacao_id         IS DISTINCT FROM OLD.cotacao_id
  OR NEW.requisicao_id      IS DISTINCT FROM OLD.requisicao_id
  OR NEW.item_descricao     IS DISTINCT FROM OLD.item_descricao
  OR NEW.condicao_pagamento IS DISTINCT FROM OLD.condicao_pagamento
  OR NEW.filial             IS DISTINCT FROM OLD.filial
  OR NEW.numero             IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O pedido % é o que a cotação aprovada fechou: item, quantidade, valor e fornecedor não mudam depois de emitido. Se a compra mudou, cancele o pedido em Compras > Pedidos e refaça a cotação.',
      COALESCE(OLD.numero, 'de compra')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_congela_compra ON public.pedidos;
CREATE TRIGGER trg_pedido_congela_compra
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_congela_compra();

-- ═══ 3. Cotação aprovada é o que o Financeiro aprovou ═══════════════════════

CREATE OR REPLACE FUNCTION public.fn_cotacao_aprovada_congela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'Aprovado' THEN
    RETURN NEW;
  END IF;
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Mudar a proposta depois do "sim" é aprovar outra coisa sem ninguém
  -- aprovar. Reabrir (volta a 'Aguardando Financeiro', mesmos valores) e
  -- cancelar continuam — é o caminho de quem precisa mudar.
  IF NEW.valor_total        IS DISTINCT FROM OLD.valor_total
  OR NEW.fornecedor_id      IS DISTINCT FROM OLD.fornecedor_id
  OR NEW.requisicao_id      IS DISTINCT FROM OLD.requisicao_id
  OR NEW.condicao_pagamento IS DISTINCT FROM OLD.condicao_pagamento
  OR NEW.prazo_entrega      IS DISTINCT FROM OLD.prazo_entrega
  OR NEW.validade           IS DISTINCT FROM OLD.validade
  OR NEW.marca              IS DISTINCT FROM OLD.marca
  OR NEW.filial             IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'A cotação % já foi aprovada: valor, fornecedor e condições são os que o Financeiro aprovou. Para mudar, reabra a cotação — ela volta para a decisão do Financeiro.',
      COALESCE(OLD.numero, '')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cotacao_aprovada_congela ON public.cotacoes;
CREATE TRIGGER trg_cotacao_aprovada_congela
  BEFORE UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_cotacao_aprovada_congela();

-- ═══ 4. Conta de pedido: valor e nota só pela conferência ═══════════════════

CREATE OR REPLACE FUNCTION public.fn_conta_de_pedido_congela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  -- As RPCs que têm esse direito se anunciam: conferir_nota_fiscal
  -- (app.conta_pedido_nf), devolução e cancelamento (app.conta_pedido_baixa).
  IF COALESCE(current_setting('app.conta_pedido_nf', true), '') = 'true'
     OR COALESCE(current_setting('app.conta_pedido_baixa', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Desligar o pedido era o atalho para pagar sem recebimento nem nota: a
  -- trava do pagamento só olha conta com pedido_id. Ligar uma conta avulsa a
  -- um pedido também não — conta de pedido nasce na emissão do pedido.
  IF NEW.pedido_id IS DISTINCT FROM OLD.pedido_id THEN
    RAISE EXCEPTION 'O vínculo da conta com o pedido de compra não se muda: é por ele que o pagamento exige a carga conferida e a nota.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.valor            IS DISTINCT FROM OLD.valor
  OR NEW.nf_valor         IS DISTINCT FROM OLD.nf_valor
  OR NEW.nf_conferida_em  IS DISTINCT FROM OLD.nf_conferida_em
  OR NEW.nf_conferida_por IS DISTINCT FROM OLD.nf_conferida_por
  OR NEW.nf_observacao    IS DISTINCT FROM OLD.nf_observacao
  OR NEW.fornecedor_id    IS DISTINCT FROM OLD.fornecedor_id
  OR NEW.filial           IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'Esta conta é de um pedido de compra: o valor passa a ser o da nota fiscal, e isso se faz em "Conferir nota" — que confronta pedido, recebimento e nota. Se a carga voltou, registre a devolução em Estoque > Recebimentos.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_de_pedido_congela ON public.contas_pagar;
CREATE TRIGGER trg_conta_de_pedido_congela
  BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_conta_de_pedido_congela();

-- ═══ 5. Recebimento: a entrada nasce na confirmação ═════════════════════════

CREATE OR REPLACE FUNCTION public.fn_recebimento_da_entrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ped public.pedidos;
BEGIN
  IF COALESCE(NEW.ativo, true) IS NOT TRUE
     OR COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NULL;
  END IF;
  -- Só na passagem para conferido (ou na reativação de um conferido, espelho
  -- do estorno de fn_recebimento_inativo_estorna_entrada). Editar a nota de
  -- um recebimento já conferido não dá outra entrada.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.ativo, true)
     AND COALESCE(OLD.status, '') IN ('Concluído', 'Parcial') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = NEW.pedido_id;
  -- Serviço não tem saldo; o aceite só libera o pagamento.
  IF v_ped.produto_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A PWA com o bundle antigo grava a entrada ANTES de confirmar. Ela já
  -- está lá: não duplica (uq_mov_estoque_por_recebimento recusaria mesmo).
  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque
              WHERE recebimento_id = NEW.id AND COALESCE(ativo, true)) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.entrada_recebimento', 'true', true);
  INSERT INTO public.movimentacoes_estoque (
    produto_id, tipo, qtd, origem, destino, data, recebimento_id, filial
  ) VALUES (
    v_ped.produto_id, 'Entrada', NEW.qtd_recebida,
    COALESCE(v_ped.numero, 'Pedido #' || upper(right(v_ped.id::text, 6))),
    'Almoxarifado', public.acre_today(), NEW.id, NEW.filial
  );
  PERFORM set_config('app.entrada_recebimento', '', true);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimento_da_entrada ON public.recebimentos;
CREATE TRIGGER trg_recebimento_da_entrada
  AFTER INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_da_entrada();

CREATE OR REPLACE FUNCTION public.fn_recebimento_conferido_congela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (COALESCE(OLD.ativo, true) AND COALESCE(NEW.ativo, true))
     OR COALESCE(OLD.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  -- A entrada no estoque foi desta quantidade, deste pedido. Mudar um sem o
  -- outro deixaria saldo e recebimento contando histórias diferentes.
  IF NEW.qtd_recebida IS DISTINCT FROM OLD.qtd_recebida
  OR NEW.pedido_id    IS DISTINCT FROM OLD.pedido_id THEN
    RAISE EXCEPTION 'Este recebimento já foi conferido e a mercadoria entrou no estoque — a quantidade não muda mais. Se veio a mais, registre a devolução ao fornecedor na própria linha.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimento_conferido_congela ON public.recebimentos;
CREATE TRIGGER trg_recebimento_conferido_congela
  BEFORE UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_conferido_congela();

-- Funções de gatilho não são chamáveis pela API; o REVOKE é higiene (o
-- Supabase concede EXECUTE a anon/authenticated em toda função nova).
REVOKE ALL ON FUNCTION public.fn_pedido_congela_compra()          FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_cotacao_aprovada_congela()       FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_conta_de_pedido_congela()        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_recebimento_da_entrada()         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_recebimento_conferido_congela()  FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
