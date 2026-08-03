-- 340 — Documento do fluxo de compras não se exclui. Se errou, corrige-se.
--
-- Excluir uma requisição quebra o trabalho da turma: some o documento que o
-- aluno abriu, o gerente aprovou e Compras ia cotar, e as telas seguintes
-- ficam sem correspondência — foi o que aconteceu com a REQ-TM-2026-0001,
-- excluída em 30/07 e depois procurada em Cotações e Pedidos, onde nunca
-- estaria.
--
-- Numa turma, erro de aluno é a regra, não a exceção. A resposta certa a erro
-- não é apagar o documento; é devolvê-lo para quem erra poder consertar — que
-- é o que uma empresa faz, e o que o histórico consegue contar depois.
--
-- Vale para os quatro documentos do fluxo — requisição de compra, cotação,
-- pedido e requisição de material —, porque o argumento é o mesmo em todos:
-- apagar destrói o rastro de quem fez o quê, e é justamente o rastro que
-- permite a aula seguinte.
--
-- Em cada um, o soft-delete é recusado e entra o caminho de conserto que aquele
-- documento pede:
--
--   requisicoes          → reabrir (volta a Pendente + aprovação na fila)
--   requisicoes_estoque  → reabrir, exceto se já teve baixa no estoque
--   cotacoes             → cancelar já existia; reabrir traz de volta ao
--                          Financeiro quando a recusa foi engano
--   pedidos              → cancelar (status + conta a pagar + requisição
--                          liberada de novo), numa transação só
--
-- Admin continua com a saída de emergência em todos. As telas não oferecem
-- mais o botão de excluir.

BEGIN;

-- ── 1. Exclusão barrada ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.documento_sem_exclusao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só interessa a transição ativa → inativa. Reativar (o que a RPC de reabrir
  -- faz) passa livre, e o resto dos updates não é assunto deste guard.
  IF NOT (COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true)) THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_service_role() OR public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Este documento não se exclui — ele é o rastro do que a turma fez. Se estiver errado, cancele-o ou peça à direção para reabri-lo, e corrija.'
    USING ERRCODE = '42501';
END;
$function$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requisicoes', 'requisicoes_estoque', 'cotacoes', 'pedidos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sem_exclusao ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sem_exclusao BEFORE UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.documento_sem_exclusao()', t);
  END LOOP;
END $$;

-- DELETE de verdade (hard delete) também sai de cena para quem não é admin.
DROP POLICY IF EXISTS "compras_delete" ON public.requisicoes;
CREATE POLICY "compras_delete" ON public.requisicoes FOR DELETE TO authenticated
  USING (public.auth_is_admin());

DROP POLICY IF EXISTS "cot_delete" ON public.cotacoes;
CREATE POLICY "cot_delete" ON public.cotacoes FOR DELETE TO authenticated
  USING (public.auth_is_admin());

COMMENT ON FUNCTION public.documento_sem_exclusao() IS
  'Erro de aluno se corrige reabrindo ou cancelando, não apagando. Admin mantém a saída de emergência.';

-- ── 2. Reabertura ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reabrir_requisicao(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      public.requisicoes;
  v_nome     text;
  v_ap_id    uuid;
  v_pedido   text;
  v_restaura boolean;
BEGIN
  PERFORM public._assert_rpc();

  -- Reabrir desfaz decisão de gerente e, às vezes, exclusão. É ato de direção.
  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'Só a direção reabre uma requisição.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Pedido vivo é compra em andamento: reabrir por baixo dele faria a
  -- requisição dizer uma coisa e o pedido outra, com a conta a pagar já criada.
  SELECT COALESCE(p.numero, upper(right(p.id::text, 6))) INTO v_pedido
    FROM public.pedidos p
   WHERE p.requisicao_id = v_req.id AND COALESCE(p.ativo, true)
   LIMIT 1;

  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta requisição já virou o pedido %. Inative o pedido antes de reabri-la — a conta a pagar dele também precisa ser resolvida.',
      v_pedido
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cotacoes c
              WHERE c.requisicao_id = v_req.id AND COALESCE(c.ativo, true)
                AND c.status IN ('Aguardando Financeiro', 'Aprovado')) THEN
    RAISE EXCEPTION
      'Existe cotação em andamento para esta requisição. Cancele a cotação antes de reabrir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();
  v_restaura := NOT COALESCE(v_req.ativo, true);

  UPDATE public.requisicoes
     SET status = 'Pendente',
         ativo  = true
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  -- A aprovação volta para a fila do gerente. Sem isto a requisição ficaria
  -- 'Pendente' sem card em Aprovações — travada, que é o defeito que a 331
  -- ajudou a encontrar e a 330 a evitar.
  SELECT id INTO v_ap_id FROM public.aprovacoes_compras
   WHERE requisicao_id = v_req.id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_ap_id IS NULL THEN
    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', v_req.filial);
  ELSE
    UPDATE public.aprovacoes_compras
       SET status     = 'Pendente',
           aprovador  = NULL,
           observacao = format('Reaberta por %s%s.',
                               COALESCE(v_nome, 'direção'),
                               COALESCE(' — ' || NULLIF(trim(p_motivo), ''), ''))
     WHERE id = v_ap_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurada', v_restaura,
    'requisicao', to_jsonb(v_req)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reabrir_requisicao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_requisicao(uuid, text) TO authenticated;

-- -- 3. Requisicao de material ------------------------------------------------
-- Mesma ideia, com uma trava a mais: material liberado já saiu da prateleira.
-- Reabrir depois da baixa faria o estoque contar a mesma saída duas vezes.

CREATE OR REPLACE FUNCTION public.reabrir_requisicao_estoque(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      public.requisicoes_estoque;
  v_nome     text;
  v_ap_id    uuid;
  v_restaura boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'So a direcao reabre uma requisicao de material.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisicao de material nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- 'Aprovado' aqui significa liberado: o Estoque ja deu baixa.
  IF v_req.status = 'Aprovado' AND COALESCE(v_req.ativo, true) THEN
    RAISE EXCEPTION
      'Este material ja foi liberado e saiu do estoque. Reabrir contaria a mesma saida duas vezes - registre uma entrada de devolucao em Movimentacoes e abra uma requisicao nova.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();
  v_restaura := NOT COALESCE(v_req.ativo, true);

  UPDATE public.requisicoes_estoque
     SET status = 'Pendente', ativo = true
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  SELECT id INTO v_ap_id FROM public.aprovacoes_estoque
   WHERE requisicao_estoque_id = v_req.id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_ap_id IS NULL THEN
    INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
    VALUES (v_req.id, 'Pendente', v_req.filial);
  ELSE
    UPDATE public.aprovacoes_estoque
       SET status = 'Pendente', aprovador = NULL,
           observacao = format('Reaberta por %s%s.', COALESCE(v_nome, 'direcao'),
                               COALESCE(' - ' || NULLIF(trim(p_motivo), ''), ''))
     WHERE id = v_ap_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'restaurada', v_restaura, 'requisicao', to_jsonb(v_req));
END;
$function$;

REVOKE ALL ON FUNCTION public.reabrir_requisicao_estoque(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_requisicao_estoque(uuid, text) TO authenticated;

-- -- 4. Cotacao ----------------------------------------------------------------
-- Cancelar ja existia e continua sendo o caminho normal. Reabrir serve para o
-- engano: o Financeiro reprovou a proposta errada, ou a cotacao foi cancelada
-- em cascata e a aprovada acabou desfeita.

CREATE OR REPLACE FUNCTION public.reabrir_cotacao(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot      public.cotacoes;
  v_restaura boolean;
  v_outra    text;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'So a direcao reabre uma cotacao.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cot FROM public.cotacoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status = 'Aguardando Financeiro' AND COALESCE(v_cot.ativo, true) THEN
    RAISE EXCEPTION 'Esta cotacao ja esta na fila do Financeiro.' USING ERRCODE = 'P0001';
  END IF;

  -- Duas propostas vivas para a mesma requisicao fazem o Financeiro decidir
  -- duas vezes a mesma compra - foi o que a migr. 334 acabou de fechar.
  IF v_cot.requisicao_id IS NOT NULL THEN
    SELECT COALESCE(c.numero, upper(right(c.id::text, 6))) INTO v_outra
      FROM public.cotacoes c
     WHERE c.requisicao_id = v_cot.requisicao_id AND c.id <> v_cot.id
       AND COALESCE(c.ativo, true) AND c.status = 'Aprovado'
     LIMIT 1;

    IF v_outra IS NOT NULL THEN
      RAISE EXCEPTION
        'A requisicao desta cotacao ja tem a proposta % aprovada. Reabra aquela decisao antes, senao a compra fica com duas propostas vivas.',
        v_outra
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_restaura := NOT COALESCE(v_cot.ativo, true);

  UPDATE public.cotacoes
     SET status       = 'Aguardando Financeiro',
         ativo        = true,
         aprovado_por = NULL,
         aprovado_em  = NULL,
         feedback     = NULLIF(trim(COALESCE(p_motivo, '')), '')
   WHERE id = v_cot.id
  RETURNING * INTO v_cot;

  RETURN jsonb_build_object('ok', true, 'restaurada', v_restaura, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.reabrir_cotacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_cotacao(uuid, text) TO authenticated;

-- -- 5. Pedido -----------------------------------------------------------------
-- Aqui nao e reabrir, e CANCELAR - e e o caso mais delicado do lote, porque o
-- pedido ja criou conta a pagar e baixou a requisicao para 'Atendida'. A tela
-- fazia as tres coisas em chamadas soltas, com catch vazio no meio: falhando a
-- segunda, sobrava conta a pagar de um pedido que nao existe mais.
--
-- Recebimento confirmado bloqueia: a mercadoria entrou no estoque, e cancelar o
-- pedido por cima disso faria o estoque ter entrada sem origem.

CREATE OR REPLACE FUNCTION public.cancelar_pedido_compra(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ped    public.pedidos;
  v_pagas  integer;
  v_contas integer;
  v_receb  integer;
BEGIN
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.auth_pode_filial(v_ped.filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_ped.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Este pedido ja esta cancelado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_receb FROM public.recebimentos r
   WHERE r.pedido_id = v_ped.id AND COALESCE(r.ativo, true) AND r.status <> 'Pendente';
  IF v_receb > 0 THEN
    RAISE EXCEPTION
      'Este pedido ja teve recebimento confirmado - a mercadoria entrou no estoque. Registre uma devolucao ao fornecedor em vez de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_pagas FROM public.contas_pagar c
   WHERE c.pedido_id = v_ped.id AND COALESCE(c.ativo, true) AND c.status = 'Pago';
  IF v_pagas > 0 THEN
    RAISE EXCEPTION
      'Existe conta a pagar ja quitada para este pedido. Estorne o pagamento antes de cancelar.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pedidos SET status = 'Cancelado' WHERE id = v_ped.id;

  UPDATE public.contas_pagar
     SET ativo = false
   WHERE pedido_id = v_ped.id AND COALESCE(ativo, true) AND status <> 'Pago';
  GET DIAGNOSTICS v_contas = ROW_COUNT;

  -- A requisicao volta a poder ser cotada. Sem isto ela fica 'Atendida' por um
  -- pedido cancelado: fora do dropdown de nova cotacao e impossivel de refazer.
  IF v_ped.requisicao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pedidos p
                      WHERE p.requisicao_id = v_ped.requisicao_id
                        AND p.id <> v_ped.id AND COALESCE(p.ativo, true)
                        AND p.status <> 'Cancelado') THEN
    UPDATE public.requisicoes SET status = 'Aprovado'
     WHERE id = v_ped.requisicao_id AND status = 'Atendida';
  END IF;

  RETURN jsonb_build_object('ok', true, 'contas_inativadas', v_contas, 'motivo', p_motivo);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_compra(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_compra(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- 1) Colaborador de compras tentando excluir deve receber 42501:
--   --    UPDATE requisicoes SET ativo = false WHERE id = '...';
--
--   -- 2) Trazer de volta a requisição excluída da TechMax:
--   --    SELECT reabrir_requisicao(
--   --      (SELECT id FROM requisicoes WHERE numero = 'REQ-TM-2026-0001'),
--   --      'excluída por engano em 30/07');
--   --    → "restaurada": true, e ela reaparece nas telas.
