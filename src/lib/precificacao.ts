// Markup e margem — duas contas diferentes que o sistema chamava igual.
//
// O cadastro de produto exibia `(venda − custo) / custo` sob o rótulo "Margem
// de Lucro". Essa conta é MARKUP: quanto se acrescenta ao custo para chegar ao
// preço. Margem é outra coisa — quanto sobra da VENDA:
//
//   custo 10, venda 20  →  markup 100%   (dobrei o custo)
//                          margem  50%   (metade do preço é lucro)
//
// As duas são úteis e o varejo usa as duas: markup FORMA o preço na ponta
// (é o que `categorias_produto.margem_alvo` guarda, apesar do nome — o COMMENT
// da coluna no banco já diz "Markup-alvo"), e margem MEDE o resultado (é o que
// o DRE calcula em `gerar_dre`: 100 * lucro_bruto / receita_liquida).
//
// O sistema tinha as duas convenções e chamava as duas de "margem". Num curso
// de gestão isso não é detalhe de rótulo: o aluno que lê 100% de "margem" e
// planeja em cima disso erra o dobro.
//
// A fórmula vivia duplicada em ProdutosView e CatalogoProdutosView. Aqui é uma
// só, e cada função diz no nome qual das duas contas faz.

/** Quanto se acrescenta ao CUSTO para chegar ao preço. `(v − c) / c`. */
export const calcMarkup = (venda: number, custo: number): number | null => {
  if (!custo || !venda || custo <= 0) return null;
  return ((venda - custo) / custo) * 100;
};

/** Quanto sobra da VENDA depois do custo. `(v − c) / v`. É a do DRE. */
export const calcMargem = (venda: number, custo: number): number | null => {
  if (!custo || !venda || venda <= 0) return null;
  return ((venda - custo) / venda) * 100;
};

/** Preço formado pelo markup da categoria. `preco = custo * (1 + mk/100)`. */
export const precoPorMarkup = (custo: number, markupPct: number): number =>
  Math.round(custo * (1 + markupPct / 100) * 100) / 100;

/**
 * Régua de cor do MARKUP, preservada da versão anterior sem mudança de valor —
 * a turma já leu esses números por meses e recalibrar junto com a correção do
 * rótulo faria parecer que o catálogo inteiro piorou de um dia para o outro.
 *
 * Não existe régua equivalente para margem aqui, de propósito: margem saudável
 * depende do ramo (mercearia trabalha com 20-30%, boutique com 50%+), e chutar
 * um número único para as três filiais ensinaria outra coisa errada. A margem
 * aparece como número, sem juízo de valor.
 */
export const corDoMarkup = (markup: number | null): string =>
  markup === null ? 'text-gray-600'
  : markup >= 30  ? 'text-emerald-400'
  : markup >= 10  ? 'text-yellow-400'
  :                 'text-red-400';

/**
 * Preço de venda abaixo do custo — o erro que a turma da contabilidade cometeu
 * em 2026-09-15 lançando os dois campos trocados.
 *
 * Não é "quase certo": o markup nasce negativo, o catálogo mostra prejuízo por
 * unidade e o CMV do DRE fica maior que a receita. Como é digitação em dois
 * campos vizinhos, a chance de acontecer de novo é alta.
 *
 * Vender abaixo do custo EXISTE no varejo (promoção-isca, queima de validade),
 * então isto não é uma regra de negócio proibida — é a diferença entre a pessoa
 * ter decidido isso e ter trocado os campos de lugar. Quem decide marca a
 * exceção; quem errou vê o bloqueio.
 *
 * Zero e branco não entram: cadastro antecipado nasce sem custo (migr. 480), e
 * tratar ausência como prejuízo devolveria o número inventado que a 480 tirou.
 */
export const vendaAbaixoDoCusto = (venda: number, custo: number): boolean =>
  custo > 0 && venda > 0 && venda < custo;

export const fmtPct = (v: number | null, casas = 1): string =>
  v === null ? '—' : `${v.toFixed(casas).replace('.', ',')}%`;

/** Texto de apoio: explica a diferença onde ela aparece pela primeira vez. */
export const EXPLICA_MARKUP_MARGEM =
  'Markup é sobre o custo (quanto foi acrescentado); margem é sobre a venda (quanto sobra do preço). Custo R$ 10 e venda R$ 20 são 100% de markup e 50% de margem.';
