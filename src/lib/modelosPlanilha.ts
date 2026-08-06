// Modelos de planilha para preenchimento antes do lançamento no LogMax.
//
// Uso didático: em aula, a turma primeiro monta o cadastro no Excel/Google
// Planilhas e só depois digita no sistema. O modelo baixado é o espelho do
// formulário da tela — mesmos campos, na mesma ordem de preenchimento, mesma
// obrigatoriedade, mesmas listas de opção — pra que a passagem da planilha pro
// LogMax seja transcrição, não tradução.
//
// Cada arquivo tem duas abas: "Instruções" (o que é cada campo) e uma aba de
// preenchimento com o nome da ação no topo e uma coluna por campo.
//
// IMPORTANTE: isto é SÓ download. Não existe import de volta — preencher a
// planilha não cria nada no banco. Se um dia houver import, ele precisa passar
// pelas mesmas RPC/RLS do form; não confie no arquivo.
//
// Os campos aqui são mantidos à mão em espelho dos forms:
//   clientes/fornecedores → CRMView.tsx
//   produtos              → ProdutosView.tsx
//   servicos              → ServicosView.tsx
//   requisicoes           → RequisicoesSetorView.tsx
// Mexeu no form, mexe aqui — inclusive na ORDEM dos campos.

import { GOLD_HEX, BLACK_HEX, GOLD_TINT_HEX } from './pdfPalette';
import { unidadesDeProduto, unidadesDeRequisicao, itemExemploDaFilial } from './unidades';

export type ModeloFormato = 'texto' | 'moeda' | 'inteiro' | 'decimal' | 'data';

export type ModeloCampo = {
  /** Cabeçalho da coluna. O ` *` de obrigatório é acrescentado pelo gerador. */
  col: string;
  obrigatorio?: boolean;
  /** Valor de exemplo — vai pra aba Instruções e pra nota do cabeçalho. */
  exemplo?: string;
  /** Explicação curta do campo. */
  dica?: string;
  /** Opções fechadas: vira dropdown na coluna (validação de dados do Excel). */
  lista?: readonly string[];
  formato?: ModeloFormato;
};

export type Modelo = {
  /** Nome da ação — vai no topo da aba de preenchimento e nomeia a aba. */
  acao: string;
  /** Título longo da aba Instruções. */
  titulo: string;
  arquivo: string;
  intro: string;
  campos: ModeloCampo[];
};

export type ModeloEntidade =
  | 'clientes' | 'fornecedores' | 'produtos' | 'servicos' | 'requisicoes';

const SIM_NAO = ['Sim', 'Não'] as const;
const ATIVO_INATIVO = ['Ativo', 'Inativo'] as const;

// ---------------------------------------------------------------------------
// Campos por nicho — espelham ATRIBUTOS_* das views. Só as filiais operacionais
// têm atributo extra; Matriz e SuperMax (nos casos abaixo) ficam com o básico.
// ---------------------------------------------------------------------------

const ATRIBUTOS_FORNECEDOR: Record<string, ModeloCampo[]> = {
  MaxLook: [
    { col: 'Tipo de fornecedor', lista: ['Grife', 'Confecção', 'Atacado moda', 'Acessórios', 'Calçados'], exemplo: 'Confecção' },
    { col: 'Marcas representadas', exemplo: 'Colcci, Hering', dica: 'Separe por vírgula.' },
    { col: 'MOQ (mín. por pedido, peças)', formato: 'inteiro', exemplo: '12' },
  ],
  TechMax: [
    { col: 'Tipo de fornecedor', lista: ['Autorizada', 'Distribuidor', 'Peças', 'Acessórios'], exemplo: 'Distribuidor' },
    { col: 'Marcas atendidas', exemplo: 'Apple, Samsung', dica: 'Separe por vírgula.' },
    { col: 'Garantia da peça (dias)', formato: 'inteiro', exemplo: '90' },
  ],
};

const ATRIBUTOS_PRODUTO: Record<string, ModeloCampo[]> = {
  // Mercearia é o único nicho onde a mercadoria estraga — e era o único sem
  // ficha. Opcional de propósito: 149 produtos já cadastrados não podem virar
  // incompletos de um dia para o outro.
  SuperMax: [
    { col: 'Produto perecível', lista: SIM_NAO, exemplo: 'Sim' },
    { col: 'Validade (dias)', formato: 'inteiro', exemplo: '30',
      dica: 'Prazo desde o recebimento. É o que decide remarcação e ordem de saída.' },
    { col: 'Armazenagem', lista: ['Ambiente', 'Refrigerado', 'Congelado'], exemplo: 'Refrigerado' },
  ],
  MaxLook: [
    { col: 'Tamanho', obrigatorio: true, exemplo: 'M', dica: 'P, M, G ou numeração (38, 40).' },
    { col: 'Cor', obrigatorio: true, exemplo: 'Azul Marinho' },
    { col: 'Gênero', obrigatorio: true, lista: ['Feminino', 'Masculino', 'Unissex', 'Infantil'], exemplo: 'Unissex' },
    { col: 'Coleção', exemplo: 'Verão 2026' },
    { col: 'Composição / Material', exemplo: '100% Algodão' },
  ],
  TechMax: [
    { col: 'Modelo', obrigatorio: true, exemplo: 'iPhone 13' },
    { col: 'Cor', exemplo: 'Meia-noite' },
    { col: 'Memória', exemplo: '128 GB' },
    { col: 'Tela', exemplo: '6.1"' },
    { col: 'Bateria', exemplo: '3240 mAh' },
    { col: 'Câmera', exemplo: '12 MP + 12 MP' },
    { col: 'Garantia (dias)', formato: 'inteiro', exemplo: '365' },
    { col: 'Requer IMEI/Serial', lista: SIM_NAO, exemplo: 'Sim', dica: 'Se "Sim", o PDV pede o IMEI no fechamento da venda.' },
    { col: 'Informações adicionais', exemplo: 'Acompanha carregador e capa.' },
  ],
};

const ATRIBUTOS_SERVICO: Record<string, ModeloCampo[]> = {
  MaxLook: [
    { col: 'Categoria', obrigatorio: true, exemplo: 'Ajuste de barra',
      lista: ['Ajuste de barra', 'Bainha', 'Costura', 'Personalização', 'Lavagem', 'Outro'] },
    { col: 'Tempo estimado (min)', formato: 'inteiro', exemplo: '30' },
    { col: 'Garantia (dias)', formato: 'inteiro', exemplo: '30' },
  ],
  TechMax: [
    { col: 'Categoria', obrigatorio: true, exemplo: 'Troca de tela',
      lista: ['Troca de tela', 'Troca de bateria', 'Formatação', 'Reparo de placa', 'Software', 'Instalação', 'Diagnóstico', 'Outro'] },
    { col: 'Tempo estimado (min)', formato: 'inteiro', exemplo: '120' },
    { col: 'Marcas atendidas', exemplo: 'Apple, Samsung' },
    { col: 'Garantia do serviço (dias)', obrigatorio: true, formato: 'inteiro', exemplo: '90' },
    { col: 'Serviço requer peça de reposição', lista: SIM_NAO, exemplo: 'Sim' },
  ],
  SuperMax: [
    { col: 'Tempo estimado (min)', formato: 'inteiro', exemplo: '15' },
  ],
};

// Régua única em src/lib/unidades.ts. A lista de requisição era minúscula aqui
// e no formulário, enquanto o catálogo é maiúsculo — o modelo de planilha
// ensinava a grafia errada a quem importava dados.

// ---------------------------------------------------------------------------
// Montagem dos modelos — a ordem dos campos é a ordem do formulário na tela
// ---------------------------------------------------------------------------

const modeloPessoa = (filial: string, isCliente: boolean): Modelo => {
  const acao = isCliente ? 'Cliente' : 'Fornecedor';
  const campos: ModeloCampo[] = [
    { col: 'Tipo de pessoa', obrigatorio: true, lista: ['Empresa', 'Pessoa Física'], exemplo: 'Empresa',
      dica: 'Primeira escolha do formulário — define se o documento é CNPJ ou CPF.' },
    { col: 'Nome', obrigatorio: true, dica: 'Razão social (empresa) ou nome completo (pessoa física).',
      exemplo: isCliente ? 'Padaria do Zé Ltda' : 'Distribuidora Central Ltda' },
    { col: 'Telefone / Celular', exemplo: '(68) 99999-0000' },
    { col: 'E-mail', exemplo: 'contato@empresa.com.br' },
    { col: 'Endereço', exemplo: 'Rua das Palmeiras, 120 — Centro' },
    { col: 'CPF/CNPJ', exemplo: '12.345.678/0001-90',
      dica: 'Só números — o LogMax formata sozinho ao digitar.' },
  ];
  if (!isCliente) {
    campos.push({ col: 'Categoria', exemplo: 'Materiais',
      dica: 'Como sua filial agrupa esse parceiro: Materiais, Serviços, Embalagens...' });
    // Comum às 3 filiais (migr. 360): saiu da ficha de nicho porque é do
    // processo de compras, não do ramo.
    campos.push({ col: 'Prazo médio de entrega (dias)', formato: 'inteiro', exemplo: '15',
      dica: 'Do pedido à entrega. Compras usa na cotação e para prometer data a quem requisitou.' });
    campos.push(...(ATRIBUTOS_FORNECEDOR[filial] ?? []));
  }
  return {
    acao,
    titulo: `${acao}s — ${filial}`,
    arquivo: `modelo-${isCliente ? 'clientes' : 'fornecedores'}-${filial.toLowerCase()}`,
    intro: isCliente
      ? 'Uma linha por cliente. Depois de conferir, cadastre um a um em Vendas > Clientes.'
      : 'Uma linha por fornecedor. Depois de conferir, cadastre um a um em Cadastros > Fornecedores.',
    campos,
  };
};

const modeloProdutos = (filial: string): Modelo => {
  const isSuper = filial === 'SuperMax';
  const campos: ModeloCampo[] = [
    { col: 'Código', obrigatorio: true, exemplo: '001',
      dica: `Código único dentro da ${filial}. Filiais diferentes podem repetir o mesmo código.` },
    { col: 'Nome do produto', obrigatorio: true, exemplo: 'Arroz Branco 5kg' },
    { col: 'Categoria', obrigatorio: true, exemplo: 'Mercearia',
      dica: 'Precisa existir em Cadastros > Categorias antes de cadastrar o produto. É ela que carrega a margem-alvo usada para sugerir o preço de venda.' },
    { col: 'Subcategoria', exemplo: 'Grãos', dica: 'Opcional. Também vem do cadastro de categorias.' },
    { col: 'Cód. Barras EAN', exemplo: '7891234567895', dica: 'EAN-13, 13 dígitos. Deixe em branco se não houver.' },
    { col: 'Fornecedor', obrigatorio: true, exemplo: 'Distribuidora Central Ltda',
      dica: 'Precisa estar cadastrado em Fornecedores antes.' },
    { col: 'Marca', obrigatorio: true, exemplo: 'Tio João' },
  ];
  if (isSuper) {
    campos.push({ col: 'Peso / Volume', obrigatorio: true, formato: 'decimal', exemplo: '5',
      dica: 'Na unidade escolhida mais adiante (5 para "5 KG").' });
  }
  campos.push(
    ...(ATRIBUTOS_PRODUTO[filial] ?? []),
    { col: 'Preço de Custo (R$)', obrigatorio: true, formato: 'moeda', exemplo: '18,90',
      dica: 'Quanto a empresa paga. No LogMax só admin/CEO/Financeiro enxergam.' },
    { col: 'Preço de Venda (R$)', obrigatorio: true, formato: 'moeda', exemplo: '24,90',
      dica: 'Se a Categoria tiver margem-alvo cadastrada, o LogMax sugere este valor a partir do custo — a sugestão é um clique, e o preço continua editável.' },
    { col: 'Unidade', lista: unidadesDeProduto(filial), exemplo: 'UN' },
    { col: 'Estoque Inicial', formato: 'decimal', exemplo: '40' },
    { col: 'Quantidade Comprada', formato: 'decimal', exemplo: '40',
      dica: 'Quanto entrou na compra que originou este cadastro.' },
    { col: 'Estoque Mínimo', obrigatorio: true, formato: 'decimal', exemplo: '10',
      dica: 'Abaixo disso o produto aparece em Sugestões de Compra.' },
  );
  if (isSuper) {
    campos.push({ col: 'Elegível a benefícios', lista: SIM_NAO, exemplo: 'Não',
      dica: 'Se entra na cesta de benefícios do colaborador.' });
  }
  return {
    acao: 'Produto',
    titulo: `Produtos — ${filial}`,
    arquivo: `modelo-produtos-${filial.toLowerCase()}`,
    intro: 'Uma linha por produto. Confira antes se a Categoria e o Fornecedor já existem no LogMax — o formulário só aceita valores já cadastrados. Depois, cadastre um a um em Cadastros > Produtos.',
    campos,
  };
};

const modeloServicos = (filial: string): Modelo => ({
  acao: 'Serviço',
  titulo: `Serviços — ${filial}`,
  arquivo: `modelo-servicos-${filial.toLowerCase()}`,
  intro: 'Uma linha por serviço prestado pela filial. Depois de conferir, cadastre um a um em Cadastros > Serviços.',
  campos: [
    { col: 'Código', obrigatorio: true,
      exemplo: filial === 'TechMax' ? 'SRV-TL-001' : filial === 'MaxLook' ? 'SRV-AJ-001' : 'SRV-001',
      dica: 'Código único do serviço dentro da filial.' },
    { col: 'Nome do serviço', obrigatorio: true,
      exemplo: filial === 'TechMax' ? 'Troca de tela iPhone 12'
        : filial === 'MaxLook' ? 'Ajuste de bainha calça jeans' : 'Entrega em domicílio' },
    { col: 'Valor (R$)', obrigatorio: true, formato: 'moeda', exemplo: '180,00' },
    { col: 'Status', lista: ATIVO_INATIVO, exemplo: 'Ativo' },
    ...(ATRIBUTOS_SERVICO[filial] ?? []),
  ],
});

// Requisição segue a ordem da tela: tipo, prazo, urgência, centro de custo,
// justificativa e então os itens. Uma linha por item — que é exatamente como o
// LogMax grava (cada item vira uma requisição própria, e o cabeçalho se repete).
//
// Os três tipos e a justificativa condicional espelham a migr. 358: quem
// preenche a planilha aprende a mesma distinção que vai encontrar na tela —
// reposição se explica pelo saldo, compra eventual precisa de texto.
const modeloRequisicoes = (filial: string): Modelo => ({
  acao: 'Requisição',
  titulo: `Requisições — ${filial}`,
  arquivo: `modelo-requisicoes-${filial.toLowerCase()}`,
  intro: 'Uma linha por item solicitado. Os cinco primeiros campos são o cabeçalho do pedido — repita-os igual em todas as linhas da mesma requisição. A Justificativa só é obrigatória em Compra eventual: na Reposição o motivo é o saldo do produto, que o LogMax registra sozinho.',
  campos: [
    { col: 'O que você precisa', obrigatorio: true,
      lista: ['Reposição', 'Compra eventual', 'Material do estoque'], exemplo: 'Reposição',
      dica: 'Reposição = item do catálogo que acabou ou bateu o mínimo. Compra eventual = não está no catálogo, é serviço ou foge do normal. Material do estoque = já existe no almoxarifado.' },
    { col: 'Necessário até', obrigatorio: true, formato: 'data', exemplo: '15/09/2026' },
    { col: 'Urgência', obrigatorio: true, lista: ['Normal', 'Alta', 'Urgente'], exemplo: 'Normal' },
    { col: 'Centro de custo', exemplo: 'TI',
      dica: 'Setor que arca com o gasto. Precisa existir em Empresa > Centros de custo.' },
    // Deixou de ser obrigatória na planilha pelo mesmo motivo que deixou na
    // tela (migr. 358): na reposição o motivo é o saldo, e exigir texto aqui
    // reproduziria em .xlsx o "nao temos ou acabou" que a 358 foi corrigir.
    { col: 'Justificativa',
      exemplo: 'Compressor da câmara fria parou e não há peça no mercado local.',
      dica: 'Obrigatória só em Compra eventual — Compras não tem histórico do item para decidir sozinho. Em Reposição, deixe em branco: o motivo é o saldo.' },
    { col: 'Item', obrigatorio: true, exemplo: itemExemploDaFilial(filial),
      dica: 'Em Reposição, escreva o nome exato do produto no catálogo. Em Compra eventual, descreva o suficiente para Compras cotar sem precisar perguntar.' },
    { col: 'Quantidade', obrigatorio: true, formato: 'decimal', exemplo: '10' },
    { col: 'Unidade', obrigatorio: true, lista: unidadesDeRequisicao(filial), exemplo: 'CX',
      dica: 'Em Reposição o LogMax usa a unidade do cadastro do produto, então esta coluna serve de conferência.' },
  ],
});

export function getModelo(entidade: ModeloEntidade, filial: string): Modelo {
  switch (entidade) {
    case 'clientes':     return modeloPessoa(filial, true);
    case 'fornecedores': return modeloPessoa(filial, false);
    case 'produtos':     return modeloProdutos(filial);
    case 'servicos':     return modeloServicos(filial);
    case 'requisicoes':  return modeloRequisicoes(filial);
  }
}

// ---------------------------------------------------------------------------
// Geração do .xlsx
// ---------------------------------------------------------------------------

const NUM_FMT: Record<ModeloFormato, string | undefined> = {
  texto:   undefined,
  moeda:   'R$ #,##0.00',
  inteiro: '0',
  decimal: '#,##0.###',
  data:    'dd/mm/yyyy',
};

const LINHAS_EM_BRANCO = 100;

const colLetra = (n: number) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
};

/**
 * Gera e baixa o .xlsx do modelo. exceljs entra por import dinâmico — a lib só
 * é baixada quando o usuário clica, igual aos outros exports do projeto.
 */
export async function baixarModeloPlanilha(entidade: ModeloEntidade, filial: string) {
  const modelo = getModelo(entidade, filial);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogMax';
  wb.created = new Date();

  // ---- Aba Instruções -----------------------------------------------------
  const info = wb.addWorksheet('Instruções');
  info.columns = [{ width: 34 }, { width: 13 }, { width: 62 }, { width: 28 }];

  const tituloRow = info.addRow([modelo.titulo]);
  info.mergeCells(`A${tituloRow.number}:D${tituloRow.number}`);
  tituloRow.font = { bold: true, size: 14, color: { argb: BLACK_HEX } };
  tituloRow.height = 24;

  const introRow = info.addRow([modelo.intro]);
  info.mergeCells(`A${introRow.number}:D${introRow.number}`);
  introRow.alignment = { wrapText: true, vertical: 'top' };
  introRow.height = 44;

  const avisoRow = info.addRow(['Campos marcados com * são obrigatórios no LogMax — sem eles o formulário não salva.']);
  info.mergeCells(`A${avisoRow.number}:D${avisoRow.number}`);
  avisoRow.font = { italic: true, size: 10 };

  info.addRow([]);
  const cab = info.addRow(['Campo', 'Obrigatório', 'O que preencher', 'Exemplo']);
  cab.font = { bold: true, color: { argb: BLACK_HEX } };
  cab.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };
    c.border = { bottom: { style: 'thin' } };
  });

  for (const campo of modelo.campos) {
    const descricao = [
      campo.dica,
      campo.lista ? `Opções: ${campo.lista.join(' | ')}` : null,
      campo.formato === 'moeda' ? 'Valor em reais.' : null,
      campo.formato === 'data' ? 'Data no formato dd/mm/aaaa.' : null,
    ].filter(Boolean).join(' ');
    const r = info.addRow([campo.col, campo.obrigatorio ? 'Sim' : '—', descricao, campo.exemplo ?? '']);
    r.alignment = { wrapText: true, vertical: 'top' };
    if (campo.obrigatorio) r.getCell(1).font = { bold: true };
    r.getCell(4).font = { italic: true, color: { argb: 'FF6E6E6E' } };
  }

  // ---- Aba de preenchimento ----------------------------------------------
  // Linha 1: nome da ação. Linha 2: respiro. Linha 3: cabeçalho das colunas,
  // uma por campo do formulário, na ordem em que a tela pede.
  const ws = wb.addWorksheet(modelo.acao.slice(0, 31));
  const ultimaCol = colLetra(modelo.campos.length);

  const acaoRow = ws.addRow([modelo.acao]);
  ws.mergeCells(`A1:${ultimaCol}1`);
  acaoRow.height = 30;
  acaoRow.getCell(1).font = { bold: true, size: 16, color: { argb: BLACK_HEX } };
  acaoRow.getCell(1).alignment = { vertical: 'middle' };
  acaoRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };

  ws.addRow([]).height = 6;

  const header = ws.addRow(modelo.campos.map(c => (c.obrigatorio ? `${c.col} *` : c.col)));
  header.height = 24;
  header.font = { bold: true, color: { argb: BLACK_HEX } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((c, i) => {
    const campo = modelo.campos[i - 1];
    c.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: campo?.obrigatorio ? GOLD_HEX : GOLD_TINT_HEX },
    };
    c.border = { bottom: { style: 'medium', color: { argb: BLACK_HEX } } };
    // Dica e exemplo viram nota da célula: ficam à mão de quem preenche sem
    // ocupar linha na grade.
    const nota = [campo?.dica, campo?.exemplo ? `Ex: ${campo.exemplo}` : null]
      .filter(Boolean).join('\n');
    if (nota) c.note = nota;
  });
  ws.views = [{ state: 'frozen', ySplit: header.number }];

  const primeiraLinha = header.number + 1;
  const ultimaLinha = header.number + LINHAS_EM_BRANCO;

  modelo.campos.forEach((campo, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(42, Math.max(14, campo.col.length + 4));
    const fmt = campo.formato ? NUM_FMT[campo.formato] : undefined;

    for (let linha = primeiraLinha; linha <= ultimaLinha; linha++) {
      const cel = ws.getCell(linha, i + 1);
      if (fmt) cel.numFmt = fmt;
      // Dropdown das opções fechadas. A lista inline do Excel é separada por
      // vírgula — opção que contenha vírgula quebraria a fórmula, então nesse
      // caso ficamos só com a dica na nota do cabeçalho.
      if (campo.lista && !campo.lista.some(o => o.includes(','))) {
        cel.dataValidation = {
          type: 'list',
          allowBlank: !campo.obrigatorio,
          formulae: [`"${campo.lista.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Valor fora da lista',
          error: `Use uma das opções: ${campo.lista.join(', ')}`,
        };
      }
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${modelo.arquivo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
