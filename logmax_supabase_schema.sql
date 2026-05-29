-- ============================================================
--  LOGMAX — Schema Supabase (completo)
--  Execute no SQL Editor do seu projeto Supabase.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
--  HELPERS GLOBAIS
--  Declarados antes das tabelas porque entram em DEFAULTs.
-- ─────────────────────────────────────────────

-- LogMax opera em Rio Branco / Acre (UTC-5, sem DST). Use no lugar
-- de CURRENT_DATE em DEFAULTs de coluna e cálculos em RPC para que
-- "hoje" bata com a operação física, mesmo no cluster Supabase em UTC.
-- Histórico/contexto: migration 20260530_acre_timezone_fix.sql.
CREATE OR REPLACE FUNCTION public.acre_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Rio_Branco')::date;
$$;

-- ─────────────────────────────────────────────
--  MÓDULO: EMPRESA
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS filiais (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo      text,
  nome        text NOT NULL,
  cidade      text,
  estado      text,
  cnpj        text,
  responsavel text,
  status      text NOT NULL DEFAULT 'Ativa',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS colaboradores (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricula    text NOT NULL,
  nome         text NOT NULL,
  cargo        text,
  departamento text,
  filial_id    uuid REFERENCES filiais(id) ON DELETE SET NULL,
  email        text,
  telefone     text,
  status       text NOT NULL DEFAULT 'Ativo',
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clientes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome          text NOT NULL,
  tipo          text,
  cnpj_cpf      text,
  email         text,
  telefone      text,
  cidade        text,
  status        text NOT NULL DEFAULT 'Ativo',
  ultima_compra date,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome       text NOT NULL,
  categoria  text,
  cnpj       text,
  email      text,
  telefone   text,
  cidade     text,
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo     text NOT NULL UNIQUE,
  nome       text NOT NULL,
  categoria  text,
  estoque    integer NOT NULL DEFAULT 0,
  preco      numeric(15,2) NOT NULL DEFAULT 0,
  unidade    text DEFAULT 'UN',
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servicos (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo     text NOT NULL UNIQUE,
  nome       text NOT NULL,
  tipo       text,
  valor      numeric(15,2) NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS centros_custo (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo      text NOT NULL UNIQUE,
  nome        text NOT NULL,
  responsavel text,
  orcamento   numeric(15,2) DEFAULT 0,
  status      text NOT NULL DEFAULT 'Ativo',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projetos (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo      text NOT NULL,
  nome        text NOT NULL,
  responsavel text,
  cliente_id  uuid REFERENCES clientes(id) ON DELETE SET NULL,
  data_inicio date,
  data_fim    date,
  orcamento   numeric(15,2) DEFAULT 0,
  status      text NOT NULL DEFAULT 'Ativo',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS condicoes_pagamento (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  descricao  text NOT NULL,
  parcelas   integer NOT NULL DEFAULT 1,
  dias       text,
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classificacoes_auxiliares (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo     text NOT NULL,
  nome       text NOT NULL,
  tipo       text,
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mapeamentos_rateio (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome          text NOT NULL,
  centros_custo text,
  status        text NOT NULL DEFAULT 'Ativo',
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formas_pagamento (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  descricao  text NOT NULL,
  taxa       text DEFAULT '0%',
  prazo      text,
  status     text NOT NULL DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
--  MÓDULO: COMPRAS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS requisicoes (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item         text NOT NULL,
  qtd          integer NOT NULL DEFAULT 1,
  centro_custo text,
  urgencia     text DEFAULT 'Normal',   -- Normal / Alta / Urgente
  status       text NOT NULL DEFAULT 'Pendente',  -- Pendente / Aprovada / Negada
  solicitante  text,
  data         date DEFAULT public.acre_today(),
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aprovacoes_compras (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisicao_id uuid REFERENCES requisicoes(id) ON DELETE CASCADE,
  aprovador     text,
  status        text NOT NULL DEFAULT 'Pendente',  -- Pendente / Aprovado / Negado
  observacao    text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cotacoes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisicao_id uuid REFERENCES requisicoes(id) ON DELETE SET NULL,
  fornecedor_id uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  valor_total   numeric(15,2) DEFAULT 0,
  prazo_entrega text,
  status        text NOT NULL DEFAULT 'Em Cotação',  -- Em Cotação / Aprovada / Recusada
  validade      date,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotacao_id    uuid REFERENCES cotacoes(id) ON DELETE SET NULL,
  fornecedor_id uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  valor_total   numeric(15,2) DEFAULT 0,
  prazo_entrega date,
  condicao_pgto text,
  status        text NOT NULL DEFAULT 'Pendente',
  -- Pendente / Aprovado / Em Transporte / Recebido / Cancelado
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recebimentos (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id    uuid REFERENCES pedidos(id) ON DELETE SET NULL,
  data         date DEFAULT public.acre_today(),
  qtd_recebida integer DEFAULT 0,
  status       text NOT NULL DEFAULT 'Pendente',  -- Pendente / Concluído / Parcial
  observacao   text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notas_recebidas (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero_nf     text NOT NULL,
  fornecedor_id uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  valor_total   numeric(15,2) DEFAULT 0,
  data_emissao  date,
  status        text NOT NULL DEFAULT 'Não Vinculada',  -- Não Vinculada / Vinculada / Cancelada
  created_at    timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
--  MÓDULO: ESTOQUE
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS requisicoes_estoque (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  produto_id  uuid REFERENCES produtos(id) ON DELETE SET NULL,
  qtd         integer NOT NULL DEFAULT 1,
  destino     text,
  solicitante text,
  status      text NOT NULL DEFAULT 'Pendente',  -- Pendente / Aprovada / Negada
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aprovacoes_estoque (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisicao_estoque_id uuid REFERENCES requisicoes_estoque(id) ON DELETE CASCADE,
  aprovador             text,
  status                text NOT NULL DEFAULT 'Pendente',  -- Pendente / Aprovado / Negado
  observacao            text,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expedicao (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requisicao_id   uuid REFERENCES requisicoes_estoque(id) ON DELETE SET NULL,
  produto_id      uuid REFERENCES produtos(id) ON DELETE SET NULL,
  qtd_expedida    integer DEFAULT 0,
  data_expedicao  date DEFAULT public.acre_today(),
  status          text NOT NULL DEFAULT 'Pendente',  -- Pendente / Expedido / Cancelado
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  tipo       text NOT NULL,   -- Entrada / Saída / Ajuste
  qtd        integer NOT NULL,
  origem     text,
  destino    text,
  data       date DEFAULT public.acre_today(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventarios (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  produto_id  uuid REFERENCES produtos(id) ON DELETE SET NULL,
  qtd_sistema integer DEFAULT 0,
  qtd_contada integer DEFAULT 0,
  diferenca   integer GENERATED ALWAYS AS (qtd_contada - qtd_sistema) STORED,
  status      text NOT NULL DEFAULT 'Em Andamento',  -- Em Andamento / Concluído / Cancelado
  data        date DEFAULT public.acre_today(),
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vencimentos_estoque (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
  lote       text,
  qtd        integer DEFAULT 0,
  vencimento date NOT NULL,
  status     text DEFAULT 'OK',  -- OK / Próximo / Vencido
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
--  MÓDULO: FINANCEIRO
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contas_receber (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  descricao  text NOT NULL,
  valor      numeric(15,2) NOT NULL DEFAULT 0,
  vencimento date,
  status     text NOT NULL DEFAULT 'Aberto',  -- Aberto / Pago / Atrasado
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contas_pagar (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  fornecedor_id uuid REFERENCES fornecedores(id) ON DELETE SET NULL,
  descricao     text NOT NULL,
  valor         numeric(15,2) NOT NULL DEFAULT 0,
  vencimento    date,
  status        text NOT NULL DEFAULT 'Pendente',  -- Pendente / Pago / Atrasado
  pedido_id     uuid REFERENCES pedidos(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS duplicatas (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero     text NOT NULL,
  tipo       text,             -- A Receber / A Pagar
  valor      numeric(15,2) NOT NULL DEFAULT 0,
  vencimento date,
  sacado     text,
  status     text NOT NULL DEFAULT 'Emitida',  -- Emitida / Paga / Vencida / Cancelada
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caixa_bancos (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conta      text NOT NULL,
  banco      text,
  agencia    text,
  saldo      numeric(15,2) DEFAULT 0,
  tipo       text DEFAULT 'Conta Corrente',
  -- Conta Corrente / Conta Poupança / Caixa / Investimento
  status     text DEFAULT 'Ativo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS previsoes (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  descricao text NOT NULL,
  tipo      text,             -- Receita / Despesa
  valor     numeric(15,2) NOT NULL DEFAULT 0,
  data      date,
  status    text NOT NULL DEFAULT 'Previsto',  -- Previsto / Realizado / Cancelado
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integracoes_bancarias (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  banco       text NOT NULL,
  arquivo     text,
  data_import date DEFAULT public.acre_today(),
  registros   integer DEFAULT 0,
  status      text NOT NULL DEFAULT 'Pendente',
  created_at  timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
--  ROW LEVEL SECURITY
--  Descomente e execute após criar as tabelas.
-- ─────────────────────────────────────────────

-- ALTER TABLE filiais                 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE colaboradores           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE clientes                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE fornecedores            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE produtos                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE servicos                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE centros_custo           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projetos                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE condicoes_pagamento     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE classificacoes_auxiliares ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mapeamentos_rateio      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE formas_pagamento        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE requisicoes             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE aprovacoes_compras      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cotacoes                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pedidos                 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE recebimentos            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notas_recebidas         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE requisicoes_estoque     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE aprovacoes_estoque      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE expedicao               ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE movimentacoes_estoque   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventarios             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE vencimentos_estoque     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE contas_receber          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE contas_pagar            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE duplicatas              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE caixa_bancos            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE previsoes               ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE integracoes_bancarias   ENABLE ROW LEVEL SECURITY;

-- Política: acesso total para usuários autenticados (ajuste por perfil se necessário)
-- CREATE POLICY "auth_all" ON filiais FOR ALL USING (auth.role() = 'authenticated');
-- (repita para cada tabela)

-- ─────────────────────────────────────────────
--  DADOS DE EXEMPLO
-- ─────────────────────────────────────────────

INSERT INTO filiais (codigo, nome, cidade, estado, cnpj, responsavel, status) VALUES
  ('FIL-001', 'Matriz São Paulo',      'São Paulo',       'SP', '12.345.678/0001-90', 'Carlos Silva',  'Ativa'),
  ('FIL-002', 'Filial Campinas',       'Campinas',        'SP', '12.345.678/0002-71', 'Ana Lima',      'Ativa'),
  ('FIL-003', 'Filial Rio de Janeiro', 'Rio de Janeiro',  'RJ', '12.345.678/0003-52', 'Roberto Melo',  'Ativa')
ON CONFLICT DO NOTHING;

INSERT INTO colaboradores (matricula, nome, cargo, departamento, status) VALUES
  ('MAT-001', 'Carlos Silva',   'Diretor Geral',        'Diretoria', 'Ativo'),
  ('MAT-002', 'Ana Lima',       'Gerente de Compras',   'Compras',   'Ativo'),
  ('MAT-003', 'Roberto Melo',   'Analista de Estoque',  'Estoque',   'Ativo'),
  ('MAT-004', 'Juliana Santos', 'Analista Financeiro',  'Financeiro','Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO clientes (nome, tipo, email, telefone, cidade, status) VALUES
  ('Atacadão Distribuidora Ltda', 'PJ', 'compras@atacadao.com.br',   '(11) 3333-4444', 'São Paulo', 'Ativo'),
  ('Supermercados União SA',      'PJ', 'faturamento@uniao.com.br',  '(19) 2222-5555', 'Campinas',  'Ativo'),
  ('Comercial Norte Ltda',        'PJ', 'comercial@norte.com.br',    '(21) 9999-1111', 'Rio de Janeiro', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO fornecedores (nome, categoria, email, telefone, cidade, status) VALUES
  ('Papelão Sul Industria', 'Embalagens', 'vendas@papelao.com',      '(11) 4444-1111', 'Diadema',   'Ativo'),
  ('Plásticos Flex Ltda',   'Embalagens', 'contato@flex.com.br',     '(11) 5555-2222', 'Guarulhos', 'Ativo'),
  ('Logística Express SA',  'Logística',  'ops@logexpress.com.br',   '(11) 6666-3333', 'São Paulo', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO produtos (codigo, nome, categoria, estoque, preco, unidade, status) VALUES
  ('PRD-001', 'Caixa de Papelão P',       'Embalagens', 1200, 3.50,  'UN', 'Ativo'),
  ('PRD-002', 'Fita Adesiva 48mm',        'Fixação',     800, 1.80,  'RL', 'Ativo'),
  ('PRD-003', 'Bobina Plástico Bolha',    'Embalagens',  300, 45.00, 'RL', 'Ativo'),
  ('PRD-004', 'Pallet PVC',               'Armazenagem', 150, 85.00, 'UN', 'Ativo'),
  ('PRD-005', 'Etiqueta Térmica 100x150', 'Etiquetas',  5000, 0.08,  'UN', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO centros_custo (codigo, nome, responsavel, orcamento, status) VALUES
  ('CC-001', 'Diretoria Executiva', 'Carlos Silva', 50000.00,  'Ativo'),
  ('CC-002', 'Operações SP',        'Marcos Reis',  120000.00, 'Ativo'),
  ('CC-003', 'TI & Infraestrutura', 'Ana Lima',     30000.00,  'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO condicoes_pagamento (descricao, parcelas, dias, status) VALUES
  ('À Vista',       1, '0',        'Ativo'),
  ('30 dias',       1, '30',       'Ativo'),
  ('30/60 dias',    2, '30/60',    'Ativo'),
  ('30/60/90 dias', 3, '30/60/90', 'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO formas_pagamento (descricao, taxa, prazo, status) VALUES
  ('Boleto Bancário',  '0%',   '3 dias úteis', 'Ativo'),
  ('PIX',              '0%',   'Imediato',     'Ativo'),
  ('Cartão de Crédito','2.5%', '30 dias',      'Ativo'),
  ('Transferência',    '0%',   '1 dia útil',   'Ativo')
ON CONFLICT DO NOTHING;

INSERT INTO caixa_bancos (conta, banco, agencia, saldo, tipo, status) VALUES
  ('12345-6', 'Banco do Brasil', '0001-9', 50000.00, 'Conta Corrente', 'Ativo'),
  ('98765-4', 'Itaú',            '0042-1', 25000.00, 'Conta Corrente', 'Ativo'),
  ('Caixa',   'Caixa Física',    '',       5000.00,  'Caixa',          'Ativo')
ON CONFLICT DO NOTHING;
