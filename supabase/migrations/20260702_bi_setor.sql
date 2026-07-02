-- Adiciona coluna `setor` em relatorios_bi para suportar relatórios focados
-- por área (vendas, financeiro, rh, estoque, marketing) além da visão geral.
-- DEFAULT 'geral' mantém compatibilidade com registros existentes.

ALTER TABLE relatorios_bi
  ADD COLUMN IF NOT EXISTS setor text NOT NULL DEFAULT 'geral';

-- Índice para o cache lookup (gerado_por + período + setor)
CREATE INDEX IF NOT EXISTS idx_relatorios_bi_setor
  ON relatorios_bi (gerado_por, periodo_inicio, periodo_fim, setor)
  WHERE ativo = true;
