-- 301 — Pedido novo toca o sino do setor vendas DAQUELA filial.
--
-- O realtime da 298 resolve para quem está com a tela de Pedidos Online aberta.
-- Quem está no PDV, no caixa ou no estoque não fica sabendo que tem comprador
-- esperando — e a loja não avisa ninguém.
--
-- O BLOQUEIO QUE PRECISOU SAIR DA FRENTE
--
-- `notificacoes` não tinha coluna `filial`, e a policy de leitura era só
--
--     auth_is_admin() OR setor = 'all' OR setor = ANY(auth_user_setores())
--
-- Então `notificar_setor('vendas', …)` tocaria o sino do setor vendas das TRÊS
-- filiais: a MaxLook seria avisada de pedido da SuperMax. Isso contradiz o
-- isolamento fechado nas migrações 295-297, e num ambiente de competição
-- inter-filiais é pior que ruído — é entregar movimento da concorrente.
--
-- Agora `notificacoes.filial` existe:
--
--   NULL          → notificação da holding, chega para todo o setor (é o que
--                   todas as chamadas existentes continuam fazendo, sem tocar
--                   em nenhuma delas)
--   'SuperMax'    → só quem pode aquela filial
--
-- `auth_pode_filial` é a mesma função que decide o resto do sistema, então
-- gerente da filial, colaborador da filial e Matriz enxergam; a filial vizinha
-- não.
--
-- SOBRE O DROP DA `notificar_setor`
--
-- Parâmetro novo com DEFAULT cria SOBRECARGA em vez de substituir, e duas
-- versões com default deixam o PostgREST sem saber qual chamar (PGRST203).
-- As 6 telas que já chamam a função passam parâmetros nomeados e continuam
-- resolvendo para a versão de 9 argumentos.
--
-- E o DROP zera os privilégios: função nova nasce com EXECUTE para PUBLIC, o
-- que desfaria o lockdown da 260/261. Os GRANTs abaixo repõem exatamente o que
-- havia — anon sem nada, authenticated e service_role com EXECUTE.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS filial text;

COMMENT ON COLUMN public.notificacoes.filial IS
  'Filial destinatária. NULL = notificação da holding, chega para todo o setor (comportamento histórico). Preenchida = só quem pode aquela filial.';

CREATE INDEX IF NOT EXISTS idx_notificacoes_setor_filial
  ON public.notificacoes (setor, filial, created_at DESC);

DROP POLICY IF EXISTS notif_read ON public.notificacoes;
CREATE POLICY notif_read ON public.notificacoes
  FOR SELECT TO authenticated
  USING (
    (public.auth_is_admin() OR setor = 'all' OR setor = ANY (public.auth_user_setores()))
    AND (filial IS NULL OR public.auth_pode_filial(filial))
  );

DROP POLICY IF EXISTS notif_update ON public.notificacoes;
CREATE POLICY notif_update ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (
    (public.auth_is_admin() OR setor = 'all' OR setor = ANY (public.auth_user_setores()))
    AND (filial IS NULL OR public.auth_pode_filial(filial))
  )
  WITH CHECK (
    (public.auth_is_admin() OR setor = 'all' OR setor = ANY (public.auth_user_setores()))
    AND (filial IS NULL OR public.auth_pode_filial(filial))
  );

DROP FUNCTION IF EXISTS public.notificar_setor(text, text, text, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.notificar_setor(
  p_setor     text,
  p_tipo      text,
  p_titulo    text,
  p_mensagem  text DEFAULT NULL,
  p_link_view text DEFAULT NULL,
  p_urgencia  text DEFAULT 'Média',
  p_ref_id    uuid DEFAULT NULL,
  p_motivo    text DEFAULT NULL,
  p_filial    text DEFAULT NULL
)
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
    auth_user_setor(), auth.uid(), p_ref_id, p_motivo, p_filial
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.notificar_setor(text, text, text, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_setor(text, text, text, text, text, text, uuid, text, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação
--
--   -- Uma assinatura só, com 9 argumentos:
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'notificar_setor';
--
--   -- Privilégios repostos (false, true, true):
--   SELECT has_function_privilege('anon',          'public.notificar_setor(text,text,text,text,text,text,uuid,text,text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.notificar_setor(text,text,text,text,text,text,uuid,text,text)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.notificar_setor(text,text,text,text,text,text,uuid,text,text)', 'EXECUTE');
--
--   -- Notificações históricas seguem sem filial (chegam para todos):
--   SELECT count(*) FILTER (WHERE filial IS NULL) AS holding,
--          count(*) FILTER (WHERE filial IS NOT NULL) AS por_filial
--     FROM notificacoes;
-- ────────────────────────────────────────────────────────────────────────────
