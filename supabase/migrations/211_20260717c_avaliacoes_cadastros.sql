-- =================================================================
-- Central de Avaliação — expandir para cadastros das filiais
--
-- Adiciona 5 novos item_tipo em avaliacoes_matriz:
--   cadastro_produto, cadastro_cliente, cadastro_fornecedor,
--   cadastro_servico, cadastro_categoria
--
-- Cadastros são operacionais (sem nota) — apenas Aprovado/Reprovado.
-- O CHECK chk_nota_apenas_criativos continua barrando nota nesses
-- tipos automaticamente.
--
-- Escopo: fila da Central mostra só cadastros criados DENTRO do
-- período da competição (mesma regra dos outros 8 tipos).
-- =================================================================

BEGIN;

ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS avaliacoes_matriz_item_tipo_check;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT avaliacoes_matriz_item_tipo_check
  CHECK (item_tipo IN (
    'requisicao','cotacao','promocao','arte','campanha',
    'pedido_venda','ferias','requerimento',
    'cadastro_produto','cadastro_cliente','cadastro_fornecedor',
    'cadastro_servico','cadastro_categoria'
  ));

COMMIT;
