// Biblioteca de fórmulas do Max Show — o professor clica e a fórmula cai no
// slide como caixa de texto.
//
// As de preço seguem a conta que o sistema faz em `precificacao.ts` (markup
// divisor, migr. 656): o slide não pode ensinar uma coisa e a tela de
// Precificação calcular outra. Markup é sobre o CUSTO, margem é sobre a VENDA.

export type GrupoFormula = 'Preço' | 'Markup e margem' | 'Lucro' | 'Indicadores';

export type FormulaShow = { nome: string; formula: string; grupo: GrupoFormula };

/** Ordem em que os grupos aparecem na biblioteca. */
export const GRUPOS_FORMULAS: GrupoFormula[] = ['Preço', 'Markup e margem', 'Lucro', 'Indicadores'];

const FATIAS = 'Impostos % + Taxas % + Despesas % + Lucro %';

export const FORMULAS_SHOW: FormulaShow[] = [
  { grupo: 'Preço', nome: 'Preço de Custo', formula: 'Custo = Valor pago + Frete + Impostos da compra + Outros custos' },
  { grupo: 'Preço', nome: 'Markup divisor', formula: `Divisor = 1 − (${FATIAS}) ÷ 100` },
  { grupo: 'Preço', nome: 'Preço de Venda (markup divisor)', formula: `Preço de Venda = Custo ÷ [1 − (${FATIAS}) ÷ 100]` },
  { grupo: 'Preço', nome: 'Markup multiplicador', formula: 'Multiplicador = 1 ÷ Divisor\nPreço de Venda = Custo × Multiplicador' },
  { grupo: 'Preço', nome: 'Preço de Venda (markup simples)', formula: 'Preço de Venda = Custo × (1 + Markup % ÷ 100)' },
  { grupo: 'Markup e margem', nome: 'Markup (sobre o custo)', formula: 'Markup % = (Preço de Venda − Custo) ÷ Custo × 100' },
  { grupo: 'Markup e margem', nome: 'Margem de Lucro (sobre a venda)', formula: 'Margem % = (Preço de Venda − Custo) ÷ Preço de Venda × 100' },
  { grupo: 'Markup e margem', nome: 'Margem Líquida', formula: 'Margem Líquida % = Lucro Líquido ÷ Receita × 100' },
  { grupo: 'Markup e margem', nome: 'Margem de Contribuição', formula: 'Margem de Contribuição = Preço de Venda − Custo − Despesas Variáveis' },
  { grupo: 'Lucro', nome: 'Lucro Bruto', formula: 'Lucro Bruto = Receita de Vendas − Custo da Mercadoria Vendida (CMV)' },
  { grupo: 'Lucro', nome: 'Lucro Líquido', formula: 'Lucro Líquido = Preço de Venda − Custo − Impostos − Taxas − Despesas' },
  { grupo: 'Indicadores', nome: 'Ponto de Equilíbrio', formula: 'Ponto de Equilíbrio (R$) = Despesas Fixas ÷ Margem de Contribuição %' },
  { grupo: 'Indicadores', nome: 'Ticket Médio', formula: 'Ticket Médio = Faturamento ÷ Número de vendas' },
];

/** Normaliza para busca: sem acento, minúsculo. */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtra pelo nome ou pelo corpo da fórmula, ignorando acento e caixa. */
export function filtrarFormulas(busca: string): FormulaShow[] {
  const q = chave(busca.trim());
  if (!q) return FORMULAS_SHOW;
  return FORMULAS_SHOW.filter(f => chave(f.nome).includes(q) || chave(f.formula).includes(q));
}
