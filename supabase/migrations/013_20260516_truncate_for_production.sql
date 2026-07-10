-- =================================================================
-- LogMax — Limpeza para Produção (TRUNCATE)
-- =================================================================
-- Objetivo:
--   Apagar TODOS os dados transacionais e de cadastro para iniciar
--   a operação real do sistema com banco limpo.
--
--   Preserva APENAS os usuários administrativos (admin/CEO) em
--   user_profiles e auth.users — todos os demais perfis e usuários
--   de autenticação serão removidos.
--
-- ATENÇÃO:
--   Operação DESTRUTIVA e IRREVERSÍVEL.
--   - Faça backup antes (Supabase Dashboard → Database → Backups).
--   - Não execute em ambiente de homologação com dados úteis.
--   - Rode em janela única (envolto em transação).
--
-- Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- TRANSACIONAIS (têm FKs entre si — CASCADE limpa em cadeia)
-- -----------------------------------------------------------------
TRUNCATE TABLE
  itens_venda,
  vendas,
  movimentacoes_estoque,
  inventarios,
  recebimentos,
  notas_recebidas,
  pedidos,
  cotacoes,
  aprovacoes_compras,
  requisicoes,
  aprovacoes_estoque,
  requisicoes_estoque,
  expedicao,
  vencimentos_estoque,
  contas_receber,
  contas_pagar,
  previsoes,
  duplicatas,
  integracoes_bancarias,
  controle_caixa,
  ponto_eletronico,
  ponto_qr_registros,
  folha_pagamento,
  ferias,
  treinamentos,
  marketing_promocoes,
  marketing_tarefas
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------
-- CADASTROS (limpa também — usuário começa do zero)
-- -----------------------------------------------------------------
TRUNCATE TABLE
  produtos,
  servicos,
  clientes,
  fornecedores,
  funcionarios,
  colaboradores,
  filiais,
  departamentos,
  cargos,
  centros_custo,
  projetos,
  condicoes_pagamento,
  classificacoes_auxiliares,
  mapeamentos_rateio,
  formas_pagamento,
  caixa_bancos,
  beneficios,
  configuracoes
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------
-- USUÁRIOS — preserva APENAS admin e CEO
-- -----------------------------------------------------------------
-- 1) Remove perfis de gerentes/colaboradores
DELETE FROM user_profiles WHERE role NOT IN ('admin', 'ceo');

-- 2) Remove os usuários de auth correspondentes
--    (auth.users só é apagado para perfis já removidos)
DELETE FROM auth.users
 WHERE id NOT IN (SELECT id FROM user_profiles);

COMMIT;

-- =================================================================
-- VERIFICAÇÃO PÓS-LIMPEZA
-- =================================================================
SELECT
  (SELECT COUNT(*) FROM user_profiles)         AS perfis_restantes,
  (SELECT COUNT(*) FROM auth.users)            AS auth_users_restantes,
  (SELECT COUNT(*) FROM produtos)              AS produtos,
  (SELECT COUNT(*) FROM clientes)              AS clientes,
  (SELECT COUNT(*) FROM vendas)                AS vendas,
  (SELECT COUNT(*) FROM contas_receber)        AS contas_receber,
  (SELECT COUNT(*) FROM controle_caixa)        AS controle_caixa;
