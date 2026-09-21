// Espelho client-side do motor de rendimento da migr. 604. O banco continua
// sendo a fonte da verdade — isto aqui existe para a tela mostrar a projeção
// ANTES do clique ("se eu deixar 6 meses, quanto volta?").
//
// As duas contas têm de bater com as da RPC, incluindo o arredondamento: o
// juro é arredondado A CADA MÊS (é o que `fechar_mes_aplicacoes` faz), não só
// no fim. Arredondar uma vez só daria centavos de diferença entre a projeção
// e o extrato, e centavo de diferença numa tela de dinheiro derruba a
// confiança do aluno no sistema inteiro.

/** IR regressivo da renda fixa, em MESES FECHADOS (vide o cabeçalho da 604). */
export function irPct(meses: number): number {
  if (meses <= 6) return 22.5;
  if (meses <= 12) return 20;
  if (meses <= 24) return 17.5;
  return 15;
}

const cent = (v: number) => Math.round(v * 100) / 100;

/** Rendimento BRUTO acumulado em `meses` fechamentos, juros compostos. */
export function projetarRendimento(valor: number, taxaMensal: number, meses: number): number {
  let bruto = 0;
  for (let i = 0; i < meses; i++) {
    bruto = cent(bruto + cent((valor + bruto) * taxaMensal / 100));
  }
  return bruto;
}

export type Resgate = {
  bruto: number;
  irPct: number;
  ir: number;
  liquido: number;
  creditado: number;
};

/** O que volta para a conta no resgate: principal + rendimento menos IR. */
export function calcularResgate(
  valor: number, bruto: number, meses: number, isentoIr: boolean,
): Resgate {
  const pct = isentoIr ? 0 : irPct(meses);
  const ir = cent(bruto * pct / 100);
  const liquido = cent(bruto - ir);
  return { bruto, irPct: pct, ir, liquido, creditado: cent(valor + liquido) };
}

/** Projeção completa para a tela: aplicar X hoje, resgatar em N meses. */
export function projetarResgate(
  valor: number, taxaMensal: number, meses: number, isentoIr: boolean,
): Resgate {
  return calcularResgate(valor, projetarRendimento(valor, taxaMensal, meses), meses, isentoIr);
}
