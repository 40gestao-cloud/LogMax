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

/**
 * Markup MULTIPLICADOR: `preco = custo * (1 + mk/100)`. Era o preço sugerido
 * até a migr. 656; ficou para a comparação — somar imposto, taxa e despesa
 * ao markup subprecifica sempre, porque eles são percentuais do PREÇO.
 */
export const precoPorMarkup = (custo: number, markupPct: number): number =>
  Math.round(custo * (1 + markupPct / 100) * 100) / 100;

// ── Markup divisor (migr. 656) ───────────────────────────────────────────────
//
//   PV = custo / (1 − (imposto% + taxas% + despesas% + lucro%))
//
// Os quatro percentuais são do preço de venda. Custo 10 com 33% de fatias:
// 10 / 0,67 = 14,93, e sobram exatamente 10% de lucro. No multiplicador,
// 10 × 1,33 = 13,30, e o lucro real cai para 1,8%.

/** O que a RPC `parametros_precificacao` devolve. */
export type ParametrosPrecificacao = {
  filial: string;
  regime: 'simples_anexo_i';
  /** Só para quem abre o DRE (financeiro/gerente); os demais recebem null. */
  rbt12: number | null;
  rbt12_origem: 'manual' | 'primeiro_mes' | 'proporcional' | '12_meses';
  rbt12_meses: number | null;
  faixa: number;
  aliquota_nominal: number;
  parcela_deduzir: number;
  aliquota_efetiva: number;
  acima_do_teto: boolean;
  despesas_pct: number | null;
  despesas_origem: OrigemPercentual;
  taxas_pct: number | null;
  taxas_origem: OrigemPercentual;
  janela_inicio: string;
  janela_fim: string;
  pode_editar: boolean;
  manual: { rbt12: number | null; despesas_pct: number | null; taxas_pct: number | null } | null;
  atualizado_em: string | null;
};

export type OrigemPercentual = 'manual' | 'historico' | 'sem_historico';

/** As fatias do preço que não são custo nem lucro, em % do preço de venda. */
export type Deducoes = { impostos: number; taxas: number; despesas: number };

export const deducoesDe = (p: ParametrosPrecificacao): Deducoes => ({
  impostos: Number(p.aliquota_efetiva ?? 0),
  taxas:    Number(p.taxas_pct ?? 0),
  despesas: Number(p.despesas_pct ?? 0),
});

const somaDeducoes = (d: Deducoes) => d.impostos + d.taxas + d.despesas;

/** `1 − soma/100`. Null quando as fatias somam 100% ou mais: não há preço que pague. */
export const markupDivisor = (d: Deducoes, lucroPct: number): number | null => {
  const div = 1 - (somaDeducoes(d) + lucroPct) / 100;
  return div > 0 ? Math.round(div * 10000) / 10000 : null;
};

export const precoPorMarkupDivisor = (custo: number, d: Deducoes, lucroPct: number): number | null => {
  const div = markupDivisor(d, lucroPct);
  if (div === null || !(custo > 0)) return null;
  return Math.round((custo / div) * 100) / 100;
};

/** O markup multiplicador que dá o mesmo preço — o número que o aluno digitava antes. */
export const markupEquivalente = (d: Deducoes, lucroPct: number): number | null => {
  const div = markupDivisor(d, lucroPct);
  return div === null ? null : (1 / div - 1) * 100;
};

export type Composicao = {
  custo: number; impostos: number; taxas: number; despesas: number;
  /** O que sobra de verdade. Negativo = o preço não paga a operação. */
  lucro: number; lucroPct: number;
};

/** Onde cada real do preço vai parar. */
export const composicaoDoPreco = (venda: number, custo: number, d: Deducoes): Composicao | null => {
  if (!(venda > 0)) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const impostos = r2(venda * d.impostos / 100);
  const taxas    = r2(venda * d.taxas / 100);
  const despesas = r2(venda * d.despesas / 100);
  const lucro    = r2(venda - custo - impostos - taxas - despesas);
  return { custo: r2(custo), impostos, taxas, despesas, lucro, lucroPct: (lucro / venda) * 100 };
};

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
