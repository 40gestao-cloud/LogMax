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
  /**
   * Enriquece a aula mas o ciclo fecha sem ela. Aparece no diagrama e NÃO
   * conta para a cobertura: senão o alerta de cadeia incompleta acusaria
   * quebra em fluxo que roda perfeitamente.
   */
  opcional?: boolean;
  /**
   * A tela só existe no modo Matriz. Quem pode alcançá-la é admin, CEO e
   * conselheiro (os que escolhem filial) — e mesmo eles precisam TROCAR para
   * Matriz. Sem dizer isso, o professor libera o módulo, o aluno não acha a
   * tela e a culpa cai na whitelist.
   */
  soMatriz?: boolean;
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
  /** Colunas que não podem ser nulas para a linha valer. */
  naoNulo?: string[];
  /**
   * Conta por filial em vez de no total. Existe porque o total engana: 219
   * produtos cadastrados com zero na MaxLook fazem o check passar e a turma
   * daquela unidade abre o PDV sem nada para vender.
   */
  porFilial?: boolean;
  /** Quantas linhas bastam (por filial, quando `porFilial`). */
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

// `porFilial` nos catálogos operacionais: o aluno só vê o que é da unidade
// dele, então o total da holding não diz se a turma tem com o que trabalhar.
const PRE_PRODUTOS: AulaPreRequisito = {
  id: 'produtos', label: 'Produtos cadastrados', onde: 'Cadastros › Produtos',
  tabela: 'produtos', filtroAtivo: true, porFilial: true, minimo: 1,
};
const PRE_FORNECEDORES: AulaPreRequisito = {
  id: 'fornecedores', label: 'Fornecedores cadastrados', onde: 'Cadastros › Fornecedores',
  tabela: 'fornecedores', filtroAtivo: true, minimo: 1,
};
const PRE_CLIENTES: AulaPreRequisito = {
  id: 'clientes', label: 'Clientes cadastrados', onde: 'Vendas › Clientes',
  tabela: 'clientes', filtroAtivo: true, porFilial: true, minimo: 1,
};
// `naoNulo: filial` não é preciosismo: `auth_gerente_da(filial)` compara a
// filial do gerente com a da requisição, então gerente sem filial não decide
// nada e a cadeia de compra para na aprovação.
const PRE_GERENTE: AulaPreRequisito = {
  id: 'gerente', label: 'Gerente ativo com filial definida', onde: 'Usuários › editar o aluno',
  tabela: 'user_profiles', filtroAtivo: true, eq: { role: 'gerente' },
  naoNulo: ['filial'], minimo: 1,
};

// Não existe PRE_CAIXA: abrir o caixa do dia é a ETAPA 1 do fluxo de PDV, não
// algo que o professor prepara antes. Como pré-requisito ele nascia vermelho
// em toda aula de PDV — e ensinar o professor a ignorar alerta vermelho custa
// mais do que o alerta vale. (A primeira versão, além disso, não filtrava a
// data e contava caixas abertos de dias passados como se fossem de hoje.)

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
        view: 'compras-notasrecebidas', modulo: 'compras',
        titulo: 'Lançar a nota do fornecedor',
        quem: 'Setor de Compras',
        detalhe: 'Conferência documental: a nota tem de bater com o pedido e com o que entrou.',
        seQuebra: 'Nada — a conta a pagar já nasceu do pedido. Vale pela conferência.',
        opcional: true,
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
    id: 'material',
    nome: 'Material do almoxarifado — o que não passa por Compras',
    resumo: 'O par curto do fluxo de compra, e a lição está no contraste: o que já '
      + 'está na prateleira sai por liberação do Estoque, sem cotação nem pedido. '
      + 'Vale dar os dois na mesma aula.',
    prerequisitos: [PRE_PRODUTOS],
    etapas: [
      {
        view: 'requisicoes-dosetor', modulo: 'requisicoes',
        titulo: 'O setor pede material',
        quem: 'Colaborador de qualquer setor',
        detalhe: 'Mesma tela do pedido de compra, outra aba: o produto vem do catálogo '
          + 'porque a saída é do que já existe (`criar_requisicao_estoque`).',
        seQuebra: 'Não há por onde a cadeia começar.',
      },
      {
        view: 'estoque-liberarrequisições', modulo: 'estoque',
        titulo: 'O Estoque libera a saída',
        quem: 'Setor de Estoque (nunca quem pediu)',
        detalhe: 'Liberar dá baixa no saldo na hora — sem passar por Compras nem pelo Financeiro (migr. 284).',
        seQuebra: 'O pedido de material fica Pendente e o aluno conclui, errado, que todo pedido vira compra.',
      },
      {
        view: 'estoque-movimentações', modulo: 'estoque',
        titulo: 'Ver a baixa na movimentação',
        quem: 'Turma inteira',
        detalhe: 'Onde a liberação aparece como saída, lado a lado com as entradas de compra.',
        seQuebra: 'Nada — a baixa acontece igual. Vale para fechar o raciocínio.',
        opcional: true,
      },
    ],
  },
  {
    id: 'venda-pdv',
    nome: 'Venda no PDV — do caixa aberto ao recebimento',
    resumo: 'Curta e imediata: boa para a primeira aula, porque o aluno vê a baixa '
      + 'de estoque e a conta a receber nascerem do mesmo clique.',
    prerequisitos: [PRE_PRODUTOS],
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
        detalhe: 'Peça DUAS vendas do mesmo produto: uma em Dinheiro, outra em Fiado. '
          + 'É o contraste que faz a etapa de receber existir — e sem ele metade da '
          + 'aula vira slide. `criar_venda_pdv` baixa o estoque, gera a conta a receber '
          + 'e emite a nota, tudo numa transação só.',
        seQuebra: 'Não há venda para acompanhar.',
      },
      {
        view: 'estoque-saldos', modulo: 'estoque',
        titulo: 'Conferir a baixa no estoque',
        quem: 'Turma inteira',
        detalhe: 'O momento de mostrar que venda e estoque são o mesmo fato visto de dois lugares.',
        seQuebra: 'Nada na mecânica — a baixa acontece igual. Sem esta tela a integração fica abstrata.',
        opcional: true,
      },
      {
        view: 'financeiro-contasareceber', modulo: 'financeiro',
        titulo: 'Receber o que ficou a prazo',
        quem: 'Setor Financeiro',
        // O texto antigo ("à vista ou parcelado em 1x-12x") descrevia as opções
        // do PDV, não o que chega aqui — e mandava a turma para uma tela sem
        // ação. `criar_venda_pdv` só cria conta 'Aberto' em Fiado e Cartão
        // Crédito; Dinheiro, Pix e Débito nascem 'Pago', com vencimento hoje.
        detalhe: 'Só a venda a prazo dá trabalho aqui: Fiado e Cartão Crédito nascem '
          + '"Aberto" (30 dias, ou 30/60/90… no parcelado). Dinheiro, Pix e Débito '
          + 'entram já como "Pago" — a linha existe, mas não há o que receber, e é '
          + 'esse o ponto: à vista o dinheiro já entrou, a prazo virou direito a '
          + 'receber. O dinheiro do turno volta no fechamento do Controle de Caixa.',
        seQuebra: 'O outro lado da venda fica invisível.',
      },
      {
        view: 'financeiro-notasemitidas', modulo: 'financeiro',
        titulo: 'A nota que saiu sozinha',
        quem: 'Turma inteira',
        detalhe: 'Ninguém emitiu: `criar_venda_pdv` chama `emitir_nota` dentro da mesma '
          + 'transação, com numeração própria por filial e série. Boa hora para dizer '
          + 'que faturar não é uma tela a mais, é consequência de vender.',
        seQuebra: 'Nada — a nota sai igual. É a etapa que mostra o que o sistema fez sem pedir.',
        opcional: true,
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
        detalhe: 'Proposta ao cliente, ainda sem compromisso de estoque. Nasce Rascunho '
          + 'e o vendedor envia ao Financeiro — não dá para pular para o cliente.',
        seQuebra: 'Não há por onde começar.',
      },
      {
        // Etapa que faltava. O orçamento percorre Rascunho → Aguardando
        // Financeiro → Aprovado Financeiro → Enviado ao Cliente → Aprovado
        // Cliente, e só no último estado o botão Converter aparece. Sem esta
        // etapa no roteiro, o professor montava a aula sem o submenu do
        // Financeiro, o orçamento parava no primeiro estado e a turma
        // concluía que o sistema tinha travado.
        view: 'financeiro-aprovaçõesdeorçamento', modulo: 'financeiro',
        titulo: 'O Financeiro aprova a proposta',
        quem: 'Setor Financeiro',
        detalhe: 'Segunda autoridade do fluxo: quem vende não decide sozinho o preço que '
          + 'sai da loja. Aprovado aqui, Vendas envia ao cliente — e só depois do aceite '
          + 'dele o orçamento fica convertível.',
        seQuebra: 'O orçamento morre em "Aguardando Financeiro": o botão Converter só '
          + 'aparece em "Aprovado Cliente", e não há como chegar lá.',
      },
      {
        view: 'vendas-pedidosdevenda', modulo: 'vendas',
        titulo: 'Converter em pedido',
        quem: 'Setor de Vendas',
        detalhe: '`converter_orcamento_em_pedido` cria o pedido e a conta a receber na '
          + 'mesma transação. Exige o orçamento em "Aprovado Cliente".',
        seQuebra: 'O orçamento fica eterno — o aluno não vê a proposta virar compromisso.',
      },
      {
        // Era `estoque-expedição`, e era a tela errada: `expedicao` conhece
        // requisição de ALMOXARIFADO e produto solto, não pedido de venda —
        // tanto que `expedir` busca o destino em `requisicoes_estoque`. O
        // aluno não achava o pedido lá, e se tentasse se virar criava uma
        // expedição avulsa que baixava estoque por fora, sem vínculo nenhum.
        view: 'estoque-pedidosdevenda', modulo: 'estoque',
        titulo: 'Separar o pedido',
        quem: 'Setor de Estoque',
        detalhe: 'A fila "Pedidos a Separar" é a mesma tela do pedido, vista pelo Estoque. '
          + 'Separar lança a saída de cada item (migr. 400) — é aqui, e não na conversão, '
          + 'que a mercadoria deixa o saldo.',
        seQuebra: 'O pedido nunca sai; a turma não vê o efeito físico.',
      },
      {
        view: 'financeiro-contasareceber', modulo: 'financeiro',
        titulo: 'Receber do cliente',
        quem: 'Setor Financeiro',
        detalhe: 'Diferente do PDV à vista, aqui sempre há o que receber: a conversão cria '
          + 'a conta "Aberto" com 30 dias. Quitar a conta fecha o pedido sozinho — o '
          + 'recebimento não se registra na tela de Pedidos.',
        seQuebra: 'A venda não vira dinheiro na aula.',
      },
    ],
  },
  {
    id: 'rh-folha',
    nome: 'Pessoas — da contratação à folha paga',
    resumo: 'Atravessa RH inteiro e desemboca no Financeiro. Ensina que folha '
      + 'não é planilha à parte: é conta a pagar como qualquer outra.',
    // `porFilial` não é detalhe: as duas telas são filialScoped, cada unidade
    // tem os seus. Contando global, o painel ficava VERDE com os 2 cargos e o
    // 1 departamento que existiam só na Matriz, enquanto SuperMax, MaxLook e
    // TechMax — onde a aula acontece — estavam zeradas. O aluno só descobria
    // ao abrir o cadastro do funcionário e não achar o que selecionar.
    prerequisitos: [
      { id: 'cargos', label: 'Cargos cadastrados', onde: 'RH › Cargos', tabela: 'cargos', filtroAtivo: true, porFilial: true, minimo: 1 },
      { id: 'departamentos', label: 'Departamentos cadastrados', onde: 'RH › Departamentos', tabela: 'departamentos', filtroAtivo: true, porFilial: true, minimo: 1 },
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
        detalhe: 'Frequência é medida, não voto: entra no placar com peso próprio. '
          + 'Para chegar na FOLHA, porém, ela ainda depende do passo seguinte.',
        seQuebra: 'A folha sai sem lastro de jornada e vira número inventado.',
      },
      {
        // Etapa que faltava, e sem ela o `seQuebra` da anterior acontece de
        // qualquer jeito: marcar ponto não entra na folha sozinho. Quem traz é
        // `recalcular_folha_do_ponto`, um botão próprio na tela da Folha. Sem
        // esse clique a folha sai pelo salário base, atraso e falta não
        // descontam — exatamente o "número inventado" que o roteiro temia.
        view: 'rh-folhadepagamento', modulo: 'rh',
        titulo: 'Trazer o ponto para a folha',
        quem: 'Setor de RH',
        detalhe: 'O botão "Recalcular do ponto" na folha do mês: ele lê o ponto do '
          + 'período e transforma atraso, falta e hora extra em rubrica. É aqui que a '
          + 'jornada vira dinheiro — antes disso a folha é só o salário do contrato.',
        seQuebra: 'A folha processa com o salário base, e o ponto que a turma marcou '
          + 'não muda um centavo. Pior que não ter ponto: dá a impressão de que tem.',
      },
      {
        view: 'rh-folhadepagamento', modulo: 'rh',
        titulo: 'Processar a folha',
        quem: 'Setor de RH',
        detalhe: '`processar_folha` lança a folha direto em contas a pagar. Exige '
          + 'líquido maior que zero e folha ainda Pendente.',
        seQuebra: 'O trabalho do mês não vira obrigação financeira.',
      },
      {
        view: 'financeiro-contasapagar', modulo: 'financeiro',
        titulo: 'Pagar a folha',
        quem: 'Setor Financeiro',
        // Quem processa não paga (`processar_folha` cobra RH, pagar cobra
        // Financeiro), e pagar dispara mais do que o roteiro dizia: a trigger
        // credita a carteira e só então a folha vira Paga.
        detalhe: 'Onde o custo de pessoal aparece junto com todos os outros — e quem '
          + 'processou não paga. Pagar aqui credita salário e benefícios na carteira '
          + 'MaxBank do colaborador e só então a folha vira "Paga". O RH confere pelo '
          + 'botão Carteira, na linha da folha (o MaxBank é outro app — dentro do '
          + 'LogMax é por ali que se vê o crédito).',
        seQuebra: 'A folha é processada e some da vista da turma — e ninguém recebe: '
          + 'o crédito na carteira pendura no pagamento desta conta.',
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
        // Opcional na mecânica: `campanha_id` é nullable e a promoção existe
        // sem ela. O próprio seQuebra já dizia isso — é perda de contexto, não
        // quebra de cadeia —, mas a etapa contava na cobertura e fazia o Montar
        // acusar cadeia incompleta sem necessidade.
        view: 'marketing-campanhas', modulo: 'marketing',
        titulo: 'Planejar a campanha',
        quem: 'Setor de Marketing',
        detalhe: 'O guarda-chuva a que promoções e cupons se penduram. A promoção '
          + 'funciona sem campanha; com ela, o ROI passa a ter a quem pertencer.',
        seQuebra: 'A promoção nasce sem contexto de campanha.',
        opcional: true,
      },
      {
        view: 'marketing-promoções', modulo: 'marketing',
        titulo: 'Propor o desconto',
        quem: 'Setor de Marketing',
        detalhe: 'A data de fim é obrigatória, e é ela que devolve o preço: o cron só '
          + 'reverte promoção com prazo vencido. Sem prazo, o preço promocional viraria '
          + 'o preço da casa — remarcação disfarçada de promoção.',
        seQuebra: 'Não há o que aprovar.',
      },
      {
        view: 'financeiro-aprovaçõesdepromoções', modulo: 'financeiro',
        titulo: 'O Financeiro aprova o desconto',
        quem: 'Setor Financeiro (nunca quem propôs)',
        detalhe: 'Segunda autoridade: quem quer vender não define sozinho a margem. '
          + '`aprovar_promocao` muda o status E o preço do produto na mesma transação '
          + '(migr. 402) — aprovação que não chega ao PDV não fica de pé.',
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
      + 'gasta e depois presta contas. Conduzido no modo Matriz.',
    matriz: true,
    prerequisitos: [PRE_GERENTE],
    etapas: [
      {
        // Abertura em RH desde 2026-08-08: o fluxo perdeu a etapa de auditoria
        // e ficaria inteiro dentro de Financeiro — fluxo de um módulo só é
        // atalho, não cadeia. O mandato também é o começo real da história:
        // quem pede verba é o gestor nomeado para responder pela unidade.
        view: 'rh-mandatos', modulo: 'rh',
        titulo: 'O Conselho nomeia quem responde pela unidade',
        quem: 'Conselho',
        detalhe: 'Cargo com início, fim e ato de nomeação — sem isso, pedir '
          + 'verba não tem dono.',
        seQuebra: 'A verba é pedida por alguém que ninguém nomeou.',
      },
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
        view: 'financeiro-prestaçãodecontas', modulo: 'financeiro',
        titulo: 'O Conselho julga as contas',
        quem: 'Conselho (nunca quem prestou)',
        detalhe: 'Aprovar, ressalvar ou reprovar — ressalva vira tarefa com prazo.',
        seQuebra: 'Prestar contas vira formalidade sem consequência.',
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

/** Etapas sem as quais o ciclo não fecha. As opcionais enriquecem, não travam. */
export const etapasObrigatorias = (f: AulaFluxo): AulaEtapa[] =>
  f.etapas.filter(e => !e.opcional);

export type CadeiaQuebrada = {
  fluxo: AulaFluxo;
  cobertas: number;
  total: number;
  faltando: AulaEtapa[];
};

/**
 * Fluxos que a config atual começou e não termina.
 *
 * O critério não é "tem alguma etapa ligada": módulos compartilhados fariam
 * quase todo fluxo parecer começado. Ligar só Financeiro toca uma etapa de
 * seis fluxos diferentes, e a tela despejava seis alertas — o que treina o
 * professor a ignorá-los.
 *
 * Entra na lista quem a turma consegue de fato COMEÇAR (primeira etapa
 * obrigatória liberada) ou quem já está com metade da cadeia de pé. Nos dois
 * casos há uma aula em andamento que vai parar no meio; fora deles é só um
 * módulo que serve a outro assunto.
 */
export function analisarCadeias(
  modulos: string[],
  submenus: string[],
): CadeiaQuebrada[] {
  return AULA_FLUXOS
    .map(fluxo => {
      const obrigatorias = etapasObrigatorias(fluxo);
      const faltando = obrigatorias.filter(e => !etapaCoberta(e, modulos, submenus));
      const cobertas = obrigatorias.length - faltando.length;
      const comecou = obrigatorias.length > 0
        && etapaCoberta(obrigatorias[0], modulos, submenus);
      return { fluxo, cobertas, total: obrigatorias.length, faltando, comecou };
    })
    .filter(c => c.faltando.length > 0
      && (c.comecou || c.cobertas / c.total >= 0.5))
    // Mais perto de fechar primeiro: é o que o professor provavelmente quis montar.
    .sort((a, b) => b.cobertas / b.total - a.cobertas / a.total)
    .map(({ fluxo, cobertas, total, faltando }) => ({ fluxo, cobertas, total, faltando }));
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

// O aviso de segregação de funções vive na própria tela (AulaModoView): ele é
// só texto sobre `AULA_MODULO_SETORES`, e uma função aqui para montar frase
// seria indireção sem ganho.
