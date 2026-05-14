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
  '/api/colaboradoresview':            'colaboradores',
  '/api/crmview':                      'clientes',
  '/api/crmview-fornecedores':         'fornecedores',
  '/api/produtosview':                 'produtos',
  '/api/servicosview':                 'servicos',
  '/api/centroscustoview':             'centros_custo',
  '/api/projetosview':                 'projetos',
  '/api/condicoespagamentoview':       'condicoes_pagamento',
  '/api/classificacoesauxiliaresview': 'classificacoes_auxiliares',
  '/api/mapeamentosrateioview':        'mapeamentos_rateio',
  '/api/formaspagamentoview':          'formas_pagamento',
  '/api/requisicoesview':              'requisicoes',
  '/api/cotacoesview':                 'cotacoes',
  '/api/pedidosview':                  'pedidos',
  '/api/minhasaprovacoesview':         'aprovacoes_compras',
  '/api/recebimentosview':             'recebimentos',
  '/api/notasrecebidasview':           'notas_recebidas',
  '/api/requisicoesestoqueview':       'requisicoes_estoque',
  '/api/minhasaprovacoesestoqueview':  'aprovacoes_estoque',
  '/api/expedicao':                    'expedicao',
  '/api/movimentacoesestoqueview':     'movimentacoes_estoque',
  '/api/saldosestoqueview':            'produtos',
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
};
