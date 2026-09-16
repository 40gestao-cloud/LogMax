-- 601 — Preço de venda abaixo do custo passa a ser escolha, não engano
--
-- Em 2026-09-15 a turma da contabilidade cadastrou produto com o preço de custo
-- maior que o de venda: os dois campos são vizinhos no formulário e foram
-- preenchidos trocados. O catálogo passou a mostrar prejuízo por unidade, o
-- markup nasceu negativo e o CMV do DRE ficaria maior que a receita. A turma
-- corrigiu na mão; nada impedia a repetição.
--
-- O que a tela já fazia: pintar o markup de vermelho. Não bastou — vermelho ali
-- também quer dizer "markup baixo", que é situação normal, então o aviso não se
-- distinguia do ruído.
--
-- Vender abaixo do custo EXISTE no varejo: promoção-isca, queima de validade,
-- liquidação de mostruário. Por isso a regra não é proibir, é separar a decisão
-- do engano — quem decide marca `venda_abaixo_custo` no produto (a caixa
-- aparece no cadastro só quando o caso acontece); quem trocou os campos leva o
-- bloqueio com os dois números na frente.
--
-- Os dois gatilhos abaixo fecham as portas que a tela não cobre (F12,
-- importação por planilha, correção direta):
--   1. `produtos`      — mudar o PREÇO para baixo do custo apurado;
--   2. `produtos_custo` — mudar o CUSTO à mão para cima do preço de venda.
--
-- O RECEBIMENTO NÃO É BLOQUEADO, de propósito. A entrada grava custo com
-- `origem = 'compra'` (média ponderada, migr. 417): se a compra saiu mais cara
-- que o preço de tabela, isso é um fato do mundo, e recusar a entrada deixaria
-- a mercadoria sem dar baixa na doca por causa de um preço que ainda vai ser
-- revisto. O produto fica marcado no catálogo (markup negativo à vista) e a
-- revisão do preço acontece no cadastro — onde a régua pega.
--
-- Nota de escopo: o gatilho compara com o custo que existir, qualquer que seja
-- a origem. Não bloquear preço abaixo de custo apurado seria deixar passar
-- justamente o caso que o DRE mais sente.

SET lock_timeout = '3s';

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS venda_abaixo_custo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.produtos.venda_abaixo_custo IS
  'Migr. 601: decisão consciente de vender abaixo do custo (promoção-isca, queima de validade). Sem isto, preço menor que o custo é recusado — o caso comum é o preço de custo e o de venda digitados trocados.';

CREATE OR REPLACE FUNCTION public.produto_preco_nao_fica_abaixo_do_custo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_custo numeric;
BEGIN
  IF COALESCE(NEW.venda_abaixo_custo, false) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.preco, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT c.preco_custo INTO v_custo FROM public.produtos_custo c WHERE c.produto_id = NEW.id;
  IF v_custo IS NULL OR v_custo <= 0 THEN RETURN NEW; END IF;

  IF NEW.preco < v_custo THEN
    RAISE EXCEPTION 'Preço de venda (R$ %) abaixo do preço de custo (R$ %) em "%". Confira se os dois campos não estão trocados; se a venda abaixo do custo for proposital, marque a caixa ao lado do preço de venda.',
      to_char(NEW.preco, 'FM999G999G990D00'), to_char(v_custo, 'FM999G999G990D00'), NEW.nome
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_produto_preco_abaixo_do_custo ON public.produtos;
CREATE TRIGGER trg_produto_preco_abaixo_do_custo
  BEFORE INSERT OR UPDATE OF preco, venda_abaixo_custo ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.produto_preco_nao_fica_abaixo_do_custo();

CREATE OR REPLACE FUNCTION public.custo_manual_nao_passa_do_preco_de_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_preco numeric;
  v_nome  text;
  v_excecao boolean;
BEGIN
  -- Só o custo digitado à mão. `origem = 'compra'` é a média ponderada que o
  -- recebimento apura e não pode ser recusada: a mercadoria já chegou.
  IF COALESCE(NEW.origem, 'manual') <> 'manual' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.preco_custo, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT p.preco, p.nome, COALESCE(p.venda_abaixo_custo, false)
    INTO v_preco, v_nome, v_excecao
    FROM public.produtos p WHERE p.id = NEW.produto_id;

  IF v_excecao OR v_preco IS NULL OR v_preco <= 0 THEN RETURN NEW; END IF;

  IF NEW.preco_custo > v_preco THEN
    RAISE EXCEPTION 'Preço de custo (R$ %) acima do preço de venda (R$ %) em "%". Confira se os dois campos não estão trocados; se a venda abaixo do custo for proposital, marque a caixa ao lado do preço de venda.',
      to_char(NEW.preco_custo, 'FM999G999G990D00'), to_char(v_preco, 'FM999G999G990D00'), v_nome
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_custo_manual_acima_do_preco ON public.produtos_custo;
CREATE TRIGGER trg_custo_manual_acima_do_preco
  BEFORE INSERT OR UPDATE OF preco_custo, origem ON public.produtos_custo
  FOR EACH ROW EXECUTE FUNCTION public.custo_manual_nao_passa_do_preco_de_venda();

RESET lock_timeout;
