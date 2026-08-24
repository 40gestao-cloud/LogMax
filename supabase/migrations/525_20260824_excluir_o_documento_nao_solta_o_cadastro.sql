-- 525_20260824_excluir_o_documento_nao_solta_o_cadastro.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- "Eu já apaguei o documento" — e continua travado
-- ═══════════════════════════════════════════════════════════════════════════
-- Sequência observada na ERP, 24/08, com o produto "Camisa de Linho Masculina"
-- (MaxLook, cód. 008):
--
--   1. Lixeira recusa o expurgo: existe histórico em `requisicoes`.
--   2. A migr. 524 passa a nomear o documento: REQ-ML-2026-0117 (Aprovado).
--   3. O admin vai em Compras > Requisições e EXCLUI a REQ-0117.
--   4. A lixeira recusa de novo — com a mesma mensagem, apontando o mesmo
--      documento, como se nada tivesse acontecido.
--
-- Não é bug: excluir na tela é soft-delete (`ativo = false`). A linha continua
-- no banco e, com ela, o `produto_id` apontando para o cadastro. A trava tem
-- de continuar — `requisicoes.produto_id` não tem ON DELETE, então o expurgo
-- morreria num erro cru de chave estrangeira em vez da mensagem explicada.
--
-- O que faltava era a mensagem admitir o que a pessoa acabou de fazer. Sem
-- isso, ela repete a mesma tentativa: exclui de novo, procura de novo, e a
-- tela diz sempre a mesma coisa.
--
-- Agora cada vínculo conta quantas das linhas presas já estão excluídas; o
-- rótulo de cada documento carrega "— excluído"; e quando TODOS os que travam
-- já foram excluídos, o expurgo explica que excluir não desfaz o vínculo e
-- diz o que resolve: apontar o documento para outro cadastro, ou deixar o
-- registro na lixeira, que é onde ele não atrapalha ninguém.
--
-- Nada muda em QUEM trava. Só a explicação.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O vínculo passa a saber quantos dos presos já foram excluídos
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lixeira_vinculos(p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fk      record;
  v_n       bigint;
  v_exc     bigint;
  v_out     jsonb := '[]'::jsonb;
  v_bare    text;
  v_col_rot text;
  v_tem_st  boolean;
  v_tem_at  boolean;
  v_expr    text;
  v_rotulos jsonb;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tabela_filha,
           a.attname                  AS coluna,
           -- Satélite: 1:1 em cascata. O índice tem de ser único, VÁLIDO, com
           -- uma coluna de chave só, sobre a própria coluna da FK e sem WHERE.
           (pg_get_constraintdef(c.oid) LIKE '%ON DELETE CASCADE%'
            AND EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND i.indisunique
                 AND i.indisvalid
                 AND i.indnkeyatts = 1
                 AND i.indkey[0] = c.conkey[1]
                 AND i.indpred IS NULL)) AS satelite
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum   = c.conkey[1]
     WHERE c.contype  = 'f'
       AND c.confrelid = ('public.' || p_tabela)::regclass
       AND array_length(c.conkey, 1) = 1
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tabela_filha, v_fk.coluna)
      INTO v_n USING p_id;

    IF v_n > 0 THEN
      v_bare := regexp_replace(v_fk.tabela_filha, '^.*\.', '');

      SELECT column_name INTO v_col_rot
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = v_bare
         AND column_name = ANY (ARRAY['numero', 'nome', 'item', 'descricao', 'titulo'])
       ORDER BY array_position(ARRAY['numero', 'nome', 'item', 'descricao', 'titulo'],
                               column_name::text)
       LIMIT 1;

      -- MIGR 525: quantos dos presos a pessoa já mandou excluir. Tabela sem
      -- soft-delete devolve zero — e aí a mensagem não promete nada.
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_bare AND column_name = 'ativo'
      ) INTO v_tem_at;

      v_exc := 0;
      IF v_tem_at THEN
        EXECUTE format(
          'SELECT count(*) FROM %s WHERE %I = $1 AND COALESCE(ativo, true) = false',
          v_fk.tabela_filha, v_fk.coluna)
          INTO v_exc USING p_id;
      END IF;

      v_rotulos := '[]'::jsonb;

      IF v_col_rot IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = v_bare AND column_name = 'status'
        ) INTO v_tem_st;

        v_expr := format('COALESCE(x.%I::text, ''(sem nome)'')', v_col_rot);
        IF v_tem_st THEN
          v_expr := v_expr || ' || COALESCE('' ('' || x.status::text || '')'', '''')';
        END IF;
        -- MIGR 525: o documento que a pessoa já excluiu se anuncia como tal.
        IF v_tem_at THEN
          v_expr := v_expr ||
            ' || CASE WHEN COALESCE(x.ativo, true) THEN '''' ELSE '' — excluído'' END';
        END IF;

        EXECUTE format(
          'SELECT COALESCE(jsonb_agg(r), ''[]''::jsonb)
             FROM (SELECT %s AS r FROM %s x WHERE x.%I = $1 LIMIT 3) s',
          v_expr, v_fk.tabela_filha, v_fk.coluna)
          INTO v_rotulos USING p_id;
      END IF;

      v_out := v_out || jsonb_build_object(
        'tabela',    v_fk.tabela_filha,
        'linhas',    v_n,
        'excluidas', v_exc,
        'rotulos',   v_rotulos,
        -- Migr. 452: quem é parte do registro não impede apagá-lo.
        'satelite',  v_fk.satelite);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_vinculos(text, uuid) IS
  'Quem ainda referencia esta linha (migr. 451), com o rótulo de até 3 documentos presos (524) e quantos deles já foram excluídos na tela (525).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A mensagem responde a quem já excluiu o documento
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lixeira_expurgar(p_filial text, p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome     text;
  v_vinculos jsonb;
  v_texto    text;
  v_todos_ex boolean;
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
             (e->>'tabela') || ' (' || (e->>'linhas') || ')'
             || COALESCE(
                  (SELECT ': ' || string_agg(r.v, ', ')
                     FROM (SELECT jsonb_array_elements_text(e->'rotulos') AS v) r),
                  '')
             || CASE WHEN (e->>'linhas')::bigint > jsonb_array_length(COALESCE(e->'rotulos', '[]'::jsonb))
                     THEN ' e outros' ELSE '' END,
             '; ' ORDER BY (e->>'tabela'))
      INTO v_texto
      FROM jsonb_array_elements(v_vinculos) e;

    -- MIGR 525: todos os que travam já foram excluídos na tela. Sem esta
    -- frase a mensagem repetia o mesmo texto de antes da exclusão, e quem
    -- lia concluía que a exclusão não tinha funcionado.
    SELECT bool_and(COALESCE((e->>'excluidas')::bigint, 0) >= (e->>'linhas')::bigint)
      INTO v_todos_ex
      FROM jsonb_array_elements(v_vinculos) e;

    IF COALESCE(v_todos_ex, false) THEN
      RAISE EXCEPTION
        'Não dá para apagar "%" de vez: %. Esses documentos já foram excluídos na tela, mas excluir não os tira do banco — eles continuam apontando para este cadastro. Ou o documento passa a apontar para outro cadastro, ou este registro fica na lixeira, onde não atrapalha a operação.',
        v_nome, v_texto USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION
      'Não dá para apagar "%" de vez: ainda existe histórico ligado a ele em %. Apagar levaria esse histórico junto e mudaria resultado de mês já fechado. O registro continua na lixeira.',
      v_nome, v_texto USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_tabela) USING p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('apagado', v_n, 'nome', v_nome);
END;
$function$;

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   SELECT public.lixeira_vinculos('produtos', '<id>');   -- exige sessão admin
--   -- espera 'excluidas' junto de 'linhas' em cada vínculo
--   NOTIFY pgrst, 'reload schema';
