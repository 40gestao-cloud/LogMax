-- 421_20260814_escolher_fornecedor_deixa_de_ser_so_preco.sql
--
-- COMPRAR PELO MENOR PREÇO É METADE DA DECISÃO.
--
-- O mapa comparativo de Cotações mostra três propostas e destaca a mais barata
-- com um troféu. É a única informação que o aluno tem para escolher — e no
-- mundo real quem entrega com 20 dias de atraso custa mais caro que a proposta
-- que era R$ 200 mais alta, porque a loja fica sem o produto na prateleira.
--
-- Até a migr. 418 não dava para fazer diferente: o pedido não guardava quando
-- a carga chegou, então não havia como dizer se o fornecedor cumpriu o prazo.
-- Agora `pedidos.prazo_entrega` e `pedidos.recebido_em` existem lado a lado, e
-- a pontualidade é uma subtração.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ENTRA NA CONTA
--
-- Só pedido RECEBIDO, com prazo prometido E data de chegada. Pedido sem prazo
-- não pode acusar ninguém de atraso, e pedido em aberto ainda não é entrega —
-- ele aparece à parte, em `em_atraso_agora`, que é a cobrança de hoje e não o
-- histórico.
--
-- `atraso_medio_dias` conta a entrega no prazo como zero, e não como número
-- negativo: entregar quatro dias adiantado não compensa atrasar quatro noutro
-- pedido. Quem chega antes aparece em `pontualidade_pct`, que é onde essa
-- virtude cabe.
--
-- VIEW, não tabela com gatilho. O número é derivado de dados que já existem;
-- materializar criaria uma segunda verdade para manter sincronizada, e o
-- volume de uma turma cabe folgado num agregado ao vivo.
--
-- `security_invoker` declarado dentro do CREATE: sem isso a view roda com os
-- direitos do dono e entrega o histórico de compras de uma filial para quem a
-- RLS de `pedidos` barra.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DROP VIEW IF EXISTS public.v_fornecedor_desempenho;

CREATE VIEW public.v_fornecedor_desempenho
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    p.fornecedor_id,
    p.filial,
    p.status,
    p.valor_total,
    p.prazo_entrega,
    p.recebido_em,
    -- Entrega avaliável: fechou como Recebido e tem as duas datas.
    (p.status = 'Recebido'
      AND p.prazo_entrega IS NOT NULL
      AND p.recebido_em   IS NOT NULL) AS avaliavel,
    -- Ainda em aberto e já passou da data prometida.
    (p.status NOT IN ('Recebido', 'Cancelado')
      AND p.prazo_entrega IS NOT NULL
      AND p.prazo_entrega < public.acre_today()) AS atrasado_agora
    FROM public.pedidos p
   WHERE p.ativo = true
     AND p.fornecedor_id IS NOT NULL
)
SELECT
  b.fornecedor_id,
  b.filial,
  COUNT(*) FILTER (WHERE b.avaliavel)::integer AS entregas,
  COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)::integer AS entregas_no_prazo,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              100.0 * COUNT(*) FILTER (WHERE b.avaliavel AND b.recebido_em <= b.prazo_entrega)
              / COUNT(*) FILTER (WHERE b.avaliavel), 0)
  END AS pontualidade_pct,
  CASE WHEN COUNT(*) FILTER (WHERE b.avaliavel) > 0
       THEN ROUND(
              AVG(GREATEST(b.recebido_em - b.prazo_entrega, 0))
                FILTER (WHERE b.avaliavel), 1)
  END AS atraso_medio_dias,
  COALESCE(MAX(GREATEST(b.recebido_em - b.prazo_entrega, 0))
             FILTER (WHERE b.avaliavel), 0)::integer AS pior_atraso_dias,
  COUNT(*) FILTER (WHERE b.atrasado_agora)::integer AS em_atraso_agora,
  COUNT(*) FILTER (WHERE b.status NOT IN ('Recebido', 'Cancelado'))::integer AS pedidos_em_aberto,
  MAX(b.recebido_em) FILTER (WHERE b.avaliavel) AS ultima_entrega_em,
  COALESCE(SUM(b.valor_total) FILTER (WHERE b.status = 'Recebido'), 0)::numeric(15,2) AS total_comprado
  FROM base b
 GROUP BY b.fornecedor_id, b.filial;

COMMENT ON VIEW public.v_fornecedor_desempenho IS
  'Pontualidade e volume por fornecedor, a partir de pedidos.prazo_entrega x pedidos.recebido_em (migr. 418). Fornecedor sem entrega fechada não aparece — é "sem histórico", não "ruim".';

COMMIT;

NOTIFY pgrst, 'reload schema';
