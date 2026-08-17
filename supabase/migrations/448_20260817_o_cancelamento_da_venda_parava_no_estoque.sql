-- 448_20260817_o_cancelamento_da_venda_parava_no_estoque.sql
--
-- CANCELAR A VENDA DEVOLVIA O SALDO E MAIS NADA.
--
-- Auditoria de erro caro e silencioso (docs/auditoria-erro-silencioso.md),
-- pergunta 2: "qual é o caminho de volta?". A venda tem DOIS caminhos de
-- desfazimento — devolução e cancelamento. A migr. 446 fechou a devolução e
-- ninguém olhou o irmão do lado.
--
-- O cancelamento vive em `HistoricoVendasView.handleCancelar`: marca a venda
-- como 'Cancelada' e lança uma Entrada de estoque para cada item. Só. Três
-- fatos que a venda criou continuavam de pé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. O APARELHO CONTINUAVA VENDIDO
--
-- Exatamente o buraco da 446, por outra porta:
--
--   5 iPhones, 5 unidades 'Em estoque'
--   vende 1   → saldo 4, unidades 4        (certo)
--   cancela   → saldo 5, unidades 4        (errado)
--
-- Duas vendas depois o saldo diz 3, não há unidade para alocar, e o recibo sai
-- sem IMEI — o aparelho está na prateleira e o sistema acha que foi embora.
--
-- 2. A CONTA A RECEBER CONTINUAVA ABERTA
--
-- `criar_venda_pdv` gera conta a receber em TODA venda: à vista nasce 'Pago',
-- fiado e cartão nascem 'Aberto' (uma por parcela). Cancelar não tocava
-- nenhuma. A filial cobrava o cliente por uma venda que não existe mais, o
-- limite de crédito dele seguia consumido (`venda_fiado_respeita_credito` lê o
-- saldo em aberto) e o fluxo de caixa projetava dinheiro que não vem.
--
-- E o pior par: o DRE tira a venda cancelada da receita (`status <>
-- 'Cancelada'`) enquanto o Contas a Receber a mantém. As duas telas discordando
-- sobre o mesmo fato é o erro plausível de que o documento fala.
--
-- 3. O CAIXA COBRAVA O DINHEIRO DA VENDA CANCELADA
--
-- `solicitar_fechamento_caixa` e `fechar_caixa_conferido` calculam o esperado
-- somando as vendas em dinheiro do dia — filtrando `ativo`, nunca `status`. Uma
-- venda em dinheiro cancelada no mesmo dia continuava no esperado: o operador
-- conta a gaveta sem aquele dinheiro (voltou para o cliente) e o sistema acusa
-- FALTA DE CAIXA no valor exato do cancelamento. O aluno leva quebra por ter
-- feito a coisa certa. Padrão "status novo quebra função antiga".
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O ESTORNO DE ESTOQUE SAI DA TELA E VEM PARA O GATILHO
--
-- O loop de `dbInsert` no frontend estorna item a item, fora de transação:
-- falha no meio deixa metade do estoque de volta e metade não, e cancelamento
-- por qualquer outro caminho (F12, correção via SQL, fluxo futuro) não estorna
-- nada. A regra vai onde nada escapa — precedente das migrs. 425, 440, 442,
-- 444, 446.
--
-- A Entrada gerada aqui usa a MESMA `origem` que a tela usava
-- ('Estorno — Venda #XXXXXX cancelada') e só entra se ainda não existir. Assim
-- a migração pode subir antes do deploy do frontend sem estornar em dobro.
-- O loop da tela é removido no mesmo commit.
--
-- POR QUE A CONTA PAGA NÃO VIRA CONTA A PAGAR
--
-- A devolução (203) cria `contas_pagar` de estorno quando a venda já estava
-- paga, e está certo: lá a venda continua existindo, a receita continua no DRE,
-- e a saída precisa aparecer. Aqui não — a venda cancelada some inteira da
-- receita. Criar despesa abateria o mesmo dinheiro duas vezes, que é a
-- pergunta 3 do documento ("esse fato tem duas portas?").
--
-- Então a régua é o dinheiro que de fato entrou, não o status:
--
--   `valor_pago` zerado  → conta cancelada (nada entrou; nada a devolver)
--   `valor_pago` > 0     → a conta FICA, com aviso na descrição
--
-- O segundo caso é cliente que pagou de verdade uma venda depois cancelada.
-- Dinheiro que entrou não se apaga por gatilho: a devolução ao cliente é
-- lançamento do Financeiro, com valor e data que só a turma sabe. A migração
-- deixa o passivo visível e não adivinha.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 444 e da 446.

BEGIN;

-- ── 1. O desfazimento completo do cancelamento ──────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_venda_cancelada_desfaz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_short   text := upper(right(NEW.id::text, 6));
  v_hoje    date := public.acre_today();
  v_origem  text;
  v_item    record;
  v_marca   text;
BEGIN
  v_origem := 'Estorno — Venda #' || v_short || ' cancelada';
  v_marca  := ' [venda #' || v_short || ' cancelada — devolver ao cliente]';

  -- 1.1 Estoque de volta. Uma Entrada por item, com guard de idempotência pela
  -- origem: se a tela antiga já estornou este item, não estorna de novo.
  FOR v_item IN
    SELECT iv.produto_id, SUM(iv.qtd) AS qtd
      FROM public.itens_venda iv
     WHERE iv.venda_id = NEW.id
       AND iv.produto_id IS NOT NULL
     GROUP BY iv.produto_id
    HAVING SUM(iv.qtd) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.movimentacoes_estoque me
       WHERE me.produto_id = v_item.produto_id
         AND me.origem = v_origem
         AND COALESCE(me.ativo, true)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_item.produto_id, 'Entrada', v_item.qtd, v_origem, 'Almoxarifado',
       v_hoje, COALESCE(NEW.filial, 'SuperMax'));
  END LOOP;

  -- 1.2 Aparelho de volta para 'Em estoque'. Mesma decisão da 446: o vínculo
  -- com a venda antiga PERMANECE (o recibo já emitido lê `venda_id` para
  -- imprimir o IMEI); só o estado muda, e a próxima venda sobrescreve.
  UPDATE public.produto_unidades pu
     SET status     = 'Em estoque',
         vendida_em = NULL,
         observacao = trim(both ' ' from COALESCE(pu.observacao || ' | ', '')
           || 'Venda ' || v_short || ' cancelada em '
           || to_char(v_hoje, 'DD/MM/YYYY'))
   WHERE pu.ativo
     AND pu.venda_id = NEW.id
     AND pu.status = 'Vendida';

  -- 1.3 Cobrança. O elo com a venda é a descrição — `contas_receber` não tem
  -- `venda_id`, e é assim que a 203 já casa as duas pontas.
  UPDATE public.contas_receber cr
     SET status     = 'Cancelado',
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.descricao LIKE '%#' || v_short || '%'
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) = 0;

  -- Dinheiro que entrou fica, e fica VISÍVEL. `position` em vez de LIKE para
  -- não marcar duas vezes se o gatilho rodar de novo.
  UPDATE public.contas_receber cr
     SET descricao  = cr.descricao || v_marca,
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.descricao LIKE '%#' || v_short || '%'
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) > 0
     AND position(v_marca in cr.descricao) = 0;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_venda_cancelada_desfaz() IS
  'Desfaz os efeitos da venda ao cancelá-la (migr. 448): estoque, unidade serializada e contas a receber sem dinheiro movimentado. Conta com valor_pago > 0 fica marcada para o Financeiro decidir.';

DROP TRIGGER IF EXISTS trg_venda_cancelada_desfaz ON public.vendas;
CREATE TRIGGER trg_venda_cancelada_desfaz
  AFTER UPDATE OF status ON public.vendas
  FOR EACH ROW
  WHEN (NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada')
  EXECUTE FUNCTION public.fn_venda_cancelada_desfaz();

-- ── 2. O caixa deixa de cobrar a venda cancelada ────────────────────────────
--
-- Corpo copiado do banco (não do arquivo da migração antiga) e alterado só na
-- cláusula do `v_vendas_din`.

CREATE OR REPLACE FUNCTION public.solicitar_fechamento_caixa(
  p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text)
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

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     -- Migr. 448: venda cancelada devolveu o dinheiro ao cliente. Cobrá-la no
     -- esperado fazia o caixa fechar com falta do valor exato do cancelamento.
     AND COALESCE(status, '') <> 'Cancelada'
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

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

CREATE OR REPLACE FUNCTION public.fechar_caixa_conferido(
  p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text,
  p_origem text DEFAULT 'financeiro'::text)
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

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     -- Migr. 448: ver `solicitar_fechamento_caixa`. As duas contas o mesmo
     -- esperado; divergir aqui faria a conferência do Financeiro discordar do
     -- fechamento do operador.
     AND COALESCE(status, '') <> 'Cancelada'
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

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

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. gatilho no lugar
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.vendas'::regclass AND tgname = 'trg_venda_cancelada_desfaz';
--
--   -- 2. o filtro entrou nas duas RPCs de caixa — esperado: 2 linhas
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('solicitar_fechamento_caixa','fechar_caixa_conferido')
--      AND prosrc LIKE '%<> ''Cancelada''%';
--
--   -- 3. passivo: aparelho preso em venda cancelada — esperado: zero linhas
--   SELECT pu.imei, p.nome, v.status
--     FROM produto_unidades pu
--     JOIN vendas v   ON v.id = pu.venda_id
--     JOIN produtos p ON p.id = pu.produto_id
--    WHERE pu.ativo AND pu.status = 'Vendida' AND v.status = 'Cancelada';
--
--   -- 4. passivo: cobrança viva de venda cancelada — esperado: zero linhas
--   SELECT cr.descricao, cr.valor, cr.status
--     FROM contas_receber cr
--    WHERE cr.ativo AND cr.status NOT IN ('Cancelado')
--      AND COALESCE(cr.valor_pago, 0) = 0
--      AND EXISTS (SELECT 1 FROM vendas v
--                   WHERE v.status = 'Cancelada'
--                     AND cr.descricao LIKE '%#' || upper(right(v.id::text,6)) || '%');
--
-- Vendas canceladas ANTES desta migração não são varridas: o gatilho age na
-- transição. As sondas 3 e 4 mostram o passivo de quem já cancelou — corrigir
-- é decisão da turma, com a data e o valor que ela conhece.
--
-- O teste que vale a aula: vender um iPhone em dinheiro, cancelar a venda no
-- Histórico e conferir três coisas — a unidade voltou para 'Em estoque', a
-- conta a receber ficou 'Cancelado', e o fechamento do caixa NÃO acusa falta.
-- =================================================================
