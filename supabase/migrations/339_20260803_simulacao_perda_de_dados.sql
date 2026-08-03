-- 339 — Simulação de perda de dados (apagão didático).
--
-- Objetivo de aula: mostrar, sentindo, o que é depender de um sistema e não
-- ter os dados. O aluno abre a tela e não há nada — nem o pedido que ele
-- lançou, nem a conta que ele conferiu. A pergunta que vem depois ("quanto a
-- SuperMax deve ao fornecedor X?") é a lição; a tela vazia é só o cenário.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NADA É APAGADO. NUNCA.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O sumiço acontece na LEITURA, por policy RESTRICTIVE. Enquanto a simulação
-- está ligada, o SELECT não devolve linha; a linha continua na tabela, byte a
-- byte. Desligar é instantâneo e completo porque não houve o que restaurar.
--
-- Apagar de verdade e restaurar de backup seria irreversível no dia em que o
-- backup falhasse — e a aula terminaria com dados perdidos de verdade.
-- Esconder no frontend não resistiria ao F12, que é justamente o que esta
-- turma faz (foi assim que nasceram as migr. 258 e 260).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O QUE NUNCA ENTRA NO APAGÃO, E POR QUÊ
-- ═══════════════════════════════════════════════════════════════════════════
--
--   • `user_profiles`, `auth.*`, `filiais`  — se o login parar, você não tem
--     uma aula, tem um chamado.
--   • `blackout_config`                     — a tabela do próprio interruptor.
--     Se ela se apagasse, o botão de desligar sumiria junto.
--   • `aula_config`                         — o Modo Aula precisa continuar
--     funcionando durante a simulação.
--   • Cadastros (produtos, clientes, fornecedores, categorias)  — ficam de pé
--     nesta fase. O sistema continua navegável, e é isso que permite a segunda
--     metade da aula: tentar refazer o que se perdeu. Some o MOVIMENTO, que é
--     o que ninguém guarda em planilha.
--
-- Isento sempre: admin, CEO, conselheiro (a direção precisa ver o que a turma
-- não está vendo, e precisa poder desligar de dentro do sistema) e
-- service_role (cron e endpoints não podem quebrar por causa da simulação).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ESCRITA TAMBÉM CONGELA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A policy é FOR ALL. Se o aluno pudesse lançar durante o apagão, ele
-- relançaria o que "sumiu" e, ao voltar, você teria tudo duplicado. Não poder
-- nem lançar é parte da lição.

BEGIN;

-- ── Interruptor ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blackout_config (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativo         boolean NOT NULL DEFAULT false,
  mensagem      text,
  -- Fase 2 (apagão parcial: "perdemos o servidor do Financeiro"). NULL = tudo.
  -- A coluna nasce agora para que a fase 2 seja só policy, sem migração de
  -- schema no meio de uma turma em uso.
  escopo        text[],
  iniciado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  iniciado_nome text,
  iniciado_em   timestamptz,
  encerrado_em  timestamptz
);

INSERT INTO public.blackout_config (id, ativo) VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.blackout_config ENABLE ROW LEVEL SECURITY;

-- Todo mundo LÊ o interruptor: é ele que faz o aviso aparecer na tela do
-- aluno. Sem leitura, a tela ficaria vazia sem explicação — que é o oposto do
-- que esta função existe para fazer.
DROP POLICY IF EXISTS blackout_select ON public.blackout_config;
CREATE POLICY blackout_select ON public.blackout_config
  FOR SELECT TO authenticated USING (true);

-- Só a direção liga e desliga.
DROP POLICY IF EXISTS blackout_update ON public.blackout_config;
CREATE POLICY blackout_update ON public.blackout_config
  FOR UPDATE TO authenticated
  USING      (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro'))
  WITH CHECK (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'blackout_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.blackout_config;
  END IF;
END $$;

-- ── A régua ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_blackout()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.blackout_config WHERE id AND ativo)
     AND NOT public.auth_is_service_role()
     AND NOT public.auth_is_admin()
     AND COALESCE(public.auth_user_role(), '') NOT IN ('ceo', 'conselheiro');
$function$;

GRANT EXECUTE ON FUNCTION public.auth_blackout() TO authenticated;

COMMENT ON FUNCTION public.auth_blackout() IS
  'True quando a simulação de perda de dados está ligada E o caller não é isento. Isento: service_role, admin, CEO e conselheiro.';

-- ── As policies ─────────────────────────────────────────────────────────────
-- RESTRICTIVE: soma-se às existentes com AND, então não afrouxa nada. Ligada a
-- simulação, o AND vira falso e a tabela some — para quem não é isento.
--
-- A lista é a das tabelas com trilha de histórico: são exatamente as que
-- guardam movimento, e é movimento que ninguém consegue reconstruir de cabeça.

DO $$
DECLARE
  t text;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE tg.tgname = 'trg_historico'
     ORDER BY 1
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_blackout ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY zz_blackout ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (NOT public.auth_blackout()) WITH CHECK (NOT public.auth_blackout())', t);
    n := n + 1;
  END LOOP;

  -- A trilha some junto: ler o histórico durante o apagão entregaria a
  -- história inteira do que "se perdeu".
  EXECUTE 'DROP POLICY IF EXISTS zz_blackout ON public.historico_operacoes';
  EXECUTE 'CREATE POLICY zz_blackout ON public.historico_operacoes AS RESTRICTIVE FOR ALL TO authenticated '
          'USING (NOT public.auth_blackout()) WITH CHECK (NOT public.auth_blackout())';

  RAISE NOTICE 'Simulação cobre % tabela(s) de movimento + historico_operacoes.', n;
END $$;

-- ── Liga/desliga ────────────────────────────────────────────────────────────
-- RPC em vez de UPDATE solto para registrar quem fez, quando, e devolver o
-- estado — e para o botão ser um caminho só, igual em qualquer tela.

CREATE OR REPLACE FUNCTION public.alternar_simulacao_perda(
  p_ativo    boolean,
  p_mensagem text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text;
  v_cfg  public.blackout_config;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'Só a direção liga ou desliga a simulação de perda de dados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.blackout_config
     SET ativo         = p_ativo,
         mensagem      = CASE WHEN p_ativo THEN NULLIF(trim(COALESCE(p_mensagem, '')), '') ELSE NULL END,
         iniciado_por  = CASE WHEN p_ativo THEN auth.uid() ELSE iniciado_por END,
         iniciado_nome = CASE WHEN p_ativo THEN COALESCE(v_nome, 'Direção') ELSE iniciado_nome END,
         iniciado_em   = CASE WHEN p_ativo THEN now() ELSE iniciado_em END,
         encerrado_em  = CASE WHEN p_ativo THEN NULL ELSE now() END
   WHERE id
  RETURNING * INTO v_cfg;

  RETURN to_jsonb(v_cfg);
END;
$function$;

REVOKE ALL ON FUNCTION public.alternar_simulacao_perda(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alternar_simulacao_perda(boolean, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- SAÍDA DE EMERGÊNCIA
-- ═══════════════════════════════════════════════════════════════════════════
-- Se a simulação ficar ligada e ninguém conseguir desligar pela tela, isto
-- resolve pelo SQL Editor (roda como service_role, que é isento):
--
--   UPDATE public.blackout_config SET ativo = false, encerrado_em = now() WHERE id;
--
-- Verificação:
--
--   -- 1) Interruptor desligado ao fim da migração:
--   SELECT * FROM blackout_config;
--
--   -- 2) 28 policies restritivas (27 tabelas + historico_operacoes):
--   SELECT count(*) FROM pg_policy WHERE polname = 'zz_blackout';
--
--   -- 3) Nenhuma linha foi tocada — compare antes e depois de ligar:
--   SELECT count(*) FROM vendas;   -- como service_role, sempre o total real
