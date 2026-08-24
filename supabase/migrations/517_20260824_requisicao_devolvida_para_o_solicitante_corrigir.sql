-- 517_20260824_requisicao_devolvida_para_o_solicitante_corrigir.sql
--
-- ── O buraco didático ───────────────────────────────────────────────────
-- O gerente só tinha duas saídas: Aprovar ou Negar. Negar é decisão de
-- mérito — "não vamos comprar isto" — e é terminal para o solicitante: ele
-- não edita a requisição (a policy `compras_update` só entrega UPDATE ao
-- setor compras e ao gerente) e não pode reenviá-la. Quem errou a
-- quantidade, o item ou a justificativa não tinha caminho nenhum: ou abria
-- outra requisição, perdendo o fio do documento, ou chamava a direção para
-- usar `reabrir_requisicao`, que é ferramenta de professor.
--
-- Em aula, errar é a regra. Um fluxo onde o erro do aluno só se conserta
-- por fora do fluxo não ensina o fluxo.
--
-- ── A régua, que já é a da casa ─────────────────────────────────────────
-- Precedente da migr. 467 (cotação devolvida) e 502 (movimentação
-- devolvida): quem decide não corrige o trabalho do outro — devolve com
-- motivo, e quem fez conserta. Aqui isso vira uma terceira ação do gerente,
-- ao lado de Aprovar e Negar:
--
--   Aprovar  — pode comprar.
--   Negar    — não vamos comprar isto. Continua existindo, e continua
--              terminal: é decisão de mérito, não correção de formulário.
--   Devolver — o pedido está mal feito. Volta para quem abriu, com o motivo.
--
-- A aprovação NÃO é decidida na devolução: ela segue 'Pendente'. Nada foi
-- julgado ainda — o documento só saiu da mesa do gerente, e voltará para ela.
--
-- ── Por que RPC, e não abrir a policy ───────────────────────────────────
-- Dar UPDATE em `requisicoes` ao solicitante daria junto o direito de mexer
-- em requisição já aprovada, em requisição de outro setor da mesma filial, e
-- de trocar `produto_id`. A RPC escreve só o que a correção pode mudar, e só
-- enquanto o documento está 'Em correção'. Mesmo raciocínio da migr. 494.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O motivo mora na requisição, não na aprovação
-- ────────────────────────────────────────────────────────────────────────────
-- O solicitante não enxerga `aprovacoes_compras` — não há policy que a entregue
-- a ele. Guardar o motivo lá seria escrevê-lo para quem não pode lê-lo: a
-- devolução chegaria muda.
ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS correcao_motivo         text,
  ADD COLUMN IF NOT EXISTS correcao_solicitada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS correcao_solicitada_por uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.requisicoes.correcao_motivo IS
  'Migr. 517. O que o gerente pediu para consertar ao devolver a requisicao. Limpo no reenvio.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Devolver: do gerente para quem abriu
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_requisicao_para_correcao(
  p_aprovacao_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ap  record;
  v_req record;
BEGIN
  PERFORM public._assert_rpc();

  -- Devolver sem dizer o que está errado é negar com outro nome: o aluno
  -- reenviaria o mesmo documento, e o gerente devolveria de novo.
  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser corrigido — é isso que o solicitante vai ler.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_compras
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%). Para desfazer a decisão, quem reabre é a direção.',
      v_ap.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = v_ap.requisicao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION 'Esta requisição já está com o solicitante, esperando correção.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Mesma autoridade de `decidir_requisicao_compra` (migr. 282): devolver é ato
  -- de quem decide. Se o autor pudesse devolver a própria requisição, teria
  -- achado o caminho para editá-la sem passar pelo gerente.
  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem abre a requisição não a devolve. Quem decide é o gerente da filial.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) devolve requisição de compra.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.requisicoes
     SET status                  = 'Em correção',
         correcao_motivo         = trim(p_motivo),
         correcao_solicitada_em  = now(),
         correcao_solicitada_por = auth.uid()
   WHERE id = v_req.id;

  RETURN jsonb_build_object(
    'ok', true,
    'requisicao_id', v_req.id,
    'status', 'Em correção'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.devolver_requisicao_para_correcao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_requisicao_para_correcao(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.devolver_requisicao_para_correcao(uuid, text) IS
  'Migr. 517. O gerente devolve a requisicao para quem a abriu, com motivo, sem decidir a aprovacao. Terceira saida ao lado de Aprovar e Negar — Negar continua sendo decisao de merito.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Reenviar: de quem abriu de volta para o gerente
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reenviar_requisicao_corrigida(
  p_id               uuid,
  p_item             text,
  p_qtd              numeric,
  p_unidade          text DEFAULT NULL,
  p_justificativa    text DEFAULT NULL,
  p_urgencia         text DEFAULT NULL,
  p_centro_custo     text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL
)
RETURNS public.requisicoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requisicoes;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Só o documento devolvido se reenvia. Fora de 'Em correção' isto seria porta
  -- lateral para reescrever requisição pendente ou já aprovada.
  IF v_req.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Só requisição devolvida para correção pode ser reenviada (esta está %).',
      v_req.status USING ERRCODE = 'P0001';
  END IF;

  -- Quem corrige é quem fez. Gerente e Matriz entram junto porque são eles que
  -- destravam o aluno que faltou na aula seguinte.
  IF NOT COALESCE(public.auth_is_admin(), false)
     AND NOT COALESCE(public.auth_gerente_da(v_req.filial), false)
     AND COALESCE(v_req.criado_por, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RAISE EXCEPTION 'Quem corrige a requisição é quem a abriu.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(trim(p_item), '') = '' THEN
    RAISE EXCEPTION 'O item não pode ficar em branco.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade tem de ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  -- `produto_id`, `servico_id`, `tipo_requisicao`, `setor_solicitante` e
  -- `filial` ficam de fora de propósito: corrigir é consertar o que foi pedido,
  -- não trocar o documento por outro.
  UPDATE public.requisicoes
     SET item                    = trim(p_item),
         qtd                     = p_qtd,
         unidade                 = COALESCE(NULLIF(trim(COALESCE(p_unidade, '')), ''), unidade),
         justificativa           = COALESCE(NULLIF(trim(COALESCE(p_justificativa, '')), ''), justificativa),
         urgencia                = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         centro_custo            = COALESCE(NULLIF(trim(COALESCE(p_centro_custo, '')), ''), centro_custo),
         data_necessidade        = COALESCE(p_data_necessidade, data_necessidade),
         status                  = 'Pendente',
         correcao_motivo         = NULL,
         correcao_solicitada_em  = NULL,
         correcao_solicitada_por = NULL
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) IS
  'Migr. 517. Quem abriu a requisicao corrige o que o gerente apontou e devolve para a fila de aprovacao. So de "Em correcao", e sem tocar em produto_id/servico_id/tipo/setor/filial.';

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   SELECT status, count(*) FROM requisicoes GROUP BY 1;
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('devolver_requisicao_para_correcao', 'reenviar_requisicao_corrigida');
--   -- PostgREST precisa enxergar as RPCs novas (PGRST202 sem isto):
--   NOTIFY pgrst, 'reload schema';
