import { supabase, ENDPOINT_TABLE_MAP } from './supabase';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

// Mesmo universo de tipos avaliáveis do painel Matriz → Central de Avaliação
// (ver GRUPOS em src/views/MatrizAvaliacoesView.tsx). Duplicado aqui — só
// {endpoint, dateField, itemTipo}, sem labels/ícones — pra não puxar o bundle
// inteiro daquela view pro chunk da Início. Se um tipo novo entrar lá, replicar
// aqui. NÃO inclui as "Tarefas da Matriz" (tarefa_treinamento_vendas/ia/
// apresentacao) — são um fluxo de avaliação à parte (MatrizTarefasPanel), com
// contagem própria; incluir o item_tipo delas aqui infla "meus" sem inflar o
// total, subestimando pendentes.
const TIPOS_AVALIAVEIS: { endpoint: string; dateField: string; itemTipo: string }[] = [
  { endpoint: '/api/marketingartesview',              dateField: 'created_at',    itemTipo: 'arte' },
  { endpoint: '/api/marketingpromocoesview',           dateField: 'created_at',    itemTipo: 'promocao' },
  { endpoint: '/api/marketingcampanhasview',           dateField: 'created_at',    itemTipo: 'campanha' },
  { endpoint: '/api/metricasredessociaisview',         dateField: 'data_registro', itemTipo: 'redes_sociais' },
  { endpoint: '/api/orcamentosview',                   dateField: 'created_at',    itemTipo: 'orcamento' },
  { endpoint: '/api/requisicoesview',                  dateField: 'created_at',    itemTipo: 'requisicao' },
  { endpoint: '/api/cotacoesview',                     dateField: 'created_at',    itemTipo: 'cotacao' },
  { endpoint: '/api/frequenciatrabalhocomfilialview',  dateField: 'data',          itemTipo: 'frequencia_trabalho' },
  { endpoint: '/api/avaliacoesview',                   dateField: 'created_at',    itemTipo: 'avaliacao_desempenho' },
  { endpoint: 'categorias_produto',                    dateField: 'created_at',    itemTipo: 'cadastro_categoria' },
  { endpoint: '/api/crmview-fornecedores',              dateField: 'created_at',    itemTipo: 'cadastro_fornecedor' },
  { endpoint: '/api/servicosview',                      dateField: 'created_at',    itemTipo: 'cadastro_servico' },
  { endpoint: '/api/produtosview',                      dateField: 'created_at',    itemTipo: 'cadastro_produto' },
  { endpoint: '/api/crmview-clientes',                  dateField: 'created_at',    itemTipo: 'cadastro_cliente' },
  { endpoint: '/api/contaspagarview',                   dateField: 'created_at',    itemTipo: 'conta_pagar' },
  { endpoint: '/api/contasreceberview',                 dateField: 'created_at',    itemTipo: 'conta_receber' },
];

export type ResumoAvaliacaoMatriz = {
  competicaoNome: string | null;
  total: number;
  pendentes: number;
};

// Total avaliável no período da competição ativa, menos o que este avaliador
// já julgou (soma de todas as dimensões — mesmo agregado exibido nos cards
// de progresso da Central de Avaliação). Sem competição em andamento, volta
// zerado.
export async function contarAvaliacoesPendentesMatriz(profileId: string): Promise<ResumoAvaliacaoMatriz> {
  const vazio: ResumoAvaliacaoMatriz = { competicaoNome: null, total: 0, pendentes: 0 };
  if (!supabase || !profileId) return vazio;

  const { data: competicao } = await supabase
    .from('competicoes_matriz')
    .select('id,nome,data_inicio,data_fim')
    .eq('ativo', true)
    .eq('status', 'em_andamento')
    .maybeSingle();
  if (!competicao) return vazio;

  const ini = competicao.data_inicio;
  const fim = competicao.data_fim + 'T23:59:59.999';

  const [totaisPorTipo, minhasResp] = await Promise.all([
    Promise.all(TIPOS_AVALIAVEIS.map(async t => {
      const table = ENDPOINT_TABLE_MAP[t.endpoint] ?? t.endpoint;
      const { count } = await supabase!
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in('filial', OP_FILIAIS as unknown as string[])
        .gte(t.dateField, ini)
        .lte(t.dateField, fim);
      return count ?? 0;
    })),
    supabase
      .from('avaliacoes_matriz')
      .select('id', { count: 'exact', head: true })
      .eq('competicao_id', competicao.id)
      .eq('avaliador_id', profileId)
      .eq('ativo', true)
      .in('item_tipo', TIPOS_AVALIAVEIS.map(t => t.itemTipo)),
  ]);

  const total = totaisPorTipo.reduce((s, n) => s + n, 0);
  const meus = minhasResp.count ?? 0;

  return {
    competicaoNome: competicao.nome,
    total,
    pendentes: Math.max(0, total - meus),
  };
}
