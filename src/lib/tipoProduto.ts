// Tipo do produto — o DESTINO do item, que é como ERP real o classifica.
//
// Existiam dois valores ('estoque_venda' e 'patrimonio') e material de consumo
// não tinha onde caber: resma de papel, água da equipe, produto de limpeza,
// saco de lixo, embalagem, cartucho. Cadastrado como mercadoria, o papel entrava
// no PDV e o formulário cobrava preço de venda; como patrimônio, perdia o saldo
// e a requisição ao almoxarifado. Migr. 440 abriu o terceiro.
//
// Régua única porque os literais estavam espalhados por seis views, e todas as
// checagens eram BLACKLIST (`tipo !== 'patrimonio'`) — a forma que faz o tipo
// novo nascer vendável. Aqui só existe pergunta afirmativa.

export const TIPOS_PRODUTO = ['estoque_venda', 'consumo', 'patrimonio'] as const;

export type TipoProduto = typeof TIPOS_PRODUTO[number];

/** Legado de antes da coluna: sempre foi mercadoria na prática. */
export const normalizarTipo = (t: string | null | undefined): TipoProduto =>
  (TIPOS_PRODUTO as readonly string[]).includes(String(t ?? ''))
    ? (t as TipoProduto)
    : 'estoque_venda';

/**
 * Vendável. É a pergunta que PDV, catálogo, orçamento, loja e vitrine devem
 * fazer — afirmativa, não "não é patrimônio". O banco repete a regra em
 * `fn_item_venda_so_mercadoria` e `fn_produto_publicavel` (migr. 440).
 */
export const ehVendavel = (t: string | null | undefined): boolean =>
  normalizarTipo(t) === 'estoque_venda';

/** Tem saldo, mínimo e movimentação. Mercadoria e consumo têm; patrimônio não. */
export const temEstoque = (t: string | null | undefined): boolean =>
  normalizarTipo(t) !== 'patrimonio';

export const TIPO_LABEL: Record<TipoProduto, string> = {
  estoque_venda: 'Mercadoria para revenda',
  consumo:       'Uso e consumo (interno)',
  patrimonio:    'Patrimônio (bem de uso)',
};

/** Explica a escolha na própria tela — é onde o aluno decide errado. */
export const TIPO_AJUDA: Record<TipoProduto, string> = {
  estoque_venda:
    'Entra no estoque e sai pelo PDV. É o que a loja vende.',
  consumo:
    'A empresa compra para usar, não para vender: resma de papel, água, material de limpeza, embalagem. Entra no estoque e sai por Estoque > Requisições de Material. Nunca aparece no PDV nem na loja.',
  patrimonio:
    'Bem de uso da empresa: balcão, freezer, computador, manequim. Não tem saldo de estoque — depois de salvar, é gerido em Financeiro > Patrimônio e sai desta lista.',
};
