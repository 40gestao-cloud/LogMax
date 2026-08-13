-- 415_20260813_no_misto_o_credito_volta_a_ser_dinheiro_que_ainda_nao_entrou.sql
--
-- Duas correções de fechamento de venda no PDV. Nenhuma delas reescreve
-- `criar_venda_pdv` — ver a nota no fim sobre por que a função de 10 KB fica
-- intocada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. FIADO SEM CLIENTE
--
-- `criar_venda_pdv` grava a venda e a conta a receber com o `p_cliente_id` que
-- recebeu, e em Fiado não confere se veio alguém. Os três PDVs exigem cliente
-- na tela, mas isso é validação de formulário: quem chama a RPC direto (F12, e
-- essa turma abre o F12) fecha um Fiado sem devedor. Sobra uma conta a receber
-- de ninguém — dívida que o Financeiro não tem como cobrar nem baixar.
--
-- A regra vira CHECK na tabela, não IF na função: assim vale para todo caminho
-- de escrita, hoje e depois, sem depender de quem lembrou de validar.
--
-- NOT VALID de propósito. São 4 bancos de turma com histórico diferente; se
-- algum já tiver um Fiado órfão, a constraint validada faria a migração inteira
-- falhar no ALTER. NOT VALID barra toda venda NOVA — que é o objetivo — e
-- deixa o passado como está. Para validar o histórico depois de limpar:
--   ALTER TABLE vendas VALIDATE CONSTRAINT vendas_fiado_exige_cliente;
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. CRÉDITO DENTRO DO PAGAMENTO MISTO
--
-- O SuperMax fecha venda em várias formas (`Misto: Dinheiro R$ 50,00 + Cartão
-- Crédito R$ 200,00`). `criar_venda_pdv` decide o vencimento comparando a forma
-- com strings exatas: 'Cartão Crédito' parcela, 'Fiado' abre em 30 dias, e
-- qualquer outra coisa cai no ELSE como conta PAGA no dia. A string do misto
-- não bate com nenhuma, então os R$ 200 do crédito entram no caixa como
-- dinheiro de hoje — sendo que a operadora só repassa em 30 dias.
--
-- Para o aluno que fecha o mês isso é pior que um erro de digitação: o
-- Financeiro mostra saldo que a loja não tem, e a diferença não aparece em
-- lugar nenhum porque a conta está marcada como recebida.
--
-- `pdv_registrar_credito_misto` corrige o lançamento depois da venda: reduz a
-- conta paga para o que entrou à vista e abre a parte do crédito a receber,
-- parcelada como a operadora repassa.
--
-- POR QUE UMA RPC SEPARADA, E NÃO UM IF DENTRO DA criar_venda_pdv:
--
-- A função de venda tem 10 KB e é o caminho de TODA venda das 4 turmas, do
-- balcão à loja online. Reescrevê-la exige DROP + CREATE (a assinatura muda) e
-- transcrever o corpo inteiro; o corpo vivo, além disso, não é igual ao da
-- migração 224 — a 260 injetou o `_assert_rpc` nele programaticamente. Um
-- caractere trocado numa coluna OUT derruba a função inteira (42P13) e leva a
-- transação junto. Uma função nova e pequena falha sozinha, e o pior caso dela
-- é a venda ficar como está hoje.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Fiado exige devedor
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vendas'::regclass
       AND conname  = 'vendas_fiado_exige_cliente'
  ) THEN
    ALTER TABLE public.vendas
      ADD CONSTRAINT vendas_fiado_exige_cliente
      CHECK (forma_pagamento <> 'Fiado' OR cliente_id IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Parte do crédito no misto vira conta a receber
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pdv_registrar_credito_misto(
  p_venda_id      uuid,
  p_valor_credito numeric,
  p_parcelas      integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda        vendas;
  v_short_id     text;
  v_today        date := public.acre_today();
  v_conta        contas_receber;
  v_restante     numeric(15,2);
  v_parcela      numeric(15,2);
  v_acumulado    numeric(15,2) := 0;
  v_valor_atual  numeric(15,2);
  v_desc_base    text;
  v_parcelas     integer := COALESCE(p_parcelas, 1);
  i              integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_venda FROM vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda % não encontrada.', p_venda_id USING ERRCODE = 'P0002';
  END IF;

  -- Mesma régua de filial do resto do PDV: quem não opera a unidade não
  -- remexe no financeiro dela. COALESCE porque auth_pode_filial devolve NULL
  -- para quem está sem filial, e NULL num IF não barra ninguém.
  IF NOT COALESCE(public.auth_pode_filial(v_venda.filial), false) THEN
    RAISE EXCEPTION 'Sem permissão sobre a filial %.', v_venda.filial USING ERRCODE = 'P0001';
  END IF;

  -- Só venda mista. Crédito puro já é parcelado pela criar_venda_pdv, e
  -- deixar essa função mexer nele criaria duas fontes para o mesmo lançamento.
  IF v_venda.forma_pagamento IS NULL OR v_venda.forma_pagamento NOT LIKE 'Misto:%' THEN
    RAISE EXCEPTION 'Venda % não é pagamento misto (forma: %).',
      p_venda_id, COALESCE(v_venda.forma_pagamento, '—') USING ERRCODE = 'P0001';
  END IF;

  IF p_valor_credito IS NULL OR p_valor_credito <= 0 THEN
    RAISE EXCEPTION 'Valor do crédito precisa ser positivo.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_credito > v_venda.total_final + 0.01 THEN
    RAISE EXCEPTION 'Crédito (R$ %) maior que o total da venda (R$ %).',
      to_char(p_valor_credito,      'FM999G999G990D00'),
      to_char(v_venda.total_final,  'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  v_short_id  := UPPER(RIGHT(p_venda_id::text, 6));
  v_restante  := ROUND(v_venda.total_final - p_valor_credito, 2);

  -- IDEMPOTÊNCIA. Chamada repetida (duplo clique, retry de rede) não pode
  -- lançar a segunda leva de parcelas. O teste é a existência das parcelas,
  -- não o estado da conta à vista: depois do ajuste ela continua 'Pago' e
  -- ativa, e voltaria a casar com a busca abaixo.
  IF EXISTS (
    SELECT 1 FROM contas_receber
     WHERE descricao LIKE '%#' || v_short_id || '%(Cartão Crédito no misto)'
       AND filial = v_venda.filial
       AND ativo  = true
  ) THEN
    RETURN 0;
  END IF;

  -- A conta que a criar_venda_pdv gerou: paga, no dia, com o #shortId na
  -- descrição. contas_receber não tem venda_id — a amarração é essa mesma que
  -- o resto do módulo já usa. O recorte por filial evita que uma colisão dos 6
  -- caracteres do id alcance o financeiro de outra loja.
  SELECT * INTO v_conta
    FROM contas_receber
   WHERE descricao LIKE '%#' || v_short_id || '%'
     AND filial = v_venda.filial
     AND ativo = true
     AND status = 'Pago'
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Venda antiga, ou conta já baixada/editada pelo Financeiro. Não inventa
    -- lançamento em cima do que alguém mexeu à mão.
    RETURN 0;
  END IF;

  -- Tira só o sufixo de forma de pagamento que a criar_venda_pdv acrescenta no
  -- fim: '... #A1B2C3 (Misto: Dinheiro R$ 50,00 + Cartão Crédito R$ 200,00)'.
  -- `split_part(descricao, ' (', 1)` seria mais curto e estaria errado —
  -- corta no PRIMEIRO parêntese, e nome de produto com parêntese ("Arroz
  -- (5kg)") entra na descrição da venda. A base perderia o #shortId, que é a
  -- única amarração que essas contas têm.
  v_desc_base := regexp_replace(v_conta.descricao, ' \([^()]*\)$', '');

  IF v_restante > 0.005 THEN
    UPDATE contas_receber
       SET valor      = v_restante,
           descricao  = v_desc_base || ' (à vista no misto)',
           updated_at = now()
     WHERE id = v_conta.id;
  ELSE
    -- Misto inteiro no crédito (ex.: dois cartões): não sobra nada à vista.
    -- Soft-delete, que é como o resto do Financeiro remove lançamento.
    UPDATE contas_receber
       SET ativo = false, updated_at = now()
     WHERE id = v_conta.id;
  END IF;

  v_parcela := ROUND(p_valor_credito / v_parcelas, 2);
  FOR i IN 1..v_parcelas LOOP
    IF i = v_parcelas THEN
      v_valor_atual := p_valor_credito - v_acumulado;
    ELSE
      v_valor_atual := v_parcela;
      v_acumulado   := v_acumulado + v_parcela;
    END IF;
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)
    VALUES (
      v_venda.cliente_id,
      v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito no misto)',
      v_valor_atual,
      v_today + (30 * i),
      'Aberto',
      v_venda.filial
    );
  END LOOP;

  RETURN v_parcelas;
END;
$$;

-- RPC nova nasce chamável pelo anon: revogar nominalmente, porque REVOKE do
-- public sozinho não tira o que o anon herdou.
REVOKE ALL ON FUNCTION public.pdv_registrar_credito_misto(uuid, numeric, integer) FROM public;
REVOKE ALL ON FUNCTION public.pdv_registrar_credito_misto(uuid, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.pdv_registrar_credito_misto(uuid, numeric, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
