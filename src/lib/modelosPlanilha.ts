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
// PRODUTOS tem import de volta desde 2026-08-19 (`importarProdutos.ts`), e ele
// lê as colunas DESTE arquivo, via `getModelo` — mexer na ordem ou no rótulo de
// uma coluna muda o que o leitor espera. O leitor não confia no arquivo: valida
// linha a linha com as mesmas regras do form e grava pelas mesmas tabelas e RLS.
// As demais entidades continuam só download.
//
// Os campos aqui são mantidos à mão em espelho dos forms:
//   clientes/fornecedores → CRMView.tsx
//   produtos              → ProdutosView.tsx (mas a ficha por nicho NÃO: ela é
//                           derivada de `atributosProduto.ts`, ver abaixo)
//   servicos              → ServicosView.tsx
//   requisicoes           → RequisicoesSetorView.tsx
// Mexeu no form, mexe aqui — inclusive na ORDEM dos campos.

import { GOLD_HEX, BLACK_HEX, GOLD_TINT_HEX } from './pdfPalette';
import { unidadesDeProduto, unidadesDeRequisicao, itemExemploDaFilial, exemploProduto, UNIDADES_CONTEUDO, EMBALAGENS_COMPRA } from './unidades';
import { ATRIBUTOS_PRODUTO as ATRIBUTOS_FICHA, rotuloParaCliente, type AtributoDef } from './atributosProduto';
import { TIPOS_PRODUTO, TIPO_LABEL, TIPO_AJUDA } from './tipoProduto';
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

// A ficha de produto por nicho é UMA lista só: `ATRIBUTOS_PRODUTO` em
// `atributosProduto.ts`, que é o que a tela de cadastro preenche e o PDV
// exibe. Aqui ela é TRADUZIDA para coluna de planilha, não copiada.
//
// Havia uma segunda cópia à mão neste arquivo, com os mesmos campos escritos
// de novo — exatamente a duplicação que o cabeçalho de `atributosProduto.ts`
// diz ter eliminado. Ela já tinha começado a divergir (a dica do IMEI prometia
// um comportamento que o PDV não tem), e um campo novo na ficha nascia fora do
// modelo sem ninguém perceber.
const campoDaFicha = (a: AtributoDef, filial: string): ModeloCampo => {
  const col = rotuloParaCliente(a.label);
  const dicas: string[] = [];
  if (a.dica) dicas.push(a.dica);
  // A planilha é plana: não tem como esconder coluna filha. O que a tela faz
  // com `dependeDe`/`reqSe` vira instrução escrita.
  if (a.dependeDe) {
    const pai = rotuloParaCliente(
      (ATRIBUTOS_FICHA[filial] ?? []).find(x => x.key === a.dependeDe)?.label ?? a.dependeDe,
    );
    dicas.push(a.reqSe
      ? `Obrigatório quando "${pai}" for Sim; deixe vazio quando for Não.`
      : `Só se aplica quando "${pai}" for Sim.`);
  }
  const dica = dicas.join(' ') || undefined;

  if (a.type === 'bool')   return { col, lista: SIM_NAO, exemplo: 'Sim', dica };
  if (a.type === 'select') return { col, obrigatorio: a.req, lista: a.options, exemplo: a.options?.[0], dica };
  return {
    col,
    obrigatorio: a.req,
    formato: a.soDigitos ? 'inteiro' : undefined,
    exemplo: exemploDoPlaceholder(a.placeholder),
    dica,
  };
};

/** `'Ex: P, M, G, 38, 40'` → `'P'`. Sem placeholder, sem exemplo. */
const exemploDoPlaceholder = (ph?: string): string | undefined => {
  if (!ph) return undefined;
  const semPrefixo = ph.replace(/^\s*ex\.?:?\s*/i, '');
  const primeiro = semPrefixo.split(/[,;]/)[0].trim();
  return primeiro || undefined;
};

const ATRIBUTOS_PRODUTO: Record<string, ModeloCampo[]> = Object.fromEntries(
  Object.entries(ATRIBUTOS_FICHA).map(([filial, defs]) => [
    filial,
    defs.map(d => campoDaFicha(d, filial)),
  ]),
);

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
  // Exemplos do nicho, não da mercearia. O modelo saía com arroz e "Tio João"
  // para as três filiais — quem baixa o da boutique lia exemplo de supermercado
  // e parava para entender se tinha baixado o arquivo certo.
  const ex = exemploProduto(filial);
  const campos: ModeloCampo[] = [
    { col: 'Código', obrigatorio: true, exemplo: '001',
      dica: `Código único dentro da ${filial}. Filiais diferentes podem repetir o mesmo código.` },
    { col: 'Nome do produto', obrigatorio: true, exemplo: ex.nome },
    // A pergunta que decide o resto da linha, e que faltava aqui: o formulário
    // sempre teve os três destinos (migr. 440), o modelo não. Quem preenchia a
    // planilha só via "produto" e cadastrava resma de papel e freezer como
    // mercadoria — os dois iam parar no PDV. Em branco continua entrando como
    // mercadoria, que é o legado, mas a linha avisa.
    { col: 'Classificação (Tipo)', lista: TIPOS_PRODUTO.map(t => TIPO_LABEL[t]),
      exemplo: TIPO_LABEL.estoque_venda,
      dica: TIPOS_PRODUTO.map(t => `${TIPO_LABEL[t]}: ${TIPO_AJUDA[t]}`).join(' | ')
        + ' Em branco, entra como Mercadoria para revenda.' },
    { col: 'Categoria', obrigatorio: true, exemplo: ex.categoria, fonte: 'categorias',
      dica: 'Precisa existir em Cadastros > Categorias antes de cadastrar o produto. É ela que carrega o markup-alvo usado para sugerir o preço de venda.' },
    { col: 'Subcategoria', exemplo: ex.subcategoria, fonte: 'subcategorias',
      dica: 'Opcional. Também vem do cadastro de categorias.' },
    { col: 'Cód. Barras EAN', obrigatorio: true, exemplo: '7891234567895',
      dica: 'EAN-13, 13 dígitos — é o que o PDV lê no caixa. Sem o código do fabricante, o cadastro gera um interno da loja (prefixo 2).' },
    { col: 'Fornecedor', obrigatorio: true, exemplo: ex.fornecedor, fonte: 'fornecedores',
      dica: 'Precisa estar cadastrado em Fornecedores antes.' },
    { col: 'Marca', obrigatorio: true, exemplo: ex.marca, fonte: 'marcas',
      dica: 'A lista traz as marcas já usadas nesta filial. Marca nova pode ser digitada.' },
  ];
  if (isSuper) {
    // Duas colunas, não uma. A dica antiga ("na unidade escolhida mais adiante")
    // mandava usar a unidade de ESTOQUE para medir o CONTEÚDO — e é assim que a
    // coluna `peso` acumulou 900 e 0,5 sem ninguém saber se era grama ou quilo
    // (migr. 438). Só é obrigatório para embalagem fechada: granel não tem
    // conteúdo por embalagem, a unidade de estoque já é a medida.
    campos.push(
      { col: 'Peso / Volume por embalagem', formato: 'decimal', exemplo: '5',
        dica: 'O que vem dentro de UMA embalagem. Deixe em branco se o produto é vendido a granel (Unidade em KG ou L).' },
      { col: 'Medida do conteúdo', lista: UNIDADES_CONTEUDO, exemplo: 'KG',
        dica: 'A medida do conteúdo — nada a ver com a Unidade de estoque. Arroz de 5 kg em pacote: conteúdo 5 KG, Unidade UN. Use UN quando o conteúdo se CONTA (pacote com 6 sabonetes): conteúdo 6 UN, Unidade PCT.' },
    );
  }
  campos.push(
    ...(ATRIBUTOS_PRODUTO[filial] ?? []),
    { col: 'Preço de Custo (R$)', obrigatorio: true, formato: 'moeda', exemplo: '18,90',
      dica: 'Quanto a empresa paga. No LogMax só admin/CEO/Financeiro enxergam.' },
    { col: 'Preço de Venda (R$)', obrigatorio: true, formato: 'moeda', exemplo: '24,90',
      dica: 'Se a Categoria tiver markup-alvo cadastrado, o LogMax sugere este valor a partir do custo — a sugestão é um clique, e o preço continua editável. Markup é sobre o custo; margem é sobre a venda.' },
    { col: 'Unidade', lista: unidadesDeProduto(filial), exemplo: 'UN',
      dica: isSuper
        ? 'Como o item entra e sai do estoque. 50 pacotes de arroz são 50 UN; banana pesada no caixa é KG.'
        : 'Como o item entra e sai do estoque.' },
    // "Quantidade Comprada" saiu: era uma segunda entrada de estoque no mesmo
    // cadastro, e quem preenchia as duas com 40 terminava com 80. Compra tem
    // documento — vai por Compras → Recebimentos.
    { col: 'Saldo de Abertura', formato: 'decimal', exemplo: '40',
      dica: 'O que já está na prateleira hoje. Não é compra: não gera conta a pagar. Fração só faz sentido se a Unidade for KG ou L (12,5 KG) — em UN, CX, PC e PCT vai inteiro.' },
    { col: 'Estoque Mínimo', obrigatorio: true, formato: 'decimal', exemplo: '10',
      dica: 'Abaixo disso o produto aparece em Sugestões de Compra. Aceita fração para item vendido a peso (migr. 438).' },
    // A terceira medida (migr. 589). Fica ao lado de Unidade porque é com ela
    // que se confunde: uma é como o estoque conta, a outra é como o fornecedor
    // vende. Opcional — item que só se compra avulso deixa as duas em branco.
    { col: 'Compra em', lista: EMBALAGENS_COMPRA, exemplo: 'FARDO',
      dica: 'Como o FORNECEDOR vende, se ele vender em embalagem fechada. Não é a Unidade: o estoque continua contando em UN. Em branco = compra avulsa.' },
    { col: 'Qtd por embalagem', formato: 'decimal', exemplo: '30',
      dica: 'Quantas UNIDADES (a coluna Unidade) vêm em uma embalagem: fardo de arroz com 30. Preencha junto com "Compra em" — uma sem a outra não vale.' },
  );
  if (isSuper) {
    campos.push({ col: 'Elegível a benefícios', lista: SIM_NAO, exemplo: 'Não',
      dica: 'Se entra na cesta de benefícios do colaborador.' });
  }
  return {
    acao: 'Produto',
    titulo: `Produtos — ${filial}`,
    arquivo: `modelo-produtos-${filial.toLowerCase()}`,
    intro: 'Uma linha por produto. Comece pela Classificação: mercadoria para revenda vai ao PDV, uso e consumo é o que a empresa gasta internamente (papel, limpeza, embalagem) e patrimônio é bem de uso (freezer, balcão, computador) — a classificação muda o que o LogMax cobra no resto da linha. Categoria e Fornecedor vêm em lista suspensa com o que já existe no LogMax — se o que você precisa não está lá, cadastre primeiro. Preenchido o arquivo, volte em Cadastros > Produtos e use "Importar planilha": o LogMax confere linha a linha e mostra o que entra antes de gravar.',
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
// os itens (nome, marca, quantidade e em quê) e a justificativa por último.
// Uma linha por item — que é como o LogMax grava (cada item vira uma requisição
// própria, e o cabeçalho se repete).
//
// "Em quê" é uma pergunta só, como na tela (migr. 591): uma unidade de medida
// ou uma embalagem fechada "com N" unidades. Caixa e pacote vivem só como
// embalagem — como unidade, "10 CX" e "10 UN, caixa com 12" pareciam a mesma
// coisa.
const modeloRequisicoes = (filial: string): Modelo => {
  const unidades = unidadesDeRequisicao(filial).filter(u => u !== 'CX' && u !== 'PCT');
  const embalagens = EMBALAGENS_COMPRA.map(e => e.charAt(0) + e.slice(1).toLowerCase());
  // Exemplo coerente com o item de exemplo da loja: só a mercearia compra em fardo.
  const emFardo = filial === 'SuperMax';
  return {
    acao: 'Requisição',
    titulo: `Requisições — ${filial}`,
    arquivo: `modelo-requisicoes-${filial.toLowerCase()}`,
    intro: 'Uma linha por item. Os quatro primeiros campos são o cabeçalho — repita-os em todas as linhas da mesma requisição.',
    campos: [
      { col: 'O que você precisa', obrigatorio: true,
        lista: ['Compra eventual', 'Reposição', 'Material do estoque'], exemplo: 'Compra eventual',
        dica: 'Compra eventual = fora do catálogo ou serviço. Reposição = item do catálogo que acabou. Material do estoque = retirar do almoxarifado.' },
      { col: 'Necessário até', obrigatorio: true, formato: 'data', exemplo: '15/09/2026' },
      { col: 'Urgência', obrigatorio: true, lista: ['Normal', 'Alta', 'Urgente'], exemplo: 'Normal' },
      { col: 'Centro de custo', exemplo: 'TI', fonte: 'centrosCusto' },
      { col: 'Item', obrigatorio: true, exemplo: itemExemploDaFilial(filial), fonte: 'itensCatalogo',
        dica: 'Reposição: o nome do produto do catálogo, igual. Compra eventual: descreva o item.' },
      { col: 'Marca',
        dica: 'Opcional. Em branco = qualquer marca.' },
      { col: 'Quantidade', obrigatorio: true, formato: 'decimal', exemplo: emFardo ? '5' : '2' },
      { col: 'Em quê', obrigatorio: true, lista: [...unidades, ...embalagens], exemplo: emFardo ? 'Fardo' : 'UN',
        dica: 'Uma unidade (UN, KG…) ou uma embalagem fechada (Fardo, Caixa…).' },
      { col: 'Com quantas', formato: 'decimal', exemplo: emFardo ? '500' : undefined,
        dica: 'Só com embalagem: quantas unidades vêm em cada uma.' },
      { col: 'Unidade da embalagem', lista: unidades.filter(u => u !== 'SV'), exemplo: emFardo ? 'UN' : undefined,
        dica: 'Só com embalagem: em que unidade é o "com quantas".' },
      { col: 'Justificativa', exemplo: 'O estoque do setor acaba nesta semana e não há outro fornecedor na cidade.',
        dica: 'Obrigatória em Compra eventual. Em Reposição, deixe em branco.' },
    ],
  };
};

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

/**
 * Logo do LogMax para a faixa de topo das abas.
 *
 * Vem por `fetch` do próprio site em vez de embutido em base64 no bundle: o
 * PNG tem 53 KB, viraria ~71 KB de string carregada por todo mundo que abre o
 * app, e só serve a quem clica em "Modelo de planilha". Falhou o fetch (offline,
 * PWA sem cache do asset), devolve null e a planilha sai sem logo — arquivo sem
 * marca é chato, arquivo que não baixa é problema.
 */
async function carregarLogo(): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch('/icon-logmax.png');
    if (!r.ok) return null;
    return await r.arrayBuffer();
  } catch {
    return null;
  }
}

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

  const logo = await carregarLogo();
  const logoId = logo ? wb.addImage({ buffer: logo as any, extension: 'png' }) : null;
  // Faixa dourada do topo com o logo à esquerda. O texto ganha recuo para não
  // ficar embaixo da imagem — a imagem flutua sobre a célula, não empurra nada.
  const marcar = (aba: any, linha: number) => {
    if (logoId === null) return;
    aba.addImage(logoId, {
      tl: { col: 0.25, row: linha - 1 + 0.12 },
      ext: { width: 34, height: 34 },
      editAs: 'oneCell',
    });
  };
  const RECUO_LOGO = logoId === null ? 0 : 5;

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
  tituloRow.height = 40;
  tituloRow.getCell(1).font = { bold: true, size: 16, color: { argb: BLACK_HEX } };
  tituloRow.getCell(1).alignment = { vertical: 'middle', indent: RECUO_LOGO };
  tituloRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };
  marcar(info, tituloRow.number);

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
  acaoRow.height = 40;
  acaoRow.getCell(1).font = { bold: true, size: 16, color: { argb: BLACK_HEX } };
  acaoRow.getCell(1).alignment = { vertical: 'middle', indent: RECUO_LOGO };
  acaoRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_HEX } };
  marcar(ws, acaoRow.number);

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
