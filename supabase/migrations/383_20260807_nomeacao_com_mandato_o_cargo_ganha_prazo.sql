-- =================================================================
-- 383 — Nomeação com mandato: o cargo ganha origem, prazo e desfecho.
--
-- Item #G6 do backlog de governança.
--
-- O buraco: hoje virar gerente é o admin editar um campo em Usuários.
-- Não há ato, não há prazo e não há hora marcada pra prestar contas do
-- posto. Num Conselho de verdade a nomeação é um ato com data de
-- validade — no fim do mandato alguém decide reconduzir ou substituir,
-- e o critério dessa decisão é o desempenho medido.
--
-- Decisões que valem estar escritas:
--   • O mandato NÃO expira sozinho. Passada a data_fim ele fica vigente e
--     vencido, e a tela cobra a decisão do Conselho. Encerrar por cron
--     seria mais limpo e ensinaria a coisa errada: mandato vence, mas
--     quem tira alguém do cargo é gente, não o relógio.
--   • Um mandato vigente por cargo+filial e um por pessoa (índices
--     parciais). É o que impede dois "Gerente do SuperMax" ao mesmo tempo.
--   • `aplicar_acesso` é opcional e explícito. Quando ligado, a nomeação
--     mexe na role — e só entre 'colaborador' e 'gerente'. admin/CEO/
--     conselheiro nunca são tocados por aqui: mandato não é caminho de
--     escalada de privilégio (vide migr. 258).
--   • Encerrar com 'reconduzido' cria o mandato seguinte apontando para o
--     anterior por `origem_mandato_id`. A linha do tempo do posto fica
--     legível sem precisar de tabela de histórico própria.
--   • Reaproveita `movimentacoes_carreira`, que existia e estava vazia —
--     o CHECK de `tipo` ganhou os dois valores novos.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Mandatos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mandatos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id     uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  funcionario_id      uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  nome_snapshot       text,
  cargo               text NOT NULL,
  filial              text NOT NULL,
  data_inicio         date NOT NULL,
  data_fim            date NOT NULL,
  ato                 text,
  status              text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','encerrado')),
  desfecho            text CHECK (desfecho IS NULL OR desfecho IN ('reconduzido','substituido','encerrado')),
  origem_mandato_id   uuid REFERENCES public.mandatos(id) ON DELETE SET NULL,
  aplicou_acesso      boolean NOT NULL DEFAULT false,
  nomeado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nomeado_por_nome    text,
  encerrado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  encerrado_em        timestamptz,
  encerramento_motivo text,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim > data_inicio)
);

COMMENT ON TABLE public.mandatos IS
  'Ato de nomeacao com prazo. Vencido nao encerra sozinho: fica vigente e vencido ate o Conselho decidir.';
COMMENT ON COLUMN public.mandatos.aplicou_acesso IS
  'True quando a nomeacao mexeu na role do usuario. Guarda a informacao para o encerramento saber se deve desfazer.';

-- Um posto, um titular. Dois "Gerente do SuperMax" ao mesmo tempo é
-- exatamente o que o mandato existe pra impedir.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mandato_posto_vigente
  ON public.mandatos (lower(cargo), filial) WHERE status = 'vigente' AND ativo = true;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mandato_pessoa_vigente
  ON public.mandatos (user_profile_id) WHERE status = 'vigente' AND ativo = true;

CREATE INDEX IF NOT EXISTS idx_mandatos_filial ON public.mandatos (filial, status);

ALTER TABLE public.mandatos ENABLE ROW LEVEL SECURITY;

-- Quem manda na unidade não é segredo: leitura aberta a quem está logado.
-- Escrita não tem policy nenhuma de propósito — só entra pelas RPCs.
DROP POLICY IF EXISTS mandato_read ON public.mandatos;
CREATE POLICY mandato_read ON public.mandatos
  FOR SELECT TO authenticated USING (true);

-- Trilha de auditoria (migr. 331/332).
DROP TRIGGER IF EXISTS trg_historico ON public.mandatos;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.mandatos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'cargo', 'filial', 'data_fim', 'desfecho');

-- ── 2. movimentacoes_carreira aceita nomeação ─────────────────────
-- A tabela existe desde Recrutamento e nunca teve linha. Nomear e encerrar
-- mandato são movimentações de carreira como qualquer outra.
ALTER TABLE public.movimentacoes_carreira DROP CONSTRAINT IF EXISTS chk_movimentacao_tipo;
ALTER TABLE public.movimentacoes_carreira ADD CONSTRAINT chk_movimentacao_tipo
  CHECK (tipo IN ('Promoção','Transferência','Promoção e Transferência','Nomeação','Fim de mandato'));

-- ── 3. Nomear ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nomear_mandato(
  p_user_profile_id uuid,
  p_cargo           text,
  p_filial          text,
  p_data_inicio     date,
  p_data_fim        date,
  p_ato             text DEFAULT NULL,
  p_aplicar_acesso  boolean DEFAULT false,
  p_origem_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_perfil  user_profiles;
  v_func_id uuid;
  v_id      uuid;
  v_ator    text;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho nomeia.' USING ERRCODE = '42501';
  END IF;

  IF p_data_fim IS NULL OR p_data_inicio IS NULL OR p_data_fim <= p_data_inicio THEN
    RAISE EXCEPTION 'Mandato precisa de prazo: fim depois do início.' USING ERRCODE = 'P0001';
  END IF;

  IF p_filial NOT IN ('SuperMax','MaxLook','TechMax','Matriz') THEN
    RAISE EXCEPTION 'Unidade inválida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_perfil FROM user_profiles WHERE id = p_user_profile_id;
  IF v_perfil.id IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_perfil.desligado_em IS NOT NULL OR NOT COALESCE(v_perfil.ativo, true) THEN
    RAISE EXCEPTION 'Não se nomeia quem está desligado.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE user_profile_id = p_user_profile_id AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Esta pessoa já tem mandato vigente. Encerre o atual antes.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM mandatos
              WHERE lower(cargo) = lower(p_cargo) AND filial = p_filial
                AND status = 'vigente' AND ativo = true) THEN
    RAISE EXCEPTION 'Já há titular vigente para % em %.', p_cargo, p_filial USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();
  SELECT id INTO v_func_id FROM funcionarios
   WHERE user_profile_id = p_user_profile_id AND COALESCE(ativo, true) LIMIT 1;

  INSERT INTO mandatos
    (user_profile_id, funcionario_id, nome_snapshot, cargo, filial,
     data_inicio, data_fim, ato, origem_mandato_id, aplicou_acesso,
     nomeado_por, nomeado_por_nome)
  VALUES
    (p_user_profile_id, v_func_id, v_perfil.nome, p_cargo, p_filial,
     p_data_inicio, p_data_fim, NULLIF(btrim(COALESCE(p_ato,'')), ''),
     p_origem_id, COALESCE(p_aplicar_acesso, false), auth.uid(), v_ator)
  RETURNING id INTO v_id;

  -- Acesso: só entre colaborador e gerente. Mandato não promove ninguém a
  -- admin/CEO/conselheiro — esse caminho fica fechado por design (migr. 258).
  IF COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente') THEN
    UPDATE user_profiles
       SET role = 'gerente', filial = p_filial
     WHERE id = p_user_profile_id;
  END IF;

  INSERT INTO movimentacoes_carreira
    (funcionario_id, nome_funcionario, tipo, cargo_novo, filial_nova, filial,
     role_anterior, role_nova, data_efeito, user_profile_id,
     decidido_por, decidido_por_nome)
  VALUES
    (v_func_id, v_perfil.nome, 'Nomeação', p_cargo, p_filial, p_filial,
     v_perfil.role,
     CASE WHEN COALESCE(p_aplicar_acesso, false) AND v_perfil.role IN ('colaborador','gerente')
          THEN 'gerente' ELSE v_perfil.role END,
     p_data_inicio, p_user_profile_id, auth.uid(), v_ator);

  RETURN jsonb_build_object('sucesso', true, 'mandato_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.nomear_mandato(uuid,text,text,date,date,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomear_mandato(uuid,text,text,date,date,text,boolean,uuid) TO authenticated;

-- ── 4. Encerrar (reconduzir / substituir / encerrar) ──────────────
CREATE OR REPLACE FUNCTION public.encerrar_mandato(
  p_mandato_id    uuid,
  p_desfecho      text,
  p_motivo        text DEFAULT NULL,
  p_nova_data_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_m      mandatos;
  v_novo   uuid;
  v_ator   text;
  v_role   text;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho encerra mandato.' USING ERRCODE = '42501';
  END IF;

  IF p_desfecho NOT IN ('reconduzido','substituido','encerrado') THEN
    RAISE EXCEPTION 'Desfecho inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_m FROM mandatos WHERE id = p_mandato_id AND ativo = true;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Mandato não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_m.status <> 'vigente' THEN
    RAISE EXCEPTION 'Este mandato já foi encerrado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_desfecho = 'reconduzido' AND (p_nova_data_fim IS NULL OR p_nova_data_fim <= v_m.data_fim) THEN
    RAISE EXCEPTION 'Recondução precisa de novo prazo, posterior ao atual.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();

  UPDATE mandatos
     SET status = 'encerrado', desfecho = p_desfecho,
         encerrado_por = auth.uid(), encerrado_em = now(),
         encerramento_motivo = NULLIF(btrim(COALESCE(p_motivo,'')), ''),
         updated_at = now()
   WHERE id = p_mandato_id;

  IF p_desfecho = 'reconduzido' THEN
    -- O posto continua com a mesma pessoa: novo ato, novo prazo, mesma
    -- linha do tempo. O acesso já está aplicado, então não se mexe nele.
    INSERT INTO mandatos
      (user_profile_id, funcionario_id, nome_snapshot, cargo, filial,
       data_inicio, data_fim, ato, origem_mandato_id, aplicou_acesso,
       nomeado_por, nomeado_por_nome)
    VALUES
      (v_m.user_profile_id, v_m.funcionario_id, v_m.nome_snapshot, v_m.cargo, v_m.filial,
       v_m.data_fim + 1, p_nova_data_fim,
       NULLIF(btrim(COALESCE(p_motivo,'')), ''), v_m.id, v_m.aplicou_acesso,
       auth.uid(), v_ator)
    RETURNING id INTO v_novo;
  ELSE
    -- Saiu do posto. Se a nomeação tinha dado o acesso, ela o retira —
    -- e só se a pessoa não estiver titular de outro posto.
    IF v_m.aplicou_acesso THEN
      SELECT role INTO v_role FROM user_profiles WHERE id = v_m.user_profile_id;
      IF v_role = 'gerente' AND NOT EXISTS (
            SELECT 1 FROM mandatos
             WHERE user_profile_id = v_m.user_profile_id
               AND status = 'vigente' AND ativo = true) THEN
        UPDATE user_profiles SET role = 'colaborador' WHERE id = v_m.user_profile_id;
      END IF;
    END IF;

    INSERT INTO movimentacoes_carreira
      (funcionario_id, nome_funcionario, tipo, cargo_anterior, filial_anterior, filial,
       data_efeito, user_profile_id, decidido_por, decidido_por_nome)
    VALUES
      (v_m.funcionario_id, v_m.nome_snapshot, 'Fim de mandato', v_m.cargo, v_m.filial, v_m.filial,
       CURRENT_DATE, v_m.user_profile_id, auth.uid(), v_ator);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'desfecho', p_desfecho, 'novo_mandato_id', v_novo);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_mandato(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_mandato(uuid,text,text,date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN ('nomear_mandato','encerrar_mandato');
--
-- 2) Dois titulares no mesmo posto tem de falhar (uniq_mandato_posto_vigente).
--
-- 3) Recondução encadeia:
-- SELECT m.cargo, m.filial, m.data_inicio, m.data_fim, m.status, m.desfecho,
--        m.origem_mandato_id IS NOT NULL AS eh_reconducao
--   FROM mandatos m ORDER BY m.filial, m.data_inicio;
--
-- 4) Vencidos aguardando decisão do Conselho:
-- SELECT nome_snapshot, cargo, filial, data_fim FROM mandatos
--  WHERE status='vigente' AND ativo AND data_fim < CURRENT_DATE;
