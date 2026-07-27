-- ============================================================
--  LogMax — ROLLBACK do hardening RLS (2026-05-16)
--
--  Aplicar SÓ em emergência se o hardening quebrar fluxos em produção.
--  Restaura o estado anterior: "auth_all" em todas as tabelas com
--  USING (true) — qualquer authenticated lê/escreve tudo.
--
--  Idempotente. Aplicar no Supabase SQL Editor.
-- ============================================================

BEGIN;

-- 1. Drop policies do hardening
DROP POLICY IF EXISTS "read_authenticated"  ON filiais;
DROP POLICY IF EXISTS "write_admin_empresa" ON filiais;
DROP POLICY IF EXISTS "read_authenticated"  ON colaboradores;
DROP POLICY IF EXISTS "write_admin_empresa" ON colaboradores;
DROP POLICY IF EXISTS "read_authenticated"  ON clientes;
DROP POLICY IF EXISTS "write_clientes"      ON clientes;
DROP POLICY IF EXISTS "read_authenticated"  ON fornecedores;
DROP POLICY IF EXISTS "write_fornecedores"  ON fornecedores;
DROP POLICY IF EXISTS "read_authenticated"  ON produtos;
DROP POLICY IF EXISTS "write_produtos"      ON produtos;
DROP POLICY IF EXISTS "update_produtos"     ON produtos;
DROP POLICY IF EXISTS "delete_produtos"     ON produtos;
DROP POLICY IF EXISTS "read_authenticated"  ON servicos;
DROP POLICY IF EXISTS "write_servicos"      ON servicos;
DROP POLICY IF EXISTS "read_authenticated"  ON centros_custo;
DROP POLICY IF EXISTS "write_admin"         ON centros_custo;
DROP POLICY IF EXISTS "read_authenticated"  ON projetos;
DROP POLICY IF EXISTS "write_admin"         ON projetos;
DROP POLICY IF EXISTS "read_authenticated"  ON condicoes_pagamento;
DROP POLICY IF EXISTS "write_financ"        ON condicoes_pagamento;
DROP POLICY IF EXISTS "read_authenticated"  ON classificacoes_auxiliares;
DROP POLICY IF EXISTS "write_admin"         ON classificacoes_auxiliares;
DROP POLICY IF EXISTS "read_authenticated"  ON mapeamentos_rateio;
DROP POLICY IF EXISTS "write_financ"        ON mapeamentos_rateio;
DROP POLICY IF EXISTS "read_authenticated"  ON formas_pagamento;
DROP POLICY IF EXISTS "write_financ"        ON formas_pagamento;

DROP POLICY IF EXISTS "compras_select" ON requisicoes;
DROP POLICY IF EXISTS "compras_insert" ON requisicoes;
DROP POLICY IF EXISTS "compras_update" ON requisicoes;
DROP POLICY IF EXISTS "compras_delete" ON requisicoes;
DROP POLICY IF EXISTS "compras_all"    ON aprovacoes_compras;
DROP POLICY IF EXISTS "compras_all"    ON cotacoes;
DROP POLICY IF EXISTS "compras_all"    ON pedidos;
DROP POLICY IF EXISTS "compras_all"    ON recebimentos;
DROP POLICY IF EXISTS "compras_all"    ON notas_recebidas;

DROP POLICY IF EXISTS "logist_select" ON requisicoes_estoque;
DROP POLICY IF EXISTS "logist_insert" ON requisicoes_estoque;
DROP POLICY IF EXISTS "logist_update" ON requisicoes_estoque;
DROP POLICY IF EXISTS "logist_delete" ON requisicoes_estoque;
DROP POLICY IF EXISTS "logist_all"    ON aprovacoes_estoque;
DROP POLICY IF EXISTS "logist_all"    ON expedicao;
DROP POLICY IF EXISTS "mov_select"    ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_insert"    ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_update"    ON movimentacoes_estoque;
DROP POLICY IF EXISTS "mov_delete"    ON movimentacoes_estoque;
DROP POLICY IF EXISTS "logist_all"    ON inventarios;
DROP POLICY IF EXISTS "logist_all"    ON vencimentos_estoque;

DROP POLICY IF EXISTS "fin_select"  ON contas_pagar;
DROP POLICY IF EXISTS "fin_insert"  ON contas_pagar;
DROP POLICY IF EXISTS "fin_update"  ON contas_pagar;
DROP POLICY IF EXISTS "fin_delete"  ON contas_pagar;
DROP POLICY IF EXISTS "fin_select"  ON contas_receber;
DROP POLICY IF EXISTS "fin_insert"  ON contas_receber;
DROP POLICY IF EXISTS "fin_update"  ON contas_receber;
DROP POLICY IF EXISTS "fin_delete"  ON contas_receber;
DROP POLICY IF EXISTS "fin_all"     ON duplicatas;
DROP POLICY IF EXISTS "fin_all"     ON caixa_bancos;
DROP POLICY IF EXISTS "fin_all"     ON previsoes;
DROP POLICY IF EXISTS "fin_all"     ON integracoes_bancarias;
DROP POLICY IF EXISTS "fin_all"     ON controle_caixa;

DROP POLICY IF EXISTS "rh_all" ON folha_pagamento;
DROP POLICY IF EXISTS "rh_all" ON funcionarios;
DROP POLICY IF EXISTS "rh_all" ON departamentos;
DROP POLICY IF EXISTS "rh_all" ON cargos;
DROP POLICY IF EXISTS "rh_all" ON ferias;
DROP POLICY IF EXISTS "rh_all" ON beneficios;
DROP POLICY IF EXISTS "rh_all" ON treinamentos;

DROP POLICY IF EXISTS "ponto_select"   ON ponto_eletronico;
DROP POLICY IF EXISTS "ponto_insert"   ON ponto_eletronico;
DROP POLICY IF EXISTS "ponto_modify"   ON ponto_eletronico;
DROP POLICY IF EXISTS "ponto_delete"   ON ponto_eletronico;
DROP POLICY IF EXISTS "pontoqr_select" ON ponto_qr_registros;
DROP POLICY IF EXISTS "pontoqr_insert" ON ponto_qr_registros;
DROP POLICY IF EXISTS "pontoqr_modify" ON ponto_qr_registros;
DROP POLICY IF EXISTS "pontoqr_delete" ON ponto_qr_registros;

DROP POLICY IF EXISTS "vendas_select" ON vendas;
DROP POLICY IF EXISTS "vendas_write"  ON vendas;
DROP POLICY IF EXISTS "itens_select"  ON itens_venda;
DROP POLICY IF EXISTS "itens_write"   ON itens_venda;

DROP POLICY IF EXISTS "mkt_select" ON marketing_promocoes;
DROP POLICY IF EXISTS "mkt_insert" ON marketing_promocoes;
DROP POLICY IF EXISTS "mkt_update" ON marketing_promocoes;
DROP POLICY IF EXISTS "mkt_delete" ON marketing_promocoes;
DROP POLICY IF EXISTS "mkt_select" ON marketing_tarefas;
DROP POLICY IF EXISTS "mkt_insert" ON marketing_tarefas;
DROP POLICY IF EXISTS "mkt_update" ON marketing_tarefas;
DROP POLICY IF EXISTS "mkt_delete" ON marketing_tarefas;

DROP POLICY IF EXISTS "up_select_own_or_scope" ON user_profiles;
DROP POLICY IF EXISTS "up_update_own_or_admin" ON user_profiles;

-- 2. Restaurar "auth_all" original (USING true)
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
CREATE POLICY "auth_all" ON requisicoes               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON aprovacoes_compras        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON cotacoes                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON pedidos                   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON recebimentos              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON notas_recebidas           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON requisicoes_estoque       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON aprovacoes_estoque        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON expedicao                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON movimentacoes_estoque     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inventarios               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON vencimentos_estoque       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON contas_receber            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON contas_pagar              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON duplicatas                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON caixa_bancos              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON previsoes                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON integracoes_bancarias     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Tabelas que estavam sem RLS antes — desligar
ALTER TABLE user_profiles        DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendas               DISABLE ROW LEVEL SECURITY;
ALTER TABLE itens_venda          DISABLE ROW LEVEL SECURITY;
ALTER TABLE controle_caixa       DISABLE ROW LEVEL SECURITY;
ALTER TABLE folha_pagamento      DISABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios         DISABLE ROW LEVEL SECURITY;
ALTER TABLE departamentos        DISABLE ROW LEVEL SECURITY;
ALTER TABLE cargos               DISABLE ROW LEVEL SECURITY;
ALTER TABLE ferias               DISABLE ROW LEVEL SECURITY;
ALTER TABLE beneficios           DISABLE ROW LEVEL SECURITY;
ALTER TABLE treinamentos         DISABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_eletronico     DISABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_qr_registros   DISABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_promocoes  DISABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_tarefas    DISABLE ROW LEVEL SECURITY;

-- 4. Drop helpers
DROP FUNCTION IF EXISTS public.auth_in_setor(text[]);
DROP FUNCTION IF EXISTS public.auth_is_admin();
DROP FUNCTION IF EXISTS public.auth_user_setor();
DROP FUNCTION IF EXISTS public.auth_user_role();

COMMIT;
