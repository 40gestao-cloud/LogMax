-- 463_20260817_o_orcamento_nunca_virava_pedido.sql
--
-- UM `::text` DE SOBRA DERRUBAVA A CONVERSÃO INTEIRA.
--
-- `converter_orcamento_em_pedido` avisa dois setores no fim, e as duas
-- chamadas passam a referência assim:
--
--   p_ref_id     => v_pedido_id::text
--
-- `notificar_setor` declara `p_ref_id uuid`. E **não existe cast implícito de
-- `text` para `uuid`** no Postgres — conferido em `pg_cast`, que não tem a
-- linha nem numa direção nem na outra. A resolução de função exige cast
-- implícito, então a chamada não encontra assinatura nenhuma e a função aborta
-- com:
--
--   ERROR 42883: function notificar_setor(..., p_ref_id => text) does not exist
--
-- Comprovado sem executar a função, forçando a mesma resolução com uma RPC
-- que só lê:
--
--   SELECT public.lixeira_vinculos('produtos', '000...'::text);
--   → ERROR 42883: function public.lixeira_vinculos(unknown, text) does not exist
--
-- Como o `PERFORM` acontece DEPOIS de inserir o pedido, a conta a receber e de
-- marcar o orçamento como convertido, a transação inteira volta atrás. O
-- orçamento continua "Aprovado Financeiro" e o pedido de venda nunca nasce —
-- sem mensagem útil para quem clicou, porque o erro fala de uma função de
-- notificação que o usuário não sabe que existe.
--
-- Isto não é ajuste cosmético: **o fluxo Orçamento → Pedido de Venda nunca
-- funcionou**. `pedidos_venda` está zerada nas 4 turmas, e `historico_operacoes`
-- — que tem 2.348 registros de 15 entidades e um `trg_historico` ativo tanto em
-- `orcamentos` quanto em `pedidos_venda` — não guarda um único registro de
-- nenhuma das duas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE ESCAPOU
--
-- PL/pgSQL não valida chamadas de função na criação: o corpo é texto até a
-- primeira execução. Uma função que ninguém exercitou pode carregar um erro
-- fatal por meses sem que `tsc`, teste ou revisão de código percebam — e a
-- tela de Orçamentos existe desde julho.
--
-- É o oposto do padrão que esta auditoria perseguiu o dia todo. Os outros
-- quinze achados eram silenciosos por darem número errado; este é silencioso
-- por nunca ter dado número nenhum.
--
-- A CORREÇÃO É TIRAR O CAST
--
-- `v_pedido_id` já é `uuid`. Das três ocorrências de `v_pedido_id::text` no
-- corpo, duas são as chamadas (logística e financeiro) e a terceira é legítima
-- — `UPPER(SUBSTRING(v_pedido_id::text, 1, 8))`, que monta o número do pedido
-- na descrição e continua exatamente como está. O padrão de busca inclui o
-- `p_ref_id     =>` justamente para não encostar nela.
--
-- Mesma técnica da migr. 462: lê o corpo vigente, troca o que precisa, e
-- aborta se o padrão não bater. Conferido antes de escrever — o padrão casa 2
-- vezes e sobra 1 ocorrência intacta.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DO $do$
DECLARE
  v_def  text;
  v_novo text;
  v_n    int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'converter_orcamento_em_pedido';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'converter_orcamento_em_pedido não encontrada.';
  END IF;

  SELECT count(*) INTO v_n
    FROM regexp_matches(v_def, 'p_ref_id     => v_pedido_id::text', 'g');

  -- Já corrigida (reaplicação) — sai sem tocar em nada.
  IF v_n = 0 THEN
    IF position('p_ref_id     => v_pedido_id' in v_def) > 0 THEN
      RAISE NOTICE 'converter_orcamento_em_pedido já está corrigida.';
      RETURN;
    END IF;
    RAISE EXCEPTION
      'converter_orcamento_em_pedido: a chamada de notificar_setor mudou — revise a migr. 463 antes de aplicar.';
  END IF;

  IF v_n <> 2 THEN
    RAISE EXCEPTION
      'converter_orcamento_em_pedido: esperava 2 chamadas com o cast, achei %. Revise a migr. 463.', v_n;
  END IF;

  v_novo := replace(v_def,
    'p_ref_id     => v_pedido_id::text',
    'p_ref_id     => v_pedido_id');

  -- A do SUBSTRING tem de sobrar: ela monta o número do pedido, não é
  -- referência de notificação.
  SELECT count(*) INTO v_n FROM regexp_matches(v_novo, 'v_pedido_id::text', 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'converter_orcamento_em_pedido: depois da troca sobraram % casts em vez de 1 (o do número do pedido). Revise a migr. 463.', v_n;
  END IF;

  EXECUTE v_novo;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. nenhuma referência de notificação sai como texto — esperado: 0
--   SELECT count(*) FROM regexp_matches(
--     (SELECT prosrc FROM pg_proc WHERE proname = 'converter_orcamento_em_pedido'),
--     'p_ref_id     => v_pedido_id::text', 'g');
--
--   -- 2. o número do pedido continua sendo montado — esperado: 1
--   SELECT count(*) FROM regexp_matches(
--     (SELECT prosrc FROM pg_proc WHERE proname = 'converter_orcamento_em_pedido'),
--     'v_pedido_id::text', 'g');
--
--   -- 3. ninguém mais passa texto onde a assinatura pede uuid.
--   --    `abrir_revisao_auditoria` e `fn_pedido_avisa_estoque` já passavam uuid.
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosrc LIKE '%p_ref_id%::text%';
--   -- esperado: zero linhas
--
-- O teste que vale a aula — e que nunca passou até hoje: criar um orçamento,
-- aprovar no Financeiro e converter em pedido de venda. O pedido tem de
-- aparecer em Estoque › Pedidos de Venda, com a conta a receber criada e o
-- sino aceso para a logística e para o financeiro.
-- =================================================================
