-- 338 — Pedido de venda ganha número: PV-SM-2026-0001.
--
-- Fecha o par com o pedido de compra (PC, migr. 336). São documentos irmãos e
-- opostos — um compromete dinheiro, o outro traz —, e ter só um deles numerado
-- deixaria o aluno com dois vocabulários para a mesma palavra "pedido".
--
-- É o documento que o cliente cita: "cadê o meu pedido?" tem resposta quando
-- existe PV-SM-2026-0042 para procurar. Numerar pedido de venda é o que
-- qualquer ERP faz, e por esse motivo.
--
-- Sem função nova: o trigger genérico da 336 recebe prefixo e chave do contador
-- por argumento. Era esse o teste do desenho — se precisasse de código novo
-- aqui, o genérico não seria genérico.

BEGIN;

ALTER TABLE public.pedidos_venda ADD COLUMN IF NOT EXISTS numero text;

DROP TRIGGER IF EXISTS trg_numero_documento ON public.pedidos_venda;
CREATE TRIGGER trg_numero_documento BEFORE INSERT ON public.pedidos_venda
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_documento('PV', 'pedidos_venda');

WITH numerados AS (
  SELECT id, filial, extract(year FROM created_at)::integer AS ano,
         row_number() OVER (PARTITION BY filial, extract(year FROM created_at)
                            ORDER BY created_at NULLS LAST, id)::integer AS seq
    FROM public.pedidos_venda WHERE numero IS NULL
)
UPDATE public.pedidos_venda pv
   SET numero = public.formatar_numero_documento('PV', n.filial, n.ano, n.seq)
  FROM numerados n WHERE n.id = pv.id;

INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
SELECT 'pedidos_venda', filial, extract(year FROM created_at)::integer, count(*)::integer
  FROM public.pedidos_venda WHERE numero IS NOT NULL
 GROUP BY filial, extract(year FROM created_at)
ON CONFLICT (entidade, filial, ano)
DO UPDATE SET ultimo = greatest(public.documento_sequencias.ultimo, excluded.ultimo);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_venda_numero
  ON public.pedidos_venda (numero) WHERE numero IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   SELECT count(*) FROM pedidos_venda WHERE numero IS NULL;  -- 0
--   SELECT entidade, filial, ano, ultimo FROM documento_sequencias ORDER BY 1, 2;
--
-- O orçamento continua sem número de propósito: ele é proposta, e vira pedido
-- quando o cliente aceita. Numerar os dois faria o mesmo negócio ter duas
-- identidades circulando ao mesmo tempo — se a turma sentir falta, aí sim vale
-- um prefixo próprio (ORC), com esta mesma migração de três linhas.
