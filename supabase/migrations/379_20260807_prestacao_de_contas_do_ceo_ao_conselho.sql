-- =================================================================
-- 379 — Prestação de contas: quem executa volta para explicar.
--
-- Item #G3 do backlog de governança. Exceção à trava aberta pelo usuário
-- em 2026-08-07. Par da 378: lá o Conselho dá a verba, aqui cobra o que
-- foi feito com ela.
--
-- O buraco: o CEO é avaliado, mas não responde por nada. Conselho e CEO
-- tinham exatamente as mesmas mãos — os dois avaliam, votam e criam
-- tarefa —, então o órgão que deveria fiscalizar não tinha nenhum ato de
-- fiscalização para praticar. Sem prestação de contas, "CEO" é só um
-- nome bonito para super-admin.
--
-- O processo real:
--   1. Quem responde pela unidade monta a prestação do período   (rascunho)
--   2. Submete ao Conselho                                       (submetida)
--   3. Cada conselheiro dá seu parecer: aprovar, ressalvar, reprovar
--   4. O Conselho encerra e o resultado consolida os pareceres
--   5. CADA RESSALVA VIRA TAREFA COM PRAZO — é o passo que separa
--      "reunião onde se reclama" de governança que produz consequência
--
-- Decisões que valem estar escritas:
--   • Parecer é SELADO enquanto a prestação está em deliberação: cada
--     conselheiro só enxerga o próprio voto até o encerramento. Mesma
--     régua do voto da competição (375) e pelo mesmo motivo — parecer
--     visível é parecer copiado.
--   • Ressalvar EXIGE texto e prazo. Ressalva sem prazo é reclamação;
--     com prazo, é plano de ação.
--   • A consolidação é a regra mais severa presente: um "reprovar" entre
--     dez "aprovar" reprova. Conselho não decide por média.
--   • O plano de ação vai para `tarefas`, não para `matriz_tarefas` —
--     esta última exige `competicao_id NOT NULL`, e prender prestação de
--     contas à existência de uma competição ativa seria inventar uma
--     dependência que o processo real não tem.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. `tarefas` passa a aceitar o plano de ação da governança ────
-- O CHECK de `modulo` não previa governança, e o de `origem` só conhecia
-- 'manual' e 'briefing_ia'. Sem estender os dois, a ressalva teria de se
-- disfarçar de tarefa manual do módulo Empresa — e a origem, que é
-- justamente o que dá peso à tarefa, se perderia.
ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS tarefas_modulo_check;
ALTER TABLE public.tarefas ADD CONSTRAINT tarefas_modulo_check
  CHECK (modulo IN ('empresa','compras','estoque','financeiro','rh','vendas','governanca'));

ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS chk_tarefas_origem;
ALTER TABLE public.tarefas ADD CONSTRAINT chk_tarefas_origem
  CHECK (origem IN ('manual','briefing_ia','ressalva_conselho'));

-- ── 2. A prestação ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prestacoes_contas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial          text NOT NULL,          -- inclui 'Matriz': o CEO presta contas por ela
  titulo          text NOT NULL,
  periodo_inicio  date NOT NULL,
  periodo_fim     date NOT NULL,
  resultado       text,                   -- o que aconteceu no período
  destaques       text,                   -- o que foi bem
  riscos          text,                   -- o que preocupa
  indicadores     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho','submetida','aprovada','aprovada_com_ressalva','reprovada')),
  autor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submetida_em    timestamptz,
  conclusao       text,
  encerrada_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  encerrada_em    timestamptz,
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (periodo_fim >= periodo_inicio)
);

COMMENT ON TABLE public.prestacoes_contas IS
  'Quem responde pela unidade presta contas do periodo ao Conselho. Ressalva do parecer vira tarefa com prazo.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prestacao_filial_periodo
  ON public.prestacoes_contas (filial, periodo_inicio, periodo_fim)
  WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.prestacao_pareceres (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestacao_id   uuid NOT NULL REFERENCES public.prestacoes_contas(id) ON DELETE CASCADE,
  conselheiro_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  voto           text NOT NULL CHECK (voto IN ('aprovar','ressalvar','reprovar')),
  ressalva       text,
  prazo_acao     date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prestacao_id, conselheiro_id),
  -- Ressalva sem texto e sem prazo é reclamação, não plano de ação.
  CHECK (voto <> 'ressalvar' OR (ressalva IS NOT NULL AND btrim(ressalva) <> '' AND prazo_acao IS NOT NULL))
);

-- ── 3. RLS ────────────────────────────────────────────────────────
ALTER TABLE public.prestacoes_contas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestacao_pareceres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prestacao_read ON public.prestacoes_contas;
CREATE POLICY prestacao_read ON public.prestacoes_contas
  FOR SELECT TO authenticated USING (true);

-- Só a unidade dona monta a prestação, e só enquanto é rascunho.
DROP POLICY IF EXISTS prestacao_insert ON public.prestacoes_contas;
CREATE POLICY prestacao_insert ON public.prestacoes_contas
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(NOT auth_desligado(), false)
    AND COALESCE(auth_pode_filial(filial), false)
    AND status = 'rascunho'
  );

DROP POLICY IF EXISTS prestacao_update ON public.prestacoes_contas;
CREATE POLICY prestacao_update ON public.prestacoes_contas
  FOR UPDATE TO authenticated
  USING (
    COALESCE(NOT auth_desligado(), false)
    AND COALESCE(auth_pode_filial(filial), false)
    AND status = 'rascunho'
  )
  WITH CHECK (status = 'rascunho');

-- Parecer SELADO: enquanto está em deliberação, cada conselheiro só vê o
-- próprio. Depois de encerrada, todo mundo vê tudo — é o que permite
-- cobrar o Conselho pelo que ele decidiu.
DROP POLICY IF EXISTS parecer_read ON public.prestacao_pareceres;
CREATE POLICY parecer_read ON public.prestacao_pareceres
  FOR SELECT TO authenticated
  USING (
    conselheiro_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.prestacoes_contas p
       WHERE p.id = prestacao_pareceres.prestacao_id
         AND p.status IN ('aprovada','aprovada_com_ressalva','reprovada')
    )
  );

-- Escrita de parecer não tem policy: passa só por RPC SECURITY DEFINER,
-- que é quem valida papel, estado e o par ressalva+prazo.

-- ── 4. Submeter ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submeter_prestacao(p_prestacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_p prestacoes_contas;
BEGIN
  SELECT * INTO v_p FROM prestacoes_contas WHERE id = p_prestacao_id AND ativo = true;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Prestação não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(auth_pode_filial(v_p.filial), false) THEN
    RAISE EXCEPTION 'Você não responde por %.', v_p.filial USING ERRCODE = '42501';
  END IF;

  IF v_p.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Só rascunho pode ser submetido (atual: %).', v_p.status USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(v_p.resultado), '') = '' THEN
    RAISE EXCEPTION 'Preencha o resultado do período antes de submeter.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE prestacoes_contas
     SET status = 'submetida', submetida_em = now(), updated_at = now(),
         autor_id = COALESCE(autor_id, auth.uid())
   WHERE id = p_prestacao_id;

  PERFORM notificar_setor(
    p_setor     => 'financeiro',
    p_tipo      => 'aprovacao_pendente',
    p_titulo    => 'Prestação de contas para deliberação',
    p_mensagem  => format('%s submeteu "%s" ao Conselho.', v_p.filial, v_p.titulo),
    -- Slug vem do rótulo do submenu e mantém acento (convenção da casa).
    p_link_view => 'financeiro-prestaçãodecontas',
    p_ref_id    => p_prestacao_id,
    p_filial    => v_p.filial);

  RETURN jsonb_build_object('sucesso', true, 'status', 'submetida');
END;
$$;

REVOKE ALL ON FUNCTION public.submeter_prestacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submeter_prestacao(uuid) TO authenticated;

-- ── 5. Dar parecer (só Conselho) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.dar_parecer_prestacao(
  p_prestacao_id uuid,
  p_voto         text,
  p_ressalva     text DEFAULT NULL,
  p_prazo_acao   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_p prestacoes_contas;
BEGIN
  -- auth_is_admin() já é o teste de Conselho (admin, CEO, conselheiro puro
  -- ou gerente com is_conselheiro) e exclui desligado.
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho dá parecer.' USING ERRCODE = '42501';
  END IF;

  IF p_voto NOT IN ('aprovar','ressalvar','reprovar') THEN
    RAISE EXCEPTION 'Voto inválido: %.', p_voto USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_p FROM prestacoes_contas WHERE id = p_prestacao_id AND ativo = true;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Prestação não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_p.status <> 'submetida' THEN
    RAISE EXCEPTION 'A prestação não está em deliberação (atual: %).', v_p.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Quem presta contas não delibera sobre a própria prestação.
  IF v_p.autor_id = auth.uid() THEN
    RAISE EXCEPTION 'Você submeteu esta prestação — não pode dar parecer sobre ela.'
      USING ERRCODE = '42501';
  END IF;

  IF p_voto = 'ressalvar'
     AND (COALESCE(btrim(p_ressalva), '') = '' OR p_prazo_acao IS NULL) THEN
    RAISE EXCEPTION 'Ressalva exige texto e prazo — sem prazo é reclamação, não plano de ação.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO prestacao_pareceres (prestacao_id, conselheiro_id, voto, ressalva, prazo_acao)
  VALUES (p_prestacao_id, auth.uid(), p_voto,
          CASE WHEN p_voto = 'ressalvar' THEN p_ressalva ELSE NULLIF(btrim(COALESCE(p_ressalva,'')), '') END,
          CASE WHEN p_voto = 'ressalvar' THEN p_prazo_acao ELSE NULL END)
  ON CONFLICT (prestacao_id, conselheiro_id) DO UPDATE
     SET voto = EXCLUDED.voto, ressalva = EXCLUDED.ressalva,
         prazo_acao = EXCLUDED.prazo_acao, updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'voto', p_voto);
END;
$$;

REVOKE ALL ON FUNCTION public.dar_parecer_prestacao(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_parecer_prestacao(uuid,text,text,date) TO authenticated;

-- ── 6. Encerrar: consolida e gera o plano de ação ─────────────────
CREATE OR REPLACE FUNCTION public.encerrar_prestacao(
  p_prestacao_id uuid,
  p_conclusao    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_p         prestacoes_contas;
  v_pareceres int;
  v_reprovar  int;
  v_ressalvar int;
  v_status    text;
  v_tarefas   int := 0;
  r           record;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho encerra a deliberação.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM prestacoes_contas WHERE id = p_prestacao_id AND ativo = true;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'Prestação não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_p.status <> 'submetida' THEN
    RAISE EXCEPTION 'A prestação não está em deliberação (atual: %).', v_p.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE voto = 'reprovar'),
         count(*) FILTER (WHERE voto = 'ressalvar')
    INTO v_pareceres, v_reprovar, v_ressalvar
    FROM prestacao_pareceres WHERE prestacao_id = p_prestacao_id;

  IF v_pareceres = 0 THEN
    RAISE EXCEPTION 'Nenhum parecer registrado — nada a consolidar.' USING ERRCODE = 'P0001';
  END IF;

  -- Regra mais severa presente. Conselho não decide por média.
  v_status := CASE
                WHEN v_reprovar  > 0 THEN 'reprovada'
                WHEN v_ressalvar > 0 THEN 'aprovada_com_ressalva'
                ELSE 'aprovada'
              END;

  -- Cada ressalva vira tarefa com prazo. É o que transforma parecer em
  -- consequência — sem isto, a reunião acaba e nada muda.
  FOR r IN
    SELECT pp.ressalva, pp.prazo_acao, up.nome AS conselheiro
      FROM prestacao_pareceres pp
      JOIN user_profiles up ON up.id = pp.conselheiro_id
     WHERE pp.prestacao_id = p_prestacao_id AND pp.voto = 'ressalvar'
  LOOP
    INSERT INTO tarefas (modulo, titulo, descricao, prioridade, prazo, filial, origem, criado_por, nome_criador)
    VALUES ('governanca',
            format('Ressalva do Conselho — %s', v_p.titulo),
            r.ressalva,
            'Alta',
            r.prazo_acao,
            v_p.filial,
            'ressalva_conselho',
            auth.uid(),
            r.conselheiro);
    v_tarefas := v_tarefas + 1;
  END LOOP;

  UPDATE prestacoes_contas
     SET status = v_status, conclusao = p_conclusao,
         encerrada_por = auth.uid(), encerrada_em = now(), updated_at = now()
   WHERE id = p_prestacao_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'status', v_status,
    'pareceres', v_pareceres, 'tarefas_geradas', v_tarefas);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_prestacao(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_prestacao(uuid,text) TO authenticated;

-- ── 7. Realtime ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'prestacoes_contas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prestacoes_contas;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) CHECKs estendidos (senão a ressalva não vira tarefa):
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid='public.tarefas'::regclass
--    AND conname IN ('tarefas_modulo_check','chk_tarefas_origem');
--
-- 2) anon fora das RPCs novas:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('submeter_prestacao','dar_parecer_prestacao','encerrar_prestacao');
-- Esperado: false nas três.
--
-- 3) Fim a fim: CEO cria a prestação da Matriz, preenche resultado, submete.
--    Dois conselheiros dão parecer (um deles ressalvando, com prazo). Antes
--    do encerramento, cada um enxerga só o próprio parecer. Encerrar deve
--    devolver status 'aprovada_com_ressalva' e tarefas_geradas = 1, e a
--    tarefa aparece com origem='ressalva_conselho':
-- SELECT titulo, prazo, filial, origem FROM tarefas WHERE origem='ressalva_conselho';
