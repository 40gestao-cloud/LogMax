-- 488 — O fornecedor no cadastro de produto passa a ser sugestão, não pré-requisito.
--
-- A migr. 480 inverteu a ordem canônica: o produto existe ANTES da compra,
-- porque é o código dele que entra no pedido. O cadastro, porém, continuou
-- cobrando `Fornecedor *` — e antes da compra ninguém sabe quem vai fornecer:
-- é a cotação que decide, comparando propostas. Campo obrigatório nessa posição
-- só produz nome escolhido no chute, do mesmo jeito que o preço de custo
-- obrigatório produzia número inventado (o 480 já tinha soltado o custo).
--
-- Pior: `produtos.fornecedor` guarda TEXTO (o nome), não a chave. Então o
-- trabalho de escolher no cadastro não chegava à cotação — o comprador
-- selecionava tudo de novo, do zero. Esta migração cria o elo de verdade
-- (`fornecedor_id`) para que o cadastro sirva de sugestão na cotação, e mantém
-- a coluna de texto porque a busca por trigram (migr. 028), o export da grade e
-- a ficha do catálogo leem dela.
--
-- Em ERP real o mestre de material (MM01 no SAP, SB1 no Protheus) não tem
-- fornecedor: o vínculo mora no registro-info / lista de fontes, e nasce da
-- cotação aprovada. É esse o comportamento que fica.

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid;

-- ON DELETE SET NULL: fornecedor descadastrado não deve travar o catálogo — o
-- produto continua existindo, só perde a sugestão.
DO $$
BEGIN
  ALTER TABLE public.produtos
    ADD CONSTRAINT produtos_fornecedor_id_fkey
    FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedores(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor_id
  ON public.produtos (fornecedor_id)
  WHERE fornecedor_id IS NOT NULL;

COMMENT ON COLUMN public.produtos.fornecedor_id IS
  'Fornecedor habitual — SUGESTÃO opcional que pré-seleciona a cotação (migr. 488). '
  'Quem fornece de fato é decidido na cotação aprovada, não aqui.';

COMMENT ON COLUMN public.produtos.fornecedor IS
  'Nome do fornecedor habitual, denormalizado de fornecedor_id para a busca '
  'trigram (migr. 028), o export e a ficha do catálogo. Opcional desde a 488.';

-- Backfill: casa o texto já gravado com o cadastro da mesma unidade. Só quando
-- o nome resolve para UM fornecedor — homônimo dentro da filial fica em branco
-- em vez de apontar para o errado, e o próximo save conserta.
UPDATE public.produtos p
   SET fornecedor_id = m.id
  FROM (
    -- array_agg[1] e nao min(): uuid nao tem operador de ordenacao
    -- agregavel, e o HAVING abaixo garante que so ha um elemento.
    SELECT f.filial, f.nome, (array_agg(f.id))[1] AS id
      FROM public.fornecedores f
     WHERE f.excluido_em IS NULL
     GROUP BY f.filial, f.nome
    HAVING count(*) = 1
  ) m
 WHERE p.fornecedor_id IS NULL
   AND coalesce(btrim(p.fornecedor), '') <> ''
   AND m.nome = p.fornecedor
   AND m.filial IS NOT DISTINCT FROM p.filial;

-- Coluna nova só aparece no PostgREST depois do reload (ver feedback do PGRST202).
NOTIFY pgrst, 'reload schema';
