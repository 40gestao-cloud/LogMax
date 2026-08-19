// Mútuo entre Matriz e filial — Tabela Price.
//
// A Matriz aplica capital na filial e cobra juros. Não é aporte: aporte é
// dinheiro de sócio, entra no patrimônio e não rende taxa; o retorno dele é a
// distribuição de lucro. O que rende taxa mensal é dívida, e dívida se paga
// mesmo quando a filial dá prejuízo. A aula está aí.
//
// Price porque é o que o aluno reconhece de um financiamento de banco:
// parcela FIXA, e dentro dela o juro cai mês a mês enquanto a amortização
// sobe. É essa decomposição que permite dizer, mais tarde, que só o juro é
// despesa — devolver o principal não é custo de nada.
//
// Espelho client-side do que a RPC `aprovar_emprestimo` faz no banco (migr.
// 473). Existe para a tela mostrar a parcela ANTES de confirmar: a versão
// anterior aceitava "2,3" sem dizer de quê e cobrava 2,3% no total do
// contrato, não ao mês — R$ 1.150 de juros onde o professor esperava R$ 7.786.
//
// Não confundir com `src/lib/juros.ts`, que é juros de MORA (atraso de conta).

export type ParcelaMutuo = {
  n: number;
  parcela: number;
  juros: number;
  amortizacao: number;
  /** Saldo devedor DEPOIS desta parcela. */
  saldo: number;
};

export type TabelaMutuo = {
  parcelas: ParcelaMutuo[];
  /** Parcela fixa. A última difere em centavos quando há resto de arredondamento. */
  valorParcela: number;
  totalPago: number;
  totalJuros: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Monta a tabela Price de um mútuo.
 *
 * @param principal    valor emprestado
 * @param taxaMensalPct juros ao MÊS, em pontos percentuais (2.3 = 2,3% a.m.)
 * @param n            número de parcelas mensais
 */
export function tabelaPrice(principal: number, taxaMensalPct: number, n: number): TabelaMutuo {
  const p = Number(principal) || 0;
  const i = (Number(taxaMensalPct) || 0) / 100;
  const num = Math.max(1, Math.floor(Number(n) || 1));

  if (p <= 0) {
    return { parcelas: [], valorParcela: 0, totalPago: 0, totalJuros: 0 };
  }

  // Taxa zero não tem fórmula de Price (divisão por zero): vira rateio simples.
  // É o caso de quem usa o mútuo só para mover dinheiro com obrigação de
  // devolver, sem cobrar por isso.
  const valorParcela = i === 0
    ? round2(p / num)
    : round2((p * i * Math.pow(1 + i, num)) / (Math.pow(1 + i, num) - 1));

  const parcelas: ParcelaMutuo[] = [];
  let saldo = p;
  let totalPago = 0;
  let totalJuros = 0;

  for (let k = 1; k <= num; k++) {
    const juros = round2(saldo * i);
    // A última parcela amortiza o saldo que sobrou, em vez de repetir o valor
    // fixo: sem isso o arredondamento de centavos deixa a dívida viva ou paga
    // a mais, e o saldo devedor não fecha em zero.
    const amortizacao = k === num ? round2(saldo) : round2(valorParcela - juros);
    const parcela = k === num ? round2(amortizacao + juros) : valorParcela;

    saldo = round2(saldo - amortizacao);
    totalPago = round2(totalPago + parcela);
    totalJuros = round2(totalJuros + juros);
    parcelas.push({ n: k, parcela, juros, amortizacao, saldo });
  }

  return { parcelas, valorParcela, totalPago, totalJuros };
}
