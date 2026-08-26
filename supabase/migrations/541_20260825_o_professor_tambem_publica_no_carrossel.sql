-- 541 — O professor também publica no carrossel, sem inventar promoção.
--
-- A régua da migr. 539 é do fluxo do ALUNO: a arte nasce de uma campanha
-- aprovada, que nasce de um produto do catálogo. É a disciplina que o curso
-- ensina, e ela fica de pé.
--
-- Só que o professor não está nesse fluxo. Para pôr um "Bem-vindos, turma de
-- Contabilidade" na tela de login, ele teria de inventar um produto no
-- catálogo e uma promoção aprovada para pendurar a imagem — dado falso que
-- entra no DRE, no catálogo e nos relatórios de auditoria das migr. 533/534.
-- A gambiarra sairia mais cara que a funcionalidade.
--
-- ─── POR QUE TABELA PRÓPRIA, E NÃO `promocao_id` NULÁVEL ───────────────────
--
-- Deixar `marketing_artes.promocao_id` aceitar NULL seria o caminho de menos
-- linhas e o pior desenho:
--
--   · é essa coluna NOT NULL que garante a disciplina do aluno;
--   · a cota da 539 conta por `produto_id`, e item sem produto escaparia de
--     qualquer limite — exatamente o buraco que a 539 fechou;
--   · duas regras diferentes na mesma tabela é como se perde o controle das
--     duas.
--
-- Tabela separada mantém cada régua inteira: conteúdo de aluno passa pelo
-- fluxo e pela cota; conteúdo do professor é curadoria direta.
--
-- ─── O ÚNICO LUGAR ONDE "PUBLICAR DIRETO" SERIA SEGURO — E MESMO ASSIM NÃO É
--
-- O portão do `vitrine_publica` existe para moderar o que o aluno manda para
-- uma tela pré-login. Aqui o autor É o moderador, então publicar direto não
-- teria risco nenhum.
--
-- Ainda assim o item nasce FORA da vitrine (`vitrine_publica = false`). Não é
-- desconfiança: é para o professor conseguir montar o banner na véspera e
-- ligar na hora da aula. Um clique a mais compra um rascunho.
--
-- ─── PRIORIDADE ────────────────────────────────────────────────────────────
--
-- O carrossel ordenava só por `created_at DESC`, e um recado de boas-vindas
-- que aparece em quinto lugar no rodízio não cumpre o papel. `prioridade`
-- fixa o item no topo.
--
-- O campo existe SÓ aqui. Arte e produto entram na ordenação com prioridade
-- zero, e isso é de propósito: dar prioridade também ao aluno abriria uma
-- disputa por posição no carrossel que ninguém pediu, e o professor já
-- resolve a ordem tirando e pondo.
--
-- ─── AS VAGAS SÃO AS MESMAS ────────────────────────────────────────────────
--
-- Item institucional conta no `max_vitrine` como qualquer outro. Ficar de fora
-- deixaria o professor furar o próprio limite sem perceber — e o limite existe
-- justamente porque acima dele o carrossel cortava em silêncio (migr. 540).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 539/540.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A tabela
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vitrine_institucional (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL CHECK (length(btrim(titulo)) > 0),
  descricao       text,
  -- Mesma régua de `marketing_artes.arte_url`: é o que vai num `<img src>`.
  imagem_url      text NOT NULL CHECK (imagem_url ~* '^https?://'),
  data_inicio     date,
  data_fim        date,
  vitrine_publica boolean NOT NULL DEFAULT false,
  -- Maior aparece primeiro. Zero é o normal — só sobe quem precisa fixar.
  prioridade      integer NOT NULL DEFAULT 0 CHECK (prioridade BETWEEN 0 AND 100),
  criado_por      uuid,
  nome_criador    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vitrine_institucional IS
  'Peças que o professor publica direto no carrossel do login, sem promoção '
  'nem produto — boas-vindas, data comemorativa, recado da turma. Fora do '
  'fluxo do aluno e fora da cota por produto, de propósito. Migr. 541.';
COMMENT ON COLUMN public.vitrine_institucional.prioridade IS
  'Maior primeiro no carrossel. Arte e produto entram como zero.';

CREATE INDEX IF NOT EXISTS idx_vitrine_inst_publica
  ON public.vitrine_institucional (vitrine_publica) WHERE vitrine_publica;

ALTER TABLE public.vitrine_institucional ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vitrine_institucional FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vitrine_institucional TO authenticated;
GRANT ALL ON TABLE public.vitrine_institucional TO service_role;

-- Tudo só do professor — `role = 'admin'` literal. CEO e conselheiro são
-- alunos; dar a eles a porta que dispensa promoção seria desfazer a 539 por
-- outro caminho.
--
-- O visitante anônimo NÃO lê esta tabela: o carrossel chega pela RPC
-- `get_vitrine_publica`, que é SECURITY DEFINER. A tabela fica fechada.
DROP POLICY IF EXISTS vitrine_inst_read   ON public.vitrine_institucional;
DROP POLICY IF EXISTS vitrine_inst_insert ON public.vitrine_institucional;
DROP POLICY IF EXISTS vitrine_inst_update ON public.vitrine_institucional;
DROP POLICY IF EXISTS vitrine_inst_delete ON public.vitrine_institucional;

CREATE POLICY vitrine_inst_read ON public.vitrine_institucional
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY vitrine_inst_insert ON public.vitrine_institucional
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY vitrine_inst_update ON public.vitrine_institucional
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY vitrine_inst_delete ON public.vitrine_institucional
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O carrossel passa a somar três fontes
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lim AS (
    SELECT COALESCE((SELECT max_vitrine FROM public.marketing_config WHERE id = 1), 12) AS n
  ),
  artes AS (
    SELECT
      'arte'::text                                                AS tipo,
      a.id::text                                                  AS id,
      a.nome_produto                                              AS titulo,
      a.descricao_promocao                                        AS descricao,
      COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)        AS imagem_url,
      CASE WHEN NULLIF(trim(a.arte_url), '') IS NOT NULL
           THEN p.imagem_url END                                  AS imagem_fallback,
      a.preco_promocional,
      a.data_inicio,
      a.data_fim,
      0                                                           AS prioridade,
      a.created_at
    FROM public.marketing_artes a
    LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
    LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
    WHERE a.vitrine_publica = true
      AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      AND COALESCE(a.data_fim, public.acre_today() + 30) >= public.acre_today()
  ),
  prods AS (
    SELECT
      'produto'::text   AS tipo,
      id::text          AS id,
      nome              AS titulo,
      categoria         AS descricao,
      imagem_url,
      NULL::text        AS imagem_fallback,
      preco             AS preco_promocional,
      NULL::date        AS data_inicio,
      NULL::date        AS data_fim,
      0                 AS prioridade,
      created_at
    FROM public.produtos
    WHERE vitrine_publica = true
      AND imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
      AND COALESCE(tipo, 'estoque_venda') = 'estoque_venda'
  ),
  inst AS (
    SELECT
      'institucional'::text AS tipo,
      i.id::text            AS id,
      i.titulo,
      i.descricao,
      i.imagem_url,
      NULL::text            AS imagem_fallback,
      NULL::numeric         AS preco_promocional,
      i.data_inicio,
      i.data_fim,
      i.prioridade,
      i.created_at
    FROM public.vitrine_institucional i
    WHERE i.vitrine_publica = true
      -- Mesma janela das artes: sem data_fim, não expira.
      AND COALESCE(i.data_fim, public.acre_today() + 30) >= public.acre_today()
      AND COALESCE(i.data_inicio, public.acre_today()) <= public.acre_today()
  ),
  combined AS (
    SELECT * FROM artes
    UNION ALL
    SELECT * FROM prods
    UNION ALL
    SELECT * FROM inst
    ORDER BY prioridade DESC, created_at DESC
    LIMIT (SELECT n FROM lim)
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(combined) ORDER BY combined.prioridade DESC, combined.created_at DESC),
    '[]'::jsonb
  )
  FROM combined;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. A tela de curadoria enxerga os três
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.listar_vitrine_candidatos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_setor text;
BEGIN
  PERFORM public._assert_rpc('marketing');
  SELECT role, setor INTO v_role, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin','ceo') AND v_setor NOT IN ('marketing','all') THEN
    RAISE EXCEPTION 'Sem permissão para listar candidatos da vitrine.'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH artes AS (
      SELECT
        'arte'::text                                              AS tipo,
        a.id::text                                                AS id,
        a.nome_produto                                            AS titulo,
        a.descricao_promocao                                      AS descricao,
        COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)      AS imagem_url,
        CASE
          WHEN a.arte_url IS NOT NULL AND length(trim(a.arte_url)) > 0
               AND p.imagem_url IS NOT NULL
               AND p.imagem_url <> a.arte_url
          THEN p.imagem_url
          ELSE NULL
        END                                                       AS imagem_fallback,
        a.preco_promocional,
        a.vitrine_publica,
        0                                                         AS prioridade,
        a.created_at
      FROM public.marketing_artes a
      LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
      LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
      WHERE COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      ORDER BY a.created_at DESC
      LIMIT 200
    ),
    prods AS (
      SELECT
        'produto'::text   AS tipo,
        id::text          AS id,
        nome              AS titulo,
        categoria         AS descricao,
        imagem_url,
        NULL::text        AS imagem_fallback,
        preco             AS preco_promocional,
        vitrine_publica,
        0                 AS prioridade,
        created_at
      FROM public.produtos
      WHERE imagem_url IS NOT NULL
        AND COALESCE(status, 'Ativo') = 'Ativo'
        AND COALESCE(ativo,  true)    = true
      ORDER BY created_at DESC
      LIMIT 200
    ),
    inst AS (
      -- Sem `LIMIT`: são poucas e todas são do professor. Cortar aqui
      -- esconderia dele o próprio material.
      SELECT
        'institucional'::text AS tipo,
        i.id::text            AS id,
        i.titulo,
        i.descricao,
        i.imagem_url,
        NULL::text            AS imagem_fallback,
        NULL::numeric         AS preco_promocional,
        i.vitrine_publica,
        i.prioridade,
        i.created_at
      FROM public.vitrine_institucional i
    ),
    combined AS (
      SELECT * FROM artes
      UNION ALL
      SELECT * FROM prods
      UNION ALL
      SELECT * FROM inst
    )
    SELECT COALESCE(
      jsonb_agg(to_jsonb(combined)
        ORDER BY combined.vitrine_publica DESC, combined.prioridade DESC, combined.created_at DESC),
      '[]'::jsonb
    )
    FROM combined
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. O toggle aceita o terceiro tipo — e conta ele nas vagas
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.marcar_vitrine(p_tipo text, p_id uuid, p_incluir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_setor text;
  v_max   integer;
  v_tem   integer;
BEGIN
  PERFORM public._assert_rpc('marketing');
  SELECT role, setor INTO v_role, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  IF v_role NOT IN ('admin','ceo') AND v_setor NOT IN ('marketing','all') THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar vitrine.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('arte','produto','institucional') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  -- Peça institucional é do professor, inclusive para ligar e desligar.
  IF p_tipo = 'institucional' AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'Só o professor mexe nas peças institucionais da vitrine.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_incluir, false) THEN
    PERFORM pg_advisory_xact_lock(hashtext('vitrine_publica_cota'), 0);

    SELECT COALESCE(max_vitrine, 12) INTO v_max FROM public.marketing_config WHERE id = 1;
    v_max := COALESCE(v_max, 12);

    -- As três fontes dividem as MESMAS vagas: deixar a institucional de fora
    -- da conta deixaria o professor furar o próprio limite sem perceber.
    SELECT (SELECT count(*) FROM public.marketing_artes       WHERE vitrine_publica AND id <> p_id)
         + (SELECT count(*) FROM public.produtos              WHERE vitrine_publica AND id <> p_id)
         + (SELECT count(*) FROM public.vitrine_institucional WHERE vitrine_publica AND id <> p_id)
      INTO v_tem;

    IF v_tem >= v_max THEN
      RAISE EXCEPTION
        'A vitrine da tela de login já está com % item(ns), que é o limite atual. Tire um para incluir outro, ou aumente o limite em Sessões Gerais → Marketing → Configurações.',
        v_tem
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'arte' THEN
    UPDATE public.marketing_artes       SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSIF p_tipo = 'produto' THEN
    UPDATE public.produtos              SET vitrine_publica = COALESCE(p_incluir, false) WHERE id = p_id;
  ELSE
    UPDATE public.vitrine_institucional SET vitrine_publica = COALESCE(p_incluir, false),
                                            atualizado_em   = now()
     WHERE id = p_id;
  END IF;
END;
$function$;

COMMIT;

-- Verificação:
--
--   SELECT titulo, prioridade, vitrine_publica FROM vitrine_institucional ORDER BY prioridade DESC;
--   SELECT jsonb_pretty(get_vitrine_publica());
--
-- TESTE MANUAL
--   professor cria peça institucional        → nasce fora da vitrine
--   liga na vitrine com prioridade 10        → aparece em PRIMEIRO no carrossel
--   liga com a vitrine cheia                 → recusa, contando os três tipos
--   aluno de marketing tenta ligar/desligar  → recusa (só o professor)
