import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[LogMax] Supabase não configurado.\n' +
    'Crie um arquivo .env na raiz com:\n' +
    'VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co\n' +
    'VITE_SUPABASE_ANON_KEY=<sua-anon-key>\n' +
    'A aplicação rodará com dados locais até as credenciais serem configuradas.'
  );
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// Mapeamento: endpoint fictício → tabela real no Supabase
export const ENDPOINT_TABLE_MAP: Record<string, string> = {
  '/api/filiaisview':                  'filiais',
  '/api/crmview':                      'clientes',
  '/api/crmview-clientes':             'clientes',
  '/api/crmview-fornecedores':         'fornecedores',
  '/api/produtosview':                 'produtos',
  // Leitura de produtos COM custo. `produtos_com_custo` é uma view
  // security_invoker que faz LEFT JOIN em produtos_custo (migração 262): quem
  // não passa na RLS de custo recebe preco_custo = NULL em vez de erro.
  // Use este endpoint só para LER; escrita continua em '/api/produtosview'
  // (view não aceita INSERT/UPDATE) + upsert em produtos_custo.
  '/api/produtoscomcustoview':         'produtos_com_custo',
  '/api/servicosview':                 'servicos',
  '/api/centroscustoview':             'centros_custo',
  '/api/projetosview':                 'projetos',
  '/api/condicoespagamentoview':       'condicoes_pagamento',
  '/api/classificacoesauxiliaresview': 'classificacoes_auxiliares',
  '/api/formaspagamentoview':          'formas_pagamento',
  '/api/requisicoesview':              'requisicoes',
  '/api/cotacoesview':                 'cotacoes',
  '/api/pedidosview':                  'pedidos',
  '/api/minhasaprovacoesview':         'aprovacoes_compras',
  '/api/recebimentosview':             'recebimentos',
  '/api/notasrecebidasview':           'notas_recebidas',
  '/api/notasemitidasview':            'notas_emitidas',
  '/api/requisicoesestoqueview':       'requisicoes_estoque',
  '/api/minhasaprovacoesestoqueview':  'aprovacoes_estoque',
  '/api/expedicao':                    'expedicao',
  '/api/movimentacoesestoqueview':     'movimentacoes_estoque',
  '/api/saldosestoqueview':            'produtos',
  // Patrimônio exibe valor de custo do bem — lê pela view mascarada.
  '/api/patrimonioview':               'produtos_com_custo',
  '/api/inventariosestoqueview':       'inventarios',
  '/api/vencimentosestoqueview':       'vencimentos_estoque',
  '/api/contasreceberview':            'contas_receber',
  '/api/contaspagarview':              'contas_pagar',
  '/api/previsoesview':                'previsoes',
  '/api/duplicatasview':               'duplicatas',
  '/api/caixabancosview':              'caixa_bancos',
  '/api/integracaobancariaview':       'integracoes_bancarias',
  '/api/departamentosview':            'departamentos',
  '/api/cargosview':                   'cargos',
  '/api/funcionariosview':             'funcionarios',
  '/api/folhapagamentoview':           'folha_pagamento',
  '/api/feriasview':                   'ferias',
  '/api/pontoeletronicoview':          'ponto_eletronico',
  '/api/beneficiosview':               'beneficios',
  '/api/treinamentosview':             'treinamentos',
  '/api/vendasview':                   'vendas',
  '/api/itensvendaview':               'itens_venda',
  '/api/devolucoesview':               'devolucoes',
  '/api/marketingpromocoesview':       'marketing_promocoes',
  '/api/marketingtarefasview':         'marketing_tarefas',
  '/api/marketingartesview':           'marketing_artes',
  '/api/marketingartefeedbackview':    'marketing_arte_feedback',
  '/api/marketingcampanhasview':       'marketing_campanhas',
  '/api/marketingcuponsview':          'marketing_cupons',
  '/api/campanharoiview':              'v_campanha_roi',
  '/api/marketingcalendarioview':      'marketing_calendario',
  '/api/pdiitensview':                 'pdi_itens',
  '/api/treinamentoinscricoesview':    'treinamento_inscricoes',
  '/api/afastamentosview':             'afastamentos',
  '/api/frequenciatrabalhoview':       'frequencia_trabalho',
  '/api/relatoriosbiview':             'relatorios_bi',
  '/api/briefingsdiariosview':         'briefings_diarios',
  '/api/tarefasview':                  'tarefas',
  '/api/pesquisasview':                'pesquisas',
  '/api/pesquisaperguntasview':        'pesquisa_perguntas',
  '/api/pesquisarespostasview':        'pesquisa_respostas',
  '/api/pesquisarespostaitensview':    'pesquisa_resposta_itens',
  '/api/controlecaixaview':            'controle_caixa',
  '/api/desenvolvimentosiaview':       'desenvolvimentos_ia',
  '/api/notificacoesview':             'notificacoes',
  '/api/feedbacksorganizacaoview':     'feedbacks_organizacao',
  '/api/orcamentosview':               'orcamentos',
  '/api/pedidosvendaview':             'pedidos_venda',
  '/api/maxbankmetasview':             'maxbank_metas',
  '/api/metasestrategicasview':        'metas_estrategicas',
  '/api/tarefastaticasview':           'tarefas_taticas',
  '/api/justificativasfaltaview':     'justificativas_falta',
  '/api/ciclosavaliacaoview':         'ciclos_avaliacao',
  '/api/metricasredessociaisview':    'metricas_redes_sociais',
  // Orçamento por categoria + subcategorias + itens de campanha
  'categorias_produto':               'categorias_produto',
  'subcategorias_produto':            'subcategorias_produto',
  'itens_campanha':                   'itens_campanha',
  'capital_filial':                   'capital_filial',
  'requerimentos':                    'requerimentos',
  '/api/avaliacoesmatrizview':        'avaliacoes_matriz',
  '/api/competicoesmatrizview':       'competicoes_matriz',
  '/api/avaliacoesview':              'avaliacoes',
  '/api/frequenciatrabalhocomfilialview': 'frequencia_trabalho_com_filial',
  '/api/funcionariobeneficiosview':   'funcionario_beneficios',
};

// Tabelas com coluna `ativo BOOLEAN` (soft delete). useFetchData filtra
// automaticamente `ativo = true`; dbDeactivate faz UPDATE em vez de DELETE.
// Tabelas fora deste set continuam com hard delete (auditoria, cascades,
// transações efêmeras como pix_pendentes).
export const TABLES_WITH_ATIVO = new Set<string>([
  'filiais', 'clientes', 'fornecedores', 'produtos', 'produtos_com_custo', 'servicos',
  'centros_custo', 'projetos', 'condicoes_pagamento', 'classificacoes_auxiliares',
  'formas_pagamento', 'cargos', 'departamentos', 'beneficios',
  'caixa_bancos', 'funcionarios',
  'requisicoes', 'cotacoes', 'pedidos', 'recebimentos', 'notas_recebidas', 'notas_emitidas',
  'requisicoes_estoque', 'expedicao', 'movimentacoes_estoque', 'inventarios',
  'vencimentos_estoque',
  'contas_receber', 'contas_pagar', 'duplicatas', 'previsoes', 'controle_caixa',
  'integracoes_bancarias',
  'folha_pagamento', 'ferias', 'treinamentos',
  'vendas',
  'marketing_promocoes', 'marketing_tarefas',
  'marketing_campanhas', 'marketing_cupons', 'marketing_calendario',
  'treinamento_inscricoes', 'afastamentos', 'frequencia_trabalho', 'frequencia_trabalho_com_filial',
  'funcionario_beneficios',
  'relatorios_bi', 'briefings_diarios',
  'tarefas',
  'desenvolvimentos_ia',
  'feedbacks_organizacao',
  'orcamentos', 'pedidos_venda',
  'devolucoes',
  'maxbank_metas',
  'metas_estrategicas', 'tarefas_taticas',
  'justificativas_falta',
  'metricas_redes_sociais',
]);
