-- 516_20260824_servico_prestado_nao_e_servico_contratado.sql
--
-- ── O erro de endereço da migr. 499 ─────────────────────────────────────
-- `servicos` nasceu como o catálogo do que a filial PRESTA. Os atributos por
-- nicho são todos de venda — TechMax tem "Troca de tela", marcas atendidas e
-- garantia obrigatória; MaxLook tem "Ajuste de bainha"; SuperMax tem entrega
-- e corte no açougue — e `valor` significa PREÇO ao cliente.
--
-- A 499 apontou o pedido de COMPRA para essa mesma tabela, para tirar a
-- requisição de serviço do beco em que a 480 a deixou. O mecanismo estava
-- certo (item de pedido sem saldo, recebimento = aceite da execução); o
-- catálogo é que estava errado.
--
-- Com mercadoria a fusão não incomoda: o que se compra é o que se vende. Com
-- serviço não fecha — prestado é a SAÍDA da empresa, contratado é a saída de
-- outra. Na prática: o comprador que precisa de dedetização abre "Serviço do
-- catálogo" e vê "Troca de tela — R$ 150"; e para conseguir comprar, cadastra
-- "Dedetização" no catálogo que a loja OFERECE, com preço, garantia e marcas
-- atendidas. O mesmo cadastro ainda entraria em promoção de marketing.
--
-- É a distinção que o SAP faz entre serviço vendido (material tipo DIEN, do
-- lado de vendas) e serviço comprado (cadastro de serviço, usado na folha de
-- medição do pedido).
--
-- ── Por que coluna e não tabela nova ────────────────────────────────────
-- Tabela separada duplicaria cadastro, lixeira, RLS, imagem e a tela inteira
-- para um catálogo que hoje tem ZERO linhas nos 4 projetos (conferido em
-- 24/08, junto com 0 pedidos de serviço). A coluna separa as duas listas onde
-- elas se encontram — que são três selects e uma RPC.
--
-- Default 'prestado': é o que a tabela sempre foi, e é o que qualquer linha
-- criada antes desta migração significava.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A coluna
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS natureza text NOT NULL DEFAULT 'prestado';

ALTER TABLE public.servicos DROP CONSTRAINT IF EXISTS chk_servicos_natureza;
ALTER TABLE public.servicos
  ADD CONSTRAINT chk_servicos_natureza CHECK (natureza IN ('prestado', 'contratado'));

COMMENT ON COLUMN public.servicos.natureza IS
  'Quem presta (migr. 516). prestado = a unidade executa e cobra do cliente (catálogo de venda: preço, garantia, promoção). contratado = a unidade paga a um fornecedor (item de pedido de compra; o recebimento é o aceite da execução). Só o contratado entra em cotação e pedido.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O pedido só compra o que é contratado
-- ────────────────────────────────────────────────────────────────────────────
-- Sem isto a separação viveria só nos selects da tela, e o F12 não passa pela
-- tela. Mesma régua da 515: edição cirúrgica sobre a função VIGENTE, abortando
-- se a âncora não estiver lá.
DO $mig$
DECLARE
  v_def text;
  v_ancora text := $a$        v_serv.nome, v_serv.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  END IF;$a$;
  v_novo text := $n$        v_serv.nome, v_serv.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
    -- MIGR 516: o catálogo de venda não é lista de compras. Serviço prestado é
    -- a saída da unidade — comprá-lo de um fornecedor seria a loja contratando
    -- o próprio serviço que ela oferece.
    IF COALESCE(v_serv.natureza, 'prestado') <> 'contratado' THEN
      RAISE EXCEPTION '"%" é um serviço PRESTADO pela unidade (é o que ela vende ao cliente), e não um serviço contratado de terceiro. Só serviço contratado vira pedido de compra. Cadastre o que está sendo contratado em Cadastros > Serviços, marcando a natureza como "Contratado de terceiro" — ou, se este cadastro já é o certo, corrija a natureza dele.',
        v_serv.nome USING ERRCODE = 'P0001';
    END IF;
  END IF;$n$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'gerar_pedido_de_cotacao' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 516: gerar_pedido_de_cotacao não existe neste projeto.';
  END IF;
  IF position('MIGR 516' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_ancora in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 516: âncora do bloco de serviço não encontrada em gerar_pedido_de_cotacao — abortando em vez de recriar a função às cegas.';
  END IF;

  EXECUTE replace(v_def, v_ancora, v_novo);
END
$mig$;

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   SELECT natureza, count(*) FROM servicos GROUP BY 1;   -- tudo 'prestado'
--   SELECT position('MIGR 516' in pg_get_functiondef(oid)) > 0
--     FROM pg_proc WHERE proname = 'gerar_pedido_de_cotacao';
