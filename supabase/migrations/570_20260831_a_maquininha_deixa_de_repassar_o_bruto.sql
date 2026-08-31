-- A maquininha deixa de repassar o valor cheio.
--
-- Fecha o elo que a migr. 568 deixou aberto de propósito: a taxa da adquirente
-- era CALCULADA e MOSTRADA na proposta, mas não virava lançamento nenhum. O
-- aluno via "a loja recebe R$ 1.074,00" na tela do orçamento e, na hora de dar
-- baixa no título, o Financeiro creditava R$ 1.107,22 no banco. O número da
-- proposta e o número do extrato não se encontravam.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ACONTECE NA VIDA REAL
--
-- A loja vende R$ 1.000 no cartão. Ela NÃO recebe R$ 1.000 amanhã. A
-- adquirente (Cielo, Rede, Stone) desconta o MDR e deposita o líquido, na data
-- de repasse, num lote que junta várias vendas. Conciliar é sentar com o
-- extrato do banco de um lado e o sistema do outro e casar os dois.
--
-- Contabilmente são DOIS lançamentos, e é isso que esta migração passa a
-- fazer:
--
--   1. a receita entra pelo BRUTO — o título é baixado pelo valor cheio, como
--      qualquer outro; a venda foi de R$ 1.000;
--   2. a taxa sai como DESPESA — uma conta a pagar já quitada no mesmo banco.
--
-- O saldo do banco fecha no líquido (bruto − taxa) porque os dois gatilhos de
-- saldo já existentes fazem as duas pontas. E o DRE passa a enxergar a taxa
-- onde ela tem de aparecer: no resultado, como custo de vender no cartão. Se a
-- gente simplesmente creditasse o líquido, a receita da loja encolheria e a
-- despesa nunca existiria — que é o erro que o aluno aprenderia sem perceber.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A SELEÇÃO É MANUAL
--
-- O lote junta os títulos que a adquirente repassou naquele dia, e quem diz
-- quais são é o extrato. O sistema SUGERE (título de cartão, vencido até a
-- data do repasse, em aberto) e a pessoa confirma. Isso não é preguiça de
-- automatizar: casar extrato com sistema É o exercício, e é o que se faz numa
-- loja de verdade.
--
-- Tecnicamente também é a única saída honesta. O orçamento carimba
-- `forma_pagamento_id` no título (esta migração), então o que vem de proposta
-- comercial já nasce identificado. O PDV, não: ele grava `forma_pagamento`
-- como TEXTO livre ("Misto: Dinheiro R$ 50,00 + Cartão Crédito R$ 200,00"), e
-- deduzir a forma desse texto é exatamente a armadilha que a migr. 562 teve de
-- desfazer no caixa. `criar_venda_pdv` tem 10 KB e é o caminho de toda venda
-- das 4 turmas — não se reescreve por causa disto (mesmo raciocínio da 415).
-- Então o título do PDV entra no lote pela mão de quem concilia.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A BAIXA É A QUE JÁ EXISTE
--
-- `conciliar_maquininha` NÃO reimplementa baixa: ela chama
-- `baixar_conta_receber` título a título. Toda a régua que já está lá — banco
-- da mesma unidade, permissão de Financeiro/gerente, encargos por atraso,
-- linha em `contas_receber_baixas` — vale igual. Duas réguas para a mesma
-- coisa divergem no primeiro ajuste.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E SE ERRAR O LOTE
--
-- `cancelar_conciliacao_maquininha` desfaz: apaga as baixas que ELE criou
-- (guardadas uma a uma em `conciliacao_maquininha_itens.baixa_id`, não
-- adivinhadas depois), recompõe `valor_pago`/`status` de cada título a partir
-- do que sobrou, e apaga a conta a pagar da taxa. Os gatilhos de saldo
-- devolvem o dinheiro ao banco nas duas pontas, porque são simétricos.
--
-- Sem isso, um lote montado errado numa turma de 30 alunos seria irreversível
-- — e o sistema não tem estorno de baixa avulsa para socorrer.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. O título sabe em que forma de pagamento nasceu
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS forma_pagamento_id uuid REFERENCES public.formas_pagamento(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contas_receber.forma_pagamento_id IS
  'Forma de pagamento que originou o título (migr. 570). Preenchido pela conversão de orçamento; NULL no que vem do PDV, que grava a forma como texto livre.';

CREATE INDEX IF NOT EXISTS idx_contas_receber_forma_pagamento
  ON public.contas_receber(forma_pagamento_id) WHERE ativo;

-- Os títulos que a migr. 569 já gerou herdam o carimbo do orçamento de origem.
UPDATE public.contas_receber cr
   SET forma_pagamento_id = o.forma_pagamento_id
  FROM public.pedidos_venda pv
  JOIN public.orcamentos o ON o.id = pv.orcamento_id
 WHERE cr.pedido_venda_id = pv.id
   AND cr.forma_pagamento_id IS NULL
   AND o.forma_pagamento_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O lote de repasse
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.conciliacoes_maquininha (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  filial             text          NOT NULL,
  forma_pagamento_id uuid          REFERENCES public.formas_pagamento(id) ON DELETE SET NULL,
  forma_pagamento    text          NOT NULL,
  banco_id           uuid          NOT NULL REFERENCES public.caixa_bancos(id),
  data_repasse       date          NOT NULL DEFAULT public.acre_today(),
  taxa_percentual    numeric(6,3)  NOT NULL DEFAULT 0,
  valor_bruto        numeric(15,2) NOT NULL DEFAULT 0,
  valor_taxa         numeric(15,2) NOT NULL DEFAULT 0,
  valor_liquido      numeric(15,2) NOT NULL DEFAULT 0,
  qtd_titulos        integer       NOT NULL DEFAULT 0,
  conta_pagar_id     uuid          REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  status             text          NOT NULL DEFAULT 'Conciliado'
                                   CHECK (status IN ('Conciliado', 'Cancelado')),
  observacoes        text,
  cancelado_em       timestamptz,
  cancelado_por      uuid,
  motivo_cancelamento text,
  ativo              boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  criado_por         uuid,
  atualizado_por     uuid,
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conciliacoes_maquininha IS
  'Lote de repasse da adquirente: o que ela depositou, de quais títulos, com que taxa. Escrita só via conciliar_maquininha().';
COMMENT ON COLUMN public.conciliacoes_maquininha.valor_bruto IS
  'Soma do que os títulos deviam. É a receita — entra cheia no banco.';
COMMENT ON COLUMN public.conciliacoes_maquininha.valor_taxa IS
  'MDR retido pela adquirente. Vira conta a pagar quitada (conta_pagar_id), e é ela que o DRE lê como despesa.';
COMMENT ON COLUMN public.conciliacoes_maquininha.valor_liquido IS
  'O que sobra no banco depois dos dois lançamentos. Confere com o extrato.';

CREATE TABLE IF NOT EXISTS public.conciliacao_maquininha_itens (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  conciliacao_id   uuid          NOT NULL REFERENCES public.conciliacoes_maquininha(id) ON DELETE CASCADE,
  conta_receber_id uuid          NOT NULL REFERENCES public.contas_receber(id) ON DELETE CASCADE,
  baixa_id         uuid,
  descricao        text,
  valor_bruto      numeric(15,2) NOT NULL DEFAULT 0,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (conciliacao_id, conta_receber_id)
);

COMMENT ON COLUMN public.conciliacao_maquininha_itens.baixa_id IS
  'A linha de contas_receber_baixas que ESTE lote criou. Guardada aqui para o cancelamento apagar exatamente ela, e não a baixa mais recente do título.';

CREATE INDEX IF NOT EXISTS idx_conciliacoes_maq_filial_data
  ON public.conciliacoes_maquininha(filial, data_repasse DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_conciliacao_maq_itens_conta
  ON public.conciliacao_maquininha_itens(conta_receber_id);

-- ── Carimbos de auditoria e trilha do documento ─────────────────────────────
DROP TRIGGER IF EXISTS trg_auditoria ON public.conciliacoes_maquininha;
CREATE TRIGGER trg_auditoria
  BEFORE INSERT OR UPDATE ON public.conciliacoes_maquininha
  FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_historico ON public.conciliacoes_maquininha;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.conciliacoes_maquininha
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'valor_bruto', 'valor_taxa', 'valor_liquido', 'status');

-- ── RLS: mesma régua de contas_receber ──────────────────────────────────────
-- `auth_in_setor` já devolve true para admin (ele chama auth_is_admin por
-- dentro), então a política é idêntica à da tabela que ela movimenta.
ALTER TABLE public.conciliacoes_maquininha      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_maquininha_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fin_select ON public.conciliacoes_maquininha;
CREATE POLICY fin_select ON public.conciliacoes_maquininha
  FOR SELECT TO authenticated
  USING (COALESCE(
    (public.auth_in_setor('financeiro') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial), false));

DROP POLICY IF EXISTS fin_update ON public.conciliacoes_maquininha;
CREATE POLICY fin_update ON public.conciliacoes_maquininha
  FOR UPDATE TO authenticated
  USING (COALESCE(
    (public.auth_in_setor('financeiro') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial), false))
  WITH CHECK (COALESCE(
    (public.auth_in_setor('financeiro') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial), false));

-- Sem policy de INSERT/DELETE: quem escreve é a RPC (SECURITY DEFINER). Lote
-- montado a mão pela tela seria dinheiro entrando sem baixa nenhuma do outro
-- lado.

DROP POLICY IF EXISTS fin_select ON public.conciliacao_maquininha_itens;
CREATE POLICY fin_select ON public.conciliacao_maquininha_itens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conciliacoes_maquininha c
     WHERE c.id = conciliacao_id
       AND COALESCE(
         (public.auth_in_setor('financeiro') OR public.auth_gerente_da(c.filial))
         AND public.auth_pode_filial(c.filial), false)));

-- Tabela nova nasce com GRANT para anon no Supabase.
REVOKE ALL ON TABLE public.conciliacoes_maquininha      FROM anon;
REVOKE ALL ON TABLE public.conciliacao_maquininha_itens FROM anon;
GRANT SELECT, UPDATE ON TABLE public.conciliacoes_maquininha      TO authenticated;
GRANT SELECT         ON TABLE public.conciliacao_maquininha_itens TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Conciliar
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conciliar_maquininha(
  p_forma_pagamento_id uuid,
  p_banco_id           uuid,
  p_contas             uuid[],
  p_data_repasse       date DEFAULT NULL,
  p_observacoes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  f              public.formas_pagamento;
  v_filial       text;
  v_banco_filial text;
  v_banco_ok     boolean;
  v_data         date;
  v_conta        public.contas_receber;
  v_calc         jsonb;
  v_devido       numeric(15,2);
  v_bruto        numeric(15,2) := 0;
  v_taxa         numeric(15,2);
  v_liquido      numeric(15,2);
  v_qtd          integer := 0;
  v_lote_id      uuid;
  v_baixa_id     uuid;
  v_cp_id        uuid;
  c              uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_forma_pagamento_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a forma de pagamento do repasse.' USING ERRCODE = 'P0001';
  END IF;
  IF p_banco_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária em que o repasse caiu.' USING ERRCODE = 'P0001';
  END IF;
  IF p_contas IS NULL OR array_length(p_contas, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos um título para conciliar.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO f FROM public.formas_pagamento
   WHERE id = p_forma_pagamento_id AND COALESCE(ativo, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forma de pagamento não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_filial := COALESCE(f.filial, 'Matriz');
  v_data   := COALESCE(p_data_repasse, public.acre_today());

  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Forma de pagamento de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(
       public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_filial), false) THEN
    RAISE EXCEPTION 'Só o Financeiro ou o gerente da filial concilia repasse de maquininha.'
      USING ERRCODE = '42501';
  END IF;

  SELECT filial, true INTO v_banco_filial, v_banco_ok
    FROM public.caixa_bancos
   WHERE id = p_banco_id AND COALESCE(ativo, true);
  IF NOT COALESCE(v_banco_ok, false) THEN
    RAISE EXCEPTION 'Conta bancária não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_banco_filial IS NOT NULL AND v_banco_filial IS DISTINCT FROM v_filial THEN
    RAISE EXCEPTION 'O destino escolhido é caixa/banco de % e o repasse é de %.',
      v_banco_filial, v_filial USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conciliacoes_maquininha (
    filial, forma_pagamento_id, forma_pagamento, banco_id, data_repasse,
    taxa_percentual, observacoes
  ) VALUES (
    v_filial, f.id, f.descricao, p_banco_id, v_data,
    COALESCE(f.taxa, 0), NULLIF(btrim(COALESCE(p_observacoes, '')), '')
  )
  RETURNING id INTO v_lote_id;

  -- DISTINCT + ORDER BY: o mesmo título mandado duas vezes no array não é
  -- baixado duas vezes, e a ordem fixa evita deadlock entre dois alunos
  -- conciliando lotes que se cruzam (mesma lição da migr. 470).
  FOR c IN SELECT DISTINCT u FROM unnest(p_contas) AS u WHERE u IS NOT NULL ORDER BY 1 LOOP
    SELECT * INTO v_conta FROM public.contas_receber
     WHERE id = c AND COALESCE(ativo, true) FOR UPDATE;

    IF v_conta.id IS NULL THEN
      RAISE EXCEPTION 'Título não encontrado no lote.' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_conta.filial, 'Matriz') IS DISTINCT FROM v_filial THEN
      RAISE EXCEPTION 'O título "%" é da unidade %, e o repasse é de %.',
        v_conta.descricao, COALESCE(v_conta.filial, 'Matriz'), v_filial USING ERRCODE = 'P0001';
    END IF;
    IF v_conta.status IN ('Pago', 'Recebido') THEN
      RAISE EXCEPTION 'O título "%" já está quitado — refaça a seleção.', v_conta.descricao
        USING ERRCODE = 'P0001';
    END IF;
    IF v_conta.status = 'Cancelado' THEN
      RAISE EXCEPTION 'O título "%" está cancelado.', v_conta.descricao USING ERRCODE = 'P0001';
    END IF;

    v_calc   := public.calcular_valor_atualizado('receber', c);
    v_devido := ROUND(COALESCE((v_calc->>'total')::numeric, 0), 2);
    IF v_devido <= 0 THEN
      RAISE EXCEPTION 'O título "%" não tem saldo em aberto.', v_conta.descricao
        USING ERRCODE = 'P0001';
    END IF;

    -- A baixa é a que já existe. Toda a régua vive lá.
    PERFORM public.baixar_conta_receber(c, p_banco_id, v_devido);

    -- A linha que ACABAMOS de criar — estamos dentro da mesma transação.
    SELECT b.id INTO v_baixa_id
      FROM public.contas_receber_baixas b
     WHERE b.conta_id = c
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT 1;

    INSERT INTO public.conciliacao_maquininha_itens (
      conciliacao_id, conta_receber_id, baixa_id, descricao, valor_bruto
    ) VALUES (
      v_lote_id, c, v_baixa_id, v_conta.descricao, v_devido
    );

    v_bruto := v_bruto + v_devido;
    v_qtd   := v_qtd + 1;
  END LOOP;

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um título para conciliar.' USING ERRCODE = 'P0001';
  END IF;

  v_taxa    := ROUND(v_bruto * COALESCE(f.taxa, 0) / 100, 2);
  v_liquido := v_bruto - v_taxa;

  -- A taxa vira despesa paga no mesmo banco. Sem centro de custo de
  -- propósito: classificar é a aula (mesma decisão da migr. 425 — o que
  -- ninguém classificou aparece como "Não classificado" no DRE).
  IF v_taxa > 0 THEN
    INSERT INTO public.contas_pagar (
      descricao, valor, vencimento, status, filial, banco_id,
      valor_pago, pago_em, natureza, origem
    ) VALUES (
      format('Taxa da adquirente — %s — repasse de %s (%s título(s))',
             f.descricao, to_char(v_data, 'DD/MM/YYYY'), v_qtd),
      v_taxa, v_data, 'Pago', v_filial, p_banco_id,
      v_taxa, v_data, 'despesa', 'conciliacao_maquininha'
    )
    RETURNING id INTO v_cp_id;
  END IF;

  UPDATE public.conciliacoes_maquininha
     SET valor_bruto    = v_bruto,
         valor_taxa     = v_taxa,
         valor_liquido  = v_liquido,
         qtd_titulos    = v_qtd,
         conta_pagar_id = v_cp_id
   WHERE id = v_lote_id;

  RETURN jsonb_build_object(
    'id',            v_lote_id,
    'qtd_titulos',   v_qtd,
    'valor_bruto',   v_bruto,
    'taxa_percentual', COALESCE(f.taxa, 0),
    'valor_taxa',    v_taxa,
    'valor_liquido', v_liquido,
    'conta_pagar_id', v_cp_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.conciliar_maquininha(uuid, uuid, uuid[], date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conciliar_maquininha(uuid, uuid, uuid[], date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.conciliar_maquininha(uuid, uuid, uuid[], date, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Desfazer o lote
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancelar_conciliacao_maquininha(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lote     public.conciliacoes_maquininha;
  v_item     record;
  v_baixa    public.contas_receber_baixas;
  v_restante numeric(15,2);
  v_desfeito integer := 0;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_lote FROM public.conciliacoes_maquininha
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Conciliação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_lote.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Esta conciliação já foi cancelada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_lote.filial), false) THEN
    RAISE EXCEPTION 'Conciliação de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(
       public.auth_in_setor('financeiro') OR public.auth_gerente_da(v_lote.filial), false) THEN
    RAISE EXCEPTION 'Só o Financeiro ou o gerente da filial cancela conciliação.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_item IN
    SELECT * FROM public.conciliacao_maquininha_itens
     WHERE conciliacao_id = v_lote.id
     ORDER BY conta_receber_id
  LOOP
    -- Sem a baixa registrada não há o que desfazer com segurança: apagar "a
    -- mais recente" poderia levar embora um recebimento que outra pessoa
    -- lançou depois.
    CONTINUE WHEN v_item.baixa_id IS NULL;

    SELECT * INTO v_baixa FROM public.contas_receber_baixas
     WHERE id = v_item.baixa_id AND conta_id = v_item.conta_receber_id;
    CONTINUE WHEN v_baixa.id IS NULL;

    DELETE FROM public.contas_receber_baixas WHERE id = v_baixa.id;

    SELECT COALESCE(SUM(total), 0) INTO v_restante
      FROM public.contas_receber_baixas WHERE conta_id = v_item.conta_receber_id;

    UPDATE public.contas_receber
       SET valor_pago = v_restante,
           status     = CASE WHEN v_restante > 0 THEN 'Parcial' ELSE 'Aberto' END,
           juros_pago = GREATEST(COALESCE(juros_pago, 0) - COALESCE(v_baixa.juros, 0), 0),
           multa_pago = GREATEST(COALESCE(multa_pago, 0) - COALESCE(v_baixa.multa, 0), 0),
           pago_em    = NULL,
           updated_at = now()
     WHERE id = v_item.conta_receber_id;

    v_desfeito := v_desfeito + 1;
  END LOOP;

  -- A conta a pagar da taxa nasceu deste lote e não tem outro dono: apagá-la
  -- devolve o valor ao banco pelo gatilho de saldo. `conta_com_dinheiro_nao_exclui`
  -- guarda o UPDATE de `ativo`, não o DELETE — e aqui é DELETE com WHERE por id.
  IF v_lote.conta_pagar_id IS NOT NULL THEN
    DELETE FROM public.contas_pagar
     WHERE id = v_lote.conta_pagar_id
       AND origem = 'conciliacao_maquininha';
  END IF;

  UPDATE public.conciliacoes_maquininha
     SET status              = 'Cancelado',
         conta_pagar_id      = NULL,
         cancelado_em        = now(),
         cancelado_por       = auth.uid(),
         motivo_cancelamento = NULLIF(btrim(COALESCE(p_motivo, '')), ''),
         updated_at          = now()
   WHERE id = v_lote.id;

  RETURN jsonb_build_object(
    'ok',                true,
    'titulos_reabertos', v_desfeito,
    'valor_devolvido',   v_lote.valor_liquido
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_conciliacao_maquininha(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_conciliacao_maquininha(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancelar_conciliacao_maquininha(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. A conversão do orçamento carimba a forma no título
-- ════════════════════════════════════════════════════════════════════════════
-- Única diferença para o corpo da migr. 569: `forma_pagamento_id` entra no
-- INSERT de `contas_receber`. É o que faz o lote conseguir SUGERIR os títulos
-- em vez de despejar a lista inteira de contas em aberto.

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_pedido(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc           public.orcamentos;
  v_pedido_id     uuid;
  v_conta_id      uuid;
  v_primeira      uuid;
  v_cliente_nome  text;
  v_desc          text;
  v_msg           text;
  v_vencimento    date;
  v_vivo          uuid;
  f               public.formas_pagamento;
  v_parcelas      integer;
  v_prazo         integer := 30;
  v_intervalo     integer := 30;
  v_parcela       numeric(12,2);
  v_acum          numeric(12,2) := 0;
  v_valor         numeric(12,2);
  v_total         numeric(12,2);
  v_limite        numeric(15,2);
  v_saldo         numeric(15,2);
  v_vencidos      integer;
  i               integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF v_orc.pedido_venda_id IS NOT NULL THEN
    SELECT pv.id INTO v_vivo
      FROM public.pedidos_venda pv
     WHERE pv.id = v_orc.pedido_venda_id
       AND COALESCE(pv.ativo, true)
       AND pv.status <> 'Cancelado';

    IF v_vivo IS NOT NULL THEN
      RETURN v_vivo;
    END IF;

    UPDATE public.orcamentos
       SET pedido_venda_id = NULL
     WHERE id = v_orc.id;
    v_orc.pedido_venda_id := NULL;
    IF v_orc.status = 'Convertido em Pedido' THEN
      v_orc.status := 'Aprovado Cliente';
    END IF;
  END IF;

  IF v_orc.status <> 'Aprovado Cliente' THEN
    RAISE EXCEPTION 'Só é possível converter orçamentos aprovados pelo cliente. Status atual: %.', v_orc.status
      USING ERRCODE = 'P0001';
  END IF;

  v_total    := round(COALESCE(v_orc.valor_total, 0), 2);
  v_parcelas := GREATEST(1, COALESCE(v_orc.parcelas, 1));

  IF v_orc.forma_pagamento_id IS NOT NULL THEN
    SELECT * INTO f FROM public.formas_pagamento
     WHERE id = v_orc.forma_pagamento_id AND COALESCE(ativo, true);

    IF FOUND THEN
      v_prazo     := GREATEST(0, COALESCE(f.prazo, 0));
      v_intervalo := GREATEST(1, COALESCE(f.intervalo_dias, 30));

      IF COALESCE(f.exige_limite_credito, false) THEN
        IF v_orc.cliente_id IS NULL THEN
          RAISE EXCEPTION 'Venda no crediário precisa de cliente identificado — sem devedor não há crédito.'
            USING ERRCODE = 'P0001';
        END IF;

        v_vencidos := public.cliente_titulos_vencidos(v_orc.cliente_id);
        IF COALESCE(v_vencidos, 0) > 0 THEN
          RAISE EXCEPTION
            'Este cliente tem % título(s) vencido(s) em aberto. Baixe em Financeiro → Contas a Receber antes de liberar novo crediário.',
            v_vencidos USING ERRCODE = 'P0001';
        END IF;

        SELECT limite_credito INTO v_limite FROM public.clientes WHERE id = v_orc.cliente_id;
        IF v_limite IS NOT NULL THEN
          v_saldo := COALESCE(public.cliente_saldo_devedor(v_orc.cliente_id), 0);
          IF v_saldo + v_total > v_limite THEN
            RAISE EXCEPTION
              'Limite de crédito insuficiente: teto R$ %, já em aberto R$ %, esta proposta R$ %.',
              to_char(v_limite, 'FM999G999G990D00'),
              to_char(v_saldo,  'FM999G999G990D00'),
              to_char(v_total,  'FM999G999G990D00')
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.pedidos_venda (
    orcamento_id, cliente_id, vendedor_id, vendedor_nome,
    itens, valor_total, status, filial
  )
  VALUES (
    v_orc.id, v_orc.cliente_id, v_orc.vendedor_id, v_orc.vendedor_nome,
    v_orc.itens, v_total, 'Aguardando Separação', v_orc.filial
  )
  RETURNING id INTO v_pedido_id;

  SELECT nome INTO v_cliente_nome FROM public.clientes WHERE id = v_orc.cliente_id;
  v_desc := 'Pedido Venda #' || UPPER(SUBSTRING(v_pedido_id::text, 1, 8))
            || COALESCE(' - ' || v_cliente_nome, '');

  v_parcela := round(v_total / v_parcelas, 2);

  FOR i IN 1..v_parcelas LOOP
    IF i < v_parcelas THEN
      v_valor := v_parcela;
      v_acum  := v_acum + v_valor;
    ELSE
      v_valor := v_total - v_acum;
    END IF;

    v_vencimento := public.acre_today() + v_prazo + (i - 1) * v_intervalo;

    INSERT INTO public.contas_receber (
      cliente_id, descricao, valor, vencimento, status, filial,
      pedido_venda_id, forma_pagamento_id
    )
    VALUES (
      v_orc.cliente_id,
      v_desc || CASE WHEN v_parcelas > 1 THEN format(' (%s/%s)', i, v_parcelas) ELSE '' END,
      v_valor, v_vencimento, 'Aberto', v_orc.filial,
      v_pedido_id, v_orc.forma_pagamento_id
    )
    RETURNING id INTO v_conta_id;

    IF i = 1 THEN
      v_primeira := v_conta_id;
    END IF;
  END LOOP;

  UPDATE public.pedidos_venda
     SET conta_receber_id = v_primeira
   WHERE id = v_pedido_id;

  UPDATE public.orcamentos
     SET status = 'Convertido em Pedido',
         pedido_venda_id = v_pedido_id
   WHERE id = v_orc.id;

  v_msg := v_desc
           || COALESCE(' — ' || v_orc.forma_pagamento, '')
           || CASE WHEN v_parcelas > 1
                   THEN format(' em %sx de R$ %s', v_parcelas, to_char(v_parcela, 'FM999G999G990D00'))
                   ELSE '' END;

  PERFORM public.notificar_setor(
    p_setor      => 'logistica',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => 'Novo pedido de venda para separar',
    p_mensagem   => v_desc,
    p_link_view  => 'estoque-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id
  );

  PERFORM public.notificar_setor(
    p_setor      => 'financeiro',
    p_tipo       => 'aprovacao_pendente',
    p_titulo     => CASE WHEN v_parcelas > 1
                         THEN format('Contas a receber geradas (%s parcelas)', v_parcelas)
                         ELSE 'Conta a receber gerada' END,
    p_mensagem   => v_msg,
    p_link_view  => 'financeiro-pedidosdevenda',
    p_urgencia   => 'Média',
    p_ref_id     => v_pedido_id
  );

  RETURN v_pedido_id;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
