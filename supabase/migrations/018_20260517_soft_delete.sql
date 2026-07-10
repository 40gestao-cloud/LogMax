-- =================================================================
-- LogMax — Soft Delete global (coluna `ativo`)
-- =================================================================
-- Substitui o hard delete por exclusão lógica nas tabelas principais.
-- Preserva o histórico operacional (vendas canceladas, requisições
-- arquivadas, etc.) e elimina cascata de erros de FK quando o usuário
-- tenta apagar registros já referenciados.
--
-- Padrão:
--   ativo BOOLEAN NOT NULL DEFAULT true
--   Excluir = UPDATE SET ativo = false
--   Listagens filtram .eq('ativo', true) automaticamente
--
-- Idempotente (ADD COLUMN IF NOT EXISTS).
--
-- Tabelas SEM ativo (mantém hard delete):
--   user_profiles, configuracoes, itens_venda, pix_pendentes,
--   pesquisa_*, avaliacoes, criterios_avaliacao, feedbacks_avaliacao,
--   ciclos_avaliacao, ponto_qr_registros, aprovacoes_compras,
--   aprovacoes_estoque, ponto_eletronico.
-- (Auxiliares de auditoria / cascade de pais; soft delete não faz sentido.)
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- Cadastros / catálogos
ALTER TABLE filiais                   ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE colaboradores             ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE clientes                  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE fornecedores              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE produtos                  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE servicos                  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE centros_custo             ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE projetos                  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE condicoes_pagamento       ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE classificacoes_auxiliares ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE mapeamentos_rateio        ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE formas_pagamento          ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cargos                    ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE departamentos             ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE beneficios                ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE caixa_bancos              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE funcionarios              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Compras
ALTER TABLE requisicoes               ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cotacoes                  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pedidos                   ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE recebimentos              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notas_recebidas           ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Estoque
ALTER TABLE requisicoes_estoque       ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expedicao                 ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE movimentacoes_estoque     ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE inventarios               ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE vencimentos_estoque       ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Financeiro
ALTER TABLE contas_receber            ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE contas_pagar              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE duplicatas                ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE previsoes                 ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE controle_caixa            ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE integracoes_bancarias     ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- RH
ALTER TABLE folha_pagamento           ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ferias                    ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE treinamentos              ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Vendas
ALTER TABLE vendas                    ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Marketing
ALTER TABLE marketing_promocoes       ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE marketing_tarefas         ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Tarefas genéricas
ALTER TABLE tarefas                   ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- Índice composto: a maioria das queries vai filtrar `ativo = true` ordenando
-- por `created_at`. Índices parciais cobrem o caso comum sem inchar.
CREATE INDEX IF NOT EXISTS idx_produtos_ativo_created      ON produtos(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_clientes_ativo_created      ON clientes(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_fornecedores_ativo_created  ON fornecedores(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_funcionarios_ativo_created  ON funcionarios(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_requisicoes_ativo_created   ON requisicoes(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_vendas_ativo_created        ON vendas(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_contas_receber_ativo_created ON contas_receber(created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_contas_pagar_ativo_created   ON contas_pagar(created_at DESC) WHERE ativo;

COMMIT;
