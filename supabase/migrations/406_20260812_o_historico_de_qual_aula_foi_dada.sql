-- 406_20260812_o_historico_de_qual_aula_foi_dada.sql
--
-- Registro histórico das aulas conduzidas pelo Modo Aula.
--
-- `aula_config` é linha única (id = 1) e é SOBRESCRITA a cada save. Isso
-- significa que o sistema nunca soube responder "que fluxo a turma percorreu
-- na terça passada?" — a aula de ontem deixava de existir no instante em que a
-- de hoje era montada. Não havia como retomar um assunto sem depender da
-- memória de quem deu a aula, nem como saber quantas vezes cada cadeia foi
-- exercitada no semestre.
--
-- Por que TRIGGER e não RPC: `aula_config` é escrita direto pelo cliente
-- (`supabase.from('aula_config').update(...)` em AulaModoView), não por uma
-- função. Uma RPC só registraria o que passasse por ela, e o caminho que já
-- existe passa por fora — o mesmo tipo de escape que a `trg_ponto_filial` teve
-- de fechar no ponto. Na trigger, nenhum escritor escapa.
--
-- Recorte de sessão: LIGAR abre, DESLIGAR fecha. Mudança de config com a aula
-- já ligada não abre sessão nova — é a mesma aula sendo ajustada, e conta como
-- ajuste. `config_final` acompanha o último estado: numa aula que começa em
-- Compras e migra para Estoque, os dois pontos ficam registrados.
--
-- O que NÃO é gravado aqui, de propósito:
--   • a lista de FLUXOS. Ela vive em `src/lib/aulaFluxos.ts` (código do
--     frontend) e é derivada dos módulos. Gravar o nome do fluxo congelaria
--     no banco uma lista que muda com deploy, e o histórico passaria a citar
--     fluxo que não existe mais. A tela deriva na leitura, da mesma lista viva
--     que monta a aula.
--   • atividades publicadas e tarefas marcadas no período. Já estão em
--     `aula_atividades` e `aula_tarefas_realizadas` com timestamp; contar por
--     intervalo é barato e não cria um segundo lugar onde o número pode
--     divergir do fato.
--
-- APPEND-ONLY na prática: a tabela não tem policy de INSERT, UPDATE nem
-- DELETE. Quem escreve é a trigger, que é SECURITY DEFINER e passa por cima da
-- RLS. Nem admin consegue forjar ou apagar uma linha do histórico pela API —
-- só nomear a sessão, pela RPC abaixo, que toca dois campos de texto.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aula_sessoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciada_em    timestamptz NOT NULL DEFAULT now(),
  -- NULL = aula em andamento. É também o que impede duas sessões abertas.
  encerrada_em   timestamptz,
  iniciada_por   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  nome_iniciou   text,
  encerrada_por  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  nome_encerrou  text,
  -- { modulos, submenus, roles } no instante de ligar e no último estado
  -- conhecido. jsonb e não três colunas de array: o formato acompanha o que a
  -- tela já manipula como um objeto só, e a leitura não precisa de três casts.
  config_inicial jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_final   jsonb,
  -- Quantas vezes a whitelist mudou com a aula no ar. Número alto é sinal de
  -- aula montada às pressas — informação de quem conduz, não de auditoria.
  ajustes        integer NOT NULL DEFAULT 0,
  titulo         text,
  observacao     text
);

COMMENT ON TABLE public.aula_sessoes IS
  'Histórico append-only das aulas do Modo Aula. Escrito só pela trigger '
  'trg_aula_config_sessao; a lista de fluxos é derivada na leitura, não gravada.';

-- Consulta única da tela: as mais recentes primeiro.
CREATE INDEX IF NOT EXISTS idx_aula_sessoes_iniciada
  ON public.aula_sessoes (iniciada_em DESC);

-- Busca da sessão aberta (a trigger faz isso em toda escrita de aula_config).
CREATE INDEX IF NOT EXISTS idx_aula_sessoes_aberta
  ON public.aula_sessoes (iniciada_em DESC) WHERE encerrada_em IS NULL;

-- ─────────────────────────────────────────────
-- 2. Trigger — o registro nasce da própria mudança
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aula_config_registrar_sessao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
-- search_path explícito: trigger function sem ele quebra em contexto onde o
-- path do chamador é outro, e o erro aparece longe daqui.
SET search_path = public
AS $$
DECLARE
  v_quem  uuid;
  v_nome  text;
  v_snap  jsonb;
  v_mudou boolean;
BEGIN
  v_quem := COALESCE(NEW.atualizado_por, auth.uid());
  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_quem;

  v_snap := jsonb_build_object(
    'modulos',  to_jsonb(NEW.modulos_ativos),
    'submenus', to_jsonb(NEW.submenus_ativos),
    'roles',    to_jsonb(NEW.roles_afetados)
  );

  -- Ligou: abre a sessão, se já não houver uma aberta.
  --
  -- A trava de "no máximo uma aberta" mora AQUI e não num índice único. O
  -- índice pediria uma expressão constante (`ON (…) WHERE encerrada_em IS
  -- NULL`), e um UNIQUE sobre `encerrada_em` não serve: em índice único os
  -- NULLs são distintos entre si, então ele deixaria passar exatamente o caso
  -- que deveria barrar. O guard explícito é suficiente porque esta trigger é a
  -- ÚNICA escritora da tabela — não há policy de INSERT para ninguém mais.
  --
  -- O caso real que ele pega: a aula estava no ar quando esta migração subiu.
  -- Aí o próximo "ligar" encontraria a config já ativa e abriria uma segunda
  -- sessão que o "desligar" seguinte não fecharia — uma aula eterna no
  -- histórico.
  IF NEW.ativo AND NOT OLD.ativo THEN
    IF NOT EXISTS (SELECT 1 FROM public.aula_sessoes WHERE encerrada_em IS NULL) THEN
      INSERT INTO public.aula_sessoes (iniciada_por, nome_iniciou, config_inicial, config_final)
      VALUES (v_quem, v_nome, v_snap, v_snap);
    END IF;
    RETURN NEW;
  END IF;

  -- Desligou: fecha a que estiver aberta. Se não houver nenhuma (aula ligada
  -- antes desta migração existir), não há o que fechar e não se inventa uma
  -- sessão com início desconhecido.
  IF OLD.ativo AND NOT NEW.ativo THEN
    UPDATE public.aula_sessoes
       SET encerrada_em  = now(),
           encerrada_por = v_quem,
           nome_encerrou = v_nome,
           config_final  = v_snap
     WHERE encerrada_em IS NULL;
    RETURN NEW;
  END IF;

  -- Seguiu ligada: ajuste da mesma aula. Só conta quando a whitelist mudou de
  -- fato — salvar sem mexer em nada (ou mexer só nas roles) não é ajuste de
  -- conteúdo e inflaria o contador sem dizer nada.
  IF NEW.ativo AND OLD.ativo THEN
    v_mudou := NEW.modulos_ativos  IS DISTINCT FROM OLD.modulos_ativos
            OR NEW.submenus_ativos IS DISTINCT FROM OLD.submenus_ativos
            OR NEW.roles_afetados  IS DISTINCT FROM OLD.roles_afetados;
    IF v_mudou THEN
      UPDATE public.aula_sessoes
         SET ajustes      = ajustes + 1,
             config_final = v_snap
       WHERE encerrada_em IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aula_config_sessao ON public.aula_config;
CREATE TRIGGER trg_aula_config_sessao
  AFTER UPDATE ON public.aula_config
  FOR EACH ROW EXECUTE FUNCTION public.aula_config_registrar_sessao();

-- ─────────────────────────────────────────────
-- 3. RLS — leitura para quem conduz, escrita para ninguém
-- ─────────────────────────────────────────────

ALTER TABLE public.aula_sessoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aula_sessoes_read" ON public.aula_sessoes;

-- Só quem conduz. `auth_is_admin()` fica de fora pela mesma razão da migr. 403:
-- ela inclui conselheiro, que nesta operação é aluno, e o histórico das aulas
-- é material de quem prepara a próxima.
CREATE POLICY "aula_sessoes_read" ON public.aula_sessoes
  FOR SELECT TO authenticated USING (
    public.auth_user_role() IN ('admin','ceo')
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE, de propósito: a trigger é DEFINER e
-- não passa por RLS. Isso torna o histórico inforjável pela API — a única
-- escrita possível é a RPC de nomear, logo abaixo.

-- ─────────────────────────────────────────────
-- 4. RPC — nomear a aula depois de dada
-- ─────────────────────────────────────────────
-- O título não é pedido na hora de ligar: no começo da aula ninguém sabe ainda
-- o que ela foi, e um campo obrigatório ali viraria "aula 1", "aula 2". Depois,
-- olhando o histórico, o nome sai sozinho.

CREATE OR REPLACE FUNCTION public.nomear_sessao_aula(
  p_sessao_id  uuid,
  p_titulo     text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- COALESCE porque `auth_user_role()` devolve NULL para sessão sem perfil, e
  -- `NULL IN (...)` é NULL — que num IF NOT não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() IN ('admin','ceo'), false) THEN
    RAISE EXCEPTION 'Apenas admin ou CEO pode nomear a aula.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.aula_sessoes
     SET titulo     = NULLIF(btrim(COALESCE(p_titulo, '')), ''),
         observacao = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE id = p_sessao_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão de aula não encontrada.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. Grants (padrão da migr. 260: nada nominalmente para anon)
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.nomear_sessao_aula(uuid, text, text)   FROM public, anon;
REVOKE ALL ON FUNCTION public.aula_config_registrar_sessao()         FROM public, anon;

GRANT EXECUTE ON FUNCTION public.nomear_sessao_aula(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 6. Realtime
-- ─────────────────────────────────────────────
-- A aba de histórico fica aberta enquanto o professor conduz: ligar e desligar
-- o Modo Aula tem de aparecer ali sem F5, e é o mesmo gesto que já dispara
-- realtime em `aula_config`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'aula_sessoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_sessoes;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- ligar, ajustar, desligar (como admin):
--   UPDATE aula_config SET ativo = true,  modulos_ativos = '{compras}'          WHERE id = 1;
--   UPDATE aula_config SET               modulos_ativos = '{compras,estoque}'  WHERE id = 1;
--   UPDATE aula_config SET ativo = false                                        WHERE id = 1;
--
--   SELECT iniciada_em, encerrada_em, ajustes, config_inicial, config_final
--     FROM aula_sessoes ORDER BY iniciada_em DESC LIMIT 3;
--   -- esperado: 1 linha, ajustes = 1, config_inicial com [compras],
--   --           config_final com [compras, estoque], encerrada_em preenchida.
--
--   -- a trava de sessão única (ligar duas vezes seguidas não abre duas):
--   UPDATE aula_config SET ativo = true WHERE id = 1;
--   UPDATE aula_config SET ativo = true, modulos_ativos = '{rh}' WHERE id = 1;
--   SELECT count(*) FROM aula_sessoes WHERE encerrada_em IS NULL;  -- 0 ou 1, nunca 2
-- =================================================================
