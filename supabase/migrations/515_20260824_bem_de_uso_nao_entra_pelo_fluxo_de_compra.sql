-- 515_20260824_bem_de_uso_nao_entra_pelo_fluxo_de_compra.sql
--
-- ── O furo ──────────────────────────────────────────────────────────────
-- A migr. 480 passou a exigir `produtos.id` no pedido, e a 499 abriu o
-- serviço como segunda categoria de item — com trava: o gatilho
-- `trg_mov_servico_nao_tem_saldo` recusa movimentação de estoque contra
-- pedido de serviço, porque serviço não tem saldo.
--
-- Patrimônio não tem saldo pelo mesmo motivo (migr. 440: `temEstoque` é
-- falso para bem de uso), e não ganhou trava nenhuma. `produtos` guarda os
-- dois — mercadoria e imobilizado — separados só por `tipo` (migr. 046),
-- então o select do Gerar Pedido sempre aceitou um freezer, e o Confirmar
-- do recebimento (RecebimentosView) insere Entrada para tudo que não é
-- serviço. Resultado: bem com saldo de estoque, conta a pagar carimbada
-- `natureza='estoque'` por `fn_conta_pagar_natureza` (lista fixa, vide
-- migr. 500) e a compra do bem batendo no resultado do período em vez de
-- virar imobilizado com depreciação (que a migr. 511 já sabe calcular).
--
-- ── Por que fechar a porta, e não construir o corredor ───────────────────
-- Bem JÁ TEM duas portas próprias: conta a pagar marcada como imobilizado
-- (que cria o produto de patrimônio) e a montagem da unidade (Fases 3/4,
-- migr. 510/511). A Reposição, aliás, já barra patrimônio na tela desde a
-- 440 — "bem não se repõe". Só a compra EVENTUAL alcançava isto.
--
-- Levantamento de 2026-08-24 nos 4 projetos: 0 produtos `tipo='patrimonio'`,
-- 0 de consumo, 0 linhas em `filial_investimentos`, 0 pedidos apontando
-- para bem, 0 movimentações de estoque contra bem. O furo nunca foi
-- exercitado — o que torna a trava barata agora e cara depois.
--
-- Fazer patrimônio virar a terceira categoria de item do pedido (espelho do
-- serviço: aceite no lugar de entrada, natureza `imobilizado`, DRE por
-- depreciação) é o desenho certo se um dia a turma comprar um freezer pelo
-- fluxo de compras. Não é isto aqui: `gerar_dre` já foi editada
-- cirurgicamente por 499/507/508/511 e não se mexe nela por hipótese.
--
-- ── O que esta migração faz ──────────────────────────────────────────────
-- Duas recusas, nas duas pontas do mesmo caminho:
--   1. `gerar_pedido_de_cotacao` — o pedido não sai apontando para bem.
--   2. `vincular_produto_requisicao` — o vínculo da migr. 494 nem nasce, para
--      a recusa aparecer no cadastro (onde o Tipo ainda pode ser corrigido)
--      e não depois, na frente do Gerar Pedido, com o produto já salvo.
--
-- Edição CIRÚRGICA sobre a função VIGENTE (`pg_get_functiondef` + `replace`),
-- mesma régua das migr. 499/507/508/511: aborta se a âncora não estiver lá,
-- em vez de recriar a função a partir do arquivo antigo do repo.
--
-- Conferido antes de escrever: as duas funções têm md5 idêntico nos 4
-- projetos (5c954e71… e 7457a9bf…).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O pedido não sai apontando para bem de uso
-- ────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_ancora text := $a$      v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
  ELSE$a$;
  v_novo text := $n$      v_prod.nome, v_prod.filial, v_cot.filial USING ERRCODE = 'P0001';
    END IF;
    -- MIGR 515: bem de uso não tem saldo (migr. 046/440), e o Confirmar do
    -- recebimento daria entrada de mercadoria num freezer.
    IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
      RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não entra pelo pedido de compra: ele não tem saldo de estoque, então o Confirmar do recebimento daria entrada de mercadoria num item que nunca vai ter saldo. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado — o bem aparece em Financeiro > Patrimônio, com vida útil e depreciação. Se o que está sendo comprado é mercadoria ou material de consumo, corrija o Tipo do produto em Cadastros > Produtos.',
        v_prod.nome USING ERRCODE = 'P0001';
    END IF;
  ELSE$n$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'gerar_pedido_de_cotacao' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 515: gerar_pedido_de_cotacao não existe neste projeto.';
  END IF;
  -- Já aplicada: sai quieto (idempotência).
  IF position('MIGR 515' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_ancora in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 515: âncora do bloco de produto não encontrada em gerar_pedido_de_cotacao — abortando em vez de recriar a função às cegas.';
  END IF;

  EXECUTE replace(v_def, v_ancora, v_novo);
END
$mig$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O vínculo do cadastro (migr. 494) recusa bem na origem
-- ────────────────────────────────────────────────────────────────────────────
-- Sem isto a recusa acima viraria beco: o aluno cadastra o bem escolhendo a
-- requisição em "Origem deste cadastro", o vínculo é gravado, e só na frente
-- do Gerar Pedido alguém descobre que aquilo não podia. Aqui a recusa chega
-- enquanto o Tipo ainda está na tela.
DO $mig$
DECLARE
  v_def text;
  v_ancora text := $a$      v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requisicoes$a$;
  v_novo text := $n$      v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
  END IF;
  -- MIGR 515: o pedido recusaria este vínculo depois (bem não tem saldo).
  IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
    RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e requisição de compra não vira pedido de bem — o vínculo travaria na frente do Gerar Pedido. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo antes de amarrá-lo à requisição.',
      v_prod.nome USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requisicoes$n$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'vincular_produto_requisicao' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 515: vincular_produto_requisicao não existe neste projeto (migr. 494 não aplicada?).';
  END IF;
  IF position('MIGR 515' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_ancora in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 515: âncora do bloco de produto não encontrada em vincular_produto_requisicao — abortando.';
  END IF;

  EXECUTE replace(v_def, v_ancora, v_novo);
END
$mig$;

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   SELECT proname, position('MIGR 515' in pg_get_functiondef(oid)) > 0 AS travado
--     FROM pg_proc
--    WHERE proname IN ('gerar_pedido_de_cotacao', 'vincular_produto_requisicao');
--   -- as duas devem voltar `true`, e o md5 tem de bater entre os 4 projetos:
--   SELECT proname, md5(pg_get_functiondef(oid)) FROM pg_proc
--    WHERE proname IN ('gerar_pedido_de_cotacao', 'vincular_produto_requisicao');
