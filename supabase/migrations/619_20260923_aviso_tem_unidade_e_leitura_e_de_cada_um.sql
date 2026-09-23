-- 619 — O aviso tem unidade, e "lida" é de cada um
--
-- O QUE ESTAVA ACONTECENDO
--
-- Aula de 22/09 no LogMax-ERP: 337 notificações, 328 nunca lidas (97%). O sino
-- virou ruído por três defeitos que se somavam:
--
--   1. Nenhuma das 7 telas que chamam `notificar_setor()` passava `p_filial`.
--      Aviso sem filial é, pela regra do `useNotificacoes`, recado para todas
--      as unidades — então o Financeiro da TechMax recebia "Nova cotação
--      aguardando aprovação" da SuperMax com item, fornecedor e valor. Numa
--      competição entre filiais, isso é vazamento; para quem opera, é ruído
--      (83 avisos de cotação pendente no dia, todos sem unidade).
--
--   2. `lido` era UMA coluna na notificação, que é do SETOR. Bastava um colega
--      abrir o aviso para ele sumir do sino da equipe inteira — quem ainda
--      tinha de agir perdia o lembrete.
--
--   3. `marcar_todas_lidas()` não olhava unidade e tinha um ramo
--      `OR auth_is_admin()`. Como `auth_is_admin()` inclui CEO e conselheiros,
--      que são ALUNOS (vide feedback_auth_is_admin_inclui_alunos), um clique
--      desses em "marcar todas" apagava o sino da turma inteira.
--
-- Bônus do item 2: cada leitura era um UPDATE em `notificacoes`, que está na
-- publicação do realtime — a sala inteira relia a lista a cada clique no sino
-- de um colega. A leitura por pessoa vai para uma tabela FORA da publicação.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--
--   · `notificacoes_lidas (notificacao_id, user_id)` — quem leu o quê. RLS:
--     cada um só vê e só grava as próprias linhas.
--   · `marcar_notificacoes_lidas(uuid[])` — marca como lidas, PARA QUEM
--     CHAMOU, as notificações da lista que essa pessoa consegue ver. SECURITY
--     INVOKER: a RLS de `notificacoes` recorta a lista, então ninguém marca o
--     que não enxerga.
--   · `marcar_notificacao_lida(uuid)` e `marcar_todas_lidas(text)` continuam
--     existindo, com a mesma assinatura, gravando na tabela nova. O front que
--     está no ar até o deploy chama por esses nomes — a ordem segura é esta
--     migração primeiro e o deploy depois (feedback_drop_function_assinatura_exata).
--     O ramo `auth_is_admin()` sai: agora só marca o que é da própria pessoa.
--   · `notificar_setor()` sem `p_filial` cai na unidade de quem chamou (se ela
--     for uma unidade, não a Matriz). É a rede para chamada futura que
--     esquecer o parâmetro; o front passa a unidade DO REGISTRO explicitamente
--     (src/lib/notificar.ts), que é o certo quando quem age está na Matriz.
--
-- A coluna `notificacoes.lido` fica, sem uso, para não quebrar o front antigo
-- durante o deploy. Os avisos antigos começam como não lidos para todo mundo —
-- e já estavam: só 9 de 337 tinham sido abertos.
--
-- RESET: `resetar_dados_operacionais` faz TRUNCATE ... CASCADE em
-- `notificacoes`, que desce para a tabela nova; `resetar_dados_da_filial` apaga
-- com DELETE, e o ON DELETE CASCADE cuida do resto. Nada a mudar nos dois.
--
-- Idempotente.

-- ─── 1. Quem leu o quê ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notificacoes_lidas (
  notificacao_id uuid        NOT NULL REFERENCES public.notificacoes(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lida_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notificacao_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_lidas_user
  ON public.notificacoes_lidas (user_id);

COMMENT ON TABLE public.notificacoes_lidas IS
  'Leitura do sino por pessoa (migr. 619). Substitui notificacoes.lido, que era do setor inteiro. Fora da publicação do realtime de propósito.';

ALTER TABLE public.notificacoes_lidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_lidas_select ON public.notificacoes_lidas;
CREATE POLICY notif_lidas_select ON public.notificacoes_lidas
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notif_lidas_insert ON public.notificacoes_lidas;
CREATE POLICY notif_lidas_insert ON public.notificacoes_lidas
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.notificacoes_lidas FROM public, anon, authenticated;
GRANT SELECT, INSERT ON public.notificacoes_lidas TO authenticated;

COMMENT ON COLUMN public.notificacoes.lido IS
  'SEM USO desde a migr. 619 — a leitura é por pessoa, em notificacoes_lidas. Mantida só para o front antigo durante o deploy.';

-- ─── 2. Marcar como lidas (a de verdade) ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marcar_notificacoes_lidas(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  PERFORM public._assert_rpc();

  -- INVOKER: o SELECT passa pela RLS de `notificacoes`. Id que a pessoa não
  -- enxerga simplesmente não entra.
  INSERT INTO notificacoes_lidas (notificacao_id, user_id)
  SELECT n.id, auth.uid()
    FROM notificacoes n
   WHERE n.id = ANY(p_ids)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_notificacoes_lidas(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.marcar_notificacoes_lidas(uuid[]) TO authenticated;

-- ─── 3. As duas antigas, mesma assinatura, gravando na tabela nova ──────────

CREATE OR REPLACE FUNCTION public.marcar_notificacao_lida(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT public.marcar_notificacoes_lidas(ARRAY[p_id]);
$function$;

CREATE OR REPLACE FUNCTION public.marcar_todas_lidas(p_setor text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_setor text;
BEGIN
  PERFORM public._assert_rpc();
  v_setor := COALESCE(p_setor, auth_user_setor());

  -- Só para quem chamou, e só o que a RLS deixa ver. O antigo `OR
  -- auth_is_admin()` marcava a turma inteira quando o CEO clicava.
  INSERT INTO notificacoes_lidas (notificacao_id, user_id)
  SELECT n.id, auth.uid()
    FROM notificacoes n
   WHERE n.setor = v_setor OR n.setor = 'all'
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_notificacao_lida(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.marcar_notificacao_lida(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.marcar_todas_lidas(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.marcar_todas_lidas(text) TO authenticated;

-- ─── 4. notificar_setor: sem unidade, vale a de quem chamou ─────────────────

CREATE OR REPLACE FUNCTION public.notificar_setor(p_setor text, p_tipo text, p_titulo text, p_mensagem text DEFAULT NULL::text, p_link_view text DEFAULT NULL::text, p_urgencia text DEFAULT 'Média'::text, p_ref_id uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text, p_filial text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public._assert_rpc();

  INSERT INTO notificacoes (
    setor, tipo, titulo, mensagem, link_view, urgencia,
    origem_setor, origem_user, ref_id, motivo, filial
  ) VALUES (
    p_setor, p_tipo, p_titulo, p_mensagem, p_link_view, p_urgencia,
    auth_user_setor(), auth.uid(), p_ref_id, p_motivo,
    -- (619) Sem unidade o aviso ia para todas. Quem está numa unidade só
    -- avisa a própria; quem está na Matriz continua podendo mandar para todas.
    COALESCE(p_filial, NULLIF(auth_user_filial(), 'Matriz'))
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.notificar_setor(text,text,text,text,text,text,uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notificar_setor(text,text,text,text,text,text,uuid,text,text) TO authenticated;

-- ─── Guardas ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'notificar_setor' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION '619: esperava uma única notificar_setor';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND tablename = 'notificacoes_lidas') THEN
    RAISE EXCEPTION '619: notificacoes_lidas não deve estar no realtime';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
