-- 342 — Orçamento ganha número: ORC-SM-2026-0001.
--
-- Deixei de fora na 338 com um argumento que continua válido pela metade:
-- orçamento é proposta, vira pedido quando o cliente aceita, e numerar os dois
-- faz o mesmo negócio circular com duas identidades. Isso vale quando o
-- orçamento é rascunho interno.
--
-- Não vale quando ele é documento que VAI AO CLIENTE — e é esse o papel dele
-- aqui: Vendas monta, o Financeiro aprova, e a proposta é apresentada antes de
-- virar pedido. Documento que sai da empresa precisa de número, porque é por
-- ele que o cliente responde ("estou ligando sobre o orçamento tal"). Sem isso,
-- a referência vira o nome do cliente, que não identifica nada quando ele pede
-- três coisas diferentes no mesmo mês.
--
-- As duas identidades deixam de ser problema porque cada uma nomeia um momento:
-- ORC é o que foi proposto, PV é o que foi vendido. O pedido continua guardando
-- de qual orçamento nasceu.
--
-- Sem função nova: trigger genérico da 336, prefixo e contador por argumento.

BEGIN;

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS numero text;

DROP TRIGGER IF EXISTS trg_numero_documento ON public.orcamentos;
CREATE TRIGGER trg_numero_documento BEFORE INSERT ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_documento('ORC', 'orcamentos');

WITH numerados AS (
  SELECT id, filial, extract(year FROM created_at)::integer AS ano,
         row_number() OVER (PARTITION BY filial, extract(year FROM created_at)
                            ORDER BY created_at NULLS LAST, id)::integer AS seq
    FROM public.orcamentos WHERE numero IS NULL
)
UPDATE public.orcamentos o
   SET numero = public.formatar_numero_documento('ORC', n.filial, n.ano, n.seq)
  FROM numerados n WHERE n.id = o.id;

INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
SELECT 'orcamentos', filial, extract(year FROM created_at)::integer, count(*)::integer
  FROM public.orcamentos WHERE numero IS NOT NULL
 GROUP BY filial, extract(year FROM created_at)
ON CONFLICT (entidade, filial, ano)
DO UPDATE SET ultimo = greatest(public.documento_sequencias.ultimo, excluded.ultimo);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orcamentos_numero
  ON public.orcamentos (numero) WHERE numero IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   SELECT count(*) FROM orcamentos WHERE numero IS NULL;  -- 0
--   SELECT entidade, filial, ano, ultimo FROM documento_sequencias ORDER BY 1, 2;
--
-- Com isto, os cinco documentos do fluxo têm número: REQ, COT, PC (compras) e
-- ORC, PV (vendas).
