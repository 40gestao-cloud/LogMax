// Tipos mínimos de domínio — mapeiam os campos reais das tabelas Supabase.
// Não são exaustivos: campos opcionais com ? cobrem colunas nullable ou
// adicionadas em migrations recentes que nem todo registro possui.

export type FilialOp = 'SuperMax' | 'MaxLook' | 'TechMax';

// ── Cadastros ─────────────────────────────────────────────────────────────

export interface Produto {
  id: string;
  nome: string;
  codigo: string;
  ean?: string | null;
  preco: number;
  estoque: number;
  unidade: string;
  filial?: string | null;
  status: 'Ativo' | 'Inativo' | string;
  tipo?: string | null;
  imagem_url?: string | null;
  imagem_url_2?: string | null;
  imagem_url_3?: string | null;
  elegivel_beneficios?: boolean | null;
  ativo?: boolean;
  created_at?: string;
}

export interface Cliente {
  id: string;
  nome: string;
  tipo: 'PJ' | 'PF' | string;
  filial?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  ativo?: boolean;
}

export interface Funcionario {
  id: string;
  nome: string;
  cargo?: string | null;
  departamento?: string | null;
  cpf?: string | null;
  salario?: number | null;
  status: string;
  filial?: string | null;
  data_admissao?: string | null;
  ativo?: boolean;
  created_at?: string;
}

// ── Financeiro ────────────────────────────────────────────────────────────

export interface ContaPagar {
  id: string;
  descricao: string;
  valor: number;
  vencimento?: string | null;
  status: string;
  filial?: string | null;
  funcionario_id?: string | null;
  fornecedor_id?: string | null;
  ativo?: boolean;
  created_at?: string;
}

export interface ContaReceber {
  id: string;
  descricao: string;
  valor: number;
  vencimento?: string | null;
  status: string;
  filial?: string | null;
  cliente_id?: string | null;
  ativo?: boolean;
  created_at?: string;
}

// ── RH ───────────────────────────────────────────────────────────────────

export interface FolhaPagamento {
  id: string;
  funcionario_id: string;
  mes_ref: string;
  salario_base: number;
  salario_bruto: number;
  salario_liquido: number;
  descontos: number;
  valor_beneficios?: number | null;
  status: string;
  filial?: string | null;
  ativo?: boolean;
  created_at?: string;
}

export interface Ferias {
  id: string;
  funcionario_id: string;
  data_inicio: string;
  data_fim: string;
  dias: number;
  status: string;
  filial?: string | null;
  ativo?: boolean;
  created_at?: string;
}

// ── Compras ───────────────────────────────────────────────────────────────

export interface Requisicao {
  id: string;
  item: string;
  qtd: number;
  solicitante?: string | null;
  urgencia?: string | null;
  centro_custo?: string | null;
  status: string;
  filial?: string | null;
  data?: string | null;
  ativo?: boolean;
  /** Quem abriu a requisição — quem abre não aprova (migr. 282). */
  criado_por?: string | null;
  created_at?: string;
}

export interface AprovacaoCompras {
  id: string;
  requisicao_id: string;
  status: string;
  observacao?: string | null;
  filial?: string | null;
  created_at?: string;
}

// ── Estoque ───────────────────────────────────────────────────────────────

export interface RequisicaoEstoque {
  id: string;
  produto_id: string;
  qtd: number;
  destino?: string | null;
  solicitante?: string | null;
  status: string;
  filial?: string | null;
  ativo?: boolean;
  created_at?: string;
}

export interface AprovacaoEstoque {
  id: string;
  requisicao_estoque_id: string;
  status: string;
  observacao?: string | null;
  filial?: string | null;
  created_at?: string;
}

export interface MovimentacaoEstoque {
  id: string;
  produto_id: string;
  tipo: 'Entrada' | 'Saída' | 'Ajuste' | string;
  qtd: number;
  origem?: string | null;
  destino?: string | null;
  data?: string | null;
  filial?: string | null;
  recebimento_id?: string | null;
  created_at?: string;
}

// ── Vendas ────────────────────────────────────────────────────────────────

export interface Venda {
  id: string;
  total: number;
  desconto?: number | null;
  total_final: number;
  forma_pagamento: string;
  status: string;
  filial?: string | null;
  cliente_id?: string | null;
  cupom_id?: string | null;
  ativo?: boolean;
  created_at?: string;
}
