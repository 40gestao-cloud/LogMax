// Modelos de planilha para preenchimento antes do lançamento no LogMax.
//
// Uso didático: em aula, a turma primeiro monta o cadastro no Excel/Google
// Planilhas e só depois digita no sistema. O modelo baixado é o espelho do
// formulário da tela — mesmos campos, na mesma ordem de preenchimento, mesma
// obrigatoriedade, mesmas listas de opção — pra que a passagem da planilha pro
// LogMax seja transcrição, não tradução.
//
// Estrutura do arquivo: aba "Instruções" (como usar + dicionário de campos),
// aba de preenchimento (uma coluna por campo, com linha de exemplo) e a aba
// oculta "Listas", que alimenta os dropdowns.
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
import { supabase } from './supabase';

export type ModeloFormato = 'texto' | 'moeda' | 'inteiro' | 'decimal' | 'data';

export type ModeloCampo = {
  /** Cabeçalho da coluna. O ` *` de obrigatório é acrescentado pelo gerador. */
  col: string;
  obrigatorio?: boolean;
  /** Valor de exemplo — vai pra aba Instruções e pra linha de exemplo. */
  exemplo?: string;
  /** Explicação curta do campo. */
  dica?: string;
  /** Opções fechadas: vira dropdown na coluna (validação de dados do Excel). */
  lista?: readonly string[];
  formato?: ModeloFormato;
  /**
   * Chave da lista que vem do LogMax (não é opção fixa: é o que a turma já
   * cadastrou). Preenchida em `getModelo` a partir de `ListasDinamicas`. Se o
   * banco não responder ou a lista vier vazia, o campo continua texto livre —
   * o download nunca depende da rede para funcionar.
   */
  fonte?: keyof ListasDinamicas;
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

/**
 * Valores que já existem no LogMax e que o formulário só aceita se estiverem
 * cadastrados. Eram a maior fonte de retrabalho: o aluno escrevia "Bebidas" na
 * planilha, a categoria no sistema chamava "Bebidas e Sucos", e a transcrição
 * virava caça ao erro. Agora descem como dropdown.
 */
export type ListasDinamicas = {
  categorias?: string[];
  subcategorias?: string[];
  fornecedores?: string[];
  marcas?: string[];
  categoriasFornecedor?: string[];
  centrosCusto?: string[];
  itensCatalogo?: string[];
};

const SIM_NAO = ['Sim', 'Não'] as const;
const ATIVO_INATIVO = ['Ativo', 'Inativo'] as const;

// Teto por lista. Excel aguenta muito mais, mas dropdown de 2 mil linhas é
// pior que campo livre — e o arquivo é para preencher, não para consultar.
const MAX_OPCOES = 400;

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
    campos.push({ col: 'Categoria', exemplo: 'Materiais', fonte: 'categoriasFornecedor',
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
    { col: 'Categoria', obrigatorio: true, exemplo: 'Mercearia', fonte: 'categorias',
      dica: 'Precisa existir em Cadastros > Categorias antes de cadastrar o produto. É ela que carrega a margem-alvo usada para sugerir o preço de venda.' },
    { col: 'Subcategoria', exemplo: 'Grãos', fonte: 'subcategorias',
      dica: 'Opcional. Também vem do cadastro de categorias.' },
    { col: 'Cód. Barras EAN', exemplo: '7891234567895', dica: 'EAN-13, 13 dígitos. Deixe em branco se não houver.' },
    { col: 'Fornecedor', obrigatorio: true, exemplo: 'Distribuidora Central Ltda', fonte: 'fornecedores',
      dica: 'Precisa estar cadastrado em Fornecedores antes.' },
    { col: 'Marca', obrigatorio: true, exemplo: 'Tio João', fonte: 'marcas',
      dica: 'A lista traz as marcas já usadas nesta filial. Marca nova pode ser digitada.' },
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
    intro: 'Uma linha por produto. Categoria e Fornecedor vêm em lista suspensa com o que já existe no LogMax — se o que você precisa não está lá, cadastre primeiro. Depois de conferir, cadastre um a um em Cadastros > Produtos.',
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
    { col: 'Centro de custo', exemplo: 'TI', fonte: 'centrosCusto',
      dica: 'Setor que arca com o gasto. Precisa existir em Empresa > Centros de custo.' },
    // Deixou de ser obrigatória na planilha pelo mesmo motivo que deixou na
    // tela (migr. 358): na reposição o motivo é o saldo, e exigir texto aqui
    // reproduziria em .xlsx o "nao temos ou acabou" que a 358 foi corrigir.
    { col: 'Justificativa',
      exemplo: 'Compressor da câmara fria parou e não há peça no mercado local.',
      dica: 'Obrigatória só em Compra eventual — Compras não tem histórico do item para decidir sozinho. Em Reposição, deixe em branco: o motivo é o saldo.' },
    { col: 'Item', obrigatorio: true, exemplo: itemExemploDaFilial(filial), fonte: 'itensCatalogo',
      dica: 'Em Reposição, escolha na lista o produto do catálogo — o nome tem de bater exatamente. Em Compra eventual o item não está no catálogo: digite por cima da lista, descrevendo o suficiente para Compras cotar sem precisar perguntar.' },
    { col: 'Quantidade', obrigatorio: true, formato: 'decimal', exemplo: '10' },
    { col: 'Unidade', obrigatorio: true, lista: unidadesDeRequisicao(filial), exemplo: 'CX',
      dica: 'Em Reposição o LogMax usa a unidade do cadastro do produto, então esta coluna serve de conferência.' },
  ],
});

// ---------------------------------------------------------------------------
// Listas vindas do LogMax
// ---------------------------------------------------------------------------

const textos = (rows: any[] | null | undefined, campo: string): string[] =>
  Array.from(new Set(
    (rows ?? [])
      .map(r => String(r?.[campo] ?? '').trim())
      .filter(v => v !== ''),
  ))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
    .slice(0, MAX_OPCOES);

/**
 * Busca no LogMax os valores que o formulário exige que já existam.
 *
 * Nunca lança: rede caída, RLS fechada ou tabela vazia devolvem `{}` e o
 * modelo sai com esses campos como texto livre, exatamente como era antes.
 * Baixar o modelo é a primeira coisa que a turma faz na aula — não pode
 * depender de o banco estar de pé.
 */
export async function carregarListasDoLogMax(
  entidade: ModeloEntidade,
  filial: string,
): Promise<ListasDinamicas> {
  if (!supabase) return {};
  const naFilial = <T>(q: T): T =>
    // Cadastro sem filial é de uso comum às unidades — entra na lista de todas.
    (q as any).or(`filial.eq.${filial},filial.is.null`);

  try {
    if (entidade === 'produtos') {
      const [cat, forn, mar] = await Promise.all([
        naFilial(supabase.from('categorias_produto').select('id, nome').eq('ativo', true)),
        naFilial(supabase.from('fornecedores').select('nome').eq('ativo', true)),
        naFilial(supabase.from('produtos').select('marca').eq('ativo', true)),
      ]);
      // Subcategoria não tem coluna `filial` — o recorte vem pela categoria mãe.
      // Sem isso, a planilha da SuperMax ofereceria subcategoria de moda.
      const catIds = (cat.data ?? []).map((c: any) => c.id).filter(Boolean);
      const sub = catIds.length > 0
        ? await supabase.from('subcategorias_produto').select('nome')
            .eq('ativo', true).in('categoria_id', catIds)
        : { data: [] as any[] };
      return {
        categorias:    textos(cat.data, 'nome'),
        subcategorias: textos(sub.data, 'nome'),
        fornecedores:  textos(forn.data, 'nome'),
        marcas:        textos(mar.data, 'marca'),
      };
    }

    if (entidade === 'fornecedores') {
      const cat = await naFilial(supabase.from('fornecedores').select('categoria').eq('ativo', true));
      return { categoriasFornecedor: textos(cat.data, 'categoria') };
    }

    if (entidade === 'requisicoes') {
      const [cc, itens] = await Promise.all([
        supabase.from('centros_custo').select('nome').eq('ativo', true),
        naFilial(supabase.from('produtos').select('nome').eq('ativo', true)),
      ]);
      return {
        centrosCusto:  textos(cc.data, 'nome'),
        itensCatalogo: textos(itens.data, 'nome'),
      };
    }

    return {};
  } catch {
    return {};
  }
}

export function getModelo(
  entidade: ModeloEntidade,
  filial: string,
  listas: ListasDinamicas = {},
): Modelo {
  const base =
    entidade === 'clientes'     ? modeloPessoa(filial, true) :
    entidade === 'fornecedores' ? modeloPessoa(filial, false) :
    entidade === 'produtos'     ? modeloProdutos(filial) :
    entidade === 'servicos'     ? modeloServicos(filial) :
                                  modeloRequisicoes(filial);

  // Lista fixa declarada no campo ganha do banco: 'Sim/Não' e as unidades são
  // vocabulário do sistema, não dado da turma.
  return {
    ...base,
    campos: base.campos.map(c => {
      if (c.lista || !c.fonte) return c;
      const doBanco = listas[c.fonte];
      return doBanco && doBanco.length > 0 ? { ...c, lista: doBanco } : c;
    }),
  };
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

const CINZA_TEXTO   = 'FF6E6E6E';
const CINZA_BORDA   = 'FFD9D9D9';
const ZEBRA_HEX     = 'FFFAFAFA';
const EXEMPLO_HEX   = 'FFF3F3F3';

const colLetra = (n: number) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
};

/** Largura que cabe o cabeçalho E o exemplo — a antiga só olhava o cabeçalho. */
const larguraDaColuna = (campo: ModeloCampo): number => {
  const porTitulo  = campo.col.length + 6;
  const porExemplo = Math.min(46, (campo.exemplo?.length ?? 0) + 4);
  return Math.min(46, Math.max(14, porTitulo, porExemplo));
};

/**
 * Gera e baixa o .xlsx do modelo. exceljs entra por import dinâmico — a lib só
 * é baixada quando o usuário clica, igual aos outros exports do projeto.
 */
export async function baixarModeloPlanilha(entidade: ModeloEntidade, filial: string) {
  const listas = await carregarListasDoLogMax(entidade, filial);
  const modelo = getModelo(entidade, filial, listas);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogMax';
  wb.created = new Date();

  // ---- Aba oculta com as opções -------------------------------------------
  // Antes, as opções iam inline na fórmula da validação (`"A,B,C"`). Isso tinha
  // dois tetos: opção com vírgula quebrava a fórmula — e o código então
  // desistia da validação inteira, em silêncio — e o Excel corta a fórmula em
  // 255 caracteres, o que qualquer lista real de fornecedores estoura. Com as
  // opções numa aba, os dois problemas somem.
  const listasWs = wb.addWorksheet('Listas');
  // Chaveado pelo ÍNDICE do campo, não pelo rótulo: dois campos podem ter o
  // mesmo cabeçalho ('Cor', 'Categoria') e um mapa por nome faria a segunda
  // coluna herdar a lista da primeira.
  const rangeDaColuna = new Map<number, string>();
  let colListas = 0;

  modelo.campos.forEach((campo, idx) => {
    if (!campo.lista || campo.lista.length === 0) return;
    colListas += 1;
    const letra = colLetra(colListas);
    listasWs.getCell(`${letra}1`).value = campo.col;
    campo.lista.forEach((op, i) => { listasWs.getCell(`${letra}${i + 2}`).value = op; });
    listasWs.getColumn(colListas).width = 32;
    rangeDaColuna.set(idx, `Listas!$${letra}$2:$${letra}$${campo.lista.length + 1}`);
  });
  listasWs.getRow(1).font = { bold: true };
  // `veryHidden`: não aparece nem no menu "Reexibir". A aba é encanamento, e
  // aluno que a apaga por engano quebra todos os dropdowns de uma vez.
  listasWs.state = colListas > 0 ? 'veryHidden' : 'hidden';

  // ---- Aba Instruções -----------------------------------------------------
  const info = wb.addWorksheet('Instruções');
  info.columns = [{ width: 34 }, { width: 13 }, { width: 66 }, { width: 30 }];
  info.views = [{ showGridLines: false }];

  const tituloRow = info.addRow([modelo.titulo]);
  info.mergeCells(`A${tituloRow.number}:D${tituloRow.number}`);
  tituloRow.height = 30;
  tituloRow.getCell(1).font = { bold: true, size: 16, color: { argb: BLACK_HEX } };
  tituloRow.getCell(1).alignment = { vertical: 'middle' };
  tituloRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };

  const introRow = info.addRow([modelo.intro]);
  info.mergeCells(`A${introRow.number}:D${introRow.number}`);
  introRow.alignment = { wrapText: true, vertical: 'top' };
  introRow.height = 46;

  info.addRow([]);

  // Passo a passo: a aba antiga explicava os campos mas não o processo, e a
  // pergunta que mais aparecia em aula era "por onde eu começo".
  const comoRow = info.addRow(['Como usar']);
  comoRow.font = { bold: true, size: 12, color: { argb: BLACK_HEX } };
  const passos = [
    `1. Vá para a aba "${modelo.acao}" e preencha uma linha por registro.`,
    '2. A linha de exemplo (cinza, logo abaixo do cabeçalho) mostra o formato esperado. Apague-a antes de usar a planilha para valer.',
    '3. Colunas com seta abrem lista suspensa — use a lista em vez de digitar, é ela que garante que o valor existe no LogMax.',
    '4. Colunas com * são obrigatórias: sem elas o formulário do LogMax não salva.',
    '5. Confira tudo e só então transcreva para o sistema, um registro por vez.',
  ];
  for (const p of passos) {
    const r = info.addRow([p]);
    info.mergeCells(`A${r.number}:D${r.number}`);
    r.alignment = { wrapText: true, vertical: 'top' };
    r.height = 26;
  }

  const avisoRow = info.addRow(['A aba de preenchimento é protegida no cabeçalho para o modelo não se desmontar. Para liberar: Revisão > Desproteger Planilha (não há senha).']);
  info.mergeCells(`A${avisoRow.number}:D${avisoRow.number}`);
  avisoRow.font = { italic: true, size: 10, color: { argb: CINZA_TEXTO } };
  avisoRow.alignment = { wrapText: true, vertical: 'top' };
  avisoRow.height = 26;

  info.addRow([]);

  const dicRow = info.addRow(['Dicionário de campos']);
  dicRow.font = { bold: true, size: 12, color: { argb: BLACK_HEX } };

  const cab = info.addRow(['Campo', 'Obrigatório', 'O que preencher', 'Exemplo']);
  cab.font = { bold: true, color: { argb: BLACK_HEX } };
  cab.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };
    c.border = { bottom: { style: 'thin' } };
  });

  for (const campo of modelo.campos) {
    const opcoes = campo.lista
      // Lista longa (a que vem do LogMax) não cabe no dicionário: dizer
      // "escolha na lista" é mais útil que despejar 200 fornecedores aqui.
      ? campo.lista.length <= 12
        ? `Opções: ${campo.lista.join(' | ')}`
        : `Lista suspensa com ${campo.lista.length} opções do LogMax.`
      : null;
    const descricao = [
      campo.dica,
      opcoes,
      campo.formato === 'moeda' ? 'Valor em reais.' : null,
      campo.formato === 'data' ? 'Data no formato dd/mm/aaaa.' : null,
    ].filter(Boolean).join(' ');
    const r = info.addRow([campo.col, campo.obrigatorio ? 'Sim' : '—', descricao, campo.exemplo ?? '']);
    r.alignment = { wrapText: true, vertical: 'top' };
    if (campo.obrigatorio) r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'top' };
    r.getCell(4).font = { italic: true, color: { argb: CINZA_TEXTO } };
    r.eachCell(c => { c.border = { bottom: { style: 'hair', color: { argb: CINZA_BORDA } } }; });
  }

  // ---- Aba de preenchimento ----------------------------------------------
  // Linha 1: nome da ação. Linha 2: respiro. Linha 3: cabeçalho das colunas,
  // uma por campo do formulário, na ordem em que a tela pede. Linha 4: exemplo.
  const ws = wb.addWorksheet(modelo.acao.slice(0, 31));
  const nCols = modelo.campos.length;
  const ultimaCol = colLetra(nCols);

  const acaoRow = ws.addRow([modelo.acao]);
  ws.mergeCells(`A1:${ultimaCol}1`);
  acaoRow.height = 30;
  acaoRow.getCell(1).font = { bold: true, size: 16, color: { argb: BLACK_HEX } };
  acaoRow.getCell(1).alignment = { vertical: 'middle' };
  acaoRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };

  ws.addRow([]).height = 6;

  const header = ws.addRow(modelo.campos.map(c => (c.obrigatorio ? `${c.col} *` : c.col)));
  header.height = 30;
  header.font = { bold: true, color: { argb: BLACK_HEX } };
  header.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
  header.eachCell((c, i) => {
    const campo = modelo.campos[i - 1];
    c.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: campo?.obrigatorio ? GOLD_HEX : GOLD_TINT_HEX },
    };
    c.border = {
      top:    { style: 'thin', color: { argb: BLACK_HEX } },
      left:   { style: 'thin', color: { argb: CINZA_BORDA } },
      right:  { style: 'thin', color: { argb: CINZA_BORDA } },
      bottom: { style: 'medium', color: { argb: BLACK_HEX } },
    };
    // Dica e exemplo viram nota da célula: ficam à mão de quem preenche sem
    // ocupar linha na grade.
    const nota = [campo?.dica, campo?.exemplo ? `Ex: ${campo.exemplo}` : null]
      .filter(Boolean).join('\n');
    if (nota) c.note = nota;
  });

  // Linha de exemplo: mostra o formato de todos os campos de uma vez, que é o
  // que a nota de célula não consegue fazer (só aparece uma por vez).
  const exemploRow = ws.addRow(modelo.campos.map(c => c.exemplo ?? ''));
  exemploRow.height = 20;
  exemploRow.eachCell({ includeEmpty: true }, c => {
    c.font = { italic: true, color: { argb: CINZA_TEXTO }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXEMPLO_HEX } };
    c.alignment = { vertical: 'middle' };
    c.border = {
      left:   { style: 'hair', color: { argb: CINZA_BORDA } },
      right:  { style: 'hair', color: { argb: CINZA_BORDA } },
      bottom: { style: 'dashed', color: { argb: CINZA_BORDA } },
    };
    c.protection = { locked: false };
  });
  exemploRow.getCell(1).note = 'Linha de exemplo — apague antes de preencher para valer.';

  // Congela título + cabeçalho + exemplo: rolando 100 linhas, o aluno continua
  // vendo o nome da coluna e o formato esperado.
  ws.views = [{ state: 'frozen', ySplit: exemploRow.number }];

  const primeiraLinha = exemploRow.number + 1;
  const ultimaLinha   = exemploRow.number + LINHAS_EM_BRANCO;

  modelo.campos.forEach((campo, i) => {
    const col = ws.getColumn(i + 1);
    col.width = larguraDaColuna(campo);
    const fmt = campo.formato ? NUM_FMT[campo.formato] : undefined;
    const range = rangeDaColuna.get(i);
    // Vocabulário do sistema (Sim/Não, unidades, urgência) TRAVA o que estiver
    // fora da lista: valor inventado ali não existe do outro lado. Lista vinda
    // do LogMax (`fonte`) só GUIA — em Requisição, o item de Compra eventual é
    // por definição o que não está no catálogo, e travar impediria metade do
    // formulário. Antes desta distinção, ou tudo travava ou nada travava.
    const listaAberta = Boolean(campo.fonte);

    for (let linha = primeiraLinha; linha <= ultimaLinha; linha++) {
      const cel = ws.getCell(linha, i + 1);
      if (fmt) cel.numFmt = fmt;
      // Toda a área de digitação fica desbloqueada; o resto da aba é protegido
      // logo abaixo.
      cel.protection = { locked: false };
      cel.border = {
        left:   { style: 'hair', color: { argb: CINZA_BORDA } },
        right:  { style: 'hair', color: { argb: CINZA_BORDA } },
        bottom: { style: 'hair', color: { argb: CINZA_BORDA } },
      };
      if ((linha - primeiraLinha) % 2 === 1) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_HEX } };
      }

    }

    // A validação vai de uma vez para o intervalo inteiro da coluna, e não
    // célula a célula: atribuindo em 100 células, o exceljs emitia intervalos
    // SOBREPOSTOS no XML (`A5:A104` e `A10:A104` para a mesma coluna), que é o
    // tipo de coisa que faz o Excel abrir com "encontramos um problema com
    // parte do conteúdo" e reparar o arquivo.
    const intervalo = `${colLetra(i + 1)}${primeiraLinha}:${colLetra(i + 1)}${ultimaLinha}`;
    // `dataValidations` existe no exceljs mas está fora dos typings públicos
    // (index.d.ts a deixa comentada) — daí o cast.
    const validacoes = (ws as any).dataValidations;

    if (range) {
      validacoes.add(intervalo, {
        type: 'list',
        allowBlank: listaAberta || !campo.obrigatorio,
        formulae: [range],
        showErrorMessage: !listaAberta,
        errorTitle: 'Valor fora da lista',
        error: `Escolha uma das opções da lista de ${campo.col}.`,
      });
    } else if (campo.formato === 'data') {
      validacoes.add(intervalo, {
        type: 'date', operator: 'greaterThan', allowBlank: true,
        formulae: [new Date(2000, 0, 1)],
        showErrorMessage: true,
        errorTitle: 'Data inválida',
        error: 'Digite uma data no formato dd/mm/aaaa.',
      });
    } else if (campo.formato === 'inteiro' || campo.formato === 'decimal' || campo.formato === 'moeda') {
      validacoes.add(intervalo, {
        type: campo.formato === 'inteiro' ? 'whole' : 'decimal',
        operator: 'greaterThanOrEqual', allowBlank: true,
        formulae: [0],
        showErrorMessage: true,
        errorTitle: 'Número inválido',
        error: campo.formato === 'inteiro'
          ? 'Digite um número inteiro, sem vírgula e sem texto.'
          : 'Digite um número. Use vírgula para os centavos e não escreva "R$".',
      });
    }
  });

  // Filtro no cabeçalho: com 100 linhas preenchidas, conferir por categoria ou
  // por fornecedor deixa de ser rolagem no olho.
  ws.autoFilter = {
    from: { row: header.number, column: 1 },
    to:   { row: ultimaLinha,   column: nCols },
  };

  // Impressão: a turma imprime para conferir a mão antes de digitar.
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `${header.number}:${header.number}`,
  };

  // Protege só a moldura (título, cabeçalho e o que estiver fora da grade). As
  // células de digitação foram marcadas `locked: false` acima. Sem senha: é
  // trava contra acidente, não contra o aluno.
  await ws.protect('', {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: true, formatColumns: true, formatRows: true,
    sort: true, autoFilter: true, insertRows: true, deleteRows: true,
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
