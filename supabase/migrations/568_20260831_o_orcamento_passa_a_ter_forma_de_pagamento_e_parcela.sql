-- O orçamento passa a ter forma de pagamento — e a forma passa a mexer no preço.
--
-- Hoje a proposta comercial tem UM número de preço e um campo livre de
-- desconto que o vendedor digita de cabeça. Não existe "à vista no Pix" nem
-- "em 6x no cartão": o aluno aprende que preço é um número, quando na loja
-- real preço é sempre **preço + condição**.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE O PARÂMETRO JÁ MORAVA
--
-- `formas_pagamento` existe desde o começo (Empresa → Formas de Pagamento) e
-- as turmas JÁ a preencheram por filial — "Cartão de Crédito 5x" taxa 5.49
-- prazo 30, "Crediário da Loja", "Cartão de Débito" taxa 1.99 prazo 1. É um
-- cadastro vivo que não alimentava absolutamente nada: nenhuma função do banco
-- e nenhuma tela liam essa tabela. Esta migração não inventa cadastro novo —
-- liga o que o aluno já cadastrou ao preço que ele propõe.
--
-- `taxa` e `prazo` eram `text` e por isso guardavam "0%", "2.5%", "Imediato",
-- "3 dias úteis". Parâmetro que entra em conta não pode ser texto livre: as
-- duas viram numéricas aqui, extraindo o primeiro número de cada valor já
-- gravado ("3 dias úteis" → 3, "Imediato" → 0, "2.5%" → 2.5).
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS TRÊS COISAS QUE A FORMA DE PAGAMENTO DECIDE
--
--   1. DESCONTO À VISTA (`desconto_percentual`) — o que a loja abre de preço
--      para receber agora. Pix e dinheiro.
--
--   2. JUROS AO CLIENTE (`juros_mensal`, `parcelas_sem_juros`) — o que o
--      cliente paga a mais por parcelar. Calculado pela **Tabela Price**, que é
--      como a parcela nasce na vida real: P = base · i / (1 − (1+i)^−n).
--      Somar base · i · n seria juros simples, e ensinaria errado.
--
--   3. TAXA DA ADQUIRENTE (`taxa`) — o que a maquininha come. É CUSTO DA LOJA,
--      não preço do cliente: o cliente paga R$ 100 e entram R$ 96,51. Por isso
--      ela NÃO entra no `valor_total`; sai dele, em `valor_liquido`. Confundir
--      as duas é o erro clássico de quem acha que "repassar a taxa" e "cobrar
--      juros" são a mesma coisa.
--
-- `exige_limite_credito` marca a forma que é crédito da própria loja
-- (crediário): aí quem financia é a filial, e o teto é o `limite_credito` do
-- cliente que a migr. 416 criou.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUEM CALCULA É O BANCO
--
-- Mesma régua da migr. 554 ("o preço da venda vem do catálogo, não do
-- carrinho"): a tela mostra a conta para o aluno enxergar, mas o número que
-- fica gravado é o que o gatilho recalcula. Tela e banco calculando cada um o
-- seu é como se descobre, seis semanas depois, que a proposta impressa não
-- bate com o título gerado.
--
-- O gatilho só revalida quando o que mexe no preço mudou (forma, parcelas,
-- subtotal, desconto). Sem isso, aprovar uma proposta cuja forma o aluno
-- inativou no meio do caminho estouraria exceção no Financeiro — o preço já
-- estava combinado, e mudar cadastro não pode derrubar documento em curso.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PARCELAR É GERAR N TÍTULOS
--
-- `converter_orcamento_em_pedido` gerava UMA conta a receber com vencimento
-- fixo em D+30, sempre. Crediário em 6x tem seis vencimentos, e é isso que a
-- fila do Financeiro precisa mostrar. O centavo da divisão vai na ÚLTIMA
-- parcela — 100,00 em 3x é 33,33 + 33,33 + 33,34, e não três de 33,33 que
-- somam 99,99.
--
-- `contas_receber` ganha `pedido_venda_id` porque `pedidos_venda.conta_receber_id`
-- é uma coluna só e agora há N títulos. Sem isso `cancelar_pedido_venda`
-- cancelaria a 1ª parcela e deixaria as outras cinco cobrando um pedido que
-- não existe mais — e a checagem de "já recebeu do cliente" olharia só a
-- primeira. As duas coisas estão corrigidas na migração seguinte (569).
--
-- COMPATÍVEL COM O QUE JÁ EXISTE: orçamento sem forma de pagamento (todos os
-- atuais) continua exatamente como antes — 1 título, D+30.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. `formas_pagamento` vira parâmetro de verdade
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.formas_pagamento
  ADD COLUMN IF NOT EXISTS desconto_percentual  numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS juros_mensal         numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parcelas_max         integer      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parcelas_sem_juros   integer      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS intervalo_dias       integer      NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS exige_limite_credito boolean      NOT NULL DEFAULT false;

-- `taxa` e `prazo`: texto livre → número. O `substring` pega o primeiro número
-- do que estiver lá e o COALESCE devolve 0 para o que não tem número nenhum
-- ("Imediato"). Cast direto (`::numeric`) quebraria em metade das linhas.
--
-- O grupo é `(?:...)`, NÃO-CAPTURANTE, e isso não é preciosismo: `substring`
-- devolve a primeira subexpressão entre parênteses quando ela existe, e não o
-- casamento inteiro. Com `([0-9]+)?` capturante, "2.5%" virava 0.5 e "5,49"
-- virava 0.49 — a taxa da maquininha entrava no banco dez vezes menor.
-- Conferido rodando as duas versões sobre os valores reais das turmas.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'formas_pagamento'
          AND column_name = 'taxa') = 'text' THEN
    ALTER TABLE public.formas_pagamento ALTER COLUMN taxa DROP DEFAULT;
    ALTER TABLE public.formas_pagamento
      ALTER COLUMN taxa TYPE numeric(6,3)
      USING COALESCE(
        (substring(replace(taxa, ',', '.') from '[0-9]+(?:\.[0-9]+)?'))::numeric,
        0);
    ALTER TABLE public.formas_pagamento ALTER COLUMN taxa SET DEFAULT 0;
    ALTER TABLE public.formas_pagamento ALTER COLUMN taxa SET NOT NULL;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'formas_pagamento'
          AND column_name = 'prazo') = 'text' THEN
    ALTER TABLE public.formas_pagamento ALTER COLUMN prazo DROP DEFAULT;
    ALTER TABLE public.formas_pagamento
      ALTER COLUMN prazo TYPE integer
      USING COALESCE((substring(prazo from '[0-9]+'))::integer, 0);
    ALTER TABLE public.formas_pagamento ALTER COLUMN prazo SET DEFAULT 0;
    ALTER TABLE public.formas_pagamento ALTER COLUMN prazo SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.formas_pagamento.taxa IS
  'Taxa da adquirente em %. CUSTO DA LOJA: sai do que ela recebe, não entra no preço do cliente.';
COMMENT ON COLUMN public.formas_pagamento.prazo IS
  'Dias até o dinheiro entrar (D+n). Vence a 1ª parcela do título. Pix/dinheiro = 0.';
COMMENT ON COLUMN public.formas_pagamento.desconto_percentual IS
  'Desconto à vista em % sobre o líquido de mercadoria. O que a loja abre para receber agora.';
COMMENT ON COLUMN public.formas_pagamento.juros_mensal IS
  'Juros ao cliente, % ao mês, aplicado pela Tabela Price acima de parcelas_sem_juros.';
COMMENT ON COLUMN public.formas_pagamento.parcelas_sem_juros IS
  'Até quantas parcelas a loja não cobra juros. 1 = já a 2ª parcela tem juros.';
COMMENT ON COLUMN public.formas_pagamento.intervalo_dias IS
  'Dias entre uma parcela e a seguinte.';
COMMENT ON COLUMN public.formas_pagamento.exige_limite_credito IS
  'true = crédito da própria loja (crediário). A conversão em pedido cobra limite e adimplência do cliente.';

-- Faixas: parâmetro fora delas não é política agressiva, é dedo escorregando.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.formas_pagamento'::regclass
                    AND conname  = 'formas_pagamento_parametros_validos') THEN
    ALTER TABLE public.formas_pagamento
      ADD CONSTRAINT formas_pagamento_parametros_validos CHECK (
        taxa                >= 0 AND taxa                <= 100 AND
        desconto_percentual >= 0 AND desconto_percentual <= 100 AND
        juros_mensal        >= 0 AND juros_mensal        <= 100 AND
        prazo               >= 0 AND
        parcelas_max        >= 1 AND parcelas_max <= 36 AND
        parcelas_sem_juros  >= 1 AND
        intervalo_dias      >= 1
      );
  END IF;
END $$;

-- Campo numérico deixado em branco na tela de Cadastros chega aqui como 0, e
-- 0 parcela não existe — o CHECK acima recusaria a linha e o aluno veria um
-- erro de banco ao cadastrar uma forma nova. A normalização mora na tabela, e
-- não num `|| 1` da tela, porque vale para todo caminho de escrita.
CREATE OR REPLACE FUNCTION public.fn_formas_pagamento_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.parcelas_max       := GREATEST(1, COALESCE(NEW.parcelas_max, 1));
  NEW.parcelas_sem_juros := GREATEST(1, COALESCE(NEW.parcelas_sem_juros, 1));
  NEW.intervalo_dias     := GREATEST(1, COALESCE(NEW.intervalo_dias, 30));
  NEW.prazo              := GREATEST(0, COALESCE(NEW.prazo, 0));
  NEW.taxa               := GREATEST(0, COALESCE(NEW.taxa, 0));
  NEW.desconto_percentual := GREATEST(0, COALESCE(NEW.desconto_percentual, 0));
  NEW.juros_mensal        := GREATEST(0, COALESCE(NEW.juros_mensal, 0));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_formas_pagamento_normaliza ON public.formas_pagamento;
CREATE TRIGGER trg_formas_pagamento_normaliza
  BEFORE INSERT OR UPDATE ON public.formas_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_formas_pagamento_normaliza();

-- Semente sobre o que as turmas JÁ cadastraram. Só toca em linha que continua
-- com os defaults — quem já calibrou o parâmetro não é sobrescrito, e rodar
-- duas vezes não muda nada na segunda.
UPDATE public.formas_pagamento SET
  desconto_percentual = 5,
  parcelas_max        = 1
 WHERE parcelas_max = 1 AND juros_mensal = 0 AND desconto_percentual = 0
   AND (descricao ILIKE '%pix%' OR descricao ILIKE '%dinheiro%'
        OR descricao ILIKE '%espécie%' OR descricao ILIKE '%especie%');

UPDATE public.formas_pagamento SET
  parcelas_max         = 10,
  parcelas_sem_juros   = 1,
  juros_mensal         = 3.5,
  intervalo_dias       = 30,
  exige_limite_credito = true
 WHERE parcelas_max = 1 AND juros_mensal = 0 AND desconto_percentual = 0
   AND (descricao ILIKE '%crediário%' OR descricao ILIKE '%crediario%'
        OR descricao ILIKE '%fiado%');

UPDATE public.formas_pagamento SET
  parcelas_max       = 12,
  parcelas_sem_juros = 3,
  juros_mensal       = 2.99,
  intervalo_dias     = 30
 WHERE parcelas_max = 1 AND juros_mensal = 0 AND desconto_percentual = 0
   AND (descricao ILIKE '%crédito%' OR descricao ILIKE '%credito%')
   AND descricao NOT ILIKE '%crediá%' AND descricao NOT ILIKE '%credia%';

UPDATE public.formas_pagamento SET
  parcelas_max       = 3,
  parcelas_sem_juros = 3,
  intervalo_dias     = 30
 WHERE parcelas_max = 1 AND juros_mensal = 0 AND desconto_percentual = 0
   AND descricao ILIKE '%boleto%';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O orçamento guarda a condição — e o que ela fez com o preço
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS forma_pagamento_id uuid REFERENCES public.formas_pagamento(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forma_pagamento    text,
  ADD COLUMN IF NOT EXISTS parcelas           integer       NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS desconto_condicao  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acrescimo_juros    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_parcela      numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_adquirente    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_liquido      numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orcamentos.desconto IS
  'Desconto COMERCIAL — o que o vendedor negociou. Separado do desconto da forma de pagamento.';
COMMENT ON COLUMN public.orcamentos.desconto_condicao IS
  'Desconto que veio da forma de pagamento (à vista). Calculado pelo banco.';
COMMENT ON COLUMN public.orcamentos.acrescimo_juros IS
  'Juros do parcelamento (Tabela Price) somados ao preço. Calculado pelo banco.';
COMMENT ON COLUMN public.orcamentos.taxa_adquirente IS
  'Custo estimado da maquininha. NÃO está dentro de valor_total — está descontado em valor_liquido.';
COMMENT ON COLUMN public.orcamentos.valor_liquido IS
  'O que a loja espera receber de fato: valor_total menos a taxa da adquirente.';
COMMENT ON COLUMN public.orcamentos.forma_pagamento IS
  'Snapshot da descrição da forma no momento da proposta — o cadastro pode mudar de nome depois.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.orcamentos'::regclass
                    AND conname  = 'orcamentos_parcelas_positivas') THEN
    ALTER TABLE public.orcamentos
      ADD CONSTRAINT orcamentos_parcelas_positivas CHECK (parcelas >= 1 AND parcelas <= 36);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orcamentos_forma_pagamento
  ON public.orcamentos(forma_pagamento_id) WHERE ativo;

-- ── O gatilho que faz a conta ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_orcamento_condicao_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  f         public.formas_pagamento;
  v_base    numeric(16,4);
  v_i       numeric(16,8);
  v_parcela numeric(16,4);
  v_total   numeric(12,2);
BEGIN
  -- Só recalcula quando mexeram no que forma o preço. Um UPDATE de status
  -- (aprovar, enviar ao cliente) não pode reabrir a negociação — nem estourar
  -- porque alguém inativou a forma no cadastro no meio do caminho.
  IF TG_OP = 'UPDATE'
     AND NEW.forma_pagamento_id IS NOT DISTINCT FROM OLD.forma_pagamento_id
     AND NEW.parcelas           IS NOT DISTINCT FROM OLD.parcelas
     AND NEW.subtotal           IS NOT DISTINCT FROM OLD.subtotal
     AND NEW.desconto           IS NOT DISTINCT FROM OLD.desconto THEN
    RETURN NEW;
  END IF;

  NEW.parcelas := GREATEST(1, COALESCE(NEW.parcelas, 1));
  -- O desconto comercial vem PRIMEIRO: o desconto da forma incide sobre o que
  -- de fato está sendo cobrado, não sobre a tabela cheia.
  v_base := GREATEST(0, COALESCE(NEW.subtotal, 0) - COALESCE(NEW.desconto, 0));

  IF NEW.forma_pagamento_id IS NULL THEN
    NEW.forma_pagamento   := NULL;
    NEW.parcelas          := 1;
    NEW.desconto_condicao := 0;
    NEW.acrescimo_juros   := 0;
    NEW.taxa_adquirente   := 0;
    NEW.valor_total       := round(v_base, 2);
    NEW.valor_parcela     := NEW.valor_total;
    NEW.valor_liquido     := NEW.valor_total;
    RETURN NEW;
  END IF;

  SELECT * INTO f FROM public.formas_pagamento
   WHERE id = NEW.forma_pagamento_id AND COALESCE(ativo, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forma de pagamento não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF f.status <> 'Ativo' THEN
    RAISE EXCEPTION 'A forma de pagamento "%" está inativa no cadastro.', f.descricao
      USING ERRCODE = 'P0001';
  END IF;
  IF f.filial <> NEW.filial THEN
    RAISE EXCEPTION 'A forma de pagamento "%" é da unidade %; este orçamento é da %.',
      f.descricao, f.filial, NEW.filial USING ERRCODE = 'P0001';
  END IF;
  IF NEW.parcelas > f.parcelas_max THEN
    RAISE EXCEPTION '"%" aceita no máximo % parcela(s) — a proposta pediu %.',
      f.descricao, f.parcelas_max, NEW.parcelas USING ERRCODE = 'P0001';
  END IF;

  NEW.forma_pagamento   := f.descricao;
  NEW.desconto_condicao := round(v_base * COALESCE(f.desconto_percentual, 0) / 100, 2);
  v_base                := v_base - NEW.desconto_condicao;

  IF NEW.parcelas > COALESCE(f.parcelas_sem_juros, 1) AND COALESCE(f.juros_mensal, 0) > 0 THEN
    -- Tabela Price. `power(1+i, -n)` é o fator de valor presente; a parcela é a
    -- que zera a dívida em n períodos. Total = parcela × n, e o que passa do
    -- principal é juro.
    v_i       := f.juros_mensal / 100.0;
    v_parcela := v_base * v_i / (1 - power(1 + v_i, -NEW.parcelas));
    v_total   := round(v_parcela * NEW.parcelas, 2);
    NEW.acrescimo_juros := v_total - round(v_base, 2);
  ELSE
    v_total := round(v_base, 2);
    NEW.acrescimo_juros := 0;
  END IF;

  NEW.valor_total     := v_total;
  NEW.valor_parcela   := round(v_total / NEW.parcelas, 2);
  -- A taxa da maquininha NÃO entra no preço: ela sai do que a loja recebe.
  NEW.taxa_adquirente := round(v_total * COALESCE(f.taxa, 0) / 100, 2);
  NEW.valor_liquido   := v_total - NEW.taxa_adquirente;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_condicao_pagamento ON public.orcamentos;
CREATE TRIGGER trg_condicao_pagamento
  BEFORE INSERT OR UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_orcamento_condicao_pagamento();

-- A trilha do documento passa a guardar a condição: mudar de "Pix à vista"
-- para "12x no cartão" é mudança de proposta, e tem de aparecer na auditoria.
DROP TRIGGER IF EXISTS trg_historico ON public.orcamentos;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'valor_total', 'desconto', 'cliente_id', 'forma_pagamento', 'parcelas');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. O título sabe de que pedido veio
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS pedido_venda_id uuid REFERENCES public.pedidos_venda(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contas_receber.pedido_venda_id IS
  'Pedido de venda que gerou o título. Com parcelamento há N títulos por pedido — pedidos_venda.conta_receber_id aponta só para o primeiro.';

CREATE INDEX IF NOT EXISTS idx_contas_receber_pedido_venda
  ON public.contas_receber(pedido_venda_id) WHERE ativo;

-- Os pedidos que já existem passam a ter o elo dos dois lados.
UPDATE public.contas_receber cr
   SET pedido_venda_id = pv.id
  FROM public.pedidos_venda pv
 WHERE pv.conta_receber_id = cr.id
   AND cr.pedido_venda_id IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
