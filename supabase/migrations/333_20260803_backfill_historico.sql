-- 333 — Backfill do histórico: o que já existia ganha um ponto de partida.
--
-- As migr. 331/332 puseram a trilha em 18 documentos, mas ela começa a contar
-- da data em que rodaram. Documento aberto antes disso — e há requisição no
-- meio do fluxo, pedido em entrega, conta em aberto — abre o histórico e não
-- mostra nada, que lê como "nunca aconteceu nada aqui".
--
-- O que dá para recuperar é só o começo: `criado_por` e `created_at` existem
-- desde a migr. 055. As transições passadas não voltam — foram sobrescritas
-- pelo próprio desenho antigo (`atualizado_por` guarda uma só) e inventá-las
-- seria pior que não ter, porque a trilha passaria a mentir.
--
-- Por isso o evento retroativo NÃO diz "para: Aprovado". O status de hoje não é
-- o status de criação, e escrever o de hoje na linha de criação seria exatamente
-- a mentira que se quer evitar. O status atual entra no detalhe, com data, como
-- o que é: uma fotografia tirada no dia do backfill.
--
-- Idempotente: só insere onde o documento ainda não tem nenhuma linha de
-- histórico, então rodar de novo não duplica — e não atropela documento que já
-- ganhou trilha de verdade desde a 331.

BEGIN;

DO $$
DECLARE
  t          text;
  e_criado   text;
  e_data     text;
  e_filial   text;
  e_status   text;
  v_ins      bigint;
  v_total    bigint := 0;
BEGIN
  -- A lista sai dos próprios triggers: quem tem trilha daqui para a frente é
  -- exatamente quem precisa de ponto de partida. Acrescentar tabela ao
  -- histórico depois e reexecutar este script cobre a nova sem editar nada.
  FOR t IN
    SELECT c.relname FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE tg.tgname = 'trg_historico'
     ORDER BY 1
  LOOP
    -- Nem toda tabela tem as quatro colunas: `notas_emitidas` não tem status,
    -- e as tabelas de aprovação ficaram fora da migr. 055.
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='criado_por')
                THEN 'x.criado_por' ELSE 'NULL::uuid' END INTO e_criado;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='created_at')
                THEN 'x.created_at' ELSE 'now()' END INTO e_data;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='filial')
                THEN 'x.filial::text' ELSE 'NULL::text' END INTO e_filial;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='status')
                THEN 'COALESCE(x.status::text, ''sem status'')' ELSE '''sem status''' END INTO e_status;

    EXECUTE format(
      'INSERT INTO public.historico_operacoes '
      '  (entidade, entidade_id, filial, evento, detalhe, ator_id, ator_nome, ator_setor, created_at) '
      'SELECT %L, x.id, %s, ''Criado'', '
      '       ''Documento anterior ao histórico. Situação em '' || to_char(now(), ''DD/MM/YYYY'') || '': '' || %s || ''.'', '
      '       %s, COALESCE(p.nome, ''Não registrado''), p.setor, %s '
      '  FROM public.%I x '
      '  LEFT JOIN public.user_profiles p ON p.id = %s '
      ' WHERE NOT EXISTS (SELECT 1 FROM public.historico_operacoes h '
      '                    WHERE h.entidade = %L AND h.entidade_id = x.id)',
      t, e_filial, e_status, e_criado, e_data, t, e_criado, t);

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    v_total := v_total + v_ins;
    RAISE NOTICE '% → % documento(s)', t, v_ins;
  END LOOP;

  RAISE NOTICE 'Backfill concluído: % linha(s).', v_total;
END $$;

COMMIT;

-- Verificação:
--
--   -- Quantos documentos ganharam ponto de partida, por tipo:
--   SELECT entidade, count(*) FROM historico_operacoes
--    WHERE ator_nome = 'Não registrado' OR detalhe LIKE 'Documento anterior%'
--    GROUP BY entidade ORDER BY 2 DESC;
--
--   -- Nenhum documento deve ter ficado sem trilha (exemplo com requisições):
--   SELECT count(*) FROM requisicoes r
--    WHERE NOT EXISTS (SELECT 1 FROM historico_operacoes h
--                       WHERE h.entidade = 'requisicoes' AND h.entidade_id = r.id);
