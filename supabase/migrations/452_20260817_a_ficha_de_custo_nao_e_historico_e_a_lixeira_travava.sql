-- 452_20260817_a_ficha_de_custo_nao_e_historico_e_a_lixeira_travava.sql
--
-- A LIXEIRA DA 451 NÃO CONSEGUIA APAGAR NENHUM PRODUTO. NUNCA.
--
-- Achado relendo a própria correção, com o dado das 4 turmas na frente: os 10
-- produtos apagados apareciam presos por `movimentacoes_estoque` — legítimo,
-- é histórico — e também por **`produtos_custo`**, que não é histórico coisa
-- nenhuma.
--
-- `produtos_custo` é a ficha de custo DAQUELE produto: uma linha por produto,
-- `ON DELETE CASCADE`, criada sozinha na primeira entrada. Não é um documento
-- que aponta para o produto; é uma extensão dele, com a chave do lado de fora
-- por conveniência de modelagem. Morre com ele, e está certo que morra.
--
-- Contando essa linha como vínculo, a 451 fica com um botão que nunca
-- habilita: todo produto que já teve custo apurado — ou seja, todo produto —
-- ficaria preso para sempre por uma tabela que é parte dele. Um cadastro
-- errado, criado e apagado sem nenhuma movimentação, também não sairia.
--
-- É o mesmo erro que a auditoria de 17/08 catalogou como **regra por proxy**:
-- "existe linha apontando para cá?" responde outra pergunta ("há dado
-- dependente?") em vez da verdadeira — **"apagar isto destruiria algum fato
-- que aconteceu?"**.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A DISTINÇÃO VEM DA ESTRUTURA, NÃO DE UMA LISTA DE NOMES
--
-- Escrever `AND tabela_filha <> 'produtos_custo'` resolveria hoje e
-- envelheceria calado — a próxima tabela satélite nasceria travando de novo, e
-- ninguém lembraria do porquê. A pergunta certa é estrutural e o catálogo
-- responde:
--
--   FK com índice ÚNICO simples e total (1:1) + ON DELETE CASCADE  → satélite
--   qualquer outra                                                 → histórico
--
-- Um-para-um em cascata é, por construção, "esta linha existe por causa
-- daquela". Muitos-para-um é fato próprio, com data e autor, que sobrevive ao
-- cadastro — e é o que a lixeira tem de proteger.
--
-- Nas seis tabelas cobertas, hoje, a régua separa exatamente uma FK das
-- dezesseis de `produtos`: `produtos_custo`. `produto_unidades` e
-- `itens_campanha` também são CASCADE, mas são muitos-por-produto — o IMEI de
-- cada aparelho e a participação em campanha continuam segurando, como devem.
--
-- O satélite não é apagado à mão: o `ON DELETE CASCADE` que o define é o mesmo
-- que o leva junto. Esta migração só para de contá-lo como impedimento.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 451.

BEGIN;

CREATE OR REPLACE FUNCTION public.lixeira_vinculos(p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fk    record;
  v_n     bigint;
  v_out   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tabela_filha,
           a.attname                  AS coluna,
           -- Satélite: 1:1 em cascata. O índice tem de ser único, de uma
           -- coluna só, sobre a própria coluna da FK e sem WHERE — índice
           -- parcial não garante unicidade da relação.
           (pg_get_constraintdef(c.oid) LIKE '%ON DELETE CASCADE%'
            AND EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND i.indisunique
                 AND i.indnatts = 1
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
      v_out := v_out || jsonb_build_object(
        'tabela',   v_fk.tabela_filha,
        'linhas',   v_n,
        -- Migr. 452: quem é parte do registro não impede apagá-lo.
        'satelite', v_fk.satelite);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_vinculos(text, uuid) IS
  'Quem ainda referencia esta linha, perguntado ao pg_constraint (migr. 451/452). `satelite` marca a relação 1:1 em cascata — extensão do registro, não fato próprio, e por isso não impede o expurgo.';

CREATE OR REPLACE FUNCTION public.lixeira_expurgar(p_tabela text, p_id uuid)
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

  EXECUTE format('SELECT nome FROM public.%I WHERE id = $1', p_tabela)
    INTO v_nome USING p_id;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Só sai de vez o que já está na lixeira. Expurgar direto da operação seria
  -- pular a única etapa em que dá para mudar de ideia.
  EXECUTE format('SELECT count(*) FROM public.%I WHERE id = $1 AND ativo = false', p_tabela)
    INTO v_n USING p_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION
      '"%" ainda está em uso. Apague o cadastro primeiro; da lixeira ele sai de vez.',
      v_nome USING ERRCODE = 'P0001';
  END IF;

  -- Migr. 452: satélite (1:1 em cascata) é parte do registro e vai junto pelo
  -- próprio ON DELETE CASCADE. Só fato de terceiro segura.
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

COMMENT ON FUNCTION public.lixeira_expurgar(text, uuid) IS
  'DELETE real, e só quando nenhum FATO de terceiro aponta para a linha (migr. 451/452). Extensão 1:1 em cascata vai junto; histórico segura.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. a régua separa exatamente a ficha de custo entre as 16 FKs de
--   --    produtos — esperado: produtos_custo com satelite = true, e só ela
--   SELECT c.conrelid::regclass::text AS tabela,
--          (pg_get_constraintdef(c.oid) LIKE '%ON DELETE CASCADE%'
--           AND EXISTS (SELECT 1 FROM pg_index i
--                        WHERE i.indrelid = c.conrelid AND i.indisunique
--                          AND i.indnatts = 1 AND i.indkey[0] = c.conkey[1]
--                          AND i.indpred IS NULL)) AS satelite
--     FROM pg_constraint c
--    WHERE c.contype = 'f' AND c.confrelid = 'public.produtos'::regclass
--      AND array_length(c.conkey, 1) = 1
--    ORDER BY 2 DESC, 1;
--
--   -- 2. o que ainda segura cada produto apagado, já sem a ficha de custo.
--   --    Os 10 de hoje seguem presos por movimentacoes_estoque, e é o certo:
--   --    a entrada de implantação é um fato, ainda que duplicado.
--   SELECT jsonb_pretty(public.lixeira_listar('produtos'));
--
-- O teste que vale a aula: cadastrar um produto errado, lançar o custo dele à
-- mão, apagar sem nunca movimentar — e conseguir apagar de vez. Antes desta
-- migração a ficha de custo o prendia para sempre.
-- =================================================================
