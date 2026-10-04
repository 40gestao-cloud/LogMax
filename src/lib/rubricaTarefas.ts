// Rubrica da nota 0-10 das Tarefas da Matriz (Central de Avaliação).
//
// Existe porque a régua do modal era só "0 não entregou / 5 o combinado /
// 8 superou / 10 referência", igual para Apresentação e Logística — e a
// severidade entre avaliadores sobre os mesmos participantes chegou a ir de
// 2,83 a 8,69. Sem dizer o que olhar e o que cada faixa quer dizer, cada
// conselheiro inventa a própria escala.
//
// As FAIXAS são uma régua só para todas as áreas (a nota vai para a mesma
// média da filial). O que muda por área é o que observar — os CRITÉRIOS.
// É orientação, não formulário: o conselho segue dando UMA nota por pessoa.

export type FaixaNota = { de: number; ate: number; titulo: string; descricao: string };

export const FAIXAS_NOTA: FaixaNota[] = [
  { de: 0,  ate: 2,  titulo: 'Não entregou',        descricao: 'Não fez, ou entregou algo que não responde ao que foi pedido.' },
  { de: 3,  ate: 4,  titulo: 'Abaixo do combinado', descricao: 'Entregou parte, ou com falhas que comprometem o resultado.' },
  { de: 5,  ate: 7,  titulo: 'Cumpriu o combinado', descricao: 'Entregou o que foi pedido, completo e correto.' },
  { de: 8,  ate: 9,  titulo: 'Superou',             descricao: 'Foi além do pedido: iniciativa, capricho ou solução melhor que a esperada.' },
  { de: 10, ate: 10, titulo: 'Referência',          descricao: 'Serviria de modelo para a turma inteira.' },
];

// Meio ponto (7,5) cai na faixa da parte inteira.
export const faixaDaNota = (nota: number | null): FaixaNota | null =>
  nota === null || !Number.isFinite(nota) ? null
    : FAIXAS_NOTA.find(f => Math.floor(nota) >= f.de && Math.floor(nota) <= f.ate) ?? null;

export const CRITERIOS_POR_TIPO: Record<string, string[]> = {
  tarefa_apresentacao: [
    'Clareza e organização da fala',
    'Domínio do conteúdo e dos números da unidade',
    'Postura, tempo e uso do material de apoio',
    'Resposta às perguntas do conselho',
  ],
  tarefa_treinamento_ia: [
    'Problema bem definido antes de recorrer à IA',
    'Qualidade do pedido (prompt) e das iterações',
    'Conferência crítica do que a IA devolveu',
    'Resultado aproveitável no trabalho da unidade',
  ],
  tarefa_rh: [
    'Processo seguido na ordem, com documentos e prazos',
    'Registro correto no sistema',
    'Comunicação e trato com as pessoas',
    'Resultado da ação para o quadro da unidade',
  ],
  tarefa_financeiro: [
    'Lançamentos corretos e no prazo',
    'Conferência: caixa, contas a pagar/receber, conciliação',
    'Leitura dos números e decisão justificada',
    'Organização dos comprovantes',
  ],
  tarefa_logistica: [
    'Fluxo de compra e recebimento seguido na ordem',
    'Estoque conferido e registrado',
    'Prazos cumpridos',
    'Tratamento de divergências (falta, avaria, validade)',
  ],
  tarefa_marketing: [
    'Objetivo e público bem definidos',
    'Qualidade da peça ou da campanha',
    'Coerência com a identidade da unidade',
    'Execução e resultado acompanhado',
  ],
  tarefa_treinamento_vendas: [
    'Abordagem e escuta do cliente',
    'Conhecimento do produto e da oferta',
    'Fechamento e registro correto no PDV',
    'Cordialidade e pós-venda',
  ],
};
