-- 419_20260814_a_mesma_view_de_custo_nas_quatro_turmas.sql
--
-- `produtos_com_custo` existe nos 4 bancos em três formatos diferentes.
--
-- Descoberto ao aplicar a 417: ela quebrou na turma Aprendiz com 42P16 porque
-- a lista de colunas tinha sido escrita à mão a partir da LogMax-ERP. A 417 já
-- foi corrigida para reconstruir a view respeitando a ordem de cada banco — o
-- que a fez aplicar em todos, mas manteve a divergência de pé.
--
-- O levantamento, por hash das colunas:
--
--   `produtos`           → conjunto IDÊNTICO nos 4; ordem em 3 variações
--   `produtos_com_custo` → ERP não expõe `loja_online`; as outras 3 expõem
--
-- A ordem física das colunas vem de `ALTER TABLE ADD COLUMN`, que só acrescenta
-- no fim: coluna que já estava no CREATE TABLE de uma turma e entrou por
-- migração na outra fica em posição diferente para sempre. Isso é invisível
-- para o app (PostgREST e o front acessam por nome) e só morde DDL que depende
-- de posição. **Não é corrigível sem reconstruir a tabela**, e não vale o
-- risco: ficam como estão, de propósito.
--
-- O que É corrigível — e é a única divergência com efeito real — é a view:
-- `loja_online` chega ao front em três turmas e não chega na quarta.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE DROP + CREATE, E NÃO REPLACE
--
-- `CREATE OR REPLACE VIEW` não reordena, não renomeia e não remove: só aceita
-- coluna nova no fim. Para a ERP, `loja_online` teria de entrar no meio.
-- Recriar é o único caminho, e aqui ele é seguro:
--
--   * nenhum objeto depende da view (conferido nos 4: zero dependentes);
--   * os grants são idênticos e estão restaurados abaixo, nominalmente —
--     `anon` fica de fora de propósito, como já estava: custo não é público;
--   * `security_invoker` vai declarado dentro do CREATE, senão a view volta ao
--     padrão (security definer) e o custo vaza para quem a RLS de
--     `produtos_custo` barra;
--   * tudo dentro de uma transação: a view não fica ausente para ninguém.
--
-- A lista abaixo é a ordem canônica, igual para os 4 bancos — é a que a
-- Aprendiz e a Contabilidade já têm, então duas das quatro nem mudam de forma.
-- Daqui em diante, esta é a definição a copiar quando nascer turma nova.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- Guarda: a lista canônica é escrita à mão e só funciona se `produtos` tiver
-- as mesmas colunas em todos os bancos (o que hoje é verdade — conjunto com o
-- mesmo hash nos 4). Se um projeto divergir, falha aqui com o nome do que
-- falta, em vez de estourar num "column does not exist" sem contexto.
DO $$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_faltando
    FROM unnest(ARRAY[
      'id','codigo','nome','categoria','estoque','preco','unidade','status','created_at',
      'ativo','estoque_minimo','ean','fornecedor','filial','imagem_url','tipo',
      'patrimonio_numero','patrimonio_responsavel','patrimonio_localizacao',
      'criado_por','atualizado_por','updated_at','elegivel_beneficios','vitrine_publica',
      'categoria_id','subcategoria_id','marca','peso','atributos',
      'imagem_url_2','imagem_url_3','codigo_seq','loja_online'
    ]) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name = c
   );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'produtos não tem: %. Este banco divergiu do schema das outras turmas — alinhe a tabela antes de recriar a view.',
      v_faltando USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP VIEW IF EXISTS public.produtos_com_custo;

CREATE VIEW public.produtos_com_custo
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
         p.atributos,
         p.imagem_url_2,
         p.imagem_url_3,
         p.codigo_seq,
         p.loja_online,
         c.preco_custo,
         c.origem              AS custo_origem,
         c.ultima_compra_em    AS custo_ultima_compra_em,
         c.ultimo_custo_compra AS custo_ultima_compra_valor
    FROM public.produtos p
    LEFT JOIN public.produtos_custo c ON c.produto_id = p.id;

COMMENT ON VIEW public.produtos_com_custo IS
  'Produtos + custo mascarado pela RLS de produtos_custo (migr. 262). Definição canônica das 4 turmas — vide migr. 419.';

-- DROP leva os grants junto. Restaurados exatamente como estavam: `anon` não
-- entra, e é isso que mantém o custo fora do alcance da vitrine pública.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_com_custo TO authenticated;
GRANT ALL                            ON public.produtos_com_custo TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência depois de rodar nos 4 — o hash tem de sair igual nos quatro:
--
--   SELECT md5(string_agg(column_name, ',' ORDER BY ordinal_position))
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'produtos_com_custo';
