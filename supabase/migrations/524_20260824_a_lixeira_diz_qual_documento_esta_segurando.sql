-- 524_20260824_a_lixeira_diz_qual_documento_esta_segurando.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- "Tem histórico" não é resposta se ninguém consegue achar o histórico
-- ═══════════════════════════════════════════════════════════════════════════
-- Relato da ERP, 24/08: o produto "Camisa de Linho Masculina" (MaxLook, cód.
-- 008) não sai da lixeira. A mensagem diz que existe histórico ligado a ele
-- "em requisicoes (1)" — nome de tabela e uma contagem. Quem lê vai procurar e
-- não acha: na tela de Requisições aquele documento aparece com OUTRO texto
-- ("Camisa de Linho Masculina- Foxton", digitado pelo solicitante), e nada ali
-- indica que ele está amarrado ao produto que está na lixeira. O vínculo é a
-- coluna `requisicoes.produto_id`, invisível em qualquer tela.
--
-- No caso concreto quem segura é a REQ-ML-2026-0117, aprovada e viva. A trava
-- está certa — apagar o produto levaria o `produto_id` da requisição junto, e
-- é justamente esse elo que a migr. 480 criou para o pedido saber que item foi
-- comprado. O que estava errado era a mensagem: ela nomeava a tabela do banco
-- em vez do documento que a pessoa consegue abrir.
--
-- Agora `lixeira_vinculos` devolve também os RÓTULOS de até 3 linhas presas —
-- o `numero` do documento quando a tabela tem um, senão `nome`/`item`, com o
-- status entre parênteses. A mensagem do expurgo passa a citar:
--
--   ... ainda existe histórico ligado a ele em requisicoes (1):
--   REQ-ML-2026-0117 (Aprovado).
--
-- Nada muda em QUEM trava: continua sendo fato de terceiro, com o satélite
-- 1:1 da migr. 452 de fora. Só a explicação melhora.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Os vínculos passam a vir com nome de documento
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco (md5 igual nos 4), com o bloco de rótulos
-- acrescentado. `satelite` e a régua de FK ficam como estavam.
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
  v_out     jsonb := '[]'::jsonb;
  v_bare    text;
  v_col_rot text;
  v_tem_st  boolean;
  v_expr    text;
  v_rotulos jsonb;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tabela_filha,
           a.attname                  AS coluna,
           -- Satélite: 1:1 em cascata. O índice tem de ser único, VÁLIDO, com
           -- uma coluna de chave só, sobre a própria coluna da FK e sem WHERE.
           --
           -- `indnkeyatts`, não `indnatts`: o segundo conta também as colunas
           -- INCLUDE, que não participam da unicidade — um índice
           -- `UNIQUE (produto_id) INCLUDE (preco_custo)` deixaria de ser
           -- reconhecido e o satélite voltaria a travar o expurgo, calado.
           -- `indisvalid` porque índice em construção ainda não garante nada.
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
      -- MIGR 524: como a pessoa chama esse documento na tela dela.
      --
      -- A ordem da lista é a da especificidade: `numero` identifica sozinho
      -- (REQ-ML-2026-0117); `nome`/`item`/`descricao` pelo menos deixam
      -- reconhecer a linha. Tabela sem nenhuma dessas colunas (uma ponte
      -- N:N, por exemplo) continua aparecendo só com a contagem — melhor
      -- calar do que inventar rótulo.
      v_bare := regexp_replace(v_fk.tabela_filha, '^.*\.', '');

      SELECT column_name INTO v_col_rot
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = v_bare
         AND column_name = ANY (ARRAY['numero', 'nome', 'item', 'descricao', 'titulo'])
       ORDER BY array_position(ARRAY['numero', 'nome', 'item', 'descricao', 'titulo'],
                               column_name::text)
       LIMIT 1;

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

        -- LIMIT 3: a mensagem existe para a pessoa saber onde ir, não para
        -- listar o banco. O total continua no `linhas`.
        EXECUTE format(
          'SELECT COALESCE(jsonb_agg(r), ''[]''::jsonb)
             FROM (SELECT %s AS r FROM %s x WHERE x.%I = $1 LIMIT 3) s',
          v_expr, v_fk.tabela_filha, v_fk.coluna)
          INTO v_rotulos USING p_id;
      END IF;

      v_out := v_out || jsonb_build_object(
        'tabela',   v_fk.tabela_filha,
        'linhas',   v_n,
        'rotulos',  v_rotulos,
        -- Migr. 452: quem é parte do registro não impede apagá-lo.
        'satelite', v_fk.satelite);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_vinculos(text, uuid) IS
  'Quem ainda referencia esta linha, perguntado ao pg_constraint (migr. 451), com o rótulo de até 3 documentos presos (migr. 524). FK criada depois entra na conta sozinha.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A mensagem do expurgo cita os documentos
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
    -- MIGR 524: o nome do documento, e não só o da tabela. Sem ele a mensagem
    -- mandava procurar um histórico que nenhuma tela mostra — o vínculo é uma
    -- coluna de id.
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
--   -- o vínculo do produto preso, agora com o número do documento:
--   SELECT public.lixeira_vinculos('produtos', '<id>');   -- exige sessão admin
--   NOTIFY pgrst, 'reload schema';
