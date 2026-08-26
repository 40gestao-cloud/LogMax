-- 548 — O cadastro não sai do catálogo com documento vivo em cima dele.
--
-- A migr. 524 nasceu de um relato exatamente sobre isto: um produto que "não
-- sai da lixeira" porque a REQ-ML-2026-0117 aponta para ele. E a conclusão dela
-- foi a certa —
--
--     "A trava está certa — apagar o produto levaria o `produto_id` da
--      requisição junto, e é justamente esse elo que a migr. 480 criou para o
--      pedido saber que item foi comprado."
--
-- Só que aquela trava é do EXPURGO: o segundo passo, o apagar de verdade, lá
-- dentro da Lixeira. O PRIMEIRO passo — o botão de lixeira em Cadastros >
-- Produtos, que faz `ativo = false` — nunca perguntou nada:
--
--     if (!await confirm('Excluir este produto?')) return;
--     await dbDelete('/api/produtosview', id);
--
-- E é o primeiro passo que quebra o fluxo, não o segundo. `gerar_pedido_de_cotacao`
-- recusa produto inativo ("Produto não encontrado ou inativo"), e até a migr. 545
-- a requisição não tinha como trocar o vínculo. Resultado: requisição aprovada,
-- cotação pronta, e o Gerar Pedido recusando para sempre por causa de um clique
-- em outra tela, dias antes, sem nenhum aviso na hora.
--
-- ─── ESTADO NA BASE (ERP, 26/08) ───────────────────────────────────────────
--
--   "Fone de Ouvido com Fio P2" (TechMax) · excluído em 25/08 13:06
--   REQ-TM-2026-0070 · Aprovado · aponta para ele
--
-- ─── O QUE SEGURA, E O QUE NÃO SEGURA ──────────────────────────────────────
--
-- Segura o documento ABERTO — aquele que ainda vai precisar do cadastro:
--
--   requisição em 'Pendente', 'Aprovado' ou 'Em correção'
--   pedido em 'Aprovado' ou 'Em Entrega'
--
-- Não segura o histórico. Requisição 'Atendida' ou 'Negado', pedido 'Recebido'
-- ou 'Cancelado', venda antiga, movimentação de meses atrás — nada disso impede
-- tirar um item do catálogo, porque nada disso vai voltar a precisar dele. Tirar
-- de linha um produto que a loja parou de vender é operação normal, e travá-la
-- por causa de uma venda de março seria transformar o catálogo em cemitério.
-- Quem cuida do histórico é o expurgo, na Lixeira, e ele já cuida (migr. 524).
--
-- ─── POR QUE O PROFESSOR TAMBÉM É BARRADO ──────────────────────────────────
--
-- Ao contrário de `documento_sem_exclusao`, aqui não há escape por `admin`. O
-- que este guard protege não é o rastro da turma: é a possibilidade de terminar
-- um documento que já está no meio do caminho. Um beco sem saída criado pelo
-- professor é tão sem saída quanto o criado pelo aluno — e Cadastros > Produtos
-- é restrito a admin/CEO/logística, então deixar admin passar deixaria o furo
-- aberto para metade de quem alcança a tela.
--
-- A saída, quando o cadastro tem MESMO de sair, é resolver o documento primeiro:
-- negar a requisição, cancelar o pedido, ou (migr. 545) corrigir a requisição
-- apontando para outro produto. Todas deixam rastro; esta não deixava nenhum.
--
-- ─── CONSERTO ──────────────────────────────────────────────────────────────
--
-- Produto inativo que segura documento aberto volta a ficar ativo. Não é
-- palpite: é o único estado em que o documento consegue andar, e é o estado em
-- que ele estaria se este guard existisse na hora do clique. Quem quiser tirar
-- o produto de linha depois disso tira — resolvendo o documento antes.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_produto_com_documento_aberto_nao_sai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc  text;
  v_qtos integer;
BEGIN
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NEW;
  END IF;

  -- O reset por filial (migr. 484/504) apaga linha, não inativa, então não
  -- passa por aqui. Service role continua sendo a porta de manutenção.
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(r.numero, 'Requisição #' || upper(right(r.id::text, 6)))
         || ' (' || r.status || ')',
         count(*) OVER ()
    INTO v_doc, v_qtos
    FROM public.requisicoes r
   WHERE r.produto_id = OLD.id
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Pendente', 'Aprovado', 'Em correção')
   ORDER BY r.created_at
   LIMIT 1;

  IF v_doc IS NOT NULL THEN
    RAISE EXCEPTION
      'A % ainda espera este cadastro%. Tirar "%" do catálogo agora trava esse documento: o Gerar Pedido recusa produto inativo, e ninguém que abrir a requisição vai ver que o problema está aqui. Resolva o documento primeiro — negue a requisição, ou corrija-a apontando para outro produto em Compras > Requisições.',
      v_doc,
      CASE WHEN v_qtos > 1 THEN format(' (e mais %s documento(s))', v_qtos - 1) ELSE '' END,
      OLD.nome
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
         || ' (' || p.status || ')',
         count(*) OVER ()
    INTO v_doc, v_qtos
    FROM public.pedidos p
   WHERE p.produto_id = OLD.id
     AND COALESCE(p.ativo, true)
     AND p.status IN ('Aprovado', 'Em Entrega')
   ORDER BY p.created_at
   LIMIT 1;

  IF v_doc IS NOT NULL THEN
    RAISE EXCEPTION
      'O % ainda não terminou%: a carga de "%" ou está a caminho ou espera conferência no Recebimentos, e o Confirmar dá entrada NESTE cadastro. Tirá-lo do catálogo agora deixa o pedido sem onde dar entrada. Cancele o pedido, ou espere a carga entrar antes de tirar o item de linha.',
      v_doc,
      CASE WHEN v_qtos > 1 THEN format(' (e mais %s pedido(s))', v_qtos - 1) ELSE '' END,
      OLD.nome
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- BEFORE UPDATE OF ativo: o `fn_carimba_exclusao` da mesma coluna já usa este
-- recorte, e assim o guard não é reavaliado a cada edição de preço.
DROP TRIGGER IF EXISTS trg_produto_com_documento_aberto_nao_sai ON public.produtos;
CREATE TRIGGER trg_produto_com_documento_aberto_nao_sai
  BEFORE UPDATE OF ativo ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_com_documento_aberto_nao_sai();

-- ────────────────────────────────────────────────────────────────────────────
-- Conserto: quem segura documento aberto volta para o catálogo
-- ────────────────────────────────────────────────────────────────────────────
-- `fn_carimba_exclusao` limpa `excluido_em`/`excluido_por` sozinho na volta.
-- `fn_produto_status_segue_ativo` cuida do `status`.
DO $repara$
DECLARE v_n integer;
BEGIN
  UPDATE public.produtos p
     SET ativo = true
   WHERE COALESCE(p.ativo, true) IS FALSE
     AND (EXISTS (SELECT 1 FROM public.requisicoes r
                   WHERE r.produto_id = p.id AND COALESCE(r.ativo, true)
                     AND r.status IN ('Pendente', 'Aprovado', 'Em correção'))
          OR EXISTS (SELECT 1 FROM public.pedidos pe
                      WHERE pe.produto_id = p.id AND COALESCE(pe.ativo, true)
                        AND pe.status IN ('Aprovado', 'Em Entrega')));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'MIGR 548: % cadastro(s) devolvido(s) ao catálogo por segurarem documento aberto.', v_n;
END;
$repara$;

COMMIT;
