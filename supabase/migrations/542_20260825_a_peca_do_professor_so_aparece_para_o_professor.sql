-- 542 — A peça do professor só aparece na curadoria do professor.
--
-- Auditoria da 541. `listar_vitrine_candidatos` devolve as três fontes, mas o
-- guard dela deixa passar `role IN ('admin','ceo')` OU `setor IN
-- ('marketing','all')` — herança de quando só havia arte e produto, que são
-- material do Marketing.
--
-- A peça institucional não é. Ela é do professor, e `marcar_vitrine` (541)
-- recusa qualquer um que não seja `role = 'admin'` ao mexer nela. O resultado
-- é o pior arranjo de UI que este repositório evita por regra: o CEO — que é
-- ALUNO e alcança a Matriz — via a peça na lista, com o botão "Adicionar à
-- vitrine" ligado, e só descobria no clique que não podia.
--
-- Ação que aparece e falha é pior que ação que não aparece: a primeira ensina
-- o aluno que o sistema é instável, a segunda não ensina nada.
--
-- O conserto é na origem: quem não é o professor não recebe a peça. Sem isso,
-- esconder o botão no front seria maquiagem — a linha continuaria viajando
-- para um cliente que não tem o que fazer com ela.
--
-- A régua de arte e produto NÃO muda: continuam visíveis para o Marketing,
-- que é quem cuida delas.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 541.

BEGIN;

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
      -- O filtro que faltava. `marcar_vitrine` (541) já recusava quem não é
      -- professor; sem esta linha o CEO recebia a peça só para levar erro no
      -- clique.
      WHERE v_role = 'admin'
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

COMMIT;

-- Verificação:
--
--   -- Como professor: traz os três tipos.
--   -- Como CEO: traz arte e produto, e NENHUM institucional.
--   SELECT jsonb_path_query_array(listar_vitrine_candidatos(), '$[*].tipo');
