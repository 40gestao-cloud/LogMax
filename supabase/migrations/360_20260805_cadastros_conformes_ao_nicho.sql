-- 360 — Cadastros: o que o sistema real pergunta
--
-- Auditoria dos 4 formulários de Cadastros contra o uso real das turmas:
--
--   form          SuperMax   MaxLook   TechMax   preenchimento
--   Categorias    genérico   genérico  genérico  —
--   Produtos      NENHUM     5 campos  8 campos  Super 0/149
--   Fornecedores  NENHUM     4 campos  4 campos  Tech 1/20, Super 0/24
--   Serviços      1 campo    3 campos  5 campos  Super 0/10
--
-- O SuperMax tem 149 dos 243 produtos da holding (61%) e era a única filial sem
-- ficha nenhuma. Isso está invertido: no varejo alimentar o cadastro de produto
-- é o **mais** exigente dos três, porque carrega perecibilidade, validade e
-- condição de armazenagem — nada disso existia, e é o que faz mercearia
-- trabalhar com PEPS enquanto loja de roupa não precisa. Os próprios dados já
-- apontavam: o SuperMax é o único com produto em KG e L.
--
-- ── O que muda no banco ─────────────────────────────────────────────────────
--
--   1. `fornecedores.prazo_entrega_dias` — sai de atributo de nicho e vira
--      **campo comum às três**. Prazo de entrega alimenta a cotação e a data
--      prometida ao requisitante: é do processo de compras, não do ramo. Ficava
--      escondido em `atributos` na MaxLook e na TechMax, e não existia no
--      SuperMax. O valor que já estava no jsonb é migrado, não redigitado.
--   2. `categorias_produto.margem_alvo` — markup por linha de produto. É a
--      regra que falta para a categoria deixar de ser cor e ícone: com o custo
--      preenchido, o cadastro de produto sugere o preço de venda. Formação de
--      preço é o que um curso de gestão quer ensinar, e hoje o aluno digitava
--      custo e preço sem nenhuma relação entre os dois.
--
-- A ficha de perecível do SuperMax (perecível / validade / armazenagem) NÃO
-- precisa de migração: vai em `produtos.atributos`, o mesmo jsonb que MaxLook e
-- TechMax já usam (migr. do PDV por nicho). Fica **opcional**, de propósito —
-- 149 produtos já cadastrados ficariam incompletos de um dia para o outro, e
-- campo que trava sem informar é como nasce o "nao temos ou acabou" da 358.

BEGIN;

-- ── 1. Prazo de entrega do fornecedor ────────────────────────────────────────

ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS prazo_entrega_dias integer;

COMMENT ON COLUMN public.fornecedores.prazo_entrega_dias IS
  'Prazo médio de entrega em dias. Campo comum às 3 filiais: alimenta a cotação e a data prometida ao requisitante.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fornecedores_prazo_entrega_check') THEN
    ALTER TABLE public.fornecedores
      ADD CONSTRAINT fornecedores_prazo_entrega_check
      CHECK (prazo_entrega_dias IS NULL OR (prazo_entrega_dias >= 0 AND prazo_entrega_dias <= 365));
  END IF;
END $$;

-- Migra o que já estava no jsonb — MaxLook preencheu 17/17, seria absurdo
-- pedir que redigitassem. A chave é a mesma nas duas filiais.
UPDATE public.fornecedores
   SET prazo_entrega_dias = NULLIF(btrim(atributos->>'prazo_entrega_dias'), '')::integer
 WHERE prazo_entrega_dias IS NULL
   AND atributos ? 'prazo_entrega_dias'
   AND NULLIF(btrim(atributos->>'prazo_entrega_dias'), '') ~ '^[0-9]{1,3}$';

-- E some do jsonb, senão passam a existir duas verdades para o mesmo dado.
UPDATE public.fornecedores
   SET atributos = atributos - 'prazo_entrega_dias'
 WHERE atributos ? 'prazo_entrega_dias';

-- ── 2. Margem-alvo por categoria ─────────────────────────────────────────────

ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS margem_alvo numeric(5,2);

COMMENT ON COLUMN public.categorias_produto.margem_alvo IS
  'Markup-alvo da linha, em %. Sugere o preço de venda a partir do custo no cadastro de produto. NULL = categoria sem regra, o preço fica livre.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorias_margem_alvo_check') THEN
    ALTER TABLE public.categorias_produto
      ADD CONSTRAINT categorias_margem_alvo_check
      CHECK (margem_alvo IS NULL OR (margem_alvo >= 0 AND margem_alvo <= 900));
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verificação ──────────────────────────────────────────────────────────────
SELECT filial,
       count(*)                                            AS fornecedores,
       count(*) FILTER (WHERE prazo_entrega_dias IS NOT NULL) AS com_prazo,
       count(*) FILTER (WHERE atributos ? 'prazo_entrega_dias') AS ainda_no_jsonb
  FROM public.fornecedores WHERE COALESCE(ativo, true)
 GROUP BY 1 ORDER BY 1;
