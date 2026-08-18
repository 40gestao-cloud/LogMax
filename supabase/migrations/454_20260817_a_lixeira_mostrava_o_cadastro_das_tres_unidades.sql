-- 454_20260817_a_lixeira_mostrava_o_cadastro_das_tres_unidades.sql
--
-- QUEM ESTAVA NA SUPERMAX VIA O QUE A TECHMAX APAGOU.
--
-- Bug da 451, encontrado em uso: `lixeira_listar` varre as seis tabelas e não
-- filtra filial nenhuma. Operando dentro da SuperMax, a tela listava os
-- produtos apagados das três unidades juntos — e ofereceu restaurar e apagar
-- de vez cadastro de outra.
--
-- O erro foi meu, e de um tipo específico: parti do papel (só o admin abre) e
-- esqueci do contexto (o admin também está DENTRO de uma unidade quando
-- opera). Papel não é contexto de filial — a mesma lição das migrs. 436/437,
-- aplicada de novo, agora numa tela nova.
--
-- A régua da holding não abre exceção para o administrador: as três unidades
-- são empresas separadas, e a SuperMax não tem por que saber o que a TechMax
-- apagou. Ver a lista alheia já é vazamento; poder mexer nela é pior.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A UNIDADE É PARÂMETRO DA OPERAÇÃO, NÃO FILTRO DA TELA
--
-- Filtrar no React resolveria o que se vê e deixaria o F12 intacto: as RPCs
-- continuariam aceitando o id de qualquer registro. Então `p_filial` entra nas
-- três — listar, restaurar e expurgar —, e cada uma confere que o registro é
-- MESMO daquela unidade antes de agir.
--
-- Em modo Matriz a lixeira não abre. Cadastro é da unidade que compra, recebe
-- e vende; a Matriz não tem catálogo próprio para ter lixeira. A tela mostra o
-- seletor de unidade, como as outras telas de operação já fazem.
--
-- SUBCATEGORIA NÃO TEM FILIAL, E MESMO ASSIM PERTENCE A UMA
--
-- `subcategorias_produto` não tem a coluna — pende da categoria pai, que tem.
-- A filial dela é a da categoria, e é assim que ela entra no filtro. Deixá-la
-- de fora "porque não tem a coluna" seria a mesma resposta por proxy que esta
-- auditoria vem perseguindo o dia inteiro.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 451 e da 452.

BEGIN;

-- Assinaturas antigas saem: manter as duas geraria sobrecarga, e a versão sem
-- filial é exatamente o bug.
DROP FUNCTION IF EXISTS public.lixeira_listar(text);
DROP FUNCTION IF EXISTS public.lixeira_restaurar(text, uuid);
DROP FUNCTION IF EXISTS public.lixeira_expurgar(text, uuid);

-- ── 1. A filial de cada tabela coberta ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public._lixeira_expr_filial(p_tabela text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_tabela
    -- Pende da categoria pai: a subcategoria é da unidade da categoria.
    WHEN 'subcategorias_produto'
      THEN '(SELECT c.filial FROM public.categorias_produto c WHERE c.id = x.categoria_id)'
    ELSE 'x.filial'
  END
$function$;

COMMENT ON FUNCTION public._lixeira_expr_filial(text) IS
  'Como se obtém a filial de cada tabela da lixeira (migr. 454). Subcategoria não tem a coluna e mesmo assim pertence a uma unidade — vem da categoria pai.';

CREATE OR REPLACE FUNCTION public._assert_lixeira_filial(p_filial text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_filial IS NULL OR btrim(p_filial) = '' THEN
    RAISE EXCEPTION
      'A lixeira é de cada unidade. Escolha SuperMax, MaxLook ou TechMax no seletor, no topo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax') THEN
    RAISE EXCEPTION 'Unidade desconhecida: %.', p_filial USING ERRCODE = 'P0001';
  END IF;

  -- Papel não é contexto de filial (migrs. 436/437): mesmo o admin precisa
  -- poder aquela unidade.
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Sem acesso à unidade %.', p_filial USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- ── 2. Listar, dentro de uma unidade ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_listar(
  p_filial text, p_tabela text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tabelas text[];
  v_t       text;
  v_linhas  jsonb;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  IF p_tabela IS NULL THEN
    PERFORM public._assert_lixeira('produtos');   -- só para checar o papel
    v_tabelas := public._lixeira_tabelas();
  ELSE
    PERFORM public._assert_lixeira(p_tabela);
    v_tabelas := ARRAY[p_tabela];
  END IF;

  PERFORM public._assert_lixeira_filial(p_filial);

  FOREACH v_t IN ARRAY v_tabelas LOOP
    EXECUTE format($q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'tabela',      %L,
               'id',          x.id,
               'nome',        x.nome,
               'filial',      %s,
               'excluido_em', x.excluido_em,
               'excluido_por', (SELECT nome FROM public.user_profiles u WHERE u.id = x.excluido_por),
               'vinculos',    public.lixeira_vinculos(%L, x.id)
             ) ORDER BY x.excluido_em DESC NULLS LAST), '[]'::jsonb)
        FROM public.%I x
       WHERE x.ativo = false
         AND %s = $1
    $q$, v_t, public._lixeira_expr_filial(v_t), v_t, v_t, public._lixeira_expr_filial(v_t))
    INTO v_linhas USING p_filial;

    v_out := v_out || v_linhas;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_listar(text, text) IS
  'Cadastros apagados DA UNIDADE, com autor, data e vínculos (migr. 451/454). Role admin literal, e a unidade é parâmetro — a SuperMax não vê o que a TechMax apagou.';

-- ── 3. Restaurar, sem atravessar a parede ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_restaurar(
  p_filial text, p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_n    int;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);
  PERFORM public._assert_lixeira_filial(p_filial);

  -- A filial entra no WHERE, não num IF depois: registro de outra unidade
  -- simplesmente não é encontrado.
  EXECUTE format(
    'SELECT nome FROM public.%I x WHERE x.id = $1 AND x.ativo = false AND %s = $2',
    p_tabela, public._lixeira_expr_filial(p_tabela))
    INTO v_nome USING p_id, p_filial;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Registro não está na lixeira desta unidade (ou já foi restaurado).'
      USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    EXECUTE format('UPDATE public.%I SET ativo = true WHERE id = $1', p_tabela)
      USING p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'Não dá para restaurar "%": outro cadastro ativo já ocupa a identificação dele (código, EAN ou variante). Renomeie ou apague o que está no lugar, e tente de novo.',
        v_nome USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object('restaurado', v_n, 'nome', v_nome);
END;
$function$;

COMMENT ON FUNCTION public.lixeira_restaurar(text, text, uuid) IS
  'Devolve o cadastro da unidade à operação (migr. 451/454). Colisão de índice único parcial vira mensagem, não 23505.';

-- ── 4. Apagar de vez, sem atravessar a parede ───────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_expurgar(
  p_filial text, p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome     text;
  v_vinculos jsonb;
  v_texto    text;
  v_n        int;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);
  PERFORM public._assert_lixeira_filial(p_filial);

  EXECUTE format(
    'SELECT nome FROM public.%I x WHERE x.id = $1 AND %s = $2',
    p_tabela, public._lixeira_expr_filial(p_tabela))
    INTO v_nome USING p_id, p_filial;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado nesta unidade.' USING ERRCODE = 'P0002';
  END IF;

  EXECUTE format('SELECT count(*) FROM public.%I WHERE id = $1 AND ativo = false', p_tabela)
    INTO v_n USING p_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION
      '"%" ainda está em uso. Apague o cadastro primeiro; da lixeira ele sai de vez.',
      v_nome USING ERRCODE = 'P0001';
  END IF;

  -- Satélite (1:1 em cascata) é parte do registro e vai junto pelo próprio
  -- ON DELETE CASCADE. Só fato de terceiro segura (migr. 452).
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO v_vinculos
    FROM jsonb_array_elements(public.lixeira_vinculos(p_tabela, p_id)) e
   WHERE COALESCE((e->>'satelite')::boolean, false) = false;

  IF jsonb_array_length(v_vinculos) > 0 THEN
    SELECT string_agg(
             (e->>'tabela') || ' (' || (e->>'linhas') || ')', ', '
             ORDER BY (e->>'tabela'))
      INTO v_texto
      FROM jsonb_array_elements(v_vinculos) e;

    RAISE EXCEPTION
      'Não dá para apagar "%" de vez: ainda existe histórico ligado a ele em %. Apagar levaria esse histórico junto e mudaria resultado de mês já fechado. O registro continua na lixeira.',
      v_nome, v_texto USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_tabela) USING p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('apagado', v_n, 'nome', v_nome);
END;
$function$;

COMMENT ON FUNCTION public.lixeira_expurgar(text, text, uuid) IS
  'DELETE real, na unidade certa e só quando nenhum fato de terceiro aponta para a linha (migr. 451/452/454).';

-- ── 5. Quem executa ─────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._lixeira_expr_filial(text)                  FROM public, anon;
REVOKE ALL ON FUNCTION public._assert_lixeira_filial(text)                FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_listar(text, text)                  FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_restaurar(text, text, uuid)         FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_expurgar(text, text, uuid)          FROM public, anon;

GRANT EXECUTE ON FUNCTION public.lixeira_listar(text, text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lixeira_restaurar(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lixeira_expurgar(text, text, uuid)  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as assinaturas antigas sumiram e as novas existem
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc WHERE proname LIKE 'lixeira%' ORDER BY 1;
--   -- esperado: listar(text,text), restaurar(text,text,uuid),
--   --           expurgar(text,text,uuid), vinculos(text,uuid)
--
--   -- 2. nenhuma aberta para anônimo — esperado: zero linhas
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE '%lixeira%'
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
--   -- 3. o que cada unidade tem na lixeira, pela mesma régua da RPC
--   SELECT filial, count(*) FROM produtos WHERE NOT ativo GROUP BY 1 ORDER BY 1;
--   SELECT c.filial, count(*) FROM subcategorias_produto s
--     JOIN categorias_produto c ON c.id = s.categoria_id
--    WHERE NOT s.ativo GROUP BY 1 ORDER BY 1;
--
-- O teste que vale a aula: entrar na SuperMax e conferir que a lixeira mostra
-- só o que a SuperMax apagou; trocar para a TechMax e ver a lista mudar
-- inteira. Em modo Matriz a tela pede a unidade.
-- =================================================================
