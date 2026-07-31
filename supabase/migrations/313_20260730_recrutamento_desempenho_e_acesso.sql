-- 313 — Recrutamento, Fase 3: desempenho como pré-requisito e criação de acesso.
--
-- Fecha os dois ganchos que ficaram soltos nas 311/312:
--
--   1. PROMOVER SEM OLHAR A AVALIAÇÃO. O módulo de Avaliações existe desde a
--      migr. 002 e termina na nota: ninguém a consulta para decidir nada. A
--      vaga interna passa a poder exigir uma nota mínima, e o RH passa a ver
--      o desempenho de cada candidato na hora de inscrever.
--
--   2. CONTRATADO SEM LOGIN. `efetivar_contratacao` cria o `funcionarios`, e o
--      acesso ficava para "alguém lembrar de criar em Usuários" — com o email
--      digitado de novo, à mão, e nada garantindo que as duas pontas fossem a
--      mesma pessoa. `vincular_acesso_funcionario` amarra o vínculo depois que
--      `/api/users` cria a conta.
--
-- SOBRE ONDE CADA REGRA MORA. A nota que a UI EXIBE sai de
-- `desempenho_funcionarios()`, escopada por quem o chamador já pode ver em
-- `funcionarios`. A nota que o GATE aplica sai de
-- `media_avaliacao_funcionario()`, SECURITY DEFINER e sem RLS no caminho.
--
-- São duas coisas de propósito: a RLS de `avaliacoes` (migr. 091) deixa o RH
-- ler tudo mas confina o gerente ao próprio setor. Se o gate dependesse dela,
-- um gerente de outro setor faria a mesma inscrição passar por um caminho e
-- falhar por outro, dependendo de quem clicou — regra de negócio que muda
-- conforme o observador não é regra.
--
-- DECISÃO CONSCIENTE: `desempenho_funcionarios()` mostra a média ao gerente da
-- filial mesmo para setor que não é o dele, o que é mais do que a RLS de
-- `avaliacoes` daria. É a régua "gerente opera a filial inteira" (migrs.
-- 185/187) — ele já enxerga o salário dessas pessoas em Folha, e nota de
-- avaliação é menos sensível que salário. Sem isso ele decidiria promoção às
-- cegas na própria unidade.
--
-- IDEMPOTENTE. Depende da 311 e da 312. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — NOTA MÍNIMA NA VAGA INTERNA
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vagas
  ADD COLUMN IF NOT EXISTS nota_minima numeric(3,2);

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_nota_minima
    CHECK (nota_minima IS NULL OR (nota_minima >= 1 AND nota_minima <= 5));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Nota mínima em vaga externa não teria como ser verificada: o candidato de
-- fora não tem avaliação nenhuma no sistema.
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_nota_so_interna
    CHECK (nota_minima IS NULL OR tipo = 'Interna');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.vagas.nota_minima IS
  'Média mínima (1-5) da última avaliação de desempenho para entrar no processo '
  'interno. NULL = sem exigência. Escala de criterios_avaliacao. Migração 313.';

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — MÉDIA DA ÚLTIMA AVALIAÇÃO
--
-- `avaliacoes.avaliado_id` aponta para `user_profiles`, não para
-- `funcionarios` — então funcionário sem login nunca teve avaliação, e a
-- função devolve NULL. Quem decide o que fazer com o NULL é o chamador: o
-- gate abaixo trata como "não atende", e a tela mostra "sem avaliação".
--
-- Só os tipos de desempenho entram. 'feedback_colaborador' é a avaliação
-- ascendente — usá-la aqui misturaria "como ele foi avaliado" com "como ele
-- avaliou o chefe".
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.media_avaliacao_funcionario(p_funcionario_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH perfil AS (
    SELECT user_profile_id FROM public.funcionarios WHERE id = p_funcionario_id
  ),
  ultima AS (
    SELECT a.id
      FROM public.avaliacoes a, perfil p
     WHERE p.user_profile_id IS NOT NULL
       AND a.avaliado_id = p.user_profile_id
       AND a.tipo IN ('gerente_colaborador', 'ceo_gerente')
     ORDER BY a.created_at DESC
     LIMIT 1
  )
  SELECT ROUND(AVG(c.nota)::numeric, 2)
    FROM public.criterios_avaliacao c
    JOIN ultima u ON u.id = c.avaliacao_id;
$function$;

-- Revogada também de `authenticated`, e não só de anon: ela é SECURITY DEFINER
-- e não tem gate próprio, então exposta ao PostgREST devolveria a média de
-- QUALQUER pessoa a QUALQUER usuário logado que soubesse um `funcionario_id`.
-- Só `registrar_candidatura_interna` a chama, e como aquela também é SECURITY
-- DEFINER (mesmo owner), o EXECUTE continua funcionando por dentro. É a mesma
-- régua de `creditar_rescisao_maxbank` na 307. A leitura para a tela é a
-- `desempenho_funcionarios()` abaixo, que tem gate.
REVOKE ALL ON FUNCTION public.media_avaliacao_funcionario(uuid) FROM PUBLIC, anon, authenticated;

-- Painel de desempenho para a tela de recrutamento: uma chamada em vez de N.
CREATE OR REPLACE FUNCTION public.desempenho_funcionarios()
RETURNS TABLE (
  funcionario_id  uuid,
  media           numeric,
  ciclo           text,
  avaliado_em     timestamptz,
  pdi_total       integer,
  pdi_concluidos  integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  RETURN QUERY
  WITH visiveis AS (
    SELECT f.id, f.user_profile_id
      FROM public.funcionarios f
     WHERE COALESCE(f.ativo, true)
       -- Mesmo recorte de `funcionarios`: quem o chamador já pode ver.
       AND COALESCE(
             (public.auth_in_setor('rh') OR public.auth_gerente_da(f.filial))
             AND public.auth_pode_filial(f.filial), false)
  ),
  ultima AS (
    SELECT DISTINCT ON (v.id)
           v.id AS func_id, a.id AS aval_id, a.created_at, c.nome AS ciclo_nome
      FROM visiveis v
      JOIN public.avaliacoes a       ON a.avaliado_id = v.user_profile_id
                                    AND a.tipo IN ('gerente_colaborador', 'ceo_gerente')
      JOIN public.ciclos_avaliacao c ON c.id = a.ciclo_id
     WHERE v.user_profile_id IS NOT NULL
     ORDER BY v.id, a.created_at DESC
  )
  SELECT u.func_id,
         ROUND(AVG(cr.nota)::numeric, 2),
         u.ciclo_nome,
         u.created_at,
         COUNT(DISTINCT p.id)::integer,
         COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'Concluído')::integer
    FROM ultima u
    LEFT JOIN public.criterios_avaliacao cr ON cr.avaliacao_id = u.aval_id
    LEFT JOIN public.pdi_itens p            ON p.avaliacao_id  = u.aval_id
   GROUP BY u.func_id, u.ciclo_nome, u.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.desempenho_funcionarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desempenho_funcionarios() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — `abrir_vaga_interna` ganha a nota mínima
--
-- DROP + CREATE, e não CREATE OR REPLACE: acrescentar um parâmetro muda a
-- assinatura, o que criaria uma SOBRECARGA e faria o PostgREST recusar a
-- chamada por ambiguidade (PGRST203). Como a 312 acabou de entrar e a tela é
-- atualizada no mesmo commit, trocar a assinatura aqui é seguro.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric);

CREATE OR REPLACE FUNCTION public.abrir_vaga_interna(
  p_filial        text,
  p_cargo         text,
  p_justificativa text,
  p_escopo        text    DEFAULT 'Filial',
  p_departamento  text    DEFAULT NULL,
  p_quantidade    integer DEFAULT 1,
  p_salario_min   numeric DEFAULT NULL,
  p_salario_max   numeric DEFAULT NULL,
  p_nota_minima   numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  IF p_escopo NOT IN ('Filial', 'Interfilial') THEN
    RAISE EXCEPTION 'Escopo inválido: %. Use Filial ou Interfilial.', p_escopo
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_recrutamento(p_filial);

  IF p_escopo = 'Interfilial' THEN
    PERFORM public._assert_interfilial();
  END IF;

  IF COALESCE(btrim(p_cargo), '') = '' THEN
    RAISE EXCEPTION 'Informe o cargo da vaga.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_justificativa), '') = '' THEN
    RAISE EXCEPTION 'Justifique a abertura do processo interno.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  IF p_salario_min IS NOT NULL AND p_salario_max IS NOT NULL AND p_salario_min > p_salario_max THEN
    RAISE EXCEPTION 'Salário mínimo não pode ser maior que o máximo.' USING ERRCODE = 'P0001';
  END IF;

  IF p_nota_minima IS NOT NULL AND (p_nota_minima < 1 OR p_nota_minima > 5) THEN
    RAISE EXCEPTION 'Nota mínima deve estar entre 1 e 5 (escala da avaliação).'
      USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.vagas
    (filial, cargo, departamento, tipo, escopo, quantidade, salario_min, salario_max,
     nota_minima, justificativa, criado_por, criado_por_nome)
  VALUES
    (p_filial, btrim(p_cargo), p_departamento, 'Interna', p_escopo, p_quantidade,
     p_salario_min, p_salario_max, p_nota_minima, btrim(p_justificativa), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Processo interno aguardando aprovação',
    v_nome || ' abriu ' || p_quantidade || 'x ' || btrim(p_cargo)
      || ' (' || p_filial || ', ' || p_escopo || ')'
      || COALESCE(' · nota mínima ' || p_nota_minima, ''),
    'rh-recrutamentoeseleção', 'Média', v_id, NULL, p_filial
  );

  RETURN jsonb_build_object('ok', true, 'vaga_id', v_id, 'escopo', p_escopo);
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric, numeric) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — O gate de desempenho na inscrição
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_candidatura_interna(
  p_vaga_id        uuid,
  p_funcionario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga  record;
  v_f     record;
  v_id    uuid;
  v_nome  text;
  v_media numeric;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.tipo <> 'Interna' THEN
    RAISE EXCEPTION 'Esta vaga é externa — use registrar_candidatura.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Só é possível inscrever em vaga Aprovada (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado ou inativo.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_f.status, 'Ativo') <> 'Ativo' THEN
    RAISE EXCEPTION '% está com status % — só funcionário Ativo entra em processo interno.',
      v_f.nome, COALESCE(v_f.status, 'Ativo') USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION '% está desligado.', v_f.nome USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.escopo = 'Filial' THEN
    IF COALESCE(v_f.filial, '') <> v_vaga.filial THEN
      RAISE EXCEPTION 'Vaga de escopo Filial só aceita candidato da unidade % (este é de %).',
        v_vaga.filial, COALESCE(v_f.filial, '—') USING ERRCODE = 'P0001';
    END IF;
  ELSE
    PERFORM public._assert_interfilial();
  END IF;

  -- NOVO na 313 — o pré-requisito de desempenho.
  IF v_vaga.nota_minima IS NOT NULL THEN
    v_media := public.media_avaliacao_funcionario(p_funcionario_id);

    -- Sem avaliação não há como aferir. Recusar é a leitura conservadora: a
    -- vaga declarou uma exigência, e "não sei" não é "atende".
    IF v_media IS NULL THEN
      RAISE EXCEPTION
        '% não tem avaliação de desempenho registrada, e esta vaga exige média mínima de %.',
        v_f.nome, v_vaga.nota_minima USING ERRCODE = 'P0001';
    END IF;

    IF v_media < v_vaga.nota_minima THEN
      RAISE EXCEPTION 'A média de % é % — abaixo do mínimo de % exigido por esta vaga.',
        v_f.nome, v_media, v_vaga.nota_minima USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.candidaturas
    (vaga_id, filial, nome, cpf, email, telefone, funcionario_origem_id,
     criado_por, criado_por_nome)
  VALUES
    (p_vaga_id, v_vaga.filial, v_f.nome, v_f.cpf, v_f.email, v_f.telefone, p_funcionario_id,
     auth.uid(), v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (v_id, NULL, 'Triagem',
          'Inscrição interna — ' || COALESCE(v_f.cargo, 'sem cargo') || ' em ' || COALESCE(v_f.filial, '—')
            || COALESCE(' · média ' || v_media, ''),
          auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'candidatura_id', v_id, 'media', v_media);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_candidatura_interna(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_candidatura_interna(uuid, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 5 — VINCULAR O ACESSO RECÉM-CRIADO AO FUNCIONÁRIO
--
-- A conta em si é criada por `/api/users` (service_role) — criar usuário no
-- Auth não é coisa que RPC de PostgREST faça, e o RBAC de quem pode criar já
-- vive lá. O que falta é o vínculo `funcionarios.user_profile_id`, que o
-- trigger `funcionarios_autovincular_user_profile` (migr. 151) só resolve
-- quando o INSERT/UPDATE toca a coluna `email` — e criar o perfil DEPOIS do
-- funcionário não toca em nada.
--
-- Daí esta RPC: explícita, com as duas validações que importam — um perfil não
-- serve a dois funcionários, e o login precisa nascer na unidade certa.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.vincular_acesso_funcionario(
  p_funcionario_id  uuid,
  p_user_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_f          record;
  v_perfil     record;
  v_ja_usado   text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado ou inativo.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_f.filial);

  IF v_f.user_profile_id IS NOT NULL THEN
    IF v_f.user_profile_id = p_user_profile_id THEN
      RETURN jsonb_build_object('ok', true, 'ja_vinculado', true);
    END IF;
    RAISE EXCEPTION '% já tem acesso vinculado a outro login.', v_f.nome
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_perfil FROM public.user_profiles WHERE id = p_user_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Login não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Um login não pode responder por dois funcionários: folha, ponto, férias e
  -- rescisão são todos escopados por `funcionario_id`, e o MaxBank credita
  -- pelo `user_profile_id`. Dois vínculos fariam um pagar o outro.
  SELECT nome INTO v_ja_usado FROM public.funcionarios
   WHERE user_profile_id = p_user_profile_id
     AND id <> p_funcionario_id
     AND COALESCE(ativo, true)
   LIMIT 1;

  IF v_ja_usado IS NOT NULL THEN
    RAISE EXCEPTION 'Este login já é o acesso de %.', v_ja_usado USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_perfil.filial, '') IS DISTINCT FROM COALESCE(v_f.filial, '') THEN
    RAISE EXCEPTION 'O login está na unidade % e o funcionário em % — alinhe em Usuários antes de vincular.',
      COALESCE(v_perfil.filial, 'nenhuma'), COALESCE(v_f.filial, 'nenhuma')
      USING ERRCODE = 'P0001';
  END IF;

  -- O e-mail tem que ser o mesmo, e esta é a validação que realmente segura a
  -- porta. `funcionarios.user_profile_id` é o que manda a folha para a carteira
  -- MaxBank (`creditar_folha_maxbank` credita pelo perfil vinculado). Sem
  -- amarrar identidade, alguém do RH apontaria o funcionário recém-criado para
  -- o perfil de outra pessoa e o salário dele cairia na conta dela.
  --
  -- É também o mesmo critério do trigger `funcionarios_autovincular_user_profile`
  -- (migr. 151), que casa funcionário e perfil por e-mail — duas portas para o
  -- mesmo vínculo devem exigir a mesma prova.
  IF COALESCE(btrim(v_perfil.email), '') = '' THEN
    RAISE EXCEPTION 'O login não tem e-mail — não há como conferir de quem ele é.'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(v_f.email), '') <> ''
     AND lower(btrim(v_f.email)) <> lower(btrim(v_perfil.email)) THEN
    RAISE EXCEPTION
      'O e-mail do login (%) não confere com o do funcionário (%). O vínculo é o que direciona a folha — os dois precisam ser a mesma pessoa.',
      v_perfil.email, v_f.email
      USING ERRCODE = 'P0001';
  END IF;

  -- Funcionário cadastrado sem e-mail (o campo é opcional em `funcionarios`)
  -- adota o do login em vez de ficar impedido de ter acesso para sempre. Como
  -- `user_profile_id` já vai preenchido no mesmo UPDATE, o trigger
  -- `funcionarios_autovincular_user_profile` (BEFORE UPDATE OF email) não
  -- tenta re-casar nada: ele só age quando o vínculo está vazio.
  UPDATE public.funcionarios
     SET user_profile_id = p_user_profile_id,
         email           = COALESCE(NULLIF(btrim(email), ''), v_perfil.email),
         updated_at      = now()
   WHERE id = p_funcionario_id;

  RETURN jsonb_build_object('ok', true, 'funcionario', v_f.nome, 'filial', v_f.filial);
END;
$function$;

REVOKE ALL ON FUNCTION public.vincular_acesso_funcionario(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_acesso_funcionario(uuid, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Desempenho como o RH da unidade enxerga:
--   SELECT * FROM desempenho_funcionarios();
--
--   -- Média de uma pessoa (NULL = sem login ou sem avaliação):
--   SELECT media_avaliacao_funcionario('<func_id>');
--
--   -- Vaga interna com exigência:
--   SELECT cargo, nota_minima FROM vagas WHERE tipo = 'Interna' AND nota_minima IS NOT NULL;
--
--   -- Nenhum login pode servir a dois funcionários ativos:
--   SELECT user_profile_id, count(*) FROM funcionarios
--    WHERE user_profile_id IS NOT NULL AND COALESCE(ativo, true)
--    GROUP BY 1 HAVING count(*) > 1;   -- 0 linhas
--
--   -- Nota mínima só existe em vaga interna:
--   SELECT count(*) FROM vagas WHERE nota_minima IS NOT NULL AND tipo <> 'Interna';  -- 0
-- ────────────────────────────────────────────────────────────────────────────
