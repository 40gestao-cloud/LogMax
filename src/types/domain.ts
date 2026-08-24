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
  /** Medida do ESTOQUE (UN, KG, CX...) — como o item entra e sai. */
  unidade: string;
  /** Quantidade do CONTEÚDO da embalagem. NULL em granel. Migr. 438. */
  peso?: number | null;
  /** Medida do conteúdo (G/KG/ML/L). NULL nas linhas herdadas sem medida. */
  peso_unidade?: string | null;
  estoque_minimo?: number | null;
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
  /** Setor de quem abriu, derivado do perfil no servidor (migr. 283). */
  setor_solicitante?: string | null;
  /** Por que a empresa precisa do item — o que o gerente lê para decidir. */
  justificativa?: string | null;
  /** Para quando o item é necessário. */
  data_necessidade?: string | null;
  unidade?: string | null;
  /** 'Reposição' (saiu do catálogo, com saldo fotografado) ou 'Eventual' (item
   *  escrito à mão). NULL nas linhas abertas antes da migr. 358. */
  tipo_requisicao?: string | null;
  /** Amarração ao catálogo: a Reposição já nasce com ele; a Eventual só ganha
   *  quando Compras casa o item (migr. 480). */
  produto_id?: string | null;
  servico_id?: string | null;
  /** Fotografia do estoque no instante do pedido — na Reposição é isto que
   *  ocupa o lugar da justificativa escrita (migr. 358). */
  saldo_no_pedido?: number | null;
  minimo_no_pedido?: number | null;
  /** Devolução para correção (migr. 517): o que o gerente pediu, quando e por
   *  quem — o solicitante lê aqui porque não enxerga `aprovacoes_compras`. */
  correcao_motivo?: string | null;
  correcao_solicitada_em?: string | null;
  correcao_solicitada_por?: string | null;
  reenviada_em?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface AprovacaoCompras {
  id: string;
  requisicao_id: string;
  status: string;
  /** Nome de quem decidiu — a RPC carimba, e a direção precisa ler para
   *  saber de quem é a decisão que está devolvendo. */
  aprovador?: string | null;
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
  criado_por?: string | null;
  /** O que o Estoque (ou gerente) pediu para corrigir — terceira saída,
   *  espelhando a de compra (migr. 522). */
  correcao_motivo?: string | null;
  correcao_solicitada_em?: string | null;
  correcao_solicitada_por?: string | null;
  reenviada_em?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface AprovacaoEstoque {
  id: string;
  requisicao_estoque_id: string;
  status: string;
  aprovador?: string | null;
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
