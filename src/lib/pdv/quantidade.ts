import { UNIDADES_FRACIONARIAS } from '../unidades';

// Quantidade no PDV — usada pelos dois PDVs (PDVView e PDVViewSupermax).

// Unidades em que a venda é por peso/volume — o PDV pede peso em vez de
// incrementar +1. Operador digita "1,250" pra 1 kg e 250 g.
// Vem de src/lib/unidades.ts — mesma régua do cadastro e da requisição.
export const isProdutoFracionario = (p: any): boolean =>
  UNIDADES_FRACIONARIAS.has(String(p?.unidade ?? 'UN').toUpperCase());

// Quantidade armada na tela: 2 e não "2"→"2,000"; peso mantém as 3 casas.
// Separado de `formatQtd` porque aquele arredonda para inteiro quando a
// unidade não é fracionária — e a armada é mostrada antes de existir item, ou
// seja, antes de existir unidade.
export const fmtQtdArmada = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// Não confundir com `formatQtd` de lib/viewUtils (recebe um booleano): este
// decide pela unidade do item.
export const formatQtd = (qtd: number, unidade: string): string => {
  const u = (unidade || 'UN').toUpperCase();
  if (UNIDADES_FRACIONARIAS.has(u)) {
    return qtd.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return String(Math.round(qtd));
};
