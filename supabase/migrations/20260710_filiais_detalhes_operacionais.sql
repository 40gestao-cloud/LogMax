-- =================================================================
-- LogMax — Detalhes operacionais da filial (plano de negócio)
-- =================================================================
-- Adiciona campos de "plano de negócio" ao cadastro de Filiais
-- (Empresa > Filiais): tamanho do espaço, tipo de imóvel, aluguel,
-- vagas, capacidade, horário de funcionamento, data de inauguração
-- e investimento inicial.
--
-- Mesmo padrão usado em produtos.atributos (PDV MaxLook/TechMax por
-- nicho): coluna jsonb única em vez de uma coluna por campo, pra não
-- exigir nova migração a cada informação adicional que surgir.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

ALTER TABLE filiais ADD COLUMN IF NOT EXISTS detalhes jsonb NOT NULL DEFAULT '{}'::jsonb;
