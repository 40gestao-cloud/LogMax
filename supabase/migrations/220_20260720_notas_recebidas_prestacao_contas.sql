-- =================================================================
-- LogMax — Notas Recebidas: prestação de contas do Capital Inicial
-- =================================================================
-- Contexto: hoje `notas_recebidas` guarda só (numero_nf, fornecedor,
-- valor, data, status) — não amarra COM O QUE a filial gastou nem
-- diferencia gasto operacional de aplicação do Capital Inicial que a
-- Matriz aportou. Estende a tabela para:
--
--   • categoria_gasto  — Produto/Equipamento/Mobiliário/Aluguel/
--                        Serviço/Outro (obrigatório em novas NFs)
--   • descricao        — texto livre do que foi comprado
--   • conta_pagar_id   — FK opcional pra amarrar com a saída de caixa
--                        (auto-flow do PDV / Compras já grava
--                        contas_pagar; nota fica apontando pra ela)
--   • capital_origem   — marca "este gasto saiu do Capital aportado
--                        pela Matriz", pra o painel Matriz de
--                        prestação de contas somar só o que interessa
--
-- RLS: gerente_ve_tudo (mig. 187) já cobre notas_recebidas com
-- write_admin_empresa por padrão canônico — não altera.
--
-- Idempotente.
-- =================================================================

BEGIN;

ALTER TABLE public.notas_recebidas
  ADD COLUMN IF NOT EXISTS categoria_gasto text,
  ADD COLUMN IF NOT EXISTS descricao       text,
  ADD COLUMN IF NOT EXISTS conta_pagar_id  uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capital_origem  boolean NOT NULL DEFAULT false;

-- CHECK controlado (nulo permitido enquanto backfill não é obrigatório).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_notas_recebidas_categoria'
  ) THEN
    ALTER TABLE public.notas_recebidas
      ADD CONSTRAINT chk_notas_recebidas_categoria CHECK (
        categoria_gasto IS NULL OR categoria_gasto IN
        ('Produto', 'Equipamento', 'Mobiliário', 'Aluguel', 'Serviço', 'Outro')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notas_recebidas_filial_categoria
  ON public.notas_recebidas (filial, categoria_gasto)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_notas_recebidas_capital_origem
  ON public.notas_recebidas (filial, capital_origem)
  WHERE ativo = true AND capital_origem = true;

COMMIT;
