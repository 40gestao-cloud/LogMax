-- Estoque: o razão passa a mandar no saldo, e "Ajuste" ganha sinal.
--
-- Três achados que nascem do mesmo trigger de 8 linhas:
--
--   E1  `fn_atualiza_estoque_produto` era `IF tipo='Saída' THEN subtrai ELSE
--       soma`. 'Ajuste' caía no ELSE: ajustar para corrigir contagem A MENOR
--       AUMENTAVA o estoque. A UI oferecia os 3 tipos lado a lado sem sinal.
--
--   E3  `GREATEST(0, estoque - qtd)` truncava em zero em silêncio. A
--       movimentação registrava a baixa cheia e o produto parava em 0 — razão
--       e saldo passavam a divergir sem erro nenhum.
--
--   E7  O trigger era AFTER INSERT apenas. Inativar (soft delete) ou corrigir
--       uma movimentação não mexia no saldo; o confirm da tela mandava o
--       operador "fazer ajuste manual" — usando justamente a ferramenta
--       quebrada pelo E1.
--
-- Consertar aqui conserta para TODOS os caminhos de escrita de uma vez (PDV,
-- Expedição, Recebimento, Aprovações de Estoque, ajuste manual), sem tocar em
-- nenhum deles. É o oposto de espalhar a regra pelas telas.
--
-- Fecha também E2: `fechar_inventario` gera o ajuste da diferença apurada. Um
-- inventário que não corrige o saldo é um formulário, não um inventário.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Vocabulário de tipos: 'Ajuste' vira 'Ajuste +' / 'Ajuste −'
-- ────────────────────────────────────────────────────────────────────────────
-- O 'Ajuste' histórico SOMAVA (era o que o ELSE fazia). Converter para
-- 'Ajuste +' preserva a verdade do que aconteceu — não reescreve a história
-- para o que deveria ter acontecido.
UPDATE public.movimentacoes_estoque SET tipo = 'Ajuste +' WHERE tipo = 'Ajuste';

ALTER TABLE public.movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS chk_mov_estoque_tipo;
ALTER TABLE public.movimentacoes_estoque
  ADD CONSTRAINT chk_mov_estoque_tipo
  CHECK (tipo IN ('Entrada', 'Saída', 'Ajuste +', 'Ajuste −'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Delta assinado — uma definição só de "o que este tipo faz com o saldo"
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mov_estoque_delta(p_tipo text, p_qtd numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_tipo IN ('Saída', 'Ajuste −') THEN -COALESCE(p_qtd, 0)
              ELSE COALESCE(p_qtd, 0) END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger de saldo: INSERT + UPDATE + DELETE, e recusa saldo negativo
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_atualiza_estoque_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta   numeric := 0;
  v_produto uuid;
  v_novo    numeric;
BEGIN
  -- Marca a transação como "permitida a mexer no estoque". A flag é resetada
  -- ao fim da transação (3º arg = true → is_local).
  PERFORM set_config('app.allow_estoque_update', 'true', true);

  -- Desfaz o efeito da linha antiga, aplica o da nova. Linha inativa não
  -- pesa no saldo — é assim que soft delete e edição passam a reverter.
  IF TG_OP <> 'INSERT' AND COALESCE((OLD).ativo, true) THEN
    v_delta   := v_delta - public.mov_estoque_delta((OLD).tipo, (OLD).qtd);
    v_produto := (OLD).produto_id;
  END IF;
  IF TG_OP <> 'DELETE' AND COALESCE((NEW).ativo, true) THEN
    v_delta   := v_delta + public.mov_estoque_delta((NEW).tipo, (NEW).qtd);
    v_produto := (NEW).produto_id;
  END IF;

  -- Movimentação trocando de produto: dois saldos mexem. Raro, mas se
  -- acontecer o caminho acima somaria tudo no produto errado.
  IF TG_OP = 'UPDATE' AND (OLD).produto_id IS DISTINCT FROM (NEW).produto_id THEN
    IF COALESCE((OLD).ativo, true) THEN
      UPDATE public.produtos
         SET estoque = estoque - public.mov_estoque_delta((OLD).tipo, (OLD).qtd)
       WHERE id = (OLD).produto_id;
    END IF;
    IF COALESCE((NEW).ativo, true) THEN
      UPDATE public.produtos
         SET estoque = estoque + public.mov_estoque_delta((NEW).tipo, (NEW).qtd)
       WHERE id = (NEW).produto_id
      RETURNING estoque INTO v_novo;
      IF v_novo < 0 THEN
        RAISE EXCEPTION 'Estoque insuficiente: a operação deixaria o produto com % unidade(s).', v_novo
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_delta <> 0 AND v_produto IS NOT NULL THEN
    UPDATE public.produtos
       SET estoque = estoque + v_delta
     WHERE id = v_produto
    RETURNING estoque INTO v_novo;

    -- Antes isto era GREATEST(0, ...): a baixa era truncada e ninguém sabia.
    -- Agora a transação inteira volta atrás, que é o que um estoque real faz.
    IF v_novo < 0 THEN
      RAISE EXCEPTION 'Estoque insuficiente: a operação deixaria o produto com % unidade(s).', v_novo
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_atualiza_estoque ON public.movimentacoes_estoque;
CREATE TRIGGER trg_atualiza_estoque
  AFTER INSERT OR UPDATE OR DELETE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_atualiza_estoque_produto();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Porta da frente do movimento manual
-- ────────────────────────────────────────────────────────────────────────────
-- Valida o que o trigger não tem como validar (filial de quem opera, produto
-- existente, quantidade positiva) e devolve a linha criada.

CREATE OR REPLACE FUNCTION public.movimentar_estoque(
  p_produto_id uuid,
  p_tipo       text,
  p_qtd        numeric,
  p_origem     text DEFAULT NULL,
  p_destino    text DEFAULT NULL,
  p_filial     text DEFAULT NULL
)
RETURNS public.movimentacoes_estoque
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prod public.produtos;
  v_mov  public.movimentacoes_estoque;
  v_fil  text;
BEGIN
  PERFORM public._assert_rpc('estoque', 'logistica', 'compras');

  IF p_tipo NOT IN ('Entrada', 'Saída', 'Ajuste +', 'Ajuste −') THEN
    RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  v_fil := COALESCE(p_filial, v_prod.filial);
  IF NOT public.auth_pode_filial(v_fil) THEN
    RAISE EXCEPTION 'Produto de outra filial.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
  VALUES (p_produto_id, p_tipo, p_qtd, p_origem, p_destino, public.acre_today(), v_fil)
  RETURNING * INTO v_mov;

  RETURN v_mov;  -- saldo negativo já teria estourado no trigger
END;
$$;

REVOKE ALL ON FUNCTION public.movimentar_estoque(uuid, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.movimentar_estoque(uuid, text, numeric, text, text, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. E2 — o inventário passa a fechar o ciclo
-- ────────────────────────────────────────────────────────────────────────────
-- `qtd_sistema` deixa de ser digitado: é lido do saldo no instante do
-- fechamento. A diferença apurada vira um 'Ajuste +/−' de verdade.

CREATE OR REPLACE FUNCTION public.fechar_inventario(
  p_inventario_id uuid,
  p_qtd_contada   numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv     public.inventarios;
  v_prod    public.produtos;
  v_sistema numeric;
  v_dif     numeric;
BEGIN
  PERFORM public._assert_rpc('estoque', 'logistica');

  IF p_qtd_contada IS NULL OR p_qtd_contada < 0 THEN
    RAISE EXCEPTION 'Informe a quantidade contada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM public.inventarios WHERE id = p_inventario_id FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Inventário não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.status = 'Concluído' THEN
    RAISE EXCEPTION 'Este inventário já foi fechado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_inv.produto_id FOR UPDATE;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto do inventário não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(COALESCE(v_inv.filial, v_prod.filial)) THEN
    RAISE EXCEPTION 'Inventário de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Saldo do sistema lido AGORA. Antes vinha digitado pelo mesmo operador que
  -- contava — dava para "fechar" um inventário digitando 100 e 100 sem abrir
  -- o depósito.
  v_sistema := COALESCE(v_prod.estoque, 0);
  v_dif     := p_qtd_contada - v_sistema;

  IF v_dif <> 0 THEN
    INSERT INTO public.movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES (
      v_inv.produto_id,
      CASE WHEN v_dif > 0 THEN 'Ajuste +' ELSE 'Ajuste −' END,
      abs(v_dif),
      'Inventário ' || to_char(COALESCE(v_inv.data, public.acre_today()), 'DD/MM/YYYY'),
      'Ajuste de contagem',
      public.acre_today(),
      COALESCE(v_inv.filial, v_prod.filial)
    );
  END IF;

  UPDATE public.inventarios
     SET qtd_sistema = v_sistema,
         qtd_contada = p_qtd_contada,
         diferenca   = v_dif,
         status      = 'Concluído'
   WHERE id = p_inventario_id;

  RETURN jsonb_build_object(
    'qtd_sistema', v_sistema,
    'qtd_contada', p_qtd_contada,
    'diferenca',   v_dif,
    'ajustado',    v_dif <> 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fechar_inventario(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechar_inventario(uuid, numeric) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. E4 — Expedição vira uma transação só, e o status volta a significar algo
-- ────────────────────────────────────────────────────────────────────────────
-- A tela inseria a expedição e depois a movimentação, sem transação e com
-- `catch { showToast("Erro.") }`. Falhando a segunda, ficava expedição
-- 'Expedido' sem baixa de estoque.
--
-- Pior: a baixa só ocorria no INSERT com status já 'Expedido', e a tela não
-- tem edição. Expedição criada 'Pendente' nunca baixava estoque e não havia
-- como avançá-la — o status era decoração.

CREATE OR REPLACE FUNCTION public.expedir(p_expedicao_id uuid)
RETURNS public.expedicao
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exp  public.expedicao;
  v_prod public.produtos;
  v_dest text;
BEGIN
  PERFORM public._assert_rpc('estoque', 'logistica');

  SELECT * INTO v_exp FROM public.expedicao WHERE id = p_expedicao_id FOR UPDATE;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expedição não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.auth_pode_filial(v_exp.filial) THEN
    RAISE EXCEPTION 'Expedição de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_exp.status = 'Expedido' THEN
    RAISE EXCEPTION 'Esta expedição já foi expedida.' USING ERRCODE = 'P0001';
  END IF;
  IF v_exp.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Expedição cancelada não pode ser expedida.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_exp.qtd_expedida, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade a expedir inválida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_exp.produto_id;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto da expedição não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT destino INTO v_dest FROM public.requisicoes_estoque WHERE id = v_exp.requisicao_id;

  -- Saldo insuficiente estoura aqui dentro (trigger) e desfaz tudo.
  INSERT INTO public.movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
  VALUES (v_exp.produto_id, 'Saída', v_exp.qtd_expedida, 'Expedição',
          COALESCE(v_dest, 'Expedido'), public.acre_today(), v_exp.filial);

  UPDATE public.expedicao
     SET status = 'Expedido',
         data_expedicao = COALESCE(data_expedicao, public.acre_today())
   WHERE id = p_expedicao_id
  RETURNING * INTO v_exp;

  RETURN v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.expedir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expedir(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Razão x saldo devem bater (0 divergentes):
-- WITH led AS (
--   SELECT produto_id, sum(mov_estoque_delta(tipo, qtd)) AS ledger
--     FROM movimentacoes_estoque WHERE COALESCE(ativo,true) GROUP BY 1)
-- SELECT count(*) FILTER (WHERE p.estoque <> l.ledger) AS divergentes
--   FROM led l JOIN produtos p ON p.id = l.produto_id;
--
-- 2) Saída acima do saldo deve ERRAR (e não truncar em zero):
-- SELECT movimentar_estoque('<produto_uuid>', 'Saída', 999999);
--
-- 3) Nenhum 'Ajuste' sem sinal deve sobrar:
-- SELECT count(*) FROM movimentacoes_estoque WHERE tipo = 'Ajuste';
