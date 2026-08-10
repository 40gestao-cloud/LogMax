-- =================================================================
-- 401 — Liberar material vira uma transação só.
--
-- Último item da auditoria do fluxo "Material do almoxarifado". Liberar
-- uma requisição eram TRÊS escritas soltas do navegador, nesta ordem:
--
--   1. aprovacoes_estoque  → 'Aprovado'
--   2. requisicoes_estoque → 'Aprovado'
--   3. movimentacoes_estoque → Saída (a baixa de verdade)
--
-- com um rollback escrito à mão no `catch` do React para desfazer 1 e 2
-- quando 3 falhasse. Funciona quando o erro é do banco; não funciona
-- quando o navegador some no meio — aba fechada, rede de escola caindo,
-- máquina hibernando. Aí sobra requisição 'Aprovado' SEM baixa: o
-- estoque não desce e o documento some da tela de Liberar, que só lista
-- Pendente. Ninguém mais destrava, e a turma não tem como saber.
--
-- É o mesmo desenho que a compra já abandonou: lá `decidir_requisicao_-
-- compra` (282) resolve tudo no banco. Aqui faltava.
--
-- `liberar_requisicao_estoque` faz as três coisas numa transação: ou o
-- material sai e os dois documentos fecham, ou nada aconteceu. Saldo
-- insuficiente estoura na trigger de estoque e derruba a liberação
-- inteira — sem TOCTOU, porque a checagem e a baixa agora estão no mesmo
-- lugar (a tela conferia o saldo, e entre a conferência e o INSERT havia
-- uma janela).
--
-- AUTORIDADE: a mesma da migr. 399, e continua sendo cobrada pela
-- trigger `trg_requisicao_estoque_decisao_guard` — a RPC é SECURITY
-- DEFINER, mas `auth.uid()` não muda, então o guard segue valendo como
-- segunda barreira. Repetimos as checagens aqui só para a mensagem
-- chegar antes de qualquer escrita.
--
-- Negar não movimenta estoque e exige observação, igual à compra.
--
-- Idempotente. A unicidade por `requisicao_estoque_id`
-- (uq_mov_estoque_por_requisicao_estoque) segue sendo o que impede
-- baixa dupla num duplo clique.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.liberar_requisicao_estoque(
  p_aprovacao_id uuid,
  p_decisao      text,
  p_observacao   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ap   public.aprovacoes_estoque;
  v_req  public.requisicoes_estoque;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_decisao = 'Negado' AND COALESCE(trim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Negar exige justificativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_estoque
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF v_ap.id IS NULL THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%).', v_ap.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque
   WHERE id = v_ap.requisicao_estoque_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.auth_pode_filial(v_req.filial) THEN
    RAISE EXCEPTION 'Requisição de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Mesma régua da 399. O guard na tabela cobra de novo; aqui é para o
  -- aluno receber o motivo antes de qualquer linha se mexer.
  IF NOT public.auth_is_admin() THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem pede o material não libera a própria requisição.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(
         public.auth_in_setor('estoque', 'logistica')
         OR public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) decide requisição de material.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.aprovacoes_estoque
     SET status     = p_decisao,
         observacao = COALESCE(p_observacao, ''),
         aprovador  = COALESCE(v_nome, aprovador)
   WHERE id = p_aprovacao_id;

  UPDATE public.requisicoes_estoque
     SET status = p_decisao
   WHERE id = v_req.id;

  -- A baixa. Só na aprovação, e dentro da mesma transação dos dois
  -- UPDATEs acima: se o saldo não der, a trigger de estoque derruba
  -- tudo e a requisição continua Pendente por si só — sem rollback
  -- escrito à mão em lugar nenhum.
  IF p_decisao = 'Aprovado' AND v_req.produto_id IS NOT NULL
     AND COALESCE(v_req.qtd, 0) > 0 THEN
    INSERT INTO public.movimentacoes_estoque (
      produto_id, tipo, qtd, origem, destino, data, filial, requisicao_estoque_id
    ) VALUES (
      v_req.produto_id, 'Saída', v_req.qtd, 'Requisição de Estoque',
      COALESCE(NULLIF(trim(v_req.destino), ''), 'Solicitado'),
      public.acre_today(), v_req.filial, v_req.id
    );
  END IF;

  RETURN jsonb_build_object(
    'aprovacao_id',  p_aprovacao_id,
    'requisicao_id', v_req.id,
    'status',        p_decisao,
    'baixou_estoque', p_decisao = 'Aprovado'
                      AND v_req.produto_id IS NOT NULL
                      AND COALESCE(v_req.qtd, 0) > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.liberar_requisicao_estoque(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liberar_requisicao_estoque(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   SELECT proname, prosecdef, proacl FROM pg_proc
--    WHERE proname = 'liberar_requisicao_estoque';
--   -- prosecdef = true; acl com authenticated=X e SEM anon.
--
--   -- e o teste que importa: aprovar com saldo menor que o pedido deve
--   -- levantar P0001 e NÃO deixar a requisição em 'Aprovado'.
