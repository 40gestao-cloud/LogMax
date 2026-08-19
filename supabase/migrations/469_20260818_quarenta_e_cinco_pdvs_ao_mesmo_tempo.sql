-- 469 — Duas vendas simultâneas podiam se matar, e a trilha falava sozinha.
--
-- Contexto: turma de até 45 alunos, cada um num PDV (SuperMax, MaxLook ou
-- TechMax), vendendo ao mesmo tempo do mesmo catálogo de ~20 produtos. Sob essa
-- carga aparecem dois problemas que com 3 ou 4 PDVs nunca deram as caras.
--
-- ─── 1. DEADLOCK NA BAIXA DE ESTOQUE ────────────────────────────────────────
--
-- `criar_venda_pdv` tranca cada produto do carrinho com FOR UPDATE antes de
-- conferir o estoque — correto, é o que impede estoque negativo. Só que a lista
-- vem de um GROUP BY sem ORDER BY, e GROUP BY não promete ordem nenhuma:
--
--   FOR v_produto_id, v_qtd_pedida IN
--     SELECT (item->>'produto_id')::uuid, SUM((item->>'qtd')::numeric)
--       FROM jsonb_array_elements(p_itens) item
--      GROUP BY (item->>'produto_id')::uuid
--   LOOP
--
-- Carrinho A = {arroz, feijão}. Carrinho B = {feijão, arroz}. Se saírem em
-- ordens diferentes e rodarem juntos, A segura o arroz e espera o feijão
-- enquanto B segura o feijão e espera o arroz. O Postgres detecta o abraço e
-- **aborta uma das transações** com 40P01 (deadlock detected).
--
-- Para o aluno isso é uma venda que falhou com erro incompreensível, sem nada
-- errado no que ele fez. Com 45 pessoas comprando de 20 produtos, carrinhos que
-- se cruzam são a regra.
--
-- A correção é ordenar a aquisição dos locks: se todo mundo trava na ordem do
-- uuid, ninguém pode estar esperando por quem espera por ele. Uma linha
-- (`ORDER BY 1`) elimina a classe inteira de deadlock — a fila continua (duas
-- vendas do mesmo produto se serializam, e é para isso que o lock existe), mas
-- ninguém mais morre nela.
--
-- Não transcreve a função: ela tem 10 KB e quatro INSERTs de dinheiro. Lê o
-- corpo vigente com pg_get_functiondef, aplica UMA substituição e aborta se o
-- padrão não aparecer exatamente uma vez — mesma técnica da migr. 462, pelo
-- mesmo motivo (o documento de auditoria manda copiar do banco, nunca do
-- arquivo antigo).
--
-- ─── 2. A TRILHA FALANDO PARA NINGUÉM ───────────────────────────────────────
--
-- `historico_operacoes` está na publicação do Realtime desde a migr. 331, e
-- nenhuma tela escuta: o <HistoricoOperacoes> lê no clique, com um SELECT
-- comum. Era desperdício pequeno até a migr. 468 pôr trilha em
-- `movimentacoes_estoque` — agora **uma venda de 3 itens grava ~5 linhas** ali,
-- e cada uma vira mensagem de Realtime enviada a todos os PDVs conectados.
--
-- Com 45 clientes abertos, é tráfego multiplicado por 45 para uma tabela que
-- ninguém observa. Sai da publicação; a leitura por clique não muda em nada.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. Ordem determinística na tomada de locks ──────────────────────────────

DO $$
DECLARE
  v_def   text;
  v_novo  text;
  v_alvo  text := 'GROUP BY (item->>''produto_id'')::uuid';
  v_qtd   int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.proname = 'criar_venda_pdv';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'criar_venda_pdv não existe neste projeto — migração fora de ordem.';
  END IF;

  -- Já corrigida? Então não há o que fazer (idempotência).
  IF position(v_alvo || E'\n     ORDER BY 1' IN v_def) > 0
     OR v_def LIKE '%GROUP BY (item->>''produto_id'')::uuid ORDER BY 1%' THEN
    RAISE NOTICE 'criar_venda_pdv já ordena a tomada de locks — nada a fazer.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM regexp_matches(v_def, replace(replace(v_alvo, '(', '\('), ')', '\)'), 'g');

  IF v_qtd <> 1 THEN
    RAISE EXCEPTION
      'Esperava 1 ocorrência de "%" em criar_venda_pdv, encontrei %. '
      'Alguém mexeu na função: revise à mão em vez de deixar esta migração remendar.',
      v_alvo, v_qtd;
  END IF;

  v_novo := replace(v_def, v_alvo, v_alvo || ' ORDER BY 1');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'Substituição não alterou o corpo de criar_venda_pdv — abortando.';
  END IF;

  EXECUTE v_novo;
  RAISE NOTICE 'criar_venda_pdv: locks de produto agora são tomados em ordem de id.';
END $$;

-- ── 2. Fora da publicação do Realtime ───────────────────────────────────────
--
-- Guardado pelo catálogo: DROP TABLE de tabela que não está na publicação é
-- erro, e a migração precisa poder rodar duas vezes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'historico_operacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.historico_operacoes;
    RAISE NOTICE 'historico_operacoes saiu do Realtime.';
  ELSE
    RAISE NOTICE 'historico_operacoes já estava fora do Realtime.';
  END IF;
END $$;

COMMIT;

-- Verificação:
--
--   -- 1. A ordem entrou:
--   SELECT position('GROUP BY (item->>''produto_id'')::uuid ORDER BY 1'
--                   IN pg_get_functiondef('public.criar_venda_pdv(uuid,numeric,numeric,numeric,text,integer,jsonb,text,text,numeric)'::regprocedure)) > 0;
--
--   -- 2. A trilha saiu da publicação (deve voltar 0 linha):
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'historico_operacoes';
--
--   -- 3. Nenhum deadlock desde a aplicação (roda depois de uma aula):
--   --    procure 40P01 nos logs do projeto no painel do Supabase.
