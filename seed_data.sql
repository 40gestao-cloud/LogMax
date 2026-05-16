-- ============================================================
-- LOGMAX — seed_data.sql
-- ============================================================
-- ⚠️ DESATIVADO PARA PRODUÇÃO (2026-05-16)
--
-- Este arquivo contém DADOS FICTÍCIOS de demonstração. Não execute
-- em ambiente de produção. Mantido apenas para referência histórica
-- / testes locais.
--
-- Para produção:
--   • Execute apenas o schema (logmax_supabase_schema.sql) e RLS.
--   • Limpe qualquer dado pré-existente com:
--       supabase/migrations/20260516_truncate_for_production.sql
--   • Cadastre o usuário admin/CEO manualmente via /api/create-user.
--
-- Para reativar como seed de demo em ambiente local, remova o RAISE
-- abaixo e os blocos DO $$ ... END $$ que envolvem o conteúdo.
-- ============================================================

DO $$
BEGIN
  RAISE EXCEPTION 'seed_data.sql desativado — vê o cabeçalho do ficheiro.';
END $$;

/*

-- ============================================================
-- CONTEÚDO ORIGINAL (preservado em bloco de comentário)
-- ============================================================


-- ============================================================
-- EMPRESA
-- ============================================================

INSERT INTO servicos (id, codigo, nome, tipo, valor, status) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'SRV-001', 'Consultoria de TI',    'Consultoria', 5000.00, 'Ativo'),
  ('e1000000-0000-0000-0000-000000000002', 'SRV-002', 'Frete Nacional',        'Logística',    350.00, 'Ativo'),
  ('e1000000-0000-0000-0000-000000000003', 'SRV-003', 'Manutenção Preventiva', 'Manutenção',   800.00, 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO projetos (id, codigo, nome, responsavel, cliente_id, data_inicio, data_fim, orcamento, status) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'PRJ-001', 'Implantação WMS',    'Carlos Silva',
   (SELECT id FROM clientes WHERE nome = 'Atacadão Distribuidora Ltda' LIMIT 1),
   '2026-01-15', '2026-12-31', 120000.00, 'Ativo'),
  ('e2000000-0000-0000-0000-000000000002', 'PRJ-002', 'Expansão Filial RJ', 'Roberto Melo',
   (SELECT id FROM clientes WHERE nome = 'Supermercados União SA' LIMIT 1),
   '2025-03-01', '2025-12-30', 85000.00, 'Concluído')
ON CONFLICT DO NOTHING;

INSERT INTO classificacoes_auxiliares (id, codigo, nome, tipo, status) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'CLA-001', 'Despesas Operacionais', 'Despesa',      'Ativo'),
  ('e3000000-0000-0000-0000-000000000002', 'CLA-002', 'Receitas de Vendas',    'Receita',      'Ativo'),
  ('e3000000-0000-0000-0000-000000000003', 'CLA-003', 'Custo de Mercadorias',  'Custo',        'Ativo'),
  ('e3000000-0000-0000-0000-000000000004', 'CLA-004', 'Investimentos',         'Investimento', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO mapeamentos_rateio (id, nome, centros_custo, status) VALUES
  ('e4000000-0000-0000-0000-000000000001', 'Rateio TI',        'CC-003', 'Ativo'),
  ('e4000000-0000-0000-0000-000000000002', 'Rateio Operações', 'CC-002', 'Ativo')
ON CONFLICT DO NOTHING;

-- Produtos com estoque crítico — acionam alertas em Sugestões de Compra
INSERT INTO produtos (id, codigo, nome, categoria, estoque, preco, unidade, status) VALUES
  ('e5000000-0000-0000-0000-000000000001', 'PRD-006', 'Lacre de Segurança', 'Segurança',   0,  2.50, 'UN', 'Ativo'),
  ('e5000000-0000-0000-0000-000000000002', 'PRD-007', 'Filme Stretch 500m', 'Embalagens',  3, 38.00, 'RL', 'Ativo')
ON CONFLICT DO NOTHING;


-- ============================================================
-- COMPRAS
-- ============================================================

INSERT INTO requisicoes (id, item, qtd, centro_custo, urgencia, status, solicitante, data) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Caixa de Papelão P',        500,  'CC-002', 'Normal',  'Pendente',  'Ana Lima',     '2026-05-02'),
  ('a1000000-0000-0000-0000-000000000002', 'Fita Adesiva 48mm',          200,  'CC-002', 'Alta',    'Pendente',  'Roberto Melo', '2026-05-05'),
  ('a1000000-0000-0000-0000-000000000003', 'Pallet PVC',                  50,  'CC-001', 'Urgente', 'Aprovada',  'Carlos Silva', '2026-04-28'),
  ('a1000000-0000-0000-0000-000000000004', 'Bobina Plástico Bolha',       10,  'CC-003', 'Normal',  'Aprovada',  'Ana Lima',     '2026-04-20'),
  ('a1000000-0000-0000-0000-000000000005', 'Etiqueta Térmica 100x150',  5000,  'CC-002', 'Alta',    'Negada',    'Roberto Melo', '2026-04-15')
ON CONFLICT DO NOTHING;

INSERT INTO aprovacoes_compras (id, requisicao_id, aprovador, status, observacao) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Carlos Silva', 'Pendente', NULL),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Carlos Silva', 'Aprovado', 'Estoque crítico, autorizado.'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000005', 'Carlos Silva', 'Negado',   'Orçamento esgotado para o mês.')
ON CONFLICT DO NOTHING;

INSERT INTO cotacoes (id, requisicao_id, fornecedor_id, valor_total, prazo_entrega, status, validade) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Papelão Sul Industria' LIMIT 1),
   4250.00, '2026-05-21', 'Em Cotação', '2026-05-30'),
  ('a3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Plásticos Flex Ltda' LIMIT 1),
   4100.00, '2026-05-19', 'Em Cotação', '2026-05-30'),
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   450.00,  '2026-05-17', 'Aprovada',   '2026-05-25'),
  ('a3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004',
   (SELECT id FROM fornecedores WHERE nome = 'Papelão Sul Industria' LIMIT 1),
   500.00,  '2026-05-19', 'Recusada',   '2026-05-25')
ON CONFLICT DO NOTHING;

INSERT INTO pedidos (id, cotacao_id, fornecedor_id, valor_total, prazo_entrega, condicao_pgto, status) VALUES
  ('a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   450.00,  '2026-05-19', '30 dias',       'Pendente'),
  ('a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   900.00,  '2026-05-17', '30/60 dias',    'Em Transporte'),
  ('a4000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   1350.00, '2026-05-16', 'À Vista',       'Recebido'),
  ('a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000002',
   (SELECT id FROM fornecedores WHERE nome = 'Plásticos Flex Ltda' LIMIT 1),
   4100.00, '2026-05-21', '30/60/90 dias', 'Recebido')
ON CONFLICT DO NOTHING;

INSERT INTO recebimentos (id, pedido_id, data, qtd_recebida, status, observacao) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003', '2026-05-08',  50, 'Pendente',  NULL),
  ('a5000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003', '2026-05-10',  50, 'Concluído', 'Recebido sem avarias.'),
  ('a5000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000004', '2026-05-12',  25, 'Parcial',   'Restante a entregar em 48h.')
ON CONFLICT DO NOTHING;

INSERT INTO notas_recebidas (id, numero_nf, fornecedor_id, valor_total, data_emissao, status) VALUES
  ('a6000000-0000-0000-0000-000000000001', '001234',
   (SELECT id FROM fornecedores WHERE nome = 'Papelão Sul Industria' LIMIT 1),
   3780.00, '2026-05-05', 'Escriturada'),
  ('a6000000-0000-0000-0000-000000000002', '005678',
   (SELECT id FROM fornecedores WHERE nome = 'Plásticos Flex Ltda' LIMIT 1),
   1200.00, '2026-05-07', 'Pendente'),
  ('a6000000-0000-0000-0000-000000000003', '009012',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   450.00,  '2026-05-10', 'Escriturada')
ON CONFLICT DO NOTHING;

INSERT INTO contas_pagar (id, fornecedor_id, descricao, valor, vencimento, status) VALUES
  ('a7000000-0000-0000-0000-000000000001',
   (SELECT id FROM fornecedores WHERE nome = 'Papelão Sul Industria' LIMIT 1),
   'Embalagens mai/2026',  3780.00, '2026-06-05', 'Pendente'),
  ('a7000000-0000-0000-0000-000000000002',
   (SELECT id FROM fornecedores WHERE nome = 'Plásticos Flex Ltda' LIMIT 1),
   'Plásticos mai/2026',   1200.00, '2026-06-10', 'Pendente'),
  ('a7000000-0000-0000-0000-000000000003',
   (SELECT id FROM fornecedores WHERE nome = 'Logística Express SA' LIMIT 1),
   'Frete abr/2026',        450.00, '2026-04-30', 'Pago'),
  ('a7000000-0000-0000-0000-000000000004',
   (SELECT id FROM fornecedores WHERE nome = 'Papelão Sul Industria' LIMIT 1),
   'Embalagens abr/2026',  2900.00, '2026-04-25', 'Pago'),
  ('a7000000-0000-0000-0000-000000000005',
   (SELECT id FROM fornecedores WHERE nome = 'Plásticos Flex Ltda' LIMIT 1),
   'Plásticos mar/2026',    980.00, '2026-04-01', 'Atrasado')
ON CONFLICT DO NOTHING;


-- ============================================================
-- ESTOQUE
-- ============================================================

INSERT INTO requisicoes_estoque (id, produto_id, qtd, destino, solicitante, status) VALUES
  ('b1000000-0000-0000-0000-000000000001',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   100, 'Expedição SP', 'Ana Lima',     'Pendente'),
  ('b1000000-0000-0000-0000-000000000002',
   (SELECT id FROM produtos WHERE codigo = 'PRD-002' LIMIT 1),
   50,  'Filial RJ',    'Roberto Melo', 'Pendente'),
  ('b1000000-0000-0000-0000-000000000003',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   200, 'Venda Direta', 'Carlos Silva', 'Aprovada'),
  ('b1000000-0000-0000-0000-000000000004',
   (SELECT id FROM produtos WHERE codigo = 'PRD-003' LIMIT 1),
   5,   'Manutenção',   'Ana Lima',     'Negada')
ON CONFLICT DO NOTHING;

INSERT INTO aprovacoes_estoque (id, requisicao_estoque_id, aprovador, status, observacao) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Carlos Silva', 'Pendente', NULL),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Carlos Silva', 'Aprovado', 'OK para expedição.'),
  ('b2000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000004', 'Carlos Silva', 'Negado',   'Estoque insuficiente para manutenção.')
ON CONFLICT DO NOTHING;

INSERT INTO expedicao (id, requisicao_id, produto_id, qtd_expedida, data_expedicao, status) VALUES
  ('b3000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   100, '2026-05-20', 'Pendente'),
  ('b3000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000003',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   200, '2026-05-08', 'Expedido'),
  ('b3000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000002',
   (SELECT id FROM produtos WHERE codigo = 'PRD-002' LIMIT 1),
   50,  '2026-05-10', 'Cancelado')
ON CONFLICT DO NOTHING;

INSERT INTO movimentacoes_estoque (id, produto_id, tipo, qtd, origem, destino, data) VALUES
  ('b4000000-0000-0000-0000-000000000001',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   'Entrada', 500, 'Papelão Sul Industria', 'Almoxarifado',  '2026-05-03'),
  ('b4000000-0000-0000-0000-000000000002',
   (SELECT id FROM produtos WHERE codigo = 'PRD-002' LIMIT 1),
   'Entrada', 200, 'Plásticos Flex Ltda',   'Almoxarifado',  '2026-05-05'),
  ('b4000000-0000-0000-0000-000000000003',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   'Saída',   100, 'Almoxarifado',           'Expedição',     '2026-05-08'),
  ('b4000000-0000-0000-0000-000000000004',
   (SELECT id FROM produtos WHERE codigo = 'PRD-003' LIMIT 1),
   'Saída',    10, 'Almoxarifado',           'Venda Direta',  '2026-05-10'),
  ('b4000000-0000-0000-0000-000000000005',
   (SELECT id FROM produtos WHERE codigo = 'PRD-004' LIMIT 1),
   'Ajuste',   -5, 'Almoxarifado',           'Almoxarifado',  '2026-05-12')
ON CONFLICT DO NOTHING;

-- diferenca é coluna GENERATED — não incluir no INSERT
INSERT INTO inventarios (id, produto_id, qtd_sistema, qtd_contada, status, data) VALUES
  ('b5000000-0000-0000-0000-000000000001',
   (SELECT id FROM produtos WHERE codigo = 'PRD-001' LIMIT 1),
   1200, 1185, 'Em Andamento', '2026-05-13'),
  ('b5000000-0000-0000-0000-000000000002',
   (SELECT id FROM produtos WHERE codigo = 'PRD-002' LIMIT 1),
   800,  800,  'Concluído',    '2026-05-10')
ON CONFLICT DO NOTHING;

INSERT INTO vencimentos_estoque (id, produto_id, lote, qtd, vencimento, status) VALUES
  ('b6000000-0000-0000-0000-000000000001',
   (SELECT id FROM produtos WHERE codigo = 'PRD-003' LIMIT 1),
   'LOT-001', 50,  '2026-03-31', 'Vencido'),
  ('b6000000-0000-0000-0000-000000000002',
   (SELECT id FROM produtos WHERE codigo = 'PRD-004' LIMIT 1),
   'LOT-002', 30,  '2026-06-14', 'Próximo ao Vencimento'),
  ('b6000000-0000-0000-0000-000000000003',
   (SELECT id FROM produtos WHERE codigo = 'PRD-005' LIMIT 1),
   'LOT-003', 200, '2027-05-01', 'OK')
ON CONFLICT DO NOTHING;


-- ============================================================
-- FINANCEIRO
-- ============================================================

INSERT INTO contas_receber (id, cliente_id, descricao, valor, vencimento, status) VALUES
  ('c1000000-0000-0000-0000-000000000001',
   (SELECT id FROM clientes WHERE nome = 'Atacadão Distribuidora Ltda' LIMIT 1),
   'Venda mai/2026 — NF 1234', 12500.00, '2026-06-10', 'Aberto'),
  ('c1000000-0000-0000-0000-000000000002',
   (SELECT id FROM clientes WHERE nome = 'Supermercados União SA' LIMIT 1),
   'Venda mai/2026 — NF 1235',  8200.00, '2026-06-15', 'Aberto'),
  ('c1000000-0000-0000-0000-000000000003',
   (SELECT id FROM clientes WHERE nome = 'Comercial Norte Ltda' LIMIT 1),
   'Venda abr/2026 — NF 1120',  3400.00, '2026-04-30', 'Atrasado'),
  ('c1000000-0000-0000-0000-000000000004',
   (SELECT id FROM clientes WHERE nome = 'Atacadão Distribuidora Ltda' LIMIT 1),
   'Venda abr/2026 — NF 1100',  6000.00, '2026-04-20', 'Pago')
ON CONFLICT DO NOTHING;

INSERT INTO previsoes (id, descricao, tipo, valor, data, status) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'Receita de Vendas',   'Receita', 85000.00, '2026-05-31', 'Previsto'),
  ('c2000000-0000-0000-0000-000000000002', 'Receita de Serviços', 'Receita', 12000.00, '2026-05-31', 'Previsto'),
  ('c2000000-0000-0000-0000-000000000003', 'Folha de Pessoal',    'Despesa', 45000.00, '2026-05-31', 'Previsto'),
  ('c2000000-0000-0000-0000-000000000004', 'Aluguel',             'Despesa',  8500.00, '2026-05-31', 'Previsto')
ON CONFLICT DO NOTHING;

INSERT INTO duplicatas (id, numero, tipo, valor, vencimento, sacado, status) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'DUP-001', 'A Receber', 12500.00, '2026-06-10', 'Atacadão Distribuidora Ltda', 'Emitida'),
  ('c3000000-0000-0000-0000-000000000002', 'DUP-002', 'A Receber',  8200.00, '2026-06-15', 'Supermercados União SA',      'Emitida'),
  ('c3000000-0000-0000-0000-000000000003', 'DUP-003', 'A Pagar',    3780.00, '2026-04-30', 'Papelão Sul Industria',       'Paga')
ON CONFLICT DO NOTHING;

INSERT INTO integracoes_bancarias (id, banco, arquivo, data_import, registros, status) VALUES
  ('c4000000-0000-0000-0000-000000000001', 'Banco do Brasil', 'extrato-05-2026.ofx', '2026-05-13', 47, 'Processado'),
  ('c4000000-0000-0000-0000-000000000002', 'Itaú',            'extrato-05-2026.ofx', '2026-05-13', 12, 'Pendente')
ON CONFLICT DO NOTHING;


-- ============================================================
-- RH
-- ============================================================

INSERT INTO departamentos (id, nome, responsavel, status) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'Tecnologia da Informação', 'Ana Lima',     'Ativo'),
  ('d1000000-0000-0000-0000-000000000002', 'Comercial',                'Roberto Melo', 'Ativo'),
  ('d1000000-0000-0000-0000-000000000003', 'Administrativo',           'Carlos Silva', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO cargos (id, nome, nivel, salario_base, status) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'Analista Jr',    'Operacional',  3500.00, 'Ativo'),
  ('d2000000-0000-0000-0000-000000000002', 'Analista Pleno', 'Operacional',  5500.00, 'Ativo'),
  ('d2000000-0000-0000-0000-000000000003', 'Gerente',        'Tático',       9000.00, 'Ativo'),
  ('d2000000-0000-0000-0000-000000000004', 'Diretor',        'Estratégico', 15000.00, 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO funcionarios (id, nome, cpf, email, telefone, cargo, departamento, data_admissao, data_nascimento, salario, status) VALUES
  ('d3000000-0000-0000-0000-000000000001', 'João Ferreira', '111.222.333-01', 'joao@logmax.com.br',    '(11) 91111-0001', 'Analista Jr',    'TI',             '2026-05-01', '1995-04-12', 3500.00, 'Ativo'),
  ('d3000000-0000-0000-0000-000000000002', 'Mariana Costa', '222.333.444-02', 'mariana@logmax.com.br', '(11) 92222-0002', 'Analista Pleno', 'Comercial',      '2025-03-15', '1990-07-22', 5500.00, 'Ativo'),
  ('d3000000-0000-0000-0000-000000000003', 'Pedro Alves',   '333.444.555-03', 'pedro@logmax.com.br',   '(11) 93333-0003', 'Gerente',        'Administrativo', '2024-01-10', '1985-11-05', 9000.00, 'Ativo'),
  ('d3000000-0000-0000-0000-000000000004', 'Camila Rocha',  '444.555.666-04', 'camila@logmax.com.br',  '(11) 94444-0004', 'Analista Jr',    'TI',             '2023-06-20', '1997-02-18', 3500.00, 'Afastado'),
  ('d3000000-0000-0000-0000-000000000005', 'Lucas Mendes',  '555.666.777-05', 'lucas@logmax.com.br',   '(11) 95555-0005', 'Analista Pleno', 'Comercial',      '2022-11-05', '1988-09-30', 5500.00, 'Desligado')
ON CONFLICT DO NOTHING;

INSERT INTO folha_pagamento (id, funcionario_id, mes_ref, salario_bruto, descontos, salario_liquido, status) VALUES
  ('d4000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', '2026-05', 3500.00,  630.00, 2870.00, 'Pendente'),
  ('d4000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', '2026-05', 5500.00,  990.00, 4510.00, 'Processada'),
  ('d4000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', '2026-05', 9000.00, 1620.00, 7380.00, 'Processada'),
  ('d4000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000004', '2026-05', 3500.00,  630.00, 2870.00, 'Paga')
ON CONFLICT DO NOTHING;

INSERT INTO ferias (id, funcionario_id, data_inicio, data_fim, dias, status) VALUES
  ('d5000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002', '2026-06-01', '2026-06-30', 30, 'Solicitada'),
  ('d5000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000003', '2026-07-01', '2026-07-30', 30, 'Aprovada'),
  ('d5000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001', '2025-12-01', '2025-12-30', 30, 'Em Andamento')
ON CONFLICT DO NOTHING;

INSERT INTO ponto_eletronico (id, funcionario_id, data, entrada, saida, horas_trabalhadas, status) VALUES
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', '2026-05-12', '08:00', '17:00',  9.0, 'Normal'),
  ('d6000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', '2026-05-12', '08:00', '17:00',  9.0, 'Normal'),
  ('d6000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', '2026-05-12', '08:00', '19:30', 11.5, 'Hora Extra'),
  ('d6000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000001', '2026-05-13', '08:00', '17:00',  9.0, 'Normal'),
  ('d6000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000002', '2026-05-13', NULL,    NULL,     0.0, 'Falta')
ON CONFLICT DO NOTHING;

INSERT INTO beneficios (id, nome, tipo, valor, status) VALUES
  ('d7000000-0000-0000-0000-000000000001', 'Vale Refeição',  'Alimentação', 550.00, 'Ativo'),
  ('d7000000-0000-0000-0000-000000000002', 'Plano de Saúde', 'Saúde',       280.00, 'Ativo'),
  ('d7000000-0000-0000-0000-000000000003', 'Vale Transporte','Transporte',  220.00, 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO treinamentos (id, nome, instrutor, data_inicio, data_fim, vagas, inscritos, status) VALUES
  ('d8000000-0000-0000-0000-000000000001', 'NR-35 Trabalho em Altura', 'José Matos',      '2026-06-10', '2026-06-11', 20, 15, 'Agendado'),
  ('d8000000-0000-0000-0000-000000000002', 'Excel Avançado',           'Ana Lima',         '2026-05-05', '2026-05-16', 15, 15, 'Em Andamento'),
  ('d8000000-0000-0000-0000-000000000003', 'LGPD na Prática',          'Dra. Paula Souza', '2026-04-01', '2026-04-02', 30, 28, 'Concluído')
ON CONFLICT DO NOTHING;

*/
