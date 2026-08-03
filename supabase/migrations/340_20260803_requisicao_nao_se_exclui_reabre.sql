-- 340 — Requisição de compra não se exclui. Se errou, reabre-se.
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
-- Duas mudanças:
--
--   1. O soft-delete de `requisicoes` passa a ser recusado. Admin continua
--      podendo, como saída de emergência — mas a tela não oferece mais o botão.
--   2. `reabrir_requisicao` devolve o documento para 'Pendente' e reabre a
--      aprovação. Serve para o caso comum (aluno errou o item, o gerente já
--      aprovou) e também para desfazer exclusão antiga: se a requisição estiver
--      inativa, ela volta.

BEGIN;

-- ── 1. Exclusão barrada ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.requisicao_sem_exclusao()
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
    'Requisição não se exclui — o documento é o rastro do que a turma fez. Se estiver errada, peça à direção para reabri-la e corrija.'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_requisicao_sem_exclusao ON public.requisicoes;
CREATE TRIGGER trg_requisicao_sem_exclusao
  BEFORE UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_sem_exclusao();

-- DELETE de verdade (hard delete) também sai de cena para quem não é admin.
DROP POLICY IF EXISTS "compras_delete" ON public.requisicoes;
CREATE POLICY "compras_delete" ON public.requisicoes FOR DELETE TO authenticated
  USING (public.auth_is_admin());

COMMENT ON TRIGGER trg_requisicao_sem_exclusao ON public.requisicoes IS
  'Erro de aluno se corrige reabrindo (reabrir_requisicao), não apagando. Admin mantém a saída de emergência.';

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
