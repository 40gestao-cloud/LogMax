-- =================================================================
-- 350 — Etapa 2: a jornada da turma vira dado do banco e o atraso
--       passa a valer meio ponto na frequência.
--
-- Na etapa 1 (migr. 349) a frequência virou medida, mas o atraso ficou
-- de fora: atraso não é status em `ponto_eletronico` — deriva de
-- comparar `entrada` com o horário-alvo da turma, e esse alvo só
-- existia em env do projeto Vercel (VITE_PONTO_ENTRADA / PONTO_*),
-- passado como parâmetro por quem chamasse (`p_target_entrada` da
-- folha). Alvo que vem do cliente não serve pra placar: dois clientes
-- com env diferente produziriam notas diferentes pra mesma competição.
--
-- Agora o horário mora em `ponto_jornada` — uma linha por projeto — e
-- o cálculo lê de lá. O env continua existindo pro que é exibição
-- (telas de ponto, folha), e vira a origem sugerida no bootstrap.
--
-- ATRASO = MEIO PONTO. Presença pontual vale 1, presença com atraso
-- vale 0,5 (ou seja: atraso TIRA metade do ponto do dia, não dá
-- ponto), falta vale 0. Justificado segue fora do denominador.
--
-- TRAVA DE SEGURANÇA. A tabela nasce com o horário da manhã como
-- default, que está errado pras turmas da tarde (13:20). Se o placar
-- usasse isso, toda entrada da tarde seria "atraso" e a nota de todas
-- as filiais despencaria por erro de configuração. Por isso a linha
-- nasce com `configurado = false` e, enquanto ninguém confirmar o
-- horário, o ATRASO NÃO ENTRA NA CONTA — a frequência se comporta
-- exatamente como na etapa 1. A tela avisa o admin e oferece gravar o
-- horário do próprio site.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Jornada da turma ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ponto_jornada (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  entrada        text    NOT NULL DEFAULT '07:40',
  retorno        text    NOT NULL DEFAULT '09:20',
  saida          text    NOT NULL DEFAULT '11:20',
  tolerancia_min integer NOT NULL DEFAULT 1,
  -- false = ninguém confirmou o horário desta turma ainda; o atraso
  -- fica fora do cálculo até alguém confirmar.
  configurado    boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT chk_jornada_entrada   CHECK (entrada ~ '^[0-9]{1,2}:[0-9]{2}$'),
  CONSTRAINT chk_jornada_retorno   CHECK (retorno ~ '^[0-9]{1,2}:[0-9]{2}$'),
  CONSTRAINT chk_jornada_saida     CHECK (saida   ~ '^[0-9]{1,2}:[0-9]{2}$'),
  CONSTRAINT chk_jornada_tolerancia CHECK (tolerancia_min BETWEEN 0 AND 60)
);

COMMENT ON TABLE public.ponto_jornada IS
  'Horário-alvo da turma (uma linha por projeto). Fonte de verdade do atraso no placar da competição; o env VITE_PONTO_*/PONTO_* segue valendo para exibição e para a folha.';

INSERT INTO public.ponto_jornada (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ponto_jornada ENABLE ROW LEVEL SECURITY;

-- Leitura aberta a quem está logado: é parâmetro de operação, não segredo.
-- Escrita só pela RPC abaixo (SECURITY DEFINER) — sem policy de write.
DROP POLICY IF EXISTS ponto_jornada_select ON public.ponto_jornada;
CREATE POLICY ponto_jornada_select ON public.ponto_jornada
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.ponto_jornada TO authenticated;

CREATE OR REPLACE FUNCTION public.definir_ponto_jornada(
  p_entrada        text,
  p_retorno        text DEFAULT NULL,
  p_saida          text DEFAULT NULL,
  p_tolerancia_min integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM _assert_matriz_admin();

  IF p_entrada !~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    RAISE EXCEPTION 'Horário de entrada inválido: % (use HH:MM)', p_entrada USING ERRCODE = 'P0001';
  END IF;

  UPDATE ponto_jornada
     SET entrada        = p_entrada,
         retorno        = COALESCE(NULLIF(p_retorno,''), retorno),
         saida          = COALESCE(NULLIF(p_saida,''),   saida),
         tolerancia_min = COALESCE(p_tolerancia_min,     tolerancia_min),
         configurado    = true,
         updated_at     = now(),
         updated_por    = auth.uid()
   WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.definir_ponto_jornada(text, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.definir_ponto_jornada(text, text, text, integer) TO authenticated;

-- ── 2. Crédito do dia: presença 1, atraso 0,5, falta 0 ────────────
-- Uma função só, usada pela RPC de exibição E pelo placar — os dois
-- números precisam bater sempre. Devolve NULL quando não há registro.
CREATE OR REPLACE FUNCTION public._freq_credito_dia(
  p_status  text,
  p_entrada text,
  p_target  time,
  p_tol     integer
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_status,'Normal') = 'Justificado' THEN NULL   -- fora do denominador
    WHEN p_status = 'Falta' THEN 0
    -- Sem alvo confirmado (ponto_jornada.configurado = false) o atraso
    -- não é classificável: vale presença cheia.
    WHEN p_target IS NULL OR p_entrada IS NULL THEN 1
    WHEN p_entrada::time > p_target + make_interval(mins => COALESCE(p_tol,0)) THEN 0.5
    ELSE 1
  END;
$$;

REVOKE ALL ON FUNCTION public._freq_credito_dia(text, text, time, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._freq_credito_dia(text, text, time, integer) TO authenticated;

-- ── 3. RPC de exibição: assinatura nova, sem alvo vindo do cliente ─
-- A antiga recebia p_target_entrada; agora o alvo é do banco. DROP com
-- a assinatura exata — lista errada é no-op silencioso e deixa as duas
-- sobrecargas vivas, que o PostgREST recusa.
DROP FUNCTION IF EXISTS public.frequencia_filiais_competicao(uuid, text);
DROP FUNCTION IF EXISTS public.frequencia_filiais_competicao(uuid);

CREATE FUNCTION public.frequencia_filiais_competicao(p_competicao_id uuid)
RETURNS TABLE (
  filial              text,
  registros           int,      -- denominador: presenças + faltas
  presencas           int,      -- inclui as com atraso
  faltas              int,
  justificados        int,
  atrasos             int,
  dias_distintos      int,
  funcionarios_ativos int,
  taxa_presenca       numeric,  -- 0..1, já com atraso valendo 0,5
  jornada_entrada     text,
  jornada_tolerancia  int,
  atraso_conta        boolean   -- false enquanto a jornada não for confirmada
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_filial_user text;
  v_inicio date;
  v_fim    date;
  v_j      ponto_jornada;
  v_target time;
BEGIN
  SELECT up.filial INTO v_filial_user FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT c.data_inicio, c.data_fim INTO v_inicio, v_fim
    FROM competicoes_matriz c WHERE c.id = p_competicao_id AND c.ativo = true;
  IF v_inicio IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  pontos AS (
    SELECT pe.filial AS f, pe.data, pe.status, pe.entrada,
           public._freq_credito_dia(pe.status, pe.entrada, v_target, v_j.tolerancia_min) AS credito
      FROM ponto_eletronico pe
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_inicio AND v_fim
  ),
  func AS (
    SELECT fn.filial AS f, COUNT(*)::int AS n
      FROM funcionarios fn
     WHERE fn.filial IN ('SuperMax','MaxLook','TechMax')
       AND fn.ativo = true
     GROUP BY fn.filial
  ),
  agg AS (
    SELECT p.f,
           COUNT(*) FILTER (WHERE p.credito IS NOT NULL)::int AS registros,
           COUNT(*) FILTER (WHERE p.credito > 0)::int         AS presencas,
           COUNT(*) FILTER (WHERE p.status = 'Falta')::int    AS faltas,
           COUNT(*) FILTER (WHERE COALESCE(p.status,'Normal') = 'Justificado')::int AS justificados,
           COUNT(*) FILTER (WHERE p.credito = 0.5)::int       AS atrasos,
           COUNT(DISTINCT p.data)::int                        AS dias_distintos,
           SUM(p.credito)                                     AS creditos
      FROM pontos p
     GROUP BY p.f
  )
  SELECT b.f,
         COALESCE(a.registros, 0),
         COALESCE(a.presencas, 0),
         COALESCE(a.faltas, 0),
         COALESCE(a.justificados, 0),
         COALESCE(a.atrasos, 0),
         COALESCE(a.dias_distintos, 0),
         COALESCE(fu.n, 0),
         CASE WHEN COALESCE(a.registros, 0) = 0 THEN NULL
              ELSE ROUND(a.creditos / a.registros, 4) END,
         v_j.entrada,
         v_j.tolerancia_min,
         COALESCE(v_j.configurado, false)
    FROM base b
    LEFT JOIN agg  a  ON a.f  = b.f
    LEFT JOIN func fu ON fu.f = b.f
   WHERE v_filial_user = 'Matriz' OR b.f = v_filial_user
   ORDER BY b.f;
END;
$$;

REVOKE ALL ON FUNCTION public.frequencia_filiais_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.frequencia_filiais_competicao(uuid) TO authenticated;

-- ── 4. Placar usa o mesmo crédito ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp          competicoes_matriz;
  v_result        jsonb;
  v_incluir_eixos boolean;
  v_peso_freq     numeric := 0.20;
  v_j             ponto_jornada;
  v_target        time;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_j FROM ponto_jornada WHERE id = true;
  IF COALESCE(v_j.configurado, false) THEN
    v_target := (v_j.entrada || ':00')::time;
  END IF;

  SELECT (
    COUNT(DISTINCT a.avaliada_filial) FILTER (
      WHERE a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
    ) = 3
  ) INTO v_incluir_eixos
    FROM public.avaliacoes a
    JOIN public.user_profiles up ON up.id = a.avaliador_id
   WHERE a.tipo = 'matriz_filial'
     AND up.role <> 'admin'
     AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim;

  WITH filiais AS (
    SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial
  ),
  notas_tarefas AS (
    SELECT am.filial_avaliada AS filial, am.nota::numeric AS nota
      FROM public.avaliacoes_matriz am
      JOIN public.user_profiles up ON up.id = am.avaliador_id
     WHERE am.competicao_id = p_competicao_id
       AND am.ativo = true
       AND am.nota IS NOT NULL
       AND am.item_tipo LIKE 'tarefa\_%'
       AND up.role <> 'admin'
  ),
  notas_eixos AS (
    SELECT a.avaliada_filial AS filial, c.nota::numeric AS nota
      FROM public.criterios_avaliacao c
      JOIN public.avaliacoes a     ON a.id  = c.avaliacao_id
      JOIN public.user_profiles up ON up.id = a.avaliador_id
     WHERE v_incluir_eixos
       AND a.tipo = 'matriz_filial'
       AND a.avaliada_filial IN ('SuperMax','MaxLook','TechMax')
       AND a.created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim
       AND up.role <> 'admin'
       AND c.criterio = 'Planejamento e Organização'
  ),
  todas AS (
    SELECT filial, nota FROM notas_tarefas
    UNION ALL
    SELECT filial, nota FROM notas_eixos
  ),
  freq AS (
    SELECT pe.filial AS f,
           COUNT(*) FILTER (WHERE cr.credito IS NOT NULL)::int AS registros,
           COUNT(*) FILTER (WHERE cr.credito > 0)::int         AS presencas,
           COUNT(*) FILTER (WHERE pe.status = 'Falta')::int    AS faltas,
           COUNT(*) FILTER (WHERE COALESCE(pe.status,'Normal') = 'Justificado')::int AS justificados,
           COUNT(*) FILTER (WHERE cr.credito = 0.5)::int       AS atrasos,
           SUM(cr.credito)                                     AS creditos
      FROM ponto_eletronico pe
      CROSS JOIN LATERAL (
        SELECT public._freq_credito_dia(pe.status, pe.entrada, v_target, v_j.tolerancia_min) AS credito
      ) cr
     WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
       AND pe.data BETWEEN v_comp.data_inicio AND v_comp.data_fim
     GROUP BY pe.filial
  ),
  agregado AS (
    SELECT f.filial,
           COALESCE(ROUND(AVG(t.nota) * 10, 2), 0) AS media_conselho,
           COALESCE(COUNT(t.nota), 0)              AS n,
           COALESCE(fr.registros, 0)               AS registros,
           COALESCE(fr.presencas, 0)               AS presencas,
           COALESCE(fr.faltas, 0)                  AS faltas,
           COALESCE(fr.justificados, 0)            AS justificados,
           COALESCE(fr.atrasos, 0)                 AS atrasos,
           CASE WHEN COALESCE(fr.registros,0) = 0 THEN NULL
                ELSE ROUND(fr.creditos / fr.registros, 4) END AS taxa
      FROM filiais f
      LEFT JOIN todas t ON t.filial = f.filial
      LEFT JOIN freq fr ON fr.f     = f.filial
     GROUP BY f.filial, fr.registros, fr.presencas, fr.faltas, fr.justificados,
              fr.atrasos, fr.creditos
  ),
  final AS (
    SELECT ag.*,
           CASE
             WHEN ag.n = 0 OR ag.taxa IS NULL THEN ag.media_conselho
             ELSE ROUND(ag.media_conselho * (1 - v_peso_freq) + ag.taxa * 100 * v_peso_freq, 2)
           END AS media
      FROM agregado ag
  )
  SELECT jsonb_object_agg(
           filial,
           jsonb_build_object(
             'media',          media,
             'n',              n,
             'media_conselho', media_conselho,
             'frequencia', jsonb_build_object(
               'taxa',         taxa,
               'registros',    registros,
               'presencas',    presencas,
               'faltas',       faltas,
               'justificados', justificados,
               'atrasos',      atrasos,
               'entrou',       (n > 0 AND taxa IS NOT NULL)
             )
           )
         )
    INTO v_result
    FROM final;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'vencedora', v_comp.vencedora
    ),
    'inclui_eixos_conselho', COALESCE(v_incluir_eixos, false),
    'peso_frequencia',       v_peso_freq,
    'atraso_conta',          COALESCE(v_j.configurado, false),
    'jornada_entrada',       v_j.entrada,
    'por_filial',            COALESCE(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- ── 5. Realtime das telas da Central e do ponto ───────────────────
-- Achado ao revisar: as telas da Central de Avaliação abrem canal em
-- competicoes_matriz / matriz_tarefas / matriz_tarefa_participantes /
-- avaliacoes_matriz há tempos, e o card de frequência abriu em
-- ponto_eletronico — mas nenhuma dessas tabelas está em
-- `supabase_realtime`. Sem publicação o canal escuta silêncio e não dá
-- erro nenhum: a tela só nunca atualiza sozinha.
--
-- A RLS continua valendo no realtime, então o voto selado da 345 não
-- vaza por aqui: cada conselheiro só recebe evento das linhas que já
-- poderia ler.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ponto_eletronico',
    'ponto_jornada',
    'competicoes_matriz',
    'matriz_tarefas',
    'matriz_tarefa_participantes',
    'avaliacoes_matriz'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
