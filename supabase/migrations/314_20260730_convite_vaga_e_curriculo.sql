-- 314_20260730_convite_vaga_e_curriculo.sql
--
-- Convocação para processo seletivo interno + currículo do candidato.
--
-- O QUE FALTAVA. Depois da 311/312/313 a vaga existia, era aprovada pela
-- Matriz e tinha funil — mas o funcionário nunca ficava sabendo dela e nunca
-- era sujeito da própria candidatura: `vagas_select` (311) só alcança RH,
-- gerente da filial e Matriz, e `registrar_candidatura_interna` recebe
-- `p_funcionario_id`, ou seja, o RH escolhia a dedo quem entrava no funil.
-- Isso é indicação, não seleção.
--
-- O DESENHO (espelha os Avisos da Matriz, migr. 263). Não é mural aberto: o
-- RH/Matriz CONVOCA nominalmente quem deve concorrer, e só o convocado passa a
-- enxergar aquela vaga. Ele responde no FAB — anexa currículo e aceita, ou
-- recusa —, e a resposta cai no sino do RH da unidade E da Matriz (uma
-- notificação só: `notif_read` da 301 libera por setor OU `auth_is_admin()`).
--
-- Tabelas:
--   vaga_convites            : convocação nominal, com prazo e resposta
--   candidaturas.curriculo_path : arquivo no bucket privado `curriculos`
--
-- RPCs:
--   convocar_para_vaga(vaga, funcionarios[], prazo)  — RH/gerente da filial
--   cancelar_convite_vaga(convite)                   — idem
--   responder_convite_vaga(convite, aceitar, path)   — só o convocado
--
-- Storage: bucket `curriculos` PRIVADO (2 MB, PDF). Leitura por URL assinada —
-- currículo tem CPF e telefone, não vai em bucket público como as imagens de
-- produto.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — COLUNAS
-- ════════════════════════════════════════════════════════════════════════════

-- O caminho no bucket, não a URL: bucket privado só entrega via signed URL, que
-- expira. Guardar a URL assinada seria guardar um link morto.
ALTER TABLE public.candidaturas
  ADD COLUMN IF NOT EXISTS curriculo_path text;

ALTER TABLE public.candidaturas
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'RH';

DO $$
BEGIN
  ALTER TABLE public.candidaturas ADD CONSTRAINT chk_candidatura_origem
    CHECK (origem IN ('RH', 'Autocandidatura'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.candidaturas.origem IS
  'RH = alguém do RH inscreveu; Autocandidatura = o próprio funcionário respondeu a um convite (migr. 314).';

-- A policy de Storage casa o objeto com a candidatura por este caminho.
CREATE INDEX IF NOT EXISTS idx_candidaturas_curriculo_path
  ON public.candidaturas (curriculo_path) WHERE curriculo_path IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — TABELA DE CONVITES
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vaga_convites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id            uuid NOT NULL REFERENCES public.vagas(id) ON DELETE CASCADE,
  funcionario_id     uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  -- Quem faz login. Denormalizado do funcionário no momento do convite porque
  -- é por ele que a RLS do convocado resolve — sem isso toda policy viraria um
  -- JOIN em `funcionarios`, que tem RLS própria e não alcança o colaborador.
  -- Pode ser NULL: funcionário sem acesso criado não recebe o FAB, e a RPC
  -- recusa convocá-lo em vez de criar convite que ninguém vê.
  user_profile_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_snapshot      text,
  filial             text NOT NULL,
  prazo              timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'Pendente',
  candidatura_id     uuid REFERENCES public.candidaturas(id) ON DELETE SET NULL,
  motivo_recusa      text,
  respondido_em      timestamptz,
  convidado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  convidado_por_nome text,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.vaga_convites ADD CONSTRAINT chk_convite_status
    CHECK (status IN ('Pendente', 'Aceito', 'Recusado', 'Cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Mesmo padrão de `uq_candidatura_vaga_funcionario` (312) e da régua de
-- [[feedback_partial_unique_soft_delete]]: parcial em `ativo`, senão um convite
-- cancelado trava a reconvocação da mesma pessoa para a mesma vaga.
CREATE UNIQUE INDEX IF NOT EXISTS uq_convite_vaga_funcionario
  ON public.vaga_convites (vaga_id, funcionario_id) WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_convites_vaga    ON public.vaga_convites (vaga_id);
CREATE INDEX IF NOT EXISTS idx_convites_usuario ON public.vaga_convites (user_profile_id)
  WHERE ativo AND status = 'Pendente';
CREATE INDEX IF NOT EXISTS idx_convites_created ON public.vaga_convites (created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — RLS
--
-- Escrita só por RPC, como nas outras 4 tabelas do módulo (311/312): convocar
-- e responder são atos com regra, não POST solto do DevTools.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vaga_convites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vaga_convites_select ON public.vaga_convites;
CREATE POLICY vaga_convites_select ON public.vaga_convites FOR SELECT TO authenticated
  USING (
    -- O convocado enxerga o próprio convite, seja qual for o setor dele.
    user_profile_id = auth.uid()
    OR (
      (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
      AND public.auth_pode_filial(filial)
    )
  );

-- A vaga em si. Sem isto o convite chega com um uuid e nada mais: o convocado
-- não é RH nem gerente, então `vagas_select` (311) não o alcança. Policies
-- permissivas somam (OR), então esta abre exatamente uma linha por convite
-- ativo — nenhuma outra vaga fica visível.
DROP POLICY IF EXISTS vagas_select_convidado ON public.vagas;
CREATE POLICY vagas_select_convidado ON public.vagas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vaga_convites vc
       WHERE vc.vaga_id = vagas.id
         AND vc.user_profile_id = auth.uid()
         AND vc.ativo
    )
  );

-- A própria candidatura. Candidatar-se e nunca mais ver o que aconteceu é o
-- pior desfecho possível deste fluxo — o funcionário acompanha a etapa dele.
-- `candidatura_etapas` continua fechada de propósito: o histórico do funil tem
-- parecer interno e não é para o candidato.
DROP POLICY IF EXISTS candidaturas_select_propria ON public.candidaturas;
CREATE POLICY candidaturas_select_propria ON public.candidaturas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.funcionarios f
       WHERE f.id = candidaturas.funcionario_origem_id
         AND f.user_profile_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — BUCKET DE CURRÍCULOS (PRIVADO)
--
-- Os 4 buckets anteriores são públicos porque guardam imagem de produto, logo
-- de banco e foto de perfil. Currículo tem CPF, telefone e endereço: leitura
-- passa por URL assinada, com o mesmo recorte de `candidaturas_select`.
--
-- Convenção de caminho: <uid do candidato>/<uuid>.pdf — é o que permite ao
-- dono ler o próprio arquivo antes mesmo de existir candidatura.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('curriculos', 'curriculos', false, 2097152, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS curriculos_read   ON storage.objects;
DROP POLICY IF EXISTS curriculos_insert ON storage.objects;
DROP POLICY IF EXISTS curriculos_update ON storage.objects;
DROP POLICY IF EXISTS curriculos_delete ON storage.objects;

CREATE POLICY curriculos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'curriculos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      -- Mesmo recorte de `candidaturas_select` (311), resolvido pelo arquivo:
      -- RH ou gerente da unidade da candidatura, Matriz por auth_pode_filial.
      OR EXISTS (
        SELECT 1 FROM public.candidaturas c
         WHERE c.curriculo_path = storage.objects.name
           AND (public.auth_in_setor('rh') OR public.auth_gerente_da(c.filial))
           AND public.auth_pode_filial(c.filial)
      )
    )
  );

-- Escrita só no próprio diretório: ninguém sobrescreve currículo alheio.
CREATE POLICY curriculos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'curriculos' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY curriculos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'curriculos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'curriculos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY curriculos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'curriculos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.auth_is_admin())
  );

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 5 — RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- 5.1 Convocar funcionários para uma vaga interna aprovada.
--
-- Recebe array e devolve o que entrou e o que foi recusado, em vez de abortar
-- no primeiro problema: convocar 8 pessoas e perder as 8 porque uma está sem
-- avaliação seria hostil com quem opera.
CREATE OR REPLACE FUNCTION public.convocar_para_vaga(
  p_vaga_id         uuid,
  p_funcionario_ids uuid[],
  p_prazo           timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga     record;
  v_f        record;
  v_nome     text;
  v_media    numeric;
  v_fid      uuid;
  v_ok       int := 0;
  v_recusas  jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesma régua da 311: RH da unidade ou gerente dela.
  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.tipo <> 'Interna' THEN
    RAISE EXCEPTION 'Só processo interno tem convocação — vaga externa recebe candidatura de fora.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Só vaga Aprovada pode convocar (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_prazo IS NULL OR p_prazo <= now() THEN
    RAISE EXCEPTION 'O prazo para responder precisa ser no futuro.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(cardinality(p_funcionario_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um funcionário.' USING ERRCODE = '22023';
  END IF;

  -- Puxar gente de outra unidade é da holding, igual à inscrição (312).
  IF v_vaga.escopo <> 'Filial' THEN
    PERFORM public._assert_interfilial();
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  FOREACH v_fid IN ARRAY p_funcionario_ids LOOP
    SELECT * INTO v_f FROM public.funcionarios
     WHERE id = v_fid AND COALESCE(ativo, true);

    IF NOT FOUND THEN
      v_recusas := v_recusas || jsonb_build_object('funcionario_id', v_fid, 'motivo', 'Funcionário não encontrado ou inativo.');
      CONTINUE;
    END IF;

    IF COALESCE(v_f.status, 'Ativo') <> 'Ativo' THEN
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Status ' || COALESCE(v_f.status, 'Ativo') || '.');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = v_fid AND ativo) THEN
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Está desligado.');
      CONTINUE;
    END IF;

    IF v_vaga.escopo = 'Filial' AND COALESCE(v_f.filial, '') <> v_vaga.filial THEN
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'É da unidade ' || COALESCE(v_f.filial, '—') || '.');
      CONTINUE;
    END IF;

    -- Nota mínima conferida JÁ na convocação, não só na resposta: convidar
    -- alguém que a `registrar_candidatura_interna` vai recusar depois é criar
    -- expectativa para negar na cara do funcionário.
    IF v_vaga.nota_minima IS NOT NULL THEN
      v_media := public.media_avaliacao_funcionario(v_fid);
      IF v_media IS NULL THEN
        v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Sem avaliação de desempenho registrada.');
        CONTINUE;
      END IF;
      IF v_media < v_vaga.nota_minima THEN
        v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Média ' || v_media || ' abaixo do mínimo.');
        CONTINUE;
      END IF;
    END IF;

    -- Sem login não há FAB, e o convite ficaria pendente para sempre.
    IF v_f.user_profile_id IS NULL THEN
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Não tem acesso ao sistema — crie o login primeiro.');
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.candidaturas
       WHERE vaga_id = p_vaga_id AND funcionario_origem_id = v_fid AND ativo
    ) THEN
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Já está no funil desta vaga.');
      CONTINUE;
    END IF;

    INSERT INTO public.vaga_convites
      (vaga_id, funcionario_id, user_profile_id, nome_snapshot, filial, prazo,
       convidado_por, convidado_por_nome)
    VALUES
      (p_vaga_id, v_fid, v_f.user_profile_id, v_f.nome, v_vaga.filial, p_prazo,
       auth.uid(), v_nome)
    ON CONFLICT DO NOTHING;

    IF FOUND THEN
      v_ok := v_ok + 1;
    ELSE
      v_recusas := v_recusas || jsonb_build_object('nome', v_f.nome, 'motivo', 'Já convocado para esta vaga.');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'convocados', v_ok, 'recusados', v_recusas);
END;
$function$;

REVOKE ALL  ON FUNCTION public.convocar_para_vaga(uuid, uuid[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convocar_para_vaga(uuid, uuid[], timestamptz) TO authenticated;

-- 5.2 Cancelar convocação ainda não respondida.
CREATE OR REPLACE FUNCTION public.cancelar_convite_vaga(p_convite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c record;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.vaga_convites WHERE id = p_convite_id AND ativo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_c.filial);

  IF v_c.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Este convite já foi respondido (%).', v_c.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vaga_convites
     SET status = 'Cancelado', ativo = false, respondido_em = now()
   WHERE id = p_convite_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL  ON FUNCTION public.cancelar_convite_vaga(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_convite_vaga(uuid) TO authenticated;

-- 5.3 O funcionário responde: envia currículo e concorre, ou recusa.
--
-- É a única RPC do módulo sem `_assert_recrutamento` — de propósito. O gate
-- aqui é ser o dono do convite, e é isso que transforma indicação em seleção.
CREATE OR REPLACE FUNCTION public.responder_convite_vaga(
  p_convite_id     uuid,
  p_aceitar        boolean,
  p_curriculo_path text DEFAULT NULL,
  p_motivo         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c     record;
  v_vaga  record;
  v_f     record;
  v_media numeric;
  v_id    uuid;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.vaga_convites WHERE id = p_convite_id AND ativo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- COALESCE explícito: `user_profile_id` é nullable, e `NULL = auth.uid()` é
  -- NULL, que num IF NOT passa reto ([[feedback_assert_rpc_null]]).
  IF NOT COALESCE(v_c.user_profile_id = auth.uid(), false) THEN
    RAISE EXCEPTION 'Este convite não é seu.' USING ERRCODE = '42501';
  END IF;

  IF v_c.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Você já respondeu a este convite (%).', v_c.status USING ERRCODE = 'P0001';
  END IF;

  IF v_c.prazo <= now() THEN
    RAISE EXCEPTION 'O prazo para responder terminou em %.',
      to_char(v_c.prazo AT TIME ZONE 'America/Rio_Branco', 'DD/MM/YYYY HH24:MI')
      USING ERRCODE = 'P0001';
  END IF;

  -- Recusa: encerra o convite e avisa quem convocou. Sem candidatura.
  IF NOT COALESCE(p_aceitar, false) THEN
    UPDATE public.vaga_convites
       SET status = 'Recusado', ativo = false, respondido_em = now(),
           motivo_recusa = NULLIF(btrim(COALESCE(p_motivo, '')), '')
     WHERE id = p_convite_id;

    PERFORM public.notificar_setor(
      'rh', 'informativo', 'Convite recusado',
      COALESCE(v_c.nome_snapshot, 'Um funcionário') || ' recusou a convocação'
        || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '') || '.',
      'rh-recrutamentoeseleção', 'Baixa', v_c.vaga_id, NULL, v_c.filial
    );

    RETURN jsonb_build_object('ok', true, 'status', 'Recusado');
  END IF;

  -- Aceite: revalida TUDO. O convite pode ter sido emitido semanas antes e a
  -- vaga já estar preenchida, ou a pessoa já ter sido desligada nesse meio.
  SELECT * INTO v_vaga FROM public.vagas WHERE id = v_c.vaga_id AND ativo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta vaga não existe mais.' USING ERRCODE = 'P0002';
  END IF;

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Esta vaga não está mais aberta (%).', v_vaga.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = v_c.funcionario_id AND COALESCE(ativo, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastro de funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = v_c.funcionario_id AND ativo) THEN
    RAISE EXCEPTION 'Funcionário desligado não concorre a vaga interna.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.nota_minima IS NOT NULL THEN
    v_media := public.media_avaliacao_funcionario(v_c.funcionario_id);
    IF v_media IS NULL OR v_media < v_vaga.nota_minima THEN
      RAISE EXCEPTION 'Sua média de avaliação não atende ao mínimo desta vaga.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- O caminho tem que estar no diretório do próprio usuário. A policy de
  -- Storage já barra o upload fora dele, mas a coluna aceita texto: sem esta
  -- checagem daria para apontar a candidatura para o arquivo de outra pessoa.
  IF p_curriculo_path IS NOT NULL
     AND (storage.foldername(p_curriculo_path))[1] IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Currículo inválido.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.candidaturas
    (vaga_id, filial, nome, cpf, email, telefone, funcionario_origem_id,
     curriculo_path, origem, criado_por, criado_por_nome)
  VALUES
    (v_c.vaga_id, v_vaga.filial, v_f.nome, v_f.cpf, v_f.email, v_f.telefone, v_c.funcionario_id,
     p_curriculo_path, 'Autocandidatura', auth.uid(), v_f.nome)
  RETURNING id INTO v_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (v_id, NULL, 'Triagem',
          'Autocandidatura — respondeu à convocação de '
            || COALESCE(v_c.convidado_por_nome, 'RH')
            || COALESCE(' · média ' || v_media, '')
            || CASE WHEN p_curriculo_path IS NULL THEN ' · sem currículo' ELSE ' · com currículo' END,
          auth.uid(), v_f.nome);

  UPDATE public.vaga_convites
     SET status = 'Aceito', ativo = false, respondido_em = now(), candidatura_id = v_id
   WHERE id = p_convite_id;

  -- Um insert só: `notif_read` (301) entrega para o setor RH da unidade E para
  -- admin/CEO/conselheiro via auth_is_admin(). RH e Matriz, sem duplicar.
  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Nova candidatura interna',
    v_f.nome || ' se candidatou a ' || v_vaga.cargo || ' (' || v_vaga.filial || ')'
      || CASE WHEN p_curriculo_path IS NULL THEN '.' ELSE ' e anexou currículo.' END,
    'rh-recrutamentoeseleção', 'Média', v_c.vaga_id, NULL, v_vaga.filial
  );

  RETURN jsonb_build_object('ok', true, 'status', 'Aceito', 'candidatura_id', v_id);
END;
$function$;

REVOKE ALL  ON FUNCTION public.responder_convite_vaga(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_convite_vaga(uuid, boolean, text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 6 — REALTIME
--
-- O FAB do convocado aparece sem F5, igual ao dos Avisos (263).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'vaga_convites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vaga_convites;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- 1. Bucket privado, 2 MB, só PDF:
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'curriculos';       -- public = false
--
--   -- 2. Convocar (como RH da unidade, vaga Interna Aprovada):
--   SELECT public.convocar_para_vaga(
--     '<vaga_id>', ARRAY['<funcionario_id>']::uuid[], now() + interval '7 days');
--
--   -- 3. Como o convocado — deve enxergar 1 convite e 1 vaga:
--   SELECT count(*) FROM vaga_convites WHERE status = 'Pendente';  -- 1
--   SELECT count(*) FROM vagas;                                    -- 1
--
--   -- 4. Responder aceitando:
--   SELECT public.responder_convite_vaga('<convite_id>', true, NULL);
--   SELECT etapa, origem FROM candidaturas WHERE vaga_id = '<vaga_id>';
--
--   -- 5. Convite de outra pessoa deve dar 42501:
--   SELECT public.responder_convite_vaga('<convite_alheio>', true, NULL);
-- =================================================================
