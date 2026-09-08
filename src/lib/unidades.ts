// Unidades de medida — régua única.
//
// A lista existia em três lugares (`ProdutosView`, `modelosPlanilha`,
// `RequisicoesSetorView`) e as três discordavam. A de Requisições estava em
// minúscula, e como a Reposição (migr. 358) grava a unidade lida do catálogo
// — que é maiúscula —, a mesma coluna passou a ter `un` e `UN` convivendo.
//
// O nicho aparece aqui, e só aqui: KG/L/M/M³ são de mercearia. A régra já
// existia no gerador de planilha (`isSuper ? … : …`) mas não tinha nome nem
// alcançava o resto do app.

export const UNIDADES_PRODUTO = ['UN', 'KG', 'L', 'M', 'M²', 'M³', 'CX', 'PC', 'PCT'] as const;

/**
 * Embalagem em que o FORNECEDOR vende — a terceira medida do produto (migr. 589).
 *
 * As outras duas já existiam e são outra coisa:
 *
 *   `unidade`              como o item entra e sai do estoque      (UN)
 *   `peso`/`peso_unidade`  o conteúdo da embalagem de venda        (1 KG)
 *   embalagem de compra    como o item é comprado                  (fardo com 30 UN)
 *
 * `FD` NÃO entra em `UNIDADES_PRODUTO` de propósito. Fardo não é unidade de
 * estoque: pôr o estoque em fardo faz o PDV vender fardo ao cliente, o mínimo
 * virar mínimo de fardo e o custo unitário ficar 30× maior. Foi por não ter
 * este campo que a turma começou a cadastrar assim.
 */
export const EMBALAGENS_COMPRA = ['FARDO', 'CAIXA', 'PACOTE', 'SACO', 'ENGRADADO', 'DÚZIA'] as const;

export type EmbalagemCompra = { nome: string; fator: number };

/**
 * A embalagem do produto, ou null quando ele só se compra na unidade solta.
 *
 * Fator 1 é tratado como ausência: "fardo com 1" é a própria unidade, e
 * oferecer "pedir em fardo" para converter 20 em 20 só confunde. O banco já
 * recusa (`chk_produtos_embalagem_qtd`); aqui a tela não chega a oferecer.
 */
export const embalagemDoProduto = (p: {
  embalagem_compra?: string | null;
  embalagem_qtd?: number | string | null;
} | null | undefined): EmbalagemCompra | null => {
  const nome = String(p?.embalagem_compra ?? '').trim().toUpperCase();
  const fator = Number(String(p?.embalagem_qtd ?? '').replace(',', '.'));
  return nome !== '' && Number.isFinite(fator) && fator > 1 ? { nome, fator } : null;
};

/** Plural de prateleira: 1 FARDO, 2 FARDOS. Todas as seis pluralizam com S. */
export const pluralEmbalagem = (nome: string, n: number): string =>
  `${String(nome ?? '').toUpperCase()}${Math.abs(n) === 1 ? '' : 'S'}`;

/**
 * "FARDO com 30 UN" — o rótulo que a ficha e o catálogo mostram.
 *
 * O fator é expresso NA UNIDADE DE ESTOQUE do produto: fardo de arroz com 30
 * (UN), saco de café com 60 (KG). Não é o conteúdo da embalagem de venda, que
 * é `peso`/`peso_unidade` e responde outra pergunta.
 */
export const rotuloEmbalagem = (emb: EmbalagemCompra | null, unidade: string | null | undefined): string =>
  emb ? `${emb.nome} com ${String(Number(emb.fator.toFixed(3))).replace('.', ',')} ${normalizarUnidade(unidade)}` : '';

/**
 * O que cada sigla quer dizer — e o motivo de ela aparecer por extenso na tela.
 *
 * Os selects mostravam "UN / KG / L / M / M² / M³ / CX / PC / PCT / SV": dez
 * pares de letras sem legenda nenhuma. `PC` e `PCT` são a pior parte — peça e
 * pacote, que num supermercado são coisas diferentes e ficavam a um caractere
 * de distância. `SV` não se adivinha, e o aluno que procurava "fardo" não
 * achava (fardo é embalagem de compra, `EMBALAGENS_COMPRA` — outra pergunta,
 * outro campo).
 *
 * O VALOR GRAVADO CONTINUA A SIGLA. É só rótulo: o banco, o PDV, os relatórios
 * e a régua acima seguem falando 'UN' e 'PCT'. Trocar o dado por "Pacote"
 * quebraria de `unidade_fracionaria()` (migr. 456) ao filtro do PDV.
 *
 * `RL` está aqui sem estar em `UNIDADES_PRODUTO` de propósito: a turma Adm tem
 * produtos gravados com ela (vide migr. 438), e o rótulo tem de saber ler o que
 * já existe mesmo que a lista não ofereça mais.
 */
export const NOME_UNIDADE: Record<string, string> = {
  UN:   'unidade',
  KG:   'quilo',
  L:    'litro',
  M:    'metro',
  'M²': 'metro quadrado',
  'M³': 'metro cúbico',
  CX:   'caixa',
  PC:   'peça',
  PCT:  'pacote',
  SV:   'serviço',
  RL:   'rolo',
  G:    'grama',
  ML:   'mililitro',
};

/** "PCT — pacote". Sigla sozinha quando não se conhece o nome. */
export const rotuloUnidade = (u: string | null | undefined): string => {
  const sigla = normalizarUnidade(u, '');
  const nome = NOME_UNIDADE[sigla];
  return sigla === '' ? '' : (nome ? `${sigla} — ${nome}` : sigla);
};

/** Sem fracionário: quem não vende por peso não compra por peso. */
export const UNIDADES_DISCRETAS = ['UN', 'CX', 'PC', 'PCT'] as const;

/** Só a requisição pede serviço — produto é sempre coisa. */
const UNIDADE_SERVICO = 'SV';

/** Fracionárias: o PDV abre modal de peso para elas (ver PDVView). */
export const UNIDADES_FRACIONARIAS = new Set(['KG', 'L', 'M', 'M²', 'M³']);

/**
 * Medida do CONTEÚDO da embalagem — outra coisa que a unidade de estoque.
 *
 * Arroz 5 kg em pacote: o estoque conta 50 UN, o conteúdo é 5 KG. O cadastro
 * amarrava as duas ao mesmo seletor, então o aluno lia "Peso / Volume (UN)" e
 * digitava um número sem medida. Nas quatro turmas isso produziu peso 900 e
 * peso 0,5 na mesma coluna — grama e quilo convivendo sem rótulo (migr. 438).
 */
export const UNIDADES_CONTEUDO = ['G', 'KG', 'ML', 'L'] as const;

/**
 * Item vendido a granel não tem conteúdo de embalagem: a unidade de estoque JÁ
 * É a medida. Banana a KG não tem "peso por embalagem" — pedir isso é o que
 * fazia o campo virar `1` repetido.
 */
export const temConteudoDeEmbalagem = (unidade: string): boolean =>
  !UNIDADES_FRACIONARIAS.has(normalizarUnidade(unidade));

/**
 * O conteúdo que o NOME do produto anuncia — "Arroz Tio João 1kg" → 1 KG.
 *
 * O aluno digita o nome com a medida dentro, porque é assim que a embalagem
 * vem escrita, e depois preenche os dois campos ao lado. Quando os dois
 * discordam, um dos dois está errado, e é barato perguntar na hora: depois de
 * gravado vira preço por quilo errado, comparação de fornecedor errada e ficha
 * de prateleira mentindo.
 *
 * Aviso, nunca bloqueio. O nome é texto livre e a heurística erra: "Kit 2
 * unidades 500ml" tem duas medidas, e quem decide é quem está olhando a
 * embalagem.
 *
 * Duas armadilhas, as duas encontradas por teste e não por leitura:
 *
 *   "256GB" — o `\b` depois da medida resolve: vem `B` depois do `G`, não casa.
 *   "A56 5G" — esse passou pelo `\b` (o G tem espaço depois) e virava 5 gramas
 *              em todo celular do catálogo. `G` colado num número de um dígito
 *              é geração de rede, não peso: fermento de 5 g escreve "5 g", com
 *              espaço. Só `G` é ambíguo assim — KG, ML e L não colidem com
 *              nada.
 *
 * O custo de errar para menos é não avisar; para mais, é avisar errado em
 * produto certo. Na dúvida, cala.
 */
export const conteudoNoNome = (
  nome: string | null | undefined,
): { valor: number; unidade: string } | null => {
  const txt = String(nome ?? '').toUpperCase();
  for (const m of txt.matchAll(/(\d+(?:[.,]\d+)?)(\s*)(KG|ML|G|L)\b/g)) {
    const valor = parseFloat(m[1].replace(',', '.'));
    const colado = m[2].length === 0;
    const unidade = m[3];
    if (!Number.isFinite(valor) || valor <= 0) continue;
    if (unidade === 'G' && colado && valor < 10) continue;   // 3G, 4G, 5G
    return { valor, unidade };
  }
  return null;
};

/**
 * Compara o que o nome anuncia com o que foi digitado. Devolve o aviso pronto,
 * ou null quando batem (ou quando não há o que comparar).
 */
export const divergenciaDeConteudo = (
  nome: string | null | undefined,
  peso: string | number | null | undefined,
  pesoUnidade: string | null | undefined,
): string | null => {
  const doNome = conteudoNoNome(nome);
  if (!doNome) return null;

  const n = typeof peso === 'number' ? peso : parseFloat(String(peso ?? '').replace(',', '.'));
  const u = normalizarUnidade(pesoUnidade, '');
  // Campo ainda em branco não é divergência — é formulário pela metade.
  if (!Number.isFinite(n) || n <= 0 || u === '') return null;

  if (doNome.unidade === u && Math.abs(doNome.valor - n) < 0.001) return null;

  const digitado = `${String(Number(n.toFixed(3))).replace('.', ',')} ${u}`;
  const anunciado = `${String(doNome.valor).replace('.', ',')} ${doNome.unidade}`;
  return `O nome diz ${anunciado} e você preencheu ${digitado}. Confira qual está certo.`;
};

/** Rótulo de prateleira: "5 KG", ou vazio quando não há conteúdo declarado. */
export const formatarConteudo = (
  peso: number | string | null | undefined,
  pesoUnidade: string | null | undefined,
): string => {
  const n = typeof peso === 'number' ? peso : parseFloat(String(peso ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  const qtd = String(Number(n.toFixed(3))).replace('.', ',');
  const u = normalizarUnidade(pesoUnidade, '');
  // Sem unidade é o passivo herdado da migr. 438 — dizer "5" e calar a medida
  // é o que causou o problema; melhor a tela admitir que não sabe.
  return u === '' ? `${qtd} (unidade não informada)` : `${qtd} ${u}`;
};

/**
 * Vocabulário canônico: sempre MAIÚSCULA, sem espaço. É o que o catálogo já
 * gravava e o que o PDV já assume (`String(p.unidade).toUpperCase()`), então
 * normalizar para cá não muda comportamento de nada que já funcionava.
 */
export const normalizarUnidade = (u: string | null | undefined, fallback = 'UN'): string => {
  const s = String(u ?? '').trim().toUpperCase();
  return s === '' ? fallback : s;
};

/** Unidades que fazem sentido no cadastro de produto desta unidade de negócio. */
export const unidadesDeProduto = (filial: string): readonly string[] =>
  filial === 'SuperMax' ? UNIDADES_PRODUTO : UNIDADES_DISCRETAS;

/**
 * Unidades que a requisição oferece. É a lista de produto da filial mais
 * serviço — compra eventual cobre manutenção, frete, licença, e nada disso se
 * mede em UN sem soar errado.
 */
export const unidadesDeRequisicao = (filial: string): readonly string[] =>
  [...unidadesDeProduto(filial), UNIDADE_SERVICO];

/**
 * Exemplo de item para o placeholder.
 *
 * O da SuperMax dizia "— fardo com 500" porque não havia onde declarar isso; a
 * migr. 591 deu campo à embalagem, e o exemplo voltou a ser só o nome do item. Ajuda contextual, não regra: "papel A4
 * 75g, resma" não diz nada a quem trabalha na TechMax. O formulário em si é o
 * mesmo nas três — requisição de compra é documento corporativo único, e
 * ramificar campos por filial faria a tela mentir sobre o processo.
 */
export const EXEMPLO_ITEM_REQUISICAO: Record<string, string> = {
  SuperMax: 'Sacola plástica reforçada 50x60',
  MaxLook:  'Manequim de vitrine, corpo inteiro',
  TechMax:  'Cabo HDMI 2.1 — 2 metros',
  Matriz:   'Papel A4 75g — resma 500 folhas',
};

/** Sem prefixo: serve de célula de exemplo no modelo de planilha. */
export const itemExemploDaFilial = (filial: string): string =>
  EXEMPLO_ITEM_REQUISICAO[filial] ?? EXEMPLO_ITEM_REQUISICAO.Matriz;

/**
 * Exemplo de PRODUTO por nicho — placeholder do cadastro e célula de exemplo do
 * modelo de planilha.
 *
 * O formulário mostrava "Ex: Parafuso M6" e "Ex: Samsung, Nestlé, 3M" nas três
 * filiais, e o modelo de planilha vinha com arroz e "Tio João" para todo mundo.
 * Quem cadastra numa boutique lê exemplo de ferragem e de mercearia e para para
 * entender se está na tela certa — o exemplo, que existe para tirar dúvida,
 * criava uma. Nicho diferente, catálogo diferente.
 *
 * Continua sendo AJUDA, não regra: o formulário é o mesmo nos três, como na
 * requisição de compra acima.
 */
export type ExemploProduto = {
  nome: string;
  marca: string;
  categoria: string;
  subcategoria: string;
  fornecedor: string;
};

export const EXEMPLO_PRODUTO: Record<string, ExemploProduto> = {
  SuperMax: {
    nome: 'Arroz Branco Tipo 1 — 5 kg',
    marca: 'Tio João',
    categoria: 'Mercearia',
    subcategoria: 'Grãos',
    fornecedor: 'Distribuidora Central Ltda',
  },
  MaxLook: {
    nome: 'Camiseta Básica Gola Careca',
    marca: 'Hering',
    categoria: 'Camisetas',
    subcategoria: 'Manga curta',
    fornecedor: 'Confecções Modelo Ltda',
  },
  TechMax: {
    nome: 'Fone Bluetooth TWS',
    marca: 'JBL',
    categoria: 'Áudio',
    subcategoria: 'Fones sem fio',
    fornecedor: 'Distribuidora Tech Sul Ltda',
  },
  Matriz: {
    nome: 'Papel A4 75g — resma 500 folhas',
    marca: 'Report',
    categoria: 'Material de escritório',
    subcategoria: 'Papelaria',
    fornecedor: 'Papelaria Central Ltda',
  },
};

export const exemploProduto = (filial: string): ExemploProduto =>
  EXEMPLO_PRODUTO[filial] ?? EXEMPLO_PRODUTO.Matriz;

/** Com prefixo: serve de placeholder do input. */
export const exemploItemRequisicao = (filial: string): string =>
  `ex.: ${itemExemploDaFilial(filial).toLowerCase()}`;
