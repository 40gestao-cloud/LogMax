// Fluxos de operação do Modo Aula.
//
// O problema que isto resolve: o Modo Aula raciocina por MÓDULO, e a operação
// que se quer ensinar acontece em CADEIA — atravessa módulos, papéis e, às
// vezes, filiais. Ligar "Requisições" e nada mais dá ao aluno a tela de abrir
// o pedido e nenhuma das seis telas seguintes; a aula trava no meio e o
// professor descobre isso na frente da turma.
//
// Era pior que uma inconveniência: o atalho "Logística" ligava
// cadastros+compras+estoque SEM Financeiro, e a cotação morre em "Aguardando
// Financeiro" porque é `gerar_pedido_de_cotacao` (migr. 336) quem cria o
// pedido e a conta a pagar de uma vez. O atalho mais óbvio da tela montava
// uma aula que não fechava.
//
// Este arquivo é a fonte de verdade única de três coisas na tela de Modo Aula:
//   1. o preset por fluxo (liga exatamente as etapas da cadeia);
//   2. o alerta de cadeia quebrada (`analisarCadeias`);
//   3. o diagrama que o professor projeta para a turma.
// Uma só lista para os três, senão elas divergem na primeira mudança.
//
// As etapas foram lidas das RPCs, não da navegação da sidebar. Quando o texto
// diz que uma etapa depende da outra, é porque o banco recusa a operação sem
// ela — as referências às migrações estão em cada `seQuebra`.

import type { AulaConfig } from '../hooks/useAulaConfig';

export type AulaEtapa = {
  /** viewId da tela (submenu ou view top-level). Vazio = etapa sem tela própria. */
  view: string;
  /** Módulo que precisa estar ligado para esta etapa existir. */
  modulo: string;
  titulo: string;
  /** Quem executa. É a dimensão que o Modo Aula não tem e que trava aula. */
  quem: string;
  /** O que o sistema faz aqui — o que o aluno tem de observar. */
  detalhe: string;
  /** O que acontece com a turma se esta etapa ficar de fora. */
  seQuebra: string;
};

export type AulaPreRequisito = {
  id: string;
  label: string;
  /** Onde resolver, em linguagem de menu. */
  onde: string;
  /** Tabela e filtros para contar o que existe. Só colunas que existem nas 4 turmas. */
  tabela: string;
  filtroAtivo?: boolean;
  eq?: Record<string, string>;
  /** Quantas linhas bastam. */
  minimo: number;
};

export type AulaFluxo = {
  id: string;
  nome: string;
  resumo: string;
  /** Só faz sentido no modo Matriz (pauta de holding). */
  matriz?: boolean;
  etapas: AulaEtapa[];
  prerequisitos: AulaPreRequisito[];
};

const PRE_PRODUTOS: AulaPreRequisito = {
  id: 'produtos', label: 'Produtos cadastrados', onde: 'Cadastros › Produtos',
  tabela: 'produtos', filtroAtivo: true, minimo: 1,
};
const PRE_FORNECEDORES: AulaPreRequisito = {
  id: 'fornecedores', label: 'Fornecedores cadastrados', onde: 'Cadastros › Fornecedores',
  tabela: 'fornecedores', filtroAtivo: true, minimo: 1,
};
const PRE_CLIENTES: AulaPreRequisito = {
  id: 'clientes', label: 'Clientes cadastrados', onde: 'Vendas › Clientes',
  tabela: 'clientes', filtroAtivo: true, minimo: 1,
};
const PRE_GERENTE: AulaPreRequisito = {
  id: 'gerente', label: 'Alguém com papel de gerente', onde: 'Usuários › editar o aluno',
  tabela: 'user_profiles', eq: { role: 'gerente' }, minimo: 1,
};
const PRE_CAIXA: AulaPreRequisito = {
  id: 'caixa', label: 'Caixa aberto hoje', onde: 'Financeiro › Controle de Caixa',
  tabela: 'controle_caixa', filtroAtivo: true, eq: { status: 'Aberto' }, minimo: 1,
};

export const AULA_FLUXOS: AulaFluxo[] = [
  {
    id: 'compra',
    nome: 'Compra — da necessidade ao pagamento',
    resumo: 'A cadeia mais longa do sistema e a que mais ensina: passa por quatro '
      + 'módulos e por duas autoridades diferentes antes de virar dinheiro saindo.',
    prerequisitos: [PRE_PRODUTOS, PRE_FORNECEDORES, PRE_GERENTE],
    etapas: [
      {
        view: 'requisicoes-dosetor', modulo: 'requisicoes',
        titulo: 'O setor pede o que falta',
        quem: 'Colaborador de qualquer setor',
        detalhe: 'Reposição vem do catálogo e se explica pelo saldo; compra eventual exige justificativa.',
        seQuebra: 'Não há por onde a cadeia começar.',
      },
      {
        view: 'requisicoes-aprovações', modulo: 'requisicoes',
        titulo: 'O gerente da filial decide',
        quem: 'Gerente da filial (nunca quem abriu)',
        detalhe: 'É aqui que a segregação de funções aparece na prática.',
        seQuebra: 'A requisição fica Pendente para sempre: `decidir_requisicao_compra` '
          + 'recusa o próprio autor e exige o gerente da filial (migr. 282).',
      },
      {
        view: 'compras-requisiçõesdecompra', modulo: 'compras',
        titulo: 'Compras recebe a requisição aprovada',
        quem: 'Setor de Compras',
        detalhe: 'A demanda do setor vira trabalho de comprador.',
        seQuebra: 'A requisição é aprovada e some — ninguém na turma a recebe.',
      },
      {
        view: 'compras-cotações', modulo: 'compras',
        titulo: 'Cotação com os fornecedores',
        quem: 'Setor de Compras',
        detalhe: 'Comparar preço é o exercício; a cotação escolhida segue para o Financeiro.',
        seQuebra: 'Não há como transformar a requisição em compra.',
      },
      {
        view: 'financeiro-aprovaçõesdecotação', modulo: 'financeiro',
        titulo: 'O Financeiro aprova por alçada',
        quem: 'Setor Financeiro (alçada por valor)',
        detalhe: 'Segunda autoridade da cadeia: quem cota não libera o gasto.',
        seQuebra: 'A cotação para em "Aguardando Financeiro" e ninguém na turma destrava.',
      },
      {
        view: 'compras-pedidos', modulo: 'compras',
        titulo: 'Pedido emitido ao fornecedor',
        quem: 'Setor de Compras',
        detalhe: '`gerar_pedido_de_cotacao` cria o pedido E a conta a pagar na mesma transação (migr. 336).',
        seQuebra: 'A aprovação do Financeiro não tem efeito visível para a turma.',
      },
      {
        view: 'estoque-recebimentos', modulo: 'estoque',
        titulo: 'Estoque confere e dá entrada',
        quem: 'Setor de Estoque / Logística',
        detalhe: 'Receber parcial é o caso interessante: o saldo do pedido controla o resto.',
        seQuebra: 'A mercadoria nunca entra e o saldo não se mexe — o aluno não vê o efeito da compra.',
      },
      {
        view: 'financeiro-contasapagar', modulo: 'financeiro',
        titulo: 'O Financeiro paga',
        quem: 'Setor Financeiro',
        detalhe: 'Fecha o ciclo: a necessidade de um setor virou saída de caixa.',
        seQuebra: 'A conta a pagar existe e ninguém a liquida — o ciclo não fecha.',
      },
    ],
  },
  {
    id: 'venda-pdv',
    nome: 'Venda no PDV — do caixa aberto ao recebimento',
    resumo: 'Curta e imediata: boa para a primeira aula, porque o aluno vê a baixa '
      + 'de estoque e a conta a receber nascerem do mesmo clique.',
    prerequisitos: [PRE_PRODUTOS, PRE_CAIXA],
    etapas: [
      {
        view: 'financeiro-controledecaixa', modulo: 'financeiro',
        titulo: 'Abrir o caixa do dia',
        quem: 'Financeiro ou operador da filial',
        detalhe: 'Um caixa por unidade por dia.',
        seQuebra: 'O PDV não vende: sem caixa aberto a tela bloqueia antes do primeiro item.',
      },
      {
        view: 'vendas-pdv', modulo: 'vendas',
        titulo: 'Vender',
        quem: 'Operador de caixa',
        detalhe: '`criar_venda_pdv` baixa o estoque e gera a conta a receber numa transação só.',
        seQuebra: 'Não há venda para acompanhar.',
      },
      {
        view: 'estoque-saldos', modulo: 'estoque',
        titulo: 'Conferir a baixa no estoque',
        quem: 'Turma inteira',
        detalhe: 'O momento de mostrar que venda e estoque são o mesmo fato visto de dois lugares.',
        seQuebra: 'A baixa acontece e ninguém a enxerga — a integração fica abstrata.',
      },
      {
        view: 'financeiro-contasareceber', modulo: 'financeiro',
        titulo: 'Receber',
        quem: 'Setor Financeiro',
        detalhe: 'À vista ou parcelado em 1x-12x; o fechamento do caixa volta ao Controle de Caixa.',
        seQuebra: 'O outro lado da venda fica invisível.',
      },
    ],
  },
  {
    id: 'venda-pedido',
    nome: 'Orçamento vira pedido e sai da loja',
    resumo: 'A venda que não é balcão: proposta, conversão e expedição. '
      + 'Mostra por que existe pedido separado do PDV.',
    prerequisitos: [PRE_CLIENTES, PRE_PRODUTOS],
    etapas: [
      {
        view: 'vendas-orçamentos', modulo: 'vendas',
        titulo: 'Montar o orçamento',
        quem: 'Setor de Vendas',
        detalhe: 'Proposta ao cliente, ainda sem compromisso de estoque.',
        seQuebra: 'Não há por onde começar.',
      },
      {
        view: 'vendas-pedidosdevenda', modulo: 'vendas',
        titulo: 'Converter em pedido',
        quem: 'Setor de Vendas',
        detalhe: '`converter_orcamento_em_pedido` cria o pedido e a conta a receber.',
        seQuebra: 'O orçamento fica eterno — o aluno não vê a proposta virar compromisso.',
      },
      {
        view: 'estoque-expedição', modulo: 'estoque',
        titulo: 'Separar e expedir',
        quem: 'Setor de Estoque',
        detalhe: 'É a etapa que transforma um documento em mercadoria saindo.',
        seQuebra: 'O pedido nunca sai; a turma não vê o efeito físico.',
      },
      {
        view: 'financeiro-contasareceber', modulo: 'financeiro',
        titulo: 'Receber do cliente',
        quem: 'Setor Financeiro',
        detalhe: 'Fecha o ciclo comercial.',
        seQuebra: 'A venda não vira dinheiro na aula.',
      },
    ],
  },
  {
    id: 'rh-folha',
    nome: 'Pessoas — da contratação à folha paga',
    resumo: 'Atravessa RH inteiro e desemboca no Financeiro. Ensina que folha '
      + 'não é planilha à parte: é conta a pagar como qualquer outra.',
    prerequisitos: [
      { id: 'cargos', label: 'Cargos cadastrados', onde: 'RH › Cargos', tabela: 'cargos', filtroAtivo: true, minimo: 1 },
      { id: 'departamentos', label: 'Departamentos cadastrados', onde: 'RH › Departamentos', tabela: 'departamentos', filtroAtivo: true, minimo: 1 },
    ],
    etapas: [
      {
        view: 'rh-recrutamentoeseleção', modulo: 'rh',
        titulo: 'Abrir a vaga e selecionar',
        quem: 'Setor de RH',
        detalhe: 'Cargo de RH não é role de RBAC — vale dizer isso em voz alta na aula.',
        seQuebra: 'A cadeia começa com o funcionário já contratado, perdendo a etapa de decisão.',
      },
      {
        view: 'rh-funcionários', modulo: 'rh',
        titulo: 'Registrar o funcionário',
        quem: 'Setor de RH',
        detalhe: 'Funcionários é a fonte única; é daqui que a folha lê.',
        seQuebra: 'Não há de quem processar folha.',
      },
      {
        view: 'rh-registrodeponto', modulo: 'rh',
        titulo: 'Marcar ponto',
        quem: 'Cada aluno, por si',
        detalhe: 'Frequência é medida, não voto: entra no placar com peso próprio.',
        seQuebra: 'A folha sai sem lastro de jornada e vira número inventado.',
      },
      {
        view: 'rh-folhadepagamento', modulo: 'rh',
        titulo: 'Processar a folha',
        quem: 'Setor de RH',
        detalhe: '`processar_folha` lança a folha direto em contas a pagar.',
        seQuebra: 'O trabalho do mês não vira obrigação financeira.',
      },
      {
        view: 'financeiro-contasapagar', modulo: 'financeiro',
        titulo: 'Pagar a folha',
        quem: 'Setor Financeiro',
        detalhe: 'Onde o custo de pessoal aparece junto com todos os outros.',
        seQuebra: 'A folha é processada e some da vista da turma.',
      },
    ],
  },
  {
    id: 'marketing-promo',
    nome: 'Promoção aprovada chega ao PDV',
    resumo: 'Mostra que marketing não decide preço sozinho: o desconto passa '
      + 'pelo Financeiro antes de existir no caixa.',
    prerequisitos: [PRE_PRODUTOS],
    etapas: [
      {
        view: 'marketing-campanhas', modulo: 'marketing',
        titulo: 'Planejar a campanha',
        quem: 'Setor de Marketing',
        detalhe: 'O guarda-chuva a que promoções e cupons se penduram.',
        seQuebra: 'A promoção nasce sem contexto de campanha.',
      },
      {
        view: 'marketing-promoções', modulo: 'marketing',
        titulo: 'Propor o desconto',
        quem: 'Setor de Marketing',
        detalhe: 'Promoção tem prazo — o cron devolve o preço quando vence.',
        seQuebra: 'Não há o que aprovar.',
      },
      {
        view: 'financeiro-aprovaçõesdepromoções', modulo: 'financeiro',
        titulo: 'O Financeiro aprova o desconto',
        quem: 'Setor Financeiro',
        detalhe: 'Segunda autoridade: quem quer vender não define sozinho a margem.',
        seQuebra: 'A promoção fica pendente e o preço no PDV nunca muda.',
      },
      {
        view: 'marketing-cupons', modulo: 'marketing',
        titulo: 'Emitir cupons',
        quem: 'Setor de Marketing',
        detalhe: 'O cupom é validado no PDV por `validar_cupom`.',
        seQuebra: 'Sobra a promoção de preço, sem o exercício do cupom.',
      },
      {
        view: 'vendas-pdv', modulo: 'vendas',
        titulo: 'Vender com o desconto',
        quem: 'Operador de caixa',
        detalhe: 'O ponto do fluxo: o aluno vê o preço mudar por decisão de outro setor.',
        seQuebra: 'A promoção existe no papel e nunca chega ao cliente.',
      },
    ],
  },
  {
    id: 'governanca',
    nome: 'Verba pedida, gasta e prestada',
    resumo: 'A pauta de holding: a unidade propõe, o Conselho concede, a unidade '
      + 'explica e a auditoria revisa. Conduzido no modo Matriz.',
    matriz: true,
    prerequisitos: [PRE_GERENTE],
    etapas: [
      {
        view: 'financeiro-orçamentoanual', modulo: 'financeiro',
        titulo: 'A unidade propõe a verba',
        quem: 'Gerente ou CEO da unidade',
        detalhe: 'Monta as rubricas e submete; devolvido volta para cá.',
        seQuebra: 'Não há verba para deliberar.',
      },
      {
        view: 'financeiro-orçamentoanual', modulo: 'financeiro',
        titulo: 'O Conselho concede ou corta',
        quem: 'Conselho (nunca quem propôs)',
        detalhe: 'Mesma tela, outro papel — é o que torna a segregação visível.',
        seQuebra: 'O orçamento fica submetido para sempre.',
      },
      {
        view: 'financeiro-prestaçãodecontas', modulo: 'financeiro',
        titulo: 'A unidade presta contas',
        quem: 'Gerente ou CEO da unidade',
        detalhe: 'Enquanto for rascunho, o Conselho não tem o que julgar.',
        seQuebra: 'O dinheiro é gasto e ninguém responde por ele.',
      },
      {
        view: 'comite-auditoria', modulo: 'auditoria',
        titulo: 'O Comitê questiona e encerra',
        quem: 'Conselho pergunta, a unidade responde',
        detalhe: 'Conforme ou não conforme; a trilha das operações fica na aba ao lado.',
        seQuebra: 'A prestação de contas é julgada sem contraditório.',
      },
    ],
  },
];

/** Todos os módulos que um fluxo exige. */
export const modulosDoFluxo = (f: AulaFluxo): string[] =>
  Array.from(new Set(f.etapas.map(e => e.modulo)));

/**
 * Views do fluxo que são submenu (têm prefixo `modulo-`). Views top-level
 * ficam de fora: elas não entram em `submenus_ativos`, basta o módulo.
 */
export const submenusDoFluxo = (f: AulaFluxo): string[] =>
  Array.from(new Set(
    f.etapas.filter(e => e.view.startsWith(`${e.modulo}-`)).map(e => e.view),
  ));

/** Uma etapa está coberta pela config atual? */
export function etapaCoberta(
  etapa: AulaEtapa,
  modulos: string[],
  submenus: string[],
): boolean {
  if (!modulos.includes(etapa.modulo)) return false;
  // Sem whitelist de submenu para o módulo, todos os submenus dele valem.
  const doModulo = submenus.filter(s => s.startsWith(`${etapa.modulo}-`));
  if (doModulo.length === 0) return true;
  if (!etapa.view.startsWith(`${etapa.modulo}-`)) return true;  // top-level
  return doModulo.includes(etapa.view);
}

export type CadeiaQuebrada = {
  fluxo: AulaFluxo;
  cobertas: number;
  faltando: AulaEtapa[];
};

/**
 * Fluxos que a config atual começou e não termina.
 *
 * Um fluxo entra na lista quando ao menos uma etapa está ligada — sinal de que
 * o professor quis trabalhá-lo — e ao menos uma está faltando. Fluxo com nada
 * ligado não é "quebrado", é só um assunto que não é o de hoje.
 */
export function analisarCadeias(
  modulos: string[],
  submenus: string[],
): CadeiaQuebrada[] {
  return AULA_FLUXOS
    .map(fluxo => {
      const faltando = fluxo.etapas.filter(e => !etapaCoberta(e, modulos, submenus));
      return { fluxo, cobertas: fluxo.etapas.length - faltando.length, faltando };
    })
    .filter(c => c.cobertas > 0 && c.faltando.length > 0)
    // Mais perto de fechar primeiro: é o que o professor provavelmente quis montar.
    .sort((a, b) => b.cobertas / b.fluxo.etapas.length - a.cobertas / a.fluxo.etapas.length);
}

/** Config que liga exatamente o fluxo, preservando o resto? Não: fluxo é foco. */
export function configDoFluxo(f: AulaFluxo): { modulos: string[]; submenus: string[] } {
  return { modulos: modulosDoFluxo(f), submenus: submenusDoFluxo(f) };
}

/** Une o fluxo à config atual, sem tirar nada. Usado pelo "completar cadeia". */
export function completarComFluxo(
  f: AulaFluxo,
  modulos: string[],
  submenus: string[],
): { modulos: string[]; submenus: string[] } {
  const novosSubs = new Set(submenus);
  for (const etapa of f.etapas) {
    // Só acrescenta submenu onde JÁ existe whitelist para aquele módulo —
    // criar uma do nada restringiria um módulo que estava inteiro liberado.
    const temWhitelist = submenus.some(s => s.startsWith(`${etapa.modulo}-`));
    const novoModulo = !modulos.includes(etapa.modulo);
    if ((temWhitelist || novoModulo) && etapa.view.startsWith(`${etapa.modulo}-`)) {
      novosSubs.add(etapa.view);
    }
  }
  return {
    modulos: Array.from(new Set([...modulos, ...modulosDoFluxo(f)])),
    submenus: Array.from(novosSubs),
  };
}

/**
 * Setores que esta config concede a TODOS os alunos filtrados (migr. 317).
 *
 * A whitelist da aula substitui o recorte por setor em vez de intersectar com
 * ele, então um fluxo largo entrega vários setores à turma inteira — e a
 * segregação de funções que o fluxo pretende ensinar ("quem abre não aprova")
 * some junto. A tela avisa; mudar a concessão é decisão separada.
 */
export function alertaDeSegregacao(setores: string[], config: AulaConfig): string | null {
  if (!config.ativo || setores.length < 2) return null;
  return `Esta configuração concede ${setores.length} setores (${setores.join(', ')}) `
    + 'a todos os alunos afetados ao mesmo tempo. As travas de papel do banco continuam '
    + 'valendo — quem abre uma requisição segue sem poder aprová-la —, mas dentro de um '
    + 'mesmo aluno os setores se somam. Para a aula de segregação de funções, prefira '
    + 'ligar menos módulos e distribuir os papéis entre os alunos.';
}
