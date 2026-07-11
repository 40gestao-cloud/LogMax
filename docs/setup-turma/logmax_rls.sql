-- ============================================================
--  LOGMAX — Row Level Security (RLS)
--  Execute no SQL Editor do Supabase APÓS criar as tabelas.
--  Estratégia: acesso total para usuários autenticados.
--  Usuários anônimos não conseguem ler nem escrever nenhuma tabela.
-- ============================================================

-- ─────────────────────────────────────────────
--  1. Habilitar RLS em todas as tabelas
-- ─────────────────────────────────────────────

ALTER TABLE filiais                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE colaboradores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE centros_custo             ENABLE ROW LEVEL SECURITY;
ALTER TABLE projetos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE condicoes_pagamento       ENABLE ROW LEVEL SECURITY;
ALTER TABLE classificacoes_auxiliares ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapeamentos_rateio        ENABLE ROW LEVEL SECURITY;
ALTER TABLE formas_pagamento          ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovacoes_compras        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recebimentos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_recebidas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes_estoque       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovacoes_estoque        ENABLE ROW LEVEL SECURITY;
ALTER TABLE expedicao                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_estoque     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventarios               ENABLE ROW LEVEL SECURITY;
ALTER TABLE vencimentos_estoque       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_receber            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_pagar              ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicatas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_bancos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE previsoes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE integracoes_bancarias     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
--  2. Criar políticas: apenas usuários autenticados têm acesso total
-- ─────────────────────────────────────────────

-- Módulo: Empresa
CREATE POLICY "auth_all" ON filiais                   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON colaboradores             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON clientes                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON fornecedores              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON produtos                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON servicos                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON centros_custo             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON projetos                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON condicoes_pagamento       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON classificacoes_auxiliares FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON mapeamentos_rateio        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON formas_pagamento          FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Módulo: Compras
CREATE POLICY "auth_all" ON requisicoes               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON aprovacoes_compras        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON cotacoes                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON pedidos                   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON recebimentos              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON notas_recebidas           FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Módulo: Estoque
CREATE POLICY "auth_all" ON requisicoes_estoque       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON aprovacoes_estoque        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON expedicao                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON movimentacoes_estoque     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inventarios               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON vencimentos_estoque       FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Módulo: Financeiro
CREATE POLICY "auth_all" ON contas_receber            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON contas_pagar              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON duplicatas                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON caixa_bancos              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON previsoes                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON integracoes_bancarias     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────
--  COMO USAR
--  1. Acesse: https://supabase.com/dashboard/project/<seu-projeto>/sql
--  2. Cole este arquivo e execute.
--  3. Verifique em Authentication > Policies que cada tabela
--     mostra "1 policy" com o nome "auth_all".
-- ─────────────────────────────────────────────
