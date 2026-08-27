-- O dinheiro da venda deixa de ser adivinhado pelo texto da forma de pagamento.
--
-- Até aqui, "venda em dinheiro" era `forma_pagamento ILIKE 'dinheiro%'`. O PDV
-- da SuperMax grava pagamento misto como texto composto — "Misto: Dinheiro
-- R$ 20,00 + PIX R$ 6,00" — que não casa com esse prefixo. Duas consequências,
-- as duas exercitadas contra o banco antes desta migração:
--
--   1. `fn_venda_dinheiro_exige_caixa` deixava passar. Com o caixa FECHADO, a
--      forma 'Dinheiro' era recusada e o misto com dinheiro passava: um centavo
--      em outra forma contornava a trava que protege a gaveta.
--   2. Os três fechadores somavam só o que casava com o prefixo, então a parte
--      em espécie do misto ficava fora de `valor_esperado`. O dinheiro estava
--      na gaveta e a conferência acusaria SOBRA exatamente desse valor.
--
-- A correção não é ler melhor a string: é a venda dizer quanto entrou em
-- espécie. `vendas.valor_dinheiro` passa a ser esse número, gravado pelo PDV
-- via `criar_venda_pdv`. Os leitores usam COALESCE com a regra antiga — linha
-- sem o campo (legado, ou escrita por um caminho que ainda não o preencha)
-- continua sendo lida como antes, em vez de virar zero silencioso. Por isso a
-- coluna NÃO tem default: NULL aqui significa "não informado", e é o que
-- aciona o fallback; um default 0 apagaria a diferença.
--
-- No mesmo movimento, a sangria ganha teto. `registrar_movimentacao_caixa`
-- validava tipo, valor > 0, caixa aberto e filial — mas não comparava o valor
-- com o que há na gaveta. Sangrar mais do que entrou deixa `valor_esperado`
-- negativo, e daí qualquer contagem >= 0 fecha como "sobra": a conferência do
-- dia perde o sentido.

BEGIN;

-- ── 1) A coluna e o histórico ────────────────────────────────────────────────
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS valor_dinheiro numeric(15,2);

COMMENT ON COLUMN public.vendas.valor_dinheiro IS
  'Quanto desta venda entrou em espécie (0 quando nenhum). NULL = não informado: os leitores caem na regra antiga (total quando a forma começa com "Dinheiro"). Sem default de propósito.';

-- Histórico: forma única em dinheiro levou o total; o resto, zero. Não há venda
-- mista em nenhuma das quatro turmas (conferido antes de escrever isto), então
-- não há texto composto para interpretar aqui.
UPDATE public.vendas
   SET valor_dinheiro = CASE WHEN forma_pagamento ILIKE 'dinheiro%' THEN total_final ELSE 0 END
 WHERE valor_dinheiro IS NULL;

-- ── 2) Uma única definição de "dinheiro que entrou na gaveta" ────────────────
-- Quatro lugares precisavam da mesma conta (os três fechadores e o teto da
-- sangria). Enquanto ela vivia copiada, bastou um deles ficar para trás para a
-- conferência do operador discordar da do Financeiro.
CREATE OR REPLACE FUNCTION public.dinheiro_das_vendas_do_caixa(p_filial text, p_data date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    COALESCE(
      v.valor_dinheiro,
      CASE WHEN COALESCE(v.forma_pagamento, '') ILIKE 'dinheiro%' THEN v.total_final ELSE 0 END
    )
  ), 0)::numeric(15,2)
    FROM public.vendas v
   WHERE DATE(v.created_at AT TIME ZONE 'America/Rio_Branco') = p_data
     AND COALESCE(v.ativo, true) = true
     -- Migr. 448: venda cancelada devolveu o dinheiro ao cliente. Cobrá-la no
     -- esperado fazia o caixa fechar com falta do valor exato do cancelamento.
     AND COALESCE(v.status, '') <> 'Cancelada'
     AND (p_filial IS NULL OR v.filial = p_filial);
$function$;

REVOKE ALL ON FUNCTION public.dinheiro_das_vendas_do_caixa(text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.dinheiro_das_vendas_do_caixa(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dinheiro_das_vendas_do_caixa(text, date) TO service_role;

-- ── 3) A trava da gaveta olha o valor, não o texto ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venda_dinheiro_exige_caixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dia      date;
  v_dinheiro numeric(15,2);
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Quanto entra em espécie. O COALESCE cobre a linha sem o campo preenchido.
  v_dinheiro := COALESCE(
    NEW.valor_dinheiro,
    CASE WHEN COALESCE(NEW.forma_pagamento, '') ILIKE 'dinheiro%' THEN NEW.total_final ELSE 0 END
  );

  -- Sem espécie não passa pela gaveta: cartão, Fiado e Pix seguem em frente.
  IF COALESCE(v_dinheiro, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Venda já nascida cancelada não movimenta gaveta nenhuma.
  IF COALESCE(NEW.status, '') = 'Cancelada' THEN
    RETURN NEW;
  END IF;

  v_dia := DATE(COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/Rio_Branco');

  IF NOT EXISTS (
    SELECT 1 FROM public.controle_caixa cc
     WHERE cc.filial = NEW.filial
       AND cc.data   = v_dia
       AND cc.status = 'Aberto'
       AND COALESCE(cc.ativo, true)
  ) THEN
    RAISE EXCEPTION
      'Não há caixa aberto na % hoje, e esta venda recebe dinheiro em espécie: o dinheiro entraria sem gaveta para guardá-lo, e a conferência do fim do dia cobraria a falta de quem abrisse o caixa depois. Abra o caixa em Financeiro > Controle de Caixa e refaça a venda — ou receba por cartão, Pix ou fiado, que não passam pela gaveta.',
      NEW.filial
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4) Os três fechadores somam o dinheiro, não o texto ──────────────────────
CREATE OR REPLACE FUNCTION public.solicitar_fechamento_caixa(p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa         public.controle_caixa;
  v_vendas_din    numeric(15,2) := 0;
  v_suprimentos   numeric(15,2) := 0;
  v_sangrias      numeric(15,2) := 0;
  v_esperado      numeric(15,2);
  v_dif           numeric(15,2);
  v_tipo          text;
  v_uid           uuid := auth.uid();
  v_nome          text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status <> 'Aberto' THEN
    RAISE EXCEPTION 'Só é possível solicitar fechamento de caixa aberto (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  v_vendas_din := public.dinheiro_das_vendas_do_caixa(v_caixa.filial, v_caixa.data);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;
  v_dif      := p_valor_contado - v_esperado;
  v_tipo     := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status             = 'Aguardando Confirmação',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = 'operador'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo,
    'status_novo',     'Aguardando Confirmação'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fechar_caixa_conferido(p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text, p_origem text DEFAULT 'financeiro'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa         public.controle_caixa;
  v_vendas_din    numeric(15,2) := 0;
  v_suprimentos   numeric(15,2) := 0;
  v_sangrias      numeric(15,2) := 0;
  v_esperado      numeric(15,2);
  v_dif           numeric(15,2);
  v_tipo          text;
  v_uid           uuid := auth.uid();
  v_nome          text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa já fechado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  v_vendas_din := public.dinheiro_das_vendas_do_caixa(v_caixa.filial, v_caixa.data);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;
  v_dif      := p_valor_contado - v_esperado;
  v_tipo     := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status             = 'Fechado',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = COALESCE(p_origem, 'financeiro')
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_fechamento_caixa(p_controle_id uuid, p_observacao_extra text DEFAULT NULL::text, p_valor_reconferido numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa       public.controle_caixa;
  v_uid         uuid := auth.uid();
  v_nome        text;
  v_esperado    numeric(15,2);
  v_guardado    numeric(15,2);
  v_vendas_din  numeric(15,2) := 0;
  v_suprimentos numeric(15,2) := 0;
  v_sangrias    numeric(15,2) := 0;
  v_valor_final numeric(15,2);
  v_dif         numeric(15,2);
  v_tipo        text;
  v_obs_final   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- p_conferencia=true mantém a régua mais estreita (só Financeiro, ou o
  -- gerente da unidade), escopada por filial.
  PERFORM public._assert_caixa(v_caixa.filial, true);

  IF v_caixa.status <> 'Aguardando Confirmação' THEN
    RAISE EXCEPTION 'Só é possível confirmar caixa em Aguardando Confirmação (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 556: era `v_esperado := COALESCE(v_caixa.valor_esperado, 0)` — o
  -- número carimbado por `solicitar_fechamento_caixa` lá atrás. Agora a conta é
  -- refeita agora, com a mesma fórmula das outras duas RPCs. O número guardado
  -- vira só a referência do que o operador viu na hora.
  v_guardado := COALESCE(v_caixa.valor_esperado, 0);

  v_vendas_din := public.dinheiro_das_vendas_do_caixa(v_caixa.filial, v_caixa.data);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;

  v_valor_final := COALESCE(p_valor_reconferido, v_caixa.valor_fechamento);
  v_dif  := v_valor_final - v_esperado;
  v_tipo := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  v_obs_final := CASE
    WHEN p_observacao_extra IS NULL OR btrim(p_observacao_extra) = '' THEN v_caixa.observacao
    WHEN v_caixa.observacao IS NULL OR btrim(v_caixa.observacao) = '' THEN p_observacao_extra
    ELSE v_caixa.observacao || E'\n— Financeiro: ' || p_observacao_extra
  END;

  -- Se o esperado mudou entre o pedido e a conferência, isso não some: fica
  -- escrito no documento, que é onde o aluno vai procurar a explicação.
  IF ABS(v_esperado - v_guardado) > 0.005 THEN
    v_obs_final := COALESCE(NULLIF(btrim(COALESCE(v_obs_final, '')), '') || E'\n', '')
      || format('— Recalculado na conferência: o esperado passou de R$ %s para R$ %s '
                || '(lançamentos entraram no caixa depois de a gaveta ser contada).',
                to_char(v_guardado, 'FM999G999G990D00'),
                to_char(v_esperado, 'FM999G999G990D00'));
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Fechado',
         valor_fechamento  = v_valor_final,
         valor_esperado    = v_esperado,
         diferenca         = v_dif,
         tipo_diferenca    = v_tipo,
         atualizado_por    = v_uid,
         updated_at        = now(),
         observacao        = v_obs_final,
         origem_fechamento = 'financeiro'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_esperado',   v_esperado,
    'esperado_no_pedido', v_guardado,
    'recalculado',      ABS(v_esperado - v_guardado) > 0.005,
    'valor_final',      v_valor_final,
    'diferenca',        v_dif,
    'tipo',             v_tipo,
    'confirmado_por',   v_nome,
    'status_novo',      'Fechado'
  );
END;
$function$;

-- ── 5) Sangria não tira da gaveta o que não está lá ──────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_movimentacao_caixa(p_controle_id uuid, p_tipo text, p_valor numeric, p_motivo text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa    public.controle_caixa;
  v_uid      uuid := auth.uid();
  v_nome     text;
  v_id       uuid;
  v_em_caixa numeric(15,2);
BEGIN
  IF p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Tipo inválido (use sangria ou suprimento).' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa fechado — operação não permitida.' USING ERRCODE = 'P0001';
  END IF;

  -- Sangria é dinheiro SAINDO da gaveta: não pode tirar o que não está lá.
  -- Sem este teto dava para deixar `valor_esperado` negativo, e a partir daí
  -- qualquer contagem fecha como "sobra" — a conferência do dia vira ficção.
  -- Mesma fórmula do fechamento, para os dois números nunca discordarem.
  IF p_tipo = 'sangria' THEN
    SELECT COALESCE(v_caixa.valor_abertura, 0)
         + public.dinheiro_das_vendas_do_caixa(v_caixa.filial, v_caixa.data)
         + COALESCE((SELECT SUM(valor) FROM public.movimentacoes_caixa
                      WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento'), 0)
         - COALESCE((SELECT SUM(valor) FROM public.movimentacoes_caixa
                      WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria'), 0)
      INTO v_em_caixa;

    IF p_valor > v_em_caixa + 0.005 THEN
      RAISE EXCEPTION
        'Sangria de R$ % é maior que o dinheiro em caixa (R$ %). A gaveta tem a abertura, as vendas em espécie do dia e os suprimentos, menos as sangrias já feitas.',
        to_char(p_valor,    'FM999G999G990D00'),
        to_char(GREATEST(v_em_caixa, 0), 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.movimentacoes_caixa
    (controle_caixa_id, tipo, valor, motivo, filial, criado_por, criado_por_nome)
  VALUES
    (p_controle_id, p_tipo, p_valor, p_motivo, v_caixa.filial, v_uid, v_nome)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── 6) O PDV declara quanto veio em espécie ──────────────────────────────────
-- A assinatura muda (parâmetro novo com default), então é DROP + CREATE: um
-- CREATE OR REPLACE deixaria as duas versões vivas e o PostgREST não saberia
-- qual chamar. GRANTs refeitos porque o DROP leva a ACL junto.
DROP FUNCTION IF EXISTS public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric);

CREATE OR REPLACE FUNCTION public.criar_venda_pdv(
  p_cliente_id uuid,
  p_total numeric,
  p_desconto numeric,
  p_total_final numeric,
  p_forma_pagamento text,
  p_parcelas integer,
  p_itens jsonb,
  p_filial text DEFAULT NULL::text,
  p_cupom_codigo text DEFAULT NULL::text,
  p_cupom_desconto numeric DEFAULT 0,
  p_valor_dinheiro numeric DEFAULT NULL::numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venda_id      uuid;
  v_short_id      text;
  v_cliente_nome  text;
  v_today         date := public.acre_today();
  v_item          jsonb;
  v_parcela_valor numeric(15,2);
  v_acumulado     numeric(15,2) := 0;
  v_valor_atual   numeric(15,2);
  v_parcelas      integer := COALESCE(p_parcelas, 1);
  v_desc_base     text;
  v_produtos_resumo text;
  v_estoque_atual numeric(15,3);
  v_nome_produto  text;
  v_qtd_pedida    numeric(15,3);
  v_produto_id    uuid;
  v_soma_itens    numeric(15,2);
  v_desconto      numeric(15,2) := COALESCE(p_desconto, 0);
  v_filial        text          := COALESCE(p_filial, 'Matriz');
  v_cupom         marketing_cupons;
  v_cupom_desc    numeric(15,2) := COALESCE(p_cupom_desconto, 0);
  v_cupom_calc    numeric(15,2);
  v_tem_cupom     boolean := p_cupom_codigo IS NOT NULL AND length(trim(p_cupom_codigo)) > 0;
  v_conta_receber_id uuid;
  v_preco_cat     numeric(15,2);   -- MIGR 554
  v_preco_env     numeric(15,2);   -- MIGR 554
  v_dinheiro      numeric(15,2);   -- MIGR 562
  i               integer;
BEGIN
  PERFORM public._assert_rpc('vendas', 'financeiro');

  -- MIGR 554: a porta da frente também confere a unidade.
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Você opera o PDV da sua unidade — esta venda está sendo lançada como %.', v_filial
      USING ERRCODE = '42501';
  END IF;

  IF v_parcelas < 1 OR v_parcelas > 12 THEN
    RAISE EXCEPTION 'Número de parcelas inválido: %', v_parcelas;
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0)
    INTO v_soma_itens
    FROM jsonb_array_elements(p_itens) item;

  IF ABS(v_soma_itens - p_total) > 0.01 THEN
    RAISE EXCEPTION 'Soma dos itens (R$ %) não bate com o total enviado (R$ %).',
      to_char(v_soma_itens, 'FM999G999G990D00'),
      to_char(p_total,      'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF ABS((p_total - v_desconto) - p_total_final) > 0.01 THEN
    RAISE EXCEPTION 'Total final (R$ %) inconsistente com total (R$ %) e desconto (R$ %).',
      to_char(p_total_final, 'FM999G999G990D00'),
      to_char(p_total,       'FM999G999G990D00'),
      to_char(v_desconto,    'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  IF p_total_final < 0 OR p_total < 0 OR v_desconto < 0 THEN
    RAISE EXCEPTION 'Valores negativos não permitidos.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 562: quanto desta venda entra em espécie. Omitido, vale a regra
  -- antiga — forma que começa com "Dinheiro" leva o total. É o que mantém
  -- chamador antigo correto, em vez de silenciosamente zerado.
  v_dinheiro := COALESCE(
    p_valor_dinheiro,
    CASE WHEN COALESCE(p_forma_pagamento, '') ILIKE 'dinheiro%' THEN p_total_final ELSE 0 END
  );
  IF v_dinheiro < 0 OR v_dinheiro > p_total_final + 0.005 THEN
    RAISE EXCEPTION 'Dinheiro recebido (R$ %) não pode ser negativo nem maior que o total da venda (R$ %).',
      to_char(v_dinheiro,    'FM999G999G990D00'),
      to_char(p_total_final, 'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF (v_item->>'qtd')::numeric <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item "%".', v_item->>'nome_produto'
        USING ERRCODE = 'P0001';
    END IF;
    IF ABS(((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric) - (v_item->>'subtotal')::numeric) > 0.01 THEN
      RAISE EXCEPTION 'Subtotal incoerente no item "%": esperado R$ %, recebido R$ %.',
        v_item->>'nome_produto',
        to_char((v_item->>'preco_unitario')::numeric * (v_item->>'qtd')::numeric, 'FM999G999G990D00'),
        to_char((v_item->>'subtotal')::numeric, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;

    -- MIGR 554: o preço é do catálogo.
    v_produto_id := NULLIF(v_item->>'produto_id', '')::uuid;
    IF v_produto_id IS NULL THEN
      RAISE EXCEPTION 'Item "%" não aponta para um produto do catálogo.',
        COALESCE(v_item->>'nome_produto', '(sem nome)') USING ERRCODE = 'P0001';
    END IF;

    SELECT preco, nome INTO v_preco_cat, v_nome_produto
      FROM public.produtos WHERE id = v_produto_id;
    IF v_nome_produto IS NULL THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;

    v_preco_env := (v_item->>'preco_unitario')::numeric;
    IF ABS(COALESCE(v_preco_cat, 0) - v_preco_env) > 0.01 THEN
      RAISE EXCEPTION
        'Preço de "%" não confere: no catálogo está R$ %, e a venda foi enviada com R$ %. Se o preço mudou, recarregue a tela; se é abatimento, use o campo Desconto — é ele que o DRE lê para separar receita de desconto concedido.',
        v_nome_produto,
        to_char(COALESCE(v_preco_cat, 0), 'FM999G999G990D00'),
        to_char(v_preco_env,              'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_tem_cupom THEN
    SELECT * INTO v_cupom
      FROM marketing_cupons
     WHERE UPPER(codigo) = UPPER(trim(p_cupom_codigo))
       AND ativo = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cupom "%" não encontrado.', p_cupom_codigo USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.validade_inicio IS NOT NULL AND v_today < v_cupom.validade_inicio THEN
      RAISE EXCEPTION 'Cupom só passa a valer em %.', to_char(v_cupom.validade_inicio, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
    IF v_today > v_cupom.validade_fim THEN
      RAISE EXCEPTION 'Cupom expirou em %.', to_char(v_cupom.validade_fim, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.filial IS NOT NULL AND v_cupom.filial <> v_filial THEN
      RAISE EXCEPTION 'Cupom válido apenas em %.', v_cupom.filial USING ERRCODE = 'P0001';
    END IF;
    IF p_total < v_cupom.valor_minimo THEN
      RAISE EXCEPTION 'Compra mínima de R$ % para usar este cupom.',
        to_char(v_cupom.valor_minimo, 'FM999G999G990D00') USING ERRCODE = 'P0001';
    END IF;
    IF v_cupom.limite_uso IS NOT NULL AND v_cupom.usos >= v_cupom.limite_uso THEN
      RAISE EXCEPTION 'Cupom atingiu o limite de usos.' USING ERRCODE = 'P0001';
    END IF;

    IF v_cupom.tipo = 'percentual' THEN
      v_cupom_calc := ROUND(p_total * v_cupom.valor / 100.0, 2);
      IF v_cupom.desconto_maximo IS NOT NULL AND v_cupom_calc > v_cupom.desconto_maximo THEN
        v_cupom_calc := v_cupom.desconto_maximo;
      END IF;
    ELSE
      v_cupom_calc := v_cupom.valor;
    END IF;
    IF v_cupom_calc > p_total THEN v_cupom_calc := p_total; END IF;

    IF ABS(v_cupom_calc - v_cupom_desc) > 0.01 THEN
      RAISE EXCEPTION 'Desconto do cupom inconsistente: servidor calculou R$ %, cliente enviou R$ %.',
        to_char(v_cupom_calc, 'FM999G999G990D00'),
        to_char(v_cupom_desc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
    IF v_desconto + 0.01 < v_cupom_calc THEN
      RAISE EXCEPTION 'Desconto total (R$ %) menor que o cupom (R$ %).',
        to_char(v_desconto,   'FM999G999G990D00'),
        to_char(v_cupom_calc, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_produto_id, v_qtd_pedida IN
    SELECT (item->>'produto_id')::uuid, SUM((item->>'qtd')::numeric)
      FROM jsonb_array_elements(p_itens) item
     GROUP BY (item->>'produto_id')::uuid ORDER BY 1
  LOOP
    SELECT estoque, nome INTO v_estoque_atual, v_nome_produto
      FROM produtos WHERE id = v_produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;
    IF v_estoque_atual < v_qtd_pedida THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%": disponível %, pedido %.',
        v_nome_produto, v_estoque_atual, v_qtd_pedida USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO vendas (
    cliente_id, total, desconto, total_final, forma_pagamento, status, filial,
    cupom_id, cupom_codigo, cupom_desconto, valor_dinheiro
  ) VALUES (
    p_cliente_id, p_total, v_desconto, p_total_final, p_forma_pagamento, 'Concluída', v_filial,
    CASE WHEN v_tem_cupom THEN v_cupom.id     ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom.codigo ELSE NULL END,
    CASE WHEN v_tem_cupom THEN v_cupom_calc   ELSE 0    END,
    v_dinheiro
  ) RETURNING id INTO v_venda_id;

  v_short_id := UPPER(RIGHT(v_venda_id::text, 6));

  IF p_cliente_id IS NOT NULL THEN
    SELECT nome INTO v_cliente_nome FROM clientes WHERE id = p_cliente_id;
  END IF;

  SELECT string_agg(
    CASE WHEN (item->>'qtd')::numeric <> 1
      THEN replace((item->>'qtd'), '.', ',') || 'x ' || (item->>'nome_produto')
      ELSE (item->>'nome_produto')
    END, ', ' ORDER BY ord
  ) INTO v_produtos_resumo
  FROM jsonb_array_elements(p_itens) WITH ORDINALITY AS t(item, ord);

  IF v_produtos_resumo IS NULL THEN v_produtos_resumo := ''; END IF;
  IF length(v_produtos_resumo) > 80 THEN
    v_produtos_resumo := left(v_produtos_resumo, 80) || '...';
  END IF;

  v_desc_base := 'Venda PDV ' || v_produtos_resumo || ' #' || v_short_id;
  IF v_cliente_nome IS NOT NULL THEN
    v_desc_base := v_desc_base || ' — ' || v_cliente_nome;
  END IF;
  IF v_tem_cupom THEN
    v_desc_base := v_desc_base || ' [cupom ' || v_cupom.codigo || ']';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO itens_venda (venda_id, produto_id, nome_produto, qtd, preco_unitario, subtotal)
    VALUES (v_venda_id, (v_item->>'produto_id')::uuid, v_item->>'nome_produto',
            (v_item->>'qtd')::numeric, (v_item->>'preco_unitario')::numeric, (v_item->>'subtotal')::numeric);

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES ((v_item->>'produto_id')::uuid, 'Saída', (v_item->>'qtd')::numeric,
            'PDV', 'Venda #' || v_short_id, v_today, v_filial);
  END LOOP;

  IF p_forma_pagamento = 'Cartão Crédito' AND v_parcelas > 1 THEN
    v_parcela_valor := ROUND(p_total_final / v_parcelas, 2);
    FOR i IN 1..v_parcelas LOOP
      IF i = v_parcelas THEN
        v_valor_atual := p_total_final - v_acumulado;
      ELSE
        v_valor_atual := v_parcela_valor;
        v_acumulado := v_acumulado + v_parcela_valor;
      END IF;
      INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
      VALUES (p_cliente_id, v_desc_base || ' - Parcela ' || i || '/' || v_parcelas || ' (Cartão Crédito)',
              v_valor_atual, v_today + (30 * i), 'Aberto', v_filial, v_venda_id);
    END LOOP;
    v_conta_receber_id := NULL;
  ELSIF p_forma_pagamento = 'Fiado' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (Fiado)', p_total_final, v_today + 30, 'Aberto', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  ELSIF p_forma_pagamento = 'Cartão Crédito' THEN
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (Cartão Crédito 1x)', p_total_final, v_today + 30, 'Aberto', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  ELSE
    INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)
    VALUES (p_cliente_id, v_desc_base || ' (' || p_forma_pagamento || ')', p_total_final, v_today, 'Pago', v_filial, v_venda_id)
    RETURNING id INTO v_conta_receber_id;
  END IF;

  IF v_tem_cupom THEN
    UPDATE marketing_cupons SET usos = usos + 1 WHERE id = v_cupom.id;
  END IF;

  PERFORM public.emitir_nota(
    p_filial          => v_filial,
    p_tipo            => 'NF Produto',
    p_origem          => 'pdv',
    p_cliente_id      => p_cliente_id,
    p_cliente_nome    => v_cliente_nome,
    p_valor_total     => p_total_final,
    p_descricao       => v_desc_base,
    p_venda_id        => v_venda_id,
    p_conta_receber_id => v_conta_receber_id,
    p_data_emissao    => v_today,
    p_serie           => '001'
  );

  RETURN v_venda_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric,numeric) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
