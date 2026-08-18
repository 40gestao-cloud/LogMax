-- 462_20260817_a_cobranca_passa_a_saber_de_que_venda_e.sql
--
-- O ELO ENTRE VENDA E COBRANÇA ERA UM PEDAÇO DE TEXTO.
--
-- `contas_receber` não tinha `venda_id`. Três funções casavam as duas pontas
-- pela descrição:
--
--   AND c.descricao LIKE '%#' || v_short_id || '%'
--
-- Funciona enquanto ninguém escrever na descrição. É campo de texto livre,
-- editável na tela de Contas a Receber, e o dia em que um aluno corrigir "
-- Venda #A3F91C — Maria" para "Venda da Maria", três coisas param de acontecer
-- **em silêncio**: a devolução não acha a cobrança para cancelar, o
-- cancelamento de venda deixa a conta viva, e a baixa parcial perde o vínculo.
-- Nenhuma delas dá erro; todas dão o número errado semanas depois.
--
-- Último item da lista de melhorias levantada hoje, e o único que ainda era
-- estrutural.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O TEXTO NÃO SAI DE CENA POR COMPLETO
--
-- `criar_venda_pdv` tem 10 KB e quatro `INSERT INTO contas_receber`. Reescrevê-la
-- inteira num arquivo de migração significa transcrever dez mil caracteres à
-- mão para mudar quatro linhas — e o documento de auditoria é explícito sobre
-- o risco disso ("copie o `prosrc` do banco antes de reescrever a função,
-- nunca do arquivo da migração antiga").
--
-- Então esta migração não transcreve nada: lê o corpo vigente com
-- `pg_get_functiondef`, aplica substituições pontuais e **aborta se o padrão
-- não for encontrado**. Se alguém tiver mexido nas funções, a migração falha
-- em vez de gravar uma versão remendada pela metade.
--
-- Os padrões foram conferidos no banco antes de escrever:
--
--   criar_venda_pdv          4 INSERT em contas_receber
--                            3 terminam em 'Aberto', v_filial)
--                            1 termina  em 'Pago',   v_filial)
--                            (o 5º `v_filial)` do corpo é de movimentacoes_
--                             estoque e não casa com nenhum dos dois)
--   criar_devolucao_venda    1 ocorrência do LIKE
--   fn_venda_cancelada_desfaz 2 ocorrências do LIKE
--
-- A DESCRIÇÃO CONTINUA SENDO ESCRITA — ela é o que o cliente lê no extrato.
-- O que muda é que ninguém mais **depende** dela para saber de que venda a
-- cobrança é.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. A coluna ─────────────────────────────────────────────────────────────
--
-- `ON DELETE SET NULL`, não CASCADE: apagar uma venda não pode levar junto a
-- cobrança, que é dinheiro. Vendas são inativadas, nunca apagadas — mas a
-- regra vale para o caminho que ninguém previu.

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS venda_id uuid REFERENCES public.vendas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contas_receber_venda
  ON public.contas_receber (venda_id) WHERE venda_id IS NOT NULL;

COMMENT ON COLUMN public.contas_receber.venda_id IS
  'Venda que originou a cobrança (migr. 462). Antes o elo era a descrição — texto livre, editável na tela.';

-- ── 2. O passado ────────────────────────────────────────────────────────────
--
-- Só casa quando a leitura é inequívoca: uma conta que bata com DUAS vendas
-- (colisão dos 6 hex finais) fica sem vínculo, para alguém olhar. Adivinhar
-- qual das duas seria inventar o dado que a migração veio tornar confiável.

UPDATE public.contas_receber cr
   SET venda_id = sub.vid
  FROM (
    -- `array_agg(...)[1]` porque não existe `min(uuid)` no Postgres. Qual
    -- elemento não importa: a linha só é usada quando `n = 1`.
    SELECT c.id AS cid, (array_agg(v.id))[1] AS vid, count(*) AS n
      FROM public.contas_receber c
      JOIN public.vendas v
        ON c.descricao LIKE '%#' || upper(right(v.id::text, 6)) || '%'
       AND c.filial IS NOT DISTINCT FROM v.filial
     WHERE c.venda_id IS NULL
     GROUP BY c.id
  ) sub
 WHERE cr.id = sub.cid
   AND sub.n = 1;

-- ── 3. A origem: a venda passa a carimbar a cobrança ────────────────────────

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'criar_venda_pdv';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'criar_venda_pdv não encontrada.';
  END IF;

  -- A lista de colunas dos quatro INSERT.
  IF position('INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)' in v_def) = 0 THEN
    RAISE EXCEPTION 'criar_venda_pdv: a lista de colunas de contas_receber mudou — revise a migr. 462 antes de aplicar.';
  END IF;

  v_novo := replace(v_def,
    'INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial)',
    'INSERT INTO contas_receber (cliente_id, descricao, valor, vencimento, status, filial, venda_id)');

  -- Os VALUES. Três contas nascem 'Aberto' (parcelas do cartão, fiado e cartão
  -- 1x) e uma nasce 'Pago' (à vista).
  IF position('''Aberto'', v_filial)' in v_novo) = 0
     OR position('''Pago'', v_filial)' in v_novo) = 0 THEN
    RAISE EXCEPTION 'criar_venda_pdv: os VALUES de contas_receber mudaram — revise a migr. 462 antes de aplicar.';
  END IF;

  v_novo := replace(v_novo, '''Aberto'', v_filial)', '''Aberto'', v_filial, v_venda_id)');
  v_novo := replace(v_novo, '''Pago'', v_filial)',   '''Pago'', v_filial, v_venda_id)');

  EXECUTE v_novo;
END
$do$;

-- ── 4. Os consumidores: perguntam pela coluna, não pelo texto ───────────────

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'criar_devolucao_venda';

  IF v_def IS NULL OR position('c.descricao LIKE ''%#'' || v_short_id || ''%''' in v_def) = 0 THEN
    RAISE EXCEPTION 'criar_devolucao_venda: o casamento por descrição mudou — revise a migr. 462.';
  END IF;

  v_novo := replace(v_def,
    'c.descricao LIKE ''%#'' || v_short_id || ''%''',
    'c.venda_id = p_venda_id');

  EXECUTE v_novo;
END
$do$;

DO $do$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_venda_cancelada_desfaz';

  IF v_def IS NULL OR position('cr.descricao LIKE ''%#'' || v_short || ''%''' in v_def) = 0 THEN
    RAISE EXCEPTION 'fn_venda_cancelada_desfaz: o casamento por descrição mudou — revise a migr. 462.';
  END IF;

  -- Duas ocorrências: a que cancela a conta sem dinheiro e a que marca a que
  -- já recebeu. `replace` troca as duas.
  v_novo := replace(v_def,
    'cr.descricao LIKE ''%#'' || v_short || ''%''',
    'cr.venda_id = NEW.id');

  EXECUTE v_novo;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. a coluna e o índice
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='contas_receber' AND column_name='venda_id';
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexname='idx_contas_receber_venda';
--
--   -- 2. ninguém mais casa venda e cobrança por texto — esperado: zero linhas
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('criar_devolucao_venda','fn_venda_cancelada_desfaz')
--      AND p.prosrc LIKE '%descricao LIKE%';
--
--   -- 3. a venda passa a carimbar — esperado: 4
--   SELECT (SELECT count(*) FROM regexp_matches(prosrc, 'v_filial, v_venda_id\)', 'g'))
--     FROM pg_proc WHERE proname = 'criar_venda_pdv';
--
--   -- 4. PASSIVO: cobrança de venda sem vínculo resolvido. Nas 4 turmas a
--   --    tabela está vazia hoje, então o esperado é zero.
--   SELECT id, descricao, valor, filial FROM contas_receber
--    WHERE venda_id IS NULL AND descricao LIKE '%Venda #%'
--    ORDER BY created_at DESC;
--
-- O teste que vale a aula: vender fiado, editar a descrição da conta a receber
-- para qualquer coisa, e então cancelar a venda. A cobrança tem de ser
-- cancelada do mesmo jeito — antes desta migração, ela sobrevivia.
-- =================================================================
