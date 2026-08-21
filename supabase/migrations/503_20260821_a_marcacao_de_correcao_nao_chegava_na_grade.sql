-- 503_20260821_a_marcacao_de_correcao_nao_chegava_na_grade.sql
--
-- Rabo da 502, achado antes de a tela ir para o ar.
--
-- A 502 pôs `correcao_pendente` (e as outras quatro colunas) em `produtos`. Só
-- que Cadastros > Produtos NÃO lê `produtos`: lê a view `produtos_com_custo`
-- (migr. 262), que é quem junta o preço de custo. E view não herda coluna nova
-- da tabela — a lista é explícita, coluna a coluna.
--
-- Resultado: o selo "Corrigir" na grade e o banner com o motivo dentro do
-- formulário nunca apareceriam. `item.correcao_pendente` viria `undefined` em
-- toda linha, sem erro nenhum no console — a marcação existiria no banco e
-- seria invisível para exatamente quem precisa vê-la.
--
-- É a mesma família de armadilha de [[feedback_usefetch_created_at]] e
-- [[feedback_endpoint_table_map_faltando]]: o dado some em silêncio, e o
-- sintoma é "a funcionalidade simplesmente não faz nada".
--
-- ── Duas réguas ao recriar a view ───────────────────────────────────────────
-- 1. As colunas novas vão NO FIM. `CREATE OR REPLACE VIEW` aceita acrescentar
--    coluna no final, mas recusa reordenar ou remover as que já existem — e as
--    4 turmas têm a mesma ordem, que é o que faz este REPLACE passar em todas.
-- 2. `security_invoker = true` declarado DENTRO do CREATE. Sem isto o REPLACE
--    devolve a view para o comportamento de definer e a RLS de `produtos` para
--    de valer na leitura — a view viraria porta lateral para o catálogo das
--    outras filiais.


BEGIN;

CREATE OR REPLACE VIEW public.produtos_com_custo
WITH (security_invoker = true) AS
 SELECT p.id,
    p.codigo,
    p.nome,
    p.categoria,
    p.estoque,
    p.preco,
    p.unidade,
    p.status,
    p.created_at,
    p.ativo,
    p.estoque_minimo,
    p.ean,
    p.fornecedor,
    p.filial,
    p.imagem_url,
    p.tipo,
    p.patrimonio_numero,
    p.patrimonio_responsavel,
    p.patrimonio_localizacao,
    p.criado_por,
    p.atualizado_por,
    p.updated_at,
    p.elegivel_beneficios,
    p.vitrine_publica,
    p.categoria_id,
    p.subcategoria_id,
    p.marca,
    p.peso,
    p.peso_unidade,
    p.atributos,
    p.imagem_url_2,
    p.imagem_url_3,
    p.codigo_seq,
    p.loja_online,
    c.preco_custo,
    c.origem AS custo_origem,
    c.ultima_compra_em AS custo_ultima_compra_em,
    c.ultimo_custo_compra AS custo_ultima_compra_valor,
    -- ── Migr. 502/503: a devolução para correção ──
    p.correcao_pendente,
    p.correcao_motivo,
    p.correcao_solicitada_por,
    p.correcao_solicitada_em,
    p.correcao_responsavel_id
   FROM produtos p
     LEFT JOIN produtos_custo c ON c.produto_id = p.id;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='produtos_com_custo' AND column_name LIKE 'correcao_%';  -- 5
--
--   -- security_invoker sobreviveu ao REPLACE:
--   SELECT reloptions FROM pg_class WHERE relname = 'produtos_com_custo';
--   -- {security_invoker=true}
-- ════════════════════════════════════════════════════════════════════════════
