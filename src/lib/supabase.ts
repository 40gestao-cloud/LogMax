import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { purgarSessaoSeExpirada } from './sessaoGuard';
import { ancorarRelogioNoServidor } from './horaServidor';

// Relógio ancorado no servidor (ver `horaServidor.ts`). PRIMEIRA linha de tudo,
// antes do guard de sessão e do createClient: os dois decidem por hora, e numa
// máquina com o relógio adiantado é essa conta que derruba o login em laço.
ancorarRelogioNoServidor();

// Camada 2 do guard de sessão (ver `sessaoGuard.ts`): em máquina compartilhada,
// derruba a sessão que ficou da turma anterior.
//
// Roda AQUI, e não no main.tsx, porque precisa acontecer ANTES do createClient
// abaixo — o GoTrueClient lê o token do localStorage já no construtor. Com o
// token removido antes, `getSession()` devolve null e o app pinta o LoginScreen
// direto; feito num efeito do React, haveria um flash com a tela do usuário
// anterior. `sessaoGuard` só importa `dates` e `pontoHorarios`, então não há
// ciclo de import com este módulo.
purgarSessaoSeExpirada();

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
  // Fase 1 do plano de desembolso da montagem de filial (migr. 509) — item a
  // item do investimento, com centro de custo e vínculo com a conta gerada.
  '/api/filialinvestimentosview':      'filial_investimentos',
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
  '/api/demissoesview':                'demissoes',
  '/api/rescisoesview':                'rescisoes',
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
  // As quatro abaixo faltavam desde que Capital foi criado (migr. 155). Sem a
  // chave, `useFetchData` cai no `if (!table)`, loga um warn no console e
  // devolve `[]` — a tela não quebra, só fica vazia. Consequências que
  // ninguém tinha ligado à causa: a Matriz nunca viu pedido de empréstimo
  // (logo, nunca teve o que aprovar), a filial nunca viu as próprias
  // parcelas, o modal de aporte não listava banco, e a taxa de juros padrão
  // e a reserva mínima apareciam sempre zeradas.
  'emprestimos_filial':               'emprestimos_filial',
  'parcelas_emprestimo':              'parcelas_emprestimo',
  'capital_config':                   'capital_config',
  // Terceira vez a mesma armadilha (o teste tests/endpointMap.test.ts existe
  // por isso): Capital lia `distribuicoes_lucro` sem a chave, então a lista de
  // distribuições de lucro da filial e a da Matriz ficavam vazias em silêncio.
  'distribuicoes_lucro':              'distribuicoes_lucro',
  'caixa_bancos':                     'caixa_bancos',
  // RH → Funcionários lê os usuários da unidade para oferecer o cadastro já
  // preenchido. Sem esta chave o select saía com uma única opção ("cadastrar
  // do zero") e nenhum nome — o mesmo sintoma do bloco acima, silencioso.
  'user_profiles':                    'user_profiles',
  // Sem `created_at`: quem ler esta tabela precisa passar
  // `{ orderBy: 'filial' }`, senão o PostgREST devolve 400 e a tela fica
  // vazia do mesmo jeito, agora por outro motivo.
  'filial_caixa_config':              'filial_caixa_config',
  'requerimentos':                    'requerimentos',
  '/api/avaliacoesmatrizview':        'avaliacoes_matriz',
  '/api/competicoesmatrizview':       'competicoes_matriz',
  '/api/avaliacoesview':              'avaliacoes',
  '/api/frequenciatrabalhocomfilialview': 'frequencia_trabalho_com_filial',
  '/api/funcionariobeneficiosview':   'funcionario_beneficios',
  '/api/pedidosonlineview':           'pedidos_online',
  '/api/pedidosonlineitensview':      'pedidos_online_itens',
  // ATENÇÃO: `loja_config` é chaveada por `filial` e NÃO tem coluna `id`.
  // Serve para o useFetchData ler, mas `dbUpdate`/`dbDelete` filtram por
  // `.eq('id', …)` e falham com "column loja_config.id does not exist".
  // Para escrever, use um update direto por `filial` (vide PedidosOnlineView).
  // Mesma pegadinha em: configuracoes, filial_caixa_config, produtos_custo,
  // redes_sociais_links.
  '/api/lojaconfigview':              'loja_config',
  '/api/vagasview':                   'vagas',
  '/api/candidaturasview':            'candidaturas',
  '/api/candidaturaetapasview':       'candidatura_etapas',
  '/api/movimentacoescarreiraview':   'movimentacoes_carreira',
  // Fora de TABLES_WITH_ATIVO de propósito: responder marca `ativo = false`
  // para liberar o índice único e permitir reconvocação, mas o RH precisa
  // continuar vendo quem aceitou e quem recusou.
  '/api/vagaconvitesview':            'vaga_convites',
  // Conciliação da maquininha (migr. 570). Escrita só por RPC — a tela lê os
  // lotes já fechados por aqui.
  '/api/conciliacoesmaquininhaview': 'conciliacoes_maquininha',
  // Rateio administrativo da Matriz (migr. 323). A escrita é só por RPC;
  // estes dois entram no mapa apenas para o useFetchData conseguir ler.
  'rateio_administrativo':            'rateio_administrativo',
  'rateio_administrativo_itens':      'rateio_administrativo_itens',
};

// Tabelas com coluna `ativo BOOLEAN` (soft delete). useFetchData filtra
// automaticamente `ativo = true`; dbDeactivate faz UPDATE em vez de DELETE.
// Tabelas fora deste set continuam com hard delete (auditoria, cascades,
// transações efêmeras como pix_pendentes).
export const TABLES_WITH_ATIVO = new Set<string>([
  'filiais', 'filial_investimentos', 'clientes', 'fornecedores', 'produtos', 'produtos_com_custo', 'servicos',
  'centros_custo', 'projetos', 'condicoes_pagamento', 'classificacoes_auxiliares',
  'formas_pagamento', 'cargos', 'departamentos', 'beneficios',
  'caixa_bancos', 'funcionarios',
  'requisicoes', 'cotacoes', 'pedidos', 'recebimentos', 'notas_recebidas', 'notas_emitidas',
  'requisicoes_estoque', 'expedicao', 'movimentacoes_estoque', 'inventarios',
  'vencimentos_estoque',
  'contas_receber', 'contas_pagar', 'duplicatas', 'previsoes', 'controle_caixa',
  'conciliacoes_maquininha',
  'integracoes_bancarias',
  'folha_pagamento', 'ferias', 'treinamentos',
  'vendas',
  'marketing_promocoes', 'marketing_tarefas',
  'marketing_campanhas', 'marketing_cupons', 'marketing_calendario',
  'treinamento_inscricoes', 'afastamentos', 'frequencia_trabalho', 'frequencia_trabalho_com_filial',
  // Readmissão inativa a linha em vez de apagar — a tela de Desligamento pede
  // includeInactive para conseguir mostrar o histórico de readmitidos.
  'demissoes', 'rescisoes',
  'funcionario_beneficios',
  // Reverter um rateio inativa a linha; sem isto a competência revertida
  // continuaria listada como fechada. Os itens ficam de fora: só são lidos
  // através do pai, que já saiu da lista.
  'rateio_administrativo',
  // `loja_config` fica de fora de propósito: é uma linha fixa por filial, não
  // um cadastro que se apaga, e não tem coluna `ativo`.
  'pedidos_online',
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
  'vagas', 'candidaturas', 'movimentacoes_carreira',
]);
