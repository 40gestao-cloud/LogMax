-- ============================================================
-- LogMax — Tabelas do Módulo RH
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Departamentos
create table if not exists departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  responsavel text,
  status text default 'Ativo',
  created_at timestamptz default now()
);

-- Cargos
create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nivel text,
  salario_base numeric(12,2) default 0,
  status text default 'Ativo',
  created_at timestamptz default now()
);

-- Funcionários
create table if not exists funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf text,
  email text,
  telefone text,
  cargo text,
  departamento text,
  data_admissao date,
  data_nascimento date,
  salario numeric(12,2) default 0,
  status text default 'Ativo',
  created_at timestamptz default now()
);

-- Folha de Pagamento
create table if not exists folha_pagamento (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid references funcionarios(id) on delete set null,
  mes_ref text not null,
  salario_bruto numeric(12,2) default 0,
  descontos numeric(12,2) default 0,
  salario_liquido numeric(12,2) default 0,
  status text default 'Pendente',
  created_at timestamptz default now()
);

-- Férias
create table if not exists ferias (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid references funcionarios(id) on delete set null,
  data_inicio date,
  data_fim date,
  dias int default 30,
  status text default 'Solicitada',
  created_at timestamptz default now()
);

-- Ponto Eletrônico
create table if not exists ponto_eletronico (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid references funcionarios(id) on delete set null,
  data date,
  entrada text,
  saida text,
  horas_trabalhadas numeric(4,2) default 0,
  status text default 'Normal',
  created_at timestamptz default now()
);

-- Benefícios
create table if not exists beneficios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text,
  valor numeric(12,2) default 0,
  status text default 'Ativo',
  created_at timestamptz default now()
);

-- Treinamentos
create table if not exists treinamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  instrutor text,
  data_inicio date,
  data_fim date,
  vagas int default 0,
  inscritos int default 0,
  status text default 'Agendado',
  created_at timestamptz default now()
);

-- ============================================================
-- RLS — Row Level Security
-- ============================================================
alter table departamentos    enable row level security;
alter table cargos           enable row level security;
alter table funcionarios     enable row level security;
alter table folha_pagamento  enable row level security;
alter table ferias           enable row level security;
alter table ponto_eletronico enable row level security;
alter table beneficios       enable row level security;
alter table treinamentos     enable row level security;

drop policy if exists "auth_all" on departamentos;
drop policy if exists "auth_all" on cargos;
drop policy if exists "auth_all" on funcionarios;
drop policy if exists "auth_all" on folha_pagamento;
drop policy if exists "auth_all" on ferias;
drop policy if exists "auth_all" on ponto_eletronico;
drop policy if exists "auth_all" on beneficios;
drop policy if exists "auth_all" on treinamentos;

create policy "auth_all" on departamentos    for all to authenticated using (true) with check (true);
create policy "auth_all" on cargos           for all to authenticated using (true) with check (true);
create policy "auth_all" on funcionarios     for all to authenticated using (true) with check (true);
create policy "auth_all" on folha_pagamento  for all to authenticated using (true) with check (true);
create policy "auth_all" on ferias           for all to authenticated using (true) with check (true);
create policy "auth_all" on ponto_eletronico for all to authenticated using (true) with check (true);
create policy "auth_all" on beneficios       for all to authenticated using (true) with check (true);
create policy "auth_all" on treinamentos     for all to authenticated using (true) with check (true);
