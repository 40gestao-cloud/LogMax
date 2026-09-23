-- 621 — O caixa confere o próprio dinheiro, não o do dia inteiro da unidade.
--
-- O DEFEITO. `dinheiro_das_vendas_do_caixa(filial, data)` somava as vendas em
-- espécie da UNIDADE NO DIA, e as quatro RPCs do caixa usavam essa soma como
-- "vendas em dinheiro" do caixa que estava sendo fechado. Com um caixa por dia
-- dá na mesma. Com dois — o operador fecha, alguém abre outro na mesma tarde —
-- o segundo herda o dinheiro do primeiro e fecha com FALTA do valor exato que
-- o primeiro já conferiu.
--
-- Caso real (Aprendiz, 23/09): caixa SuperMax aberto às 11:08 UTC, uma venda
-- mista com R$ 2,00 em espécie, fechado "exato" com R$ 102. Segundo caixa aberto
-- às 11:39, só um Pix; contados R$ 100 (o fundo), a RPC esperou R$ 102 e gravou
-- falta de R$ 2,00.
--
-- A REGRA NOVA (`dinheiro_do_caixa`). `vendas` não tem coluna de caixa, e não
-- precisa: o gatilho `fn_venda_dinheiro_exige_caixa` só aceita venda em espécie
-- com um caixa 'Aberto' da unidade com a data do dia, e o índice único
-- `uq_controle_caixa_aberto_por_dia_filial` deixa um só aberto por vez. Então o
-- dinheiro de um caixa é o das vendas da unidade
--   · no DIA do caixa (a régua de antes — segura os caixas esquecidos abertos:
--     sem ela, o caixa de 27/08 que ninguém fechou somaria as vendas de hoje), e
--   · DEPOIS de ele ser criado (`created_at`, relógio do servidor; `aberto_em`
--     vem do navegador, e relógio adiantado já derrubou sessão aqui), e
--   · ATÉ ele deixar de estar aberto (`fechado_em`, gravado com now() pelo
--     suspender/solicitar/fechar; `reabrir_caixa` zera, e aí vale now()).
--
-- Conferido antes de escrever, nos 4 bancos, recalculando todo caixa existente
-- com as duas regras: o único que muda é o caso acima (2,00 → 0,00). ERP,
-- Contabilidade e Adm não têm caixa nenhum hoje.
--
-- O QUE MUDA. As quatro RPCs são copiadas do banco (pg_get_functiondef) e só a
-- linha da conta troca: `dinheiro_das_vendas_do_caixa(v_caixa.filial,
-- v_caixa.data)` → `dinheiro_do_caixa(p_controle_id)`. A mensagem da sangria
-- diz "deste caixa" em vez de "do dia". O helper antigo fica (não tem mais quem
-- chame; sai numa limpeza à parte).
--
-- `previa_fechamento_caixa` é para o modal "Fechar meu caixa" do PDV
-- (PDVFecharCaixa), que refazia a conta no navegador e errava por conta
-- própria: somava `total_final` das vendas com forma "Dinheiro…" (a parte em
-- espécie do misto ficava de fora, migr. 562), não tirava as canceladas e
-- montava o dia sem fuso. Agora ele pergunta ao banco — o número da prévia é o
-- mesmo que o fechamento vai gravar.

-- ─── O dinheiro de UM caixa ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dinheiro_do_caixa(p_controle_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    COALESCE(
      v.valor_dinheiro,
      CASE WHEN COALESCE(v.forma_pagamento, '') ILIKE 'dinheiro%' THEN v.total_final ELSE 0 END
    )
  ), 0)::numeric(15,2)
    FROM public.controle_caixa cx
    JOIN public.vendas v ON v.filial = cx.filial
   WHERE cx.id = p_controle_id
     AND DATE(v.created_at AT TIME ZONE 'America/Rio_Branco') = cx.data
     AND v.created_at >= cx.created_at
     AND v.created_at <= COALESCE(cx.fechado_em, now())
     AND COALESCE(v.ativo, true) = true
     -- Migr. 448: venda cancelada devolveu o dinheiro ao cliente.
     AND COALESCE(v.status, '') <> 'Cancelada';
$function$;

COMMENT ON FUNCTION public.dinheiro_do_caixa(uuid) IS
  'Vendas em espécie de UM caixa (migr. 621): mesma unidade, mesmo dia, entre a criação do caixa e o fechado_em (ou agora). Uso interno das RPCs do caixa.';

-- Só as RPCs do caixa (SECURITY DEFINER, dono postgres) chamam. Aberta, daria a
-- qualquer aluno o dinheiro de qualquer caixa.
REVOKE ALL ON FUNCTION public.dinheiro_do_caixa(uuid) FROM public, anon, authenticated;

-- ─── Prévia do fechamento, para o modal do PDV ──────────────────────────────

CREATE OR REPLACE FUNCTION public.previa_fechamento_caixa(p_controle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa       public.controle_caixa;
  v_vendas_din  numeric(15,2);
  v_suprimentos numeric(15,2);
  v_sangrias    numeric(15,2);
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Mesma régua de quem pode fechar: ver o dinheiro do caixa é parte de operá-lo.
  PERFORM public._assert_caixa(v_caixa.filial);

  v_vendas_din := public.dinheiro_do_caixa(p_controle_id);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.previa_fechamento_caixa(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.previa_fechamento_caixa(uuid) TO authenticated;

-- ─── fechar_caixa_conferido: copiada do banco (pg_get_functiondef); só a conta muda ───

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

  v_vendas_din := public.dinheiro_do_caixa(p_controle_id);

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

-- ─── solicitar_fechamento_caixa: copiada do banco (pg_get_functiondef); só a conta muda ───

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

  v_vendas_din := public.dinheiro_do_caixa(p_controle_id);

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

-- ─── confirmar_fechamento_caixa: copiada do banco (pg_get_functiondef); só a conta muda ───

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

  v_vendas_din := public.dinheiro_do_caixa(p_controle_id);

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

-- ─── registrar_movimentacao_caixa: copiada do banco (pg_get_functiondef); só a conta muda ───

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
         + public.dinheiro_do_caixa(p_controle_id)
         + COALESCE((SELECT SUM(valor) FROM public.movimentacoes_caixa
                      WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento'), 0)
         - COALESCE((SELECT SUM(valor) FROM public.movimentacoes_caixa
                      WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria'), 0)
      INTO v_em_caixa;

    IF p_valor > v_em_caixa + 0.005 THEN
      RAISE EXCEPTION
        'Sangria de R$ % é maior que o dinheiro em caixa (R$ %). A gaveta tem a abertura, as vendas em espécie deste caixa e os suprimentos, menos as sangrias já feitas.',
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

NOTIFY pgrst, 'reload schema';
