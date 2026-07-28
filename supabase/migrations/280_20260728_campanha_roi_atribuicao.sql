-- Campanhas: "Receita Atribuída" passa a ser receita atribuível.
--
-- ACHADO (Etapa 6 do plano): a view `v_campanha_roi` soma como receita da
-- campanha TODA venda concluída da filial dentro da janela de datas — tenha
-- ela qualquer relação com a campanha ou nenhuma. O card da tela se chama
-- "Receita Atribuída" e o número embaixo é "vendas que aconteceram enquanto a
-- campanha existia". Duas campanhas simultâneas na mesma filial contam a mesma
-- venda duas vezes, cada uma exibindo o ROI inteiro.
--
-- Três defeitos no mesmo JOIN:
--
--   R1  atribuição por coincidência de calendário, não por vínculo. Numa base
--       com movimento, o ROI nasce inflado e nunca negativo.
--   R2  precedência de AND/OR: as condições `status = 'Concluída'` e
--       `ativo = true` pertencem só à primeira perna do OR. A perna do cupom
--       aceita venda cancelada ou inativa como receita.
--   R3  `created_at::date` é UTC (P12). Entre 19h e meia-noite no Acre a venda
--       cai no dia seguinte e entra ou sai da janela da campanha por engano.
--
-- Hoje o estrago é zero: nenhuma campanha coincide com vendas nas 4 turmas, e
-- todas mostram receita 0,00. É o próximo cruzamento que mentiria.
--
-- Depois desta migração:
--   receita / vendas_count / ticket_medio / roi_percent → só vendas com cupom
--       da campanha, concluídas e ativas. É o que "atribuída" quer dizer.
--   receita_periodo / vendas_periodo_count → o número antigo, agora com nome
--       honesto: o que a filial vendeu na janela, como contexto.
--
-- As colunas que a tela já consome continuam existindo com o mesmo nome e
-- tipo — nada quebra, o valor é que passa a ser verdadeiro.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE VIEW public.v_campanha_roi AS
WITH vendas_atribuidas AS (
  -- Vínculo real: a venda usou um cupom desta campanha.
  SELECT c.id            AS campanha_id,
         v.id            AS venda_id,
         v.total_final
    FROM public.marketing_campanhas c
    JOIN public.marketing_cupons cu ON cu.campanha_id = c.id
    JOIN public.vendas v            ON v.cupom_id     = cu.id
   WHERE v.status = 'Concluída'
     AND COALESCE(v.ativo, true)
),
vendas_periodo AS (
  -- Contexto: o que a filial vendeu na janela, com ou sem relação com a
  -- campanha. Data convertida para o fuso da operação.
  SELECT c.id            AS campanha_id,
         v.id            AS venda_id,
         v.total_final
    FROM public.marketing_campanhas c
    JOIN public.vendas v
      ON (v.created_at AT TIME ZONE 'America/Rio_Branco')::date
           BETWEEN c.data_inicio AND c.data_fim
     AND (c.filial IS NULL OR v.filial = c.filial)
   WHERE v.status = 'Concluída'
     AND COALESCE(v.ativo, true)
)
SELECT c.id,
       c.nome,
       c.filial,
       c.data_inicio,
       c.data_fim,
       c.status,
       c.orcamento,
       c.gasto_real,
       COALESCE(a.receita, 0)::numeric(15,2)  AS receita,
       COALESCE(a.n, 0)::integer              AS vendas_count,
       CASE WHEN COALESCE(a.n, 0) > 0
            THEN round(a.receita / a.n, 2)
            ELSE 0::numeric
       END                                    AS ticket_medio,
       CASE WHEN c.gasto_real > 0
            THEN round((COALESCE(a.receita, 0) - c.gasto_real) / c.gasto_real * 100, 2)
            ELSE NULL::numeric
       END                                    AS roi_percent,
       COALESCE(p.receita, 0)::numeric(15,2)  AS receita_periodo,
       COALESCE(p.n, 0)::integer              AS vendas_periodo_count
  FROM public.marketing_campanhas c
  LEFT JOIN (
    SELECT campanha_id, sum(total_final) AS receita, count(*) AS n
      FROM vendas_atribuidas GROUP BY 1
  ) a ON a.campanha_id = c.id
  LEFT JOIN (
    SELECT campanha_id, sum(total_final) AS receita, count(DISTINCT venda_id) AS n
      FROM vendas_periodo GROUP BY 1
  ) p ON p.campanha_id = c.id
 WHERE COALESCE(c.ativo, true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- A diferença entre as duas colunas é o tamanho da mentira anterior:
--   SELECT nome, filial, receita, vendas_count,
--          receita_periodo, vendas_periodo_count, roi_percent
--     FROM v_campanha_roi ORDER BY receita_periodo DESC;
--
--   -- Campanha sem nenhum cupom não tem como atribuir receita — se houver
--   -- muitas, o vínculo do modelo é o cupom e vale dizer isso na tela:
--   SELECT c.nome
--     FROM marketing_campanhas c
--    WHERE COALESCE(c.ativo,true)
--      AND NOT EXISTS (SELECT 1 FROM marketing_cupons cu WHERE cu.campanha_id = c.id);
-- ════════════════════════════════════════════════════════════════════════════
