// Prévia de parcelas na tela — espelha o que as RPCs `lancar_investimento_filial`
// e `vender_patrimonio` (migr. 634) gravam, para o aluno ver as datas e os
// valores antes de confirmar. Quem decide de verdade é o SQL; aqui só se mostra.
//
// Datas são texto 'YYYY-MM-DD' do começo ao fim: data pura não passa por
// `new Date()` local (vide lib/dates.ts, dataSimplesBR).

const pad = (n: number) => String(n).padStart(2, '0');

const partes = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { a, m, d };
};

const diasNoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** `iso` + n dias corridos. */
export function somarDias(iso: string, n: number): string {
  const { a, m, d } = partes(iso);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * `iso` + n meses. Dia que não existe no mês de destino cai no último dia —
 * é o que o Postgres faz com `date + interval 'n months'` (31/01 + 1 mês =
 * 28/02), e a prévia precisa bater com a conta gravada.
 */
export function somarMeses(iso: string, n: number): string {
  const { a, m, d } = partes(iso);
  const total = (m - 1) + n;
  const ano = a + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12 + 1;
  return `${ano}-${pad(mes)}-${pad(Math.min(d, diasNoMes(ano, mes)))}`;
}

/**
 * Divide `total` em `n` parcelas de centavos inteiros; a diferença do
 * arredondamento vai na última (mesma regra do SQL).
 */
export function dividirParcelas(total: number, n: number): number[] {
  if (n <= 1) return [Math.round(total * 100) / 100];
  const base = Math.round((total / n) * 100) / 100;
  const out = Array.from({ length: n - 1 }, () => base);
  const ultima = Math.round((total - base * (n - 1)) * 100) / 100;
  return [...out, ultima];
}

export type Parcela = { numero: number; valor: number; vencimento: string };

/**
 * Plano de parcelas. `repete` = cada parcela tem o valor inteiro e vence mês a
 * mês (aluguel); senão o total se divide e as datas andam `intervaloDias`.
 */
export function planoDeParcelas(
  total: number, n: number, primeiro: string,
  opts: { intervaloDias?: number; repete?: boolean } = {},
): Parcela[] {
  const qtd = Math.max(1, Math.floor(n || 1));
  if (!primeiro) return [];
  if (opts.repete) {
    return Array.from({ length: qtd }, (_, i) => ({
      numero: i + 1, valor: Math.round(total * 100) / 100, vencimento: somarMeses(primeiro, i),
    }));
  }
  const valores = dividirParcelas(total, qtd);
  const passo = opts.intervaloDias ?? 30;
  return valores.map((valor, i) => ({ numero: i + 1, valor, vencimento: somarDias(primeiro, i * passo) }));
}
