-- 612_20260922_as_duas_views_de_avaliacao_seguem_a_regua_da_609.sql
--
-- Terceira e última ponta da 609. Além do placar (609) e da média que a filial
-- lê (611), duas views agregam as mesmas notas com a régua velha:
--
--   · `avaliacoes_matriz_agregado`      — média e decisões por item
--   · `avaliacoes_matriz_placar_filial` — média geral e taxa de aprovação por unidade
--
-- As duas fazem `JOIN user_profiles ... WHERE up.role <> 'admin'`, ou seja,
-- filtram pelo papel de HOJE, e nenhuma tem a trava de filial própria. Enquanto
-- todas as notas existentes forem de gente que estava na Matriz, os números
-- coincidem com o placar; no primeiro caso em que não coincidirem, a tela da
-- Matriz vai exibir um KPI que não bate com o pódio, e não haverá como saber
-- qual dos dois está certo. Uma régua só.
--
-- `WITH (security_invoker = true)` explícito: CREATE OR REPLACE VIEW não
-- carrega a opção sozinho e a view voltaria a rodar com os direitos do dono,
-- furando a RLS de quem lê — [[feedback_view_security_invoker]]. As colunas
-- são as mesmas e na mesma ordem, senão o REPLACE nem passa (42P16).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE VIEW public.avaliacoes_matriz_agregado
WITH (security_invoker = true) AS
  SELECT am.competicao_id,
         am.filial_avaliada,
         am.item_tipo,
         am.item_id,
         (count(*) FILTER (WHERE (am.nota IS NOT NULL)))::integer AS n_notas,
         round(avg(am.nota) FILTER (WHERE (am.nota IS NOT NULL)), 2) AS media_nota,
         (count(*) FILTER (WHERE (am.decisao = 'Aprovado'::text)))::integer AS n_aprovado,
         (count(*) FILTER (WHERE (am.decisao = 'Reprovado'::text)))::integer AS n_reprovado,
         (count(*))::integer AS n_total_avaliadores,
         max(am.updated_at) AS ultima_atualizacao
    FROM public.avaliacoes_matriz am
   WHERE am.ativo = true
     -- (612) Papel e vínculo congelados na nota, como no placar (609).
     AND COALESCE(am.avaliador_role, 'conselheiro') <> 'admin'
     AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
   GROUP BY am.competicao_id, am.filial_avaliada, am.item_tipo, am.item_id;

CREATE OR REPLACE VIEW public.avaliacoes_matriz_placar_filial
WITH (security_invoker = true) AS
  SELECT am.competicao_id,
         am.filial_avaliada,
         round(avg(am.nota) FILTER (WHERE (am.nota IS NOT NULL)), 2) AS media_nota_geral,
         (count(*) FILTER (WHERE (am.decisao = 'Aprovado'::text)))::integer AS itens_aprovados,
         (count(*) FILTER (WHERE (am.decisao = 'Reprovado'::text)))::integer AS itens_reprovados,
         CASE
           WHEN (count(*) FILTER (WHERE (am.decisao IS NOT NULL)) = 0) THEN NULL::numeric
           ELSE round(((100.0 * (count(*) FILTER (WHERE (am.decisao = 'Aprovado'::text)))::numeric)
                       / (NULLIF(count(*) FILTER (WHERE (am.decisao IS NOT NULL)), 0))::numeric), 2)
         END AS taxa_aprovacao_pct
    FROM public.avaliacoes_matriz am
   WHERE am.ativo = true
     AND COALESCE(am.avaliador_role, 'conselheiro') <> 'admin'
     AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
   GROUP BY am.competicao_id, am.filial_avaliada;

COMMIT;
