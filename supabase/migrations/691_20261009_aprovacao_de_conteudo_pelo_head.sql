-- 691 — Aprovação de conteúdo sai do Financeiro e vai para o Head de Comunicação.
--
-- Achado ao planejar: a fila "Aprovações de Conteúdo" (Financeiro) estava
-- ÓRFÃ desde 22/07 — lia marketing_tarefas.status_link = 'Aguardando
-- Aprovação', e a única tela que gravava isso (TarefasMarketingView) foi
-- apagada no commit 004c1b9. Nada mais chegava lá; a coluna está vazia.
--
-- Onde o conteúdo nasce hoje é o Calendário Editorial, e ali ele ia de
-- Rascunho direto a Agendado, sem ninguém aprovar. Novo fluxo:
--
--   Rascunho ──(Marketing envia)──► Em aprovação ──(Head aprova)──► Agendado ─► Publicado
--                                        │
--                                        └──(Head reprova, com motivo)──► Rascunho
--
--  1. marketing_calendario: status 'Em aprovação' + aprovacao_obs/aprovado_por/
--     aprovado_em. Gatilho: Rascunho → Agendado direto não passa; sair de
--     'Em aprovação' para Agendado só pela RPC; post em aprovação não se edita
--     (retire, edite, envie de novo). Post que JÁ estava Agendado/Publicado
--     segue como está.
--  2. decidir_conteudo(post, 'Aprovado'|'Reprovado', obs): o Head de
--     Comunicação da filial; sem Head ativo na filial, a gerência (titular ou
--     assistente). Quem criou ou é responsável pelo post não aprova. O
--     professor (admin) destrava.
--  3. contar_pendencias: a chave da fila vira 'marketing-aprovaçõesdeconteúdo'
--     e conta os posts em aprovação.
--  4. Feedback de arte (dar_feedback_arte + policy feedback_insert): também o
--     Head e a gerência (assistente).

-- ── 1 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.marketing_calendario
  ADD COLUMN IF NOT EXISTS aprovacao_obs text,
  ADD COLUMN IF NOT EXISTS aprovado_por  uuid,
  ADD COLUMN IF NOT EXISTS aprovado_em   timestamptz;

DO $mig$
DECLARE v_nome text;
BEGIN
  SELECT conname INTO v_nome FROM pg_constraint
   WHERE conrelid = 'public.marketing_calendario'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'Rascunho';
  IF v_nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.marketing_calendario DROP CONSTRAINT %I', v_nome);
  END IF;
END
$mig$;
ALTER TABLE public.marketing_calendario ADD CONSTRAINT chk_marketing_calendario_status
  CHECK (status IN ('Rascunho', 'Em aprovação', 'Agendado', 'Publicado', 'Cancelado'));

CREATE OR REPLACE FUNCTION public.fn_calendario_aprovacao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_decisao boolean := COALESCE(current_setting('app.conteudo_decisao', true), '') = 'true';
BEGIN
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) OR v_decisao THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('Rascunho', 'Em aprovação') THEN
      RAISE EXCEPTION 'Post novo nasce como Rascunho ou vai direto para aprovação — quem agenda é o Head de Comunicação ao aprovar.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('Rascunho', 'Em aprovação') AND NEW.status IN ('Agendado', 'Publicado') THEN
    RAISE EXCEPTION 'Este post ainda não foi aprovado. Envie para aprovação: o Head de Comunicação da unidade (ou a gerência, se não houver Head) aprova e ele fica Agendado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'Em aprovação' AND NEW.status = 'Em aprovação'
     AND (NEW.titulo IS DISTINCT FROM OLD.titulo OR NEW.conteudo IS DISTINCT FROM OLD.conteudo
          OR NEW.link_arte IS DISTINCT FROM OLD.link_arte OR NEW.canal IS DISTINCT FROM OLD.canal
          OR NEW.data_post IS DISTINCT FROM OLD.data_post) THEN
    RAISE EXCEPTION 'Post em aprovação não se edita: retire da aprovação, ajuste e envie de novo.'
      USING ERRCODE = 'P0001';
  END IF;

  -- A decisão é carimbada só pela RPC.
  IF NEW.aprovado_por IS DISTINCT FROM OLD.aprovado_por
     OR NEW.aprovado_em IS DISTINCT FROM OLD.aprovado_em THEN
    RAISE EXCEPTION 'Aprovação de conteúdo é pela tela Marketing › Aprovações de Conteúdo.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_calendario_aprovacao_guard ON public.marketing_calendario;
CREATE TRIGGER trg_calendario_aprovacao_guard
  BEFORE INSERT OR UPDATE ON public.marketing_calendario
  FOR EACH ROW EXECUTE FUNCTION public.fn_calendario_aprovacao_guard();

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decidir_conteudo(p_post_id uuid, p_decisao text, p_obs text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_post   public.marketing_calendario;
  v_admin  boolean := public.eh_perfil_admin(auth.uid());
  v_head   boolean;
  v_tem_head boolean;
  v_novo   text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Reprovado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Reprovado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_decisao = 'Reprovado' AND btrim(COALESCE(p_obs, '')) = '' THEN
    RAISE EXCEPTION 'Reprovar exige o motivo — é o que o Marketing lê para refazer.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_post FROM public.marketing_calendario
   WHERE id = p_post_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'Post não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_post.status <> 'Em aprovação' THEN
    RAISE EXCEPTION 'Este post não está aguardando aprovação (está %).', v_post.status USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_admin THEN
    v_head := public.auth_head_comunicacao_da(v_post.filial);
    SELECT EXISTS (SELECT 1 FROM public.user_profiles u
                    WHERE u.head_comunicacao AND u.filial = v_post.filial AND u.desligado_em IS NULL)
      INTO v_tem_head;
    IF NOT (v_head OR (NOT v_tem_head AND COALESCE(public.auth_gerente_da(v_post.filial), false))) THEN
      RAISE EXCEPTION '%', CASE WHEN v_tem_head
        THEN 'Quem aprova o conteúdo desta unidade é o Head de Comunicação.'
        ELSE 'Sem Head de Comunicação na unidade, quem aprova é a gerência.' END
        USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IN (v_post.criado_por, v_post.responsavel_id) THEN
      RAISE EXCEPTION 'Quem produz o conteúdo não o aprova — peça a outra pessoa da gerência ou ao Head.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_novo := CASE p_decisao WHEN 'Aprovado' THEN 'Agendado' ELSE 'Rascunho' END;

  PERFORM set_config('app.conteudo_decisao', 'true', true);
  UPDATE public.marketing_calendario
     SET status        = v_novo,
         aprovacao_obs = NULLIF(btrim(COALESCE(p_obs, '')), ''),
         aprovado_por  = CASE WHEN p_decisao = 'Aprovado' THEN auth.uid() END,
         aprovado_em   = CASE WHEN p_decisao = 'Aprovado' THEN now() END
   WHERE id = v_post.id
  RETURNING * INTO v_post;
  PERFORM set_config('app.conteudo_decisao', 'false', true);

  BEGIN
    PERFORM public.notificar_setor(
      'marketing', CASE p_decisao WHEN 'Aprovado' THEN 'aprovado' ELSE 'reprovado' END,
      CASE p_decisao WHEN 'Aprovado' THEN 'Conteúdo aprovado' ELSE 'Conteúdo reprovado' END,
      format('"%s" (%s) %s.%s', v_post.titulo, v_post.canal,
             CASE p_decisao WHEN 'Aprovado' THEN 'foi aprovado e está Agendado' ELSE 'voltou para Rascunho' END,
             COALESCE(' Motivo: ' || v_post.aprovacao_obs, '')),
      'marketing-calendário', 'Média', v_post.id, NULL, v_post.filial);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso de conteúdo falhou: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'status', v_novo, 'post', to_jsonb(v_post));
END;
$function$;

REVOKE ALL ON FUNCTION public.decidir_conteudo(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decidir_conteudo(uuid, text, text) TO authenticated;

-- ── 3 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_old text := $o$    'financeiro-aprovaçõesdeconteúdo', (
      SELECT count(*) FROM marketing_tarefas
       WHERE ativo AND status_link = 'Aguardando Aprovação'
         AND (p_filial IS NULL OR filial = p_filial)),$o$;
  v_new text := $n$    -- MIGR 691: a fila mudou para o Marketing e lê o Calendário Editorial.
    'marketing-aprovaçõesdeconteúdo', (
      SELECT count(*) FROM marketing_calendario
       WHERE ativo AND status = 'Em aprovação'
         AND (p_filial IS NULL OR filial = p_filial)),$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.contar_pendencias(text)'::regprocedure), E'\r', '');
  IF position('MIGR 691' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'contar_pendencias: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ── 4 ──────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_old text := $o$IF v_role NOT IN ('gerente','admin','ceo') THEN$o$;
  v_new text := $n$IF v_role NOT IN ('gerente','admin','ceo')
     -- MIGR 691: o Gerente Assistente e o Head de Comunicação também avaliam a arte.
     AND NOT public.auth_e_gerencia()
     AND NOT COALESCE((SELECT u.head_comunicacao FROM public.user_profiles u WHERE u.id = v_user_id), false) THEN$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.dar_feedback_arte(uuid, integer, text)'::regprocedure), E'\r', '');
  IF position('MIGR 691' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'dar_feedback_arte: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

ALTER POLICY feedback_insert ON public.marketing_arte_feedback
  WITH CHECK (
    (user_id = (SELECT auth.uid()))
    AND (
      ((SELECT auth_user_role()) = ANY (ARRAY['gerente'::text, 'admin'::text, 'ceo'::text]))
      OR (SELECT auth_e_gerencia())
      OR COALESCE((SELECT u.head_comunicacao FROM public.user_profiles u WHERE u.id = (SELECT auth.uid())), false)
    )
  );

NOTIFY pgrst, 'reload schema';
