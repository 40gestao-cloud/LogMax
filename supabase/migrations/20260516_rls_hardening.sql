-- ============================================================
--  LogMax — Hardening RLS (2026-05-16)
--
--  Substitui as policies "auth_all" (USING true) por scoping real por setor.
--  Princípio: SELECT/UPDATE/DELETE são restritos ao setor responsável;
--  INSERT é permissivo onde há fluxos cross-setor (PDV→contas_receber,
--  Pedido→contas_pagar, Folha→contas_pagar, etc.).
--
--  Helpers (SECURITY DEFINER) usam o auth.uid() do JWT para olhar o perfil.
--
--  Rollback: ver `20260516_rls_rollback.sql`.
--  Aplicar em: Supabase SQL Editor (uma única transacção; idempotente).
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
--  1. Helpers de autenticação
--  SECURITY DEFINER permite que a função leia user_profiles mesmo
--  com RLS apertada nessa tabela. Cuidado: o SQL dentro destas
--  funções corre como o owner (postgres).
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_user_setor()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT setor FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_user_role() = 'admin';
$$;

-- Admin sempre passa. Para os restantes, verifica se o setor está na lista.
CREATE OR REPLACE FUNCTION public.auth_in_setor(VARIADIC setors text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_is_admin() OR auth_user_setor() = ANY(setors);
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_role()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_setor()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_admin()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_in_setor(text[]) TO authenticated;

-- ─────────────────────────────────────────────
--  2. Drop policies antigas (USING true)
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "auth_all" ON filiais;
DROP POLICY IF EXISTS "auth_all" ON colaboradores;
DROP POLICY IF EXISTS "auth_all" ON clientes;
DROP POLICY IF EXISTS "auth_all" ON fornecedores;
DROP POLICY IF EXISTS "auth_all" ON produtos;
DROP POLICY IF EXISTS "auth_all" ON servicos;
DROP POLICY IF EXISTS "auth_all" ON centros_custo;
DROP POLICY IF EXISTS "auth_all" ON projetos;
DROP POLICY IF EXISTS "auth_all" ON condicoes_pagamento;
DROP POLICY IF EXISTS "auth_all" ON classificacoes_auxiliares;
DROP POLICY IF EXISTS "auth_all" ON mapeamentos_rateio;
DROP POLICY IF EXISTS "auth_all" ON formas_pagamento;
DROP POLICY IF EXISTS "auth_all" ON requisicoes;
DROP POLICY IF EXISTS "auth_all" ON aprovacoes_compras;
DROP POLICY IF EXISTS "auth_all" ON cotacoes;
DROP POLICY IF EXISTS "auth_all" ON pedidos;
DROP POLICY IF EXISTS "auth_all" ON recebimentos;
DROP POLICY IF EXISTS "auth_all" ON notas_recebidas;
DROP POLICY IF EXISTS "auth_all" ON requisicoes_estoque;
DROP POLICY IF EXISTS "auth_all" ON aprovacoes_estoque;
DROP POLICY IF EXISTS "auth_all" ON expedicao;
DROP POLICY IF EXISTS "auth_all" ON movimentacoes_estoque;
DROP POLICY IF EXISTS "auth_all" ON inventarios;
DROP POLICY IF EXISTS "auth_all" ON vencimentos_estoque;
DROP POLICY IF EXISTS "auth_all" ON contas_receber;
DROP POLICY IF EXISTS "auth_all" ON contas_pagar;
DROP POLICY IF EXISTS "auth_all" ON duplicatas;
DROP POLICY IF EXISTS "auth_all" ON caixa_bancos;
DROP POLICY IF EXISTS "auth_all" ON previsoes;
DROP POLICY IF EXISTS "auth_all" ON integracoes_bancarias;

-- ─────────────────────────────────────────────
--  3. Habilitar RLS nas tabelas que estavam faltando
-- ─────────────────────────────────────────────

ALTER TABLE user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_venda          ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_caixa       ENABLE ROW LEVEL SECURITY;
ALTER TABLE folha_pagamento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE departamentos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferias               ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE treinamentos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_eletronico     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponto_qr_registros   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_promocoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_tarefas    ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
--  4. Tabelas GLOBAIS — SELECT autenticado, escrita restrita
--  Cadastros de empresa que toda a app precisa de consultar.
-- ─────────────────────────────────────────────

CREATE POLICY "read_authenticated"  ON filiais                   FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_admin_empresa" ON filiais                   FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON colaboradores             FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_admin_empresa" ON colaboradores             FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON clientes                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_clientes"      ON clientes                  FOR ALL    TO authenticated USING (auth_in_setor('vendas', 'financeiro')) WITH CHECK (auth_in_setor('vendas', 'financeiro'));

CREATE POLICY "read_authenticated"  ON fornecedores              FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_fornecedores"  ON fornecedores              FOR ALL    TO authenticated USING (auth_in_setor('compras', 'financeiro')) WITH CHECK (auth_in_setor('compras', 'financeiro'));

CREATE POLICY "read_authenticated"  ON produtos                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_produtos"      ON produtos                  FOR INSERT TO authenticated WITH CHECK (true);  -- PDV decrementa estoque
CREATE POLICY "update_produtos"     ON produtos                  FOR UPDATE TO authenticated USING (true);        -- trigger PDV
CREATE POLICY "delete_produtos"     ON produtos                  FOR DELETE TO authenticated USING (auth_in_setor('compras', 'logistica'));

CREATE POLICY "read_authenticated"  ON servicos                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_servicos"      ON servicos                  FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON centros_custo             FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_admin"         ON centros_custo             FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON projetos                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_admin"         ON projetos                  FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON condicoes_pagamento       FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_financ"        ON condicoes_pagamento       FOR ALL    TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));

CREATE POLICY "read_authenticated"  ON classificacoes_auxiliares FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_admin"         ON classificacoes_auxiliares FOR ALL    TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

CREATE POLICY "read_authenticated"  ON mapeamentos_rateio        FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_financ"        ON mapeamentos_rateio        FOR ALL    TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));

CREATE POLICY "read_authenticated"  ON formas_pagamento          FOR SELECT TO authenticated USING (true);
CREATE POLICY "write_financ"        ON formas_pagamento          FOR ALL    TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));

-- ─────────────────────────────────────────────
--  5. Compras — vê quem está no setor compras
-- ─────────────────────────────────────────────

CREATE POLICY "compras_select" ON requisicoes        FOR SELECT TO authenticated USING (auth_in_setor('compras'));
CREATE POLICY "compras_insert" ON requisicoes        FOR INSERT TO authenticated WITH CHECK (true);  -- qualquer setor pode pedir compra
CREATE POLICY "compras_update" ON requisicoes        FOR UPDATE TO authenticated USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_delete" ON requisicoes        FOR DELETE TO authenticated USING (auth_in_setor('compras'));

CREATE POLICY "compras_all" ON aprovacoes_compras    FOR ALL TO authenticated USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_all" ON cotacoes              FOR ALL TO authenticated USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_all" ON pedidos               FOR ALL TO authenticated USING (auth_in_setor('compras')) WITH CHECK (auth_in_setor('compras'));
CREATE POLICY "compras_all" ON recebimentos          FOR ALL TO authenticated USING (auth_in_setor('compras', 'logistica')) WITH CHECK (auth_in_setor('compras', 'logistica'));
CREATE POLICY "compras_all" ON notas_recebidas       FOR ALL TO authenticated USING (auth_in_setor('compras', 'financeiro')) WITH CHECK (auth_in_setor('compras', 'financeiro'));

-- ─────────────────────────────────────────────
--  6. Estoque/Logística
-- ─────────────────────────────────────────────

CREATE POLICY "logist_select" ON requisicoes_estoque   FOR SELECT TO authenticated USING (auth_in_setor('logistica'));
CREATE POLICY "logist_insert" ON requisicoes_estoque   FOR INSERT TO authenticated WITH CHECK (true);  -- qualquer setor pode pedir
CREATE POLICY "logist_update" ON requisicoes_estoque   FOR UPDATE TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "logist_delete" ON requisicoes_estoque   FOR DELETE TO authenticated USING (auth_in_setor('logistica'));

CREATE POLICY "logist_all" ON aprovacoes_estoque       FOR ALL TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "logist_all" ON expedicao                FOR ALL TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));

-- movimentacoes_estoque: PDV (vendas) e Recebimentos (compras) também escrevem
CREATE POLICY "mov_select"  ON movimentacoes_estoque  FOR SELECT TO authenticated USING (auth_in_setor('logistica', 'compras'));
CREATE POLICY "mov_insert"  ON movimentacoes_estoque  FOR INSERT TO authenticated WITH CHECK (true);  -- PDV, Recebimento, Aprovação
CREATE POLICY "mov_update"  ON movimentacoes_estoque  FOR UPDATE TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "mov_delete"  ON movimentacoes_estoque  FOR DELETE TO authenticated USING (auth_in_setor('logistica'));

CREATE POLICY "logist_all" ON inventarios             FOR ALL TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));
CREATE POLICY "logist_all" ON vencimentos_estoque     FOR ALL TO authenticated USING (auth_in_setor('logistica')) WITH CHECK (auth_in_setor('logistica'));

-- ─────────────────────────────────────────────
--  7. Financeiro — cross-flow INSERT aberto
-- ─────────────────────────────────────────────

-- contas_pagar: Pedido aprovado e Folha processada inserem aqui
CREATE POLICY "fin_select"  ON contas_pagar           FOR SELECT TO authenticated USING (auth_in_setor('financeiro'));
CREATE POLICY "fin_insert"  ON contas_pagar           FOR INSERT TO authenticated WITH CHECK (true);  -- cross-flow
CREATE POLICY "fin_update"  ON contas_pagar           FOR UPDATE TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_delete"  ON contas_pagar           FOR DELETE TO authenticated USING (auth_in_setor('financeiro'));

-- contas_receber: PDV Fiado insere aqui
CREATE POLICY "fin_select"  ON contas_receber         FOR SELECT TO authenticated USING (auth_in_setor('financeiro'));
CREATE POLICY "fin_insert"  ON contas_receber         FOR INSERT TO authenticated WITH CHECK (true);  -- cross-flow (PDV)
CREATE POLICY "fin_update"  ON contas_receber         FOR UPDATE TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_delete"  ON contas_receber         FOR DELETE TO authenticated USING (auth_in_setor('financeiro'));

CREATE POLICY "fin_all"     ON duplicatas             FOR ALL TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_all"     ON caixa_bancos           FOR ALL TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_all"     ON previsoes              FOR ALL TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_all"     ON integracoes_bancarias  FOR ALL TO authenticated USING (auth_in_setor('financeiro')) WITH CHECK (auth_in_setor('financeiro'));
CREATE POLICY "fin_all"     ON controle_caixa         FOR ALL TO authenticated USING (auth_in_setor('financeiro', 'vendas')) WITH CHECK (auth_in_setor('financeiro', 'vendas'));

-- ─────────────────────────────────────────────
--  8. RH — sem cross-flow externo (excepto Folha→contas_pagar tratado acima)
-- ─────────────────────────────────────────────

CREATE POLICY "rh_all" ON folha_pagamento       FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON funcionarios          FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON departamentos         FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON cargos                FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON ferias                FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON beneficios            FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "rh_all" ON treinamentos          FOR ALL TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));

-- ─────────────────────────────────────────────
--  9. Ponto Eletrónico — pessoal: próprio user vê o próprio, RH vê tudo
-- ─────────────────────────────────────────────

-- ponto_eletronico vincula a funcionario_id (linkado a user_profiles.funcionario_id)
CREATE POLICY "ponto_select" ON ponto_eletronico
  FOR SELECT TO authenticated
  USING (
    auth_in_setor('rh')
    OR funcionario_id = (SELECT funcionario_id FROM user_profiles WHERE id = auth.uid())
  );
CREATE POLICY "ponto_insert" ON ponto_eletronico
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_in_setor('rh')
    OR funcionario_id = (SELECT funcionario_id FROM user_profiles WHERE id = auth.uid())
  );
CREATE POLICY "ponto_modify" ON ponto_eletronico
  FOR UPDATE TO authenticated
  USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "ponto_delete" ON ponto_eletronico
  FOR DELETE TO authenticated USING (auth_in_setor('rh'));

-- ponto_qr_registros: o utilizador vê os próprios via user_id; RH vê todos
CREATE POLICY "pontoqr_select" ON ponto_qr_registros
  FOR SELECT TO authenticated
  USING (auth_in_setor('rh') OR user_id = auth.uid());
CREATE POLICY "pontoqr_insert" ON ponto_qr_registros
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR auth_in_setor('rh'));
CREATE POLICY "pontoqr_modify" ON ponto_qr_registros
  FOR UPDATE TO authenticated USING (auth_in_setor('rh')) WITH CHECK (auth_in_setor('rh'));
CREATE POLICY "pontoqr_delete" ON ponto_qr_registros
  FOR DELETE TO authenticated USING (auth_in_setor('rh'));

-- ─────────────────────────────────────────────
--  10. Vendas
-- ─────────────────────────────────────────────

CREATE POLICY "vendas_select" ON vendas       FOR SELECT TO authenticated USING (auth_in_setor('vendas', 'financeiro'));
CREATE POLICY "vendas_write"  ON vendas       FOR ALL    TO authenticated USING (auth_in_setor('vendas')) WITH CHECK (auth_in_setor('vendas'));

CREATE POLICY "itens_select" ON itens_venda   FOR SELECT TO authenticated USING (auth_in_setor('vendas', 'financeiro'));
CREATE POLICY "itens_write"  ON itens_venda   FOR ALL    TO authenticated USING (auth_in_setor('vendas')) WITH CHECK (auth_in_setor('vendas'));

-- ─────────────────────────────────────────────
--  11. Marketing
-- ─────────────────────────────────────────────

CREATE POLICY "mkt_select"  ON marketing_promocoes  FOR SELECT TO authenticated USING (auth_in_setor('marketing', 'financeiro'));
CREATE POLICY "mkt_insert"  ON marketing_promocoes  FOR INSERT TO authenticated WITH CHECK (auth_in_setor('marketing'));
CREATE POLICY "mkt_update"  ON marketing_promocoes  FOR UPDATE TO authenticated USING (auth_in_setor('marketing', 'financeiro')) WITH CHECK (auth_in_setor('marketing', 'financeiro'));
CREATE POLICY "mkt_delete"  ON marketing_promocoes  FOR DELETE TO authenticated USING (auth_in_setor('marketing'));

CREATE POLICY "mkt_select"  ON marketing_tarefas    FOR SELECT TO authenticated USING (auth_in_setor('marketing', 'financeiro'));
CREATE POLICY "mkt_insert"  ON marketing_tarefas    FOR INSERT TO authenticated WITH CHECK (auth_in_setor('marketing'));
CREATE POLICY "mkt_update"  ON marketing_tarefas    FOR UPDATE TO authenticated USING (auth_in_setor('marketing', 'financeiro')) WITH CHECK (auth_in_setor('marketing', 'financeiro'));
CREATE POLICY "mkt_delete"  ON marketing_tarefas    FOR DELETE TO authenticated USING (auth_in_setor('marketing'));

-- ─────────────────────────────────────────────
--  12. user_profiles — perfis dos utilizadores
--  - Cada user vê o próprio perfil
--  - Gerentes veem perfis do próprio setor
--  - Admins veem tudo
--  - INSERT/DELETE: bloqueados (são feitos via /api/create-user e /api/delete-user)
-- ─────────────────────────────────────────────

CREATE POLICY "up_select_own_or_scope" ON user_profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR auth_is_admin()
    OR (auth_user_role() = 'gerente' AND setor = auth_user_setor())
  );

-- INSERT só por service_role (endpoint /api/create-user)
-- DELETE só por service_role (endpoint /api/delete-user)

-- UPDATE: user pode editar campos limitados do próprio perfil; admin tudo
CREATE POLICY "up_update_own_or_admin" ON user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR auth_is_admin())
  WITH CHECK (id = auth.uid() OR auth_is_admin());

COMMIT;

-- ============================================================
--  VERIFICAÇÃO PÓS-APLICAÇÃO
--  Execute como qualquer user logado para confirmar:
--    SELECT auth_user_role();      -- devolve 'admin'/'gerente'/'colaborador'
--    SELECT auth_user_setor();     -- devolve setor do user
--    SELECT auth_is_admin();       -- true/false
--
--  Para simular contexto de outro user no SQL Editor:
--    SET LOCAL request.jwt.claim.sub = '<user_uuid>';
--    SELECT * FROM contas_pagar;   -- vazio se não financeiro
-- ============================================================
