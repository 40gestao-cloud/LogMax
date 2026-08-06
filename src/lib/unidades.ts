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
  SuperMax: 'Ex.: sacola plástica reforçada 50x60, fardo',
  MaxLook:  'Ex.: manequim de vitrine, corpo inteiro',
  TechMax:  'Ex.: cabo HDMI 2.1, 2 metros',
  Matriz:   'Ex.: papel A4 75g, resma',
};

export const exemploItemRequisicao = (filial: string): string =>
  EXEMPLO_ITEM_REQUISICAO[filial] ?? EXEMPLO_ITEM_REQUISICAO.Matriz;
