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
 * Exemplo de item para o placeholder. Ajuda contextual, não regra: "papel A4
 * 75g, resma" não diz nada a quem trabalha na TechMax. O formulário em si é o
 * mesmo nas três — requisição de compra é documento corporativo único, e
 * ramificar campos por filial faria a tela mentir sobre o processo.
 */
export const EXEMPLO_ITEM_REQUISICAO: Record<string, string> = {
  SuperMax: 'Sacola plástica reforçada 50x60 — fardo com 500',
  MaxLook:  'Manequim de vitrine, corpo inteiro',
  TechMax:  'Cabo HDMI 2.1 — 2 metros',
  Matriz:   'Papel A4 75g — resma 500 folhas',
};

/** Sem prefixo: serve de célula de exemplo no modelo de planilha. */
export const itemExemploDaFilial = (filial: string): string =>
  EXEMPLO_ITEM_REQUISICAO[filial] ?? EXEMPLO_ITEM_REQUISICAO.Matriz;

/** Com prefixo: serve de placeholder do input. */
export const exemploItemRequisicao = (filial: string): string =>
  `ex.: ${itemExemploDaFilial(filial).toLowerCase()}`;
