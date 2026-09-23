import { formatBRL } from '../viewUtils';

// Pagamento misto e troco do PDV da SuperMax (PDVViewSupermax). O PDV dos
// nichos não tem misto: lá a forma é única e o troco é só da tela.
//
// A venda é paga por uma lista de linhas até o restante chegar a zero. Cada
// linha de Dinheiro guarda o próprio troco — remover a linha tira o troco
// junto (a versão antiga guardava um troco agregado e dessincronizava).

export interface LinhaPagamento {
  forma: string;
  valor: number;
  troco?: number;
  parcelas?: number;
}

const r2 = (n: number) => parseFloat(n.toFixed(2));

// Folga de centavo nas comparações de dinheiro em ponto flutuante.
export const CENTAVO = 0.001;

// Desconto maior que o subtotal é erro do operador — clampa, porque a RPC
// criar_venda_pdv rejeita total < 0.
export const totaisComDesconto = (subtotal: number, desconto: number) => {
  const descontoAplicado = Math.min(desconto, subtotal);
  const totalFinal = Math.max(0, r2(subtotal - descontoAplicado));
  return { descontoAplicado, totalFinal };
};

export const restanteAPagar = (totalFinal: number, linhas: LinhaPagamento[]): number =>
  Math.max(0, r2(totalFinal - linhas.reduce((s, p) => s + p.valor, 0)));

// Valor desta forma: o parcial digitado, ou o restante se vazio. Valor acima
// do restante entra cortado no restante.
export const valorDevido = (parcial: number, restante: number): number =>
  parcial > 0 ? Math.min(parcial, restante) : restante;

// Misto começa quando já há linha lançada ou quando o parcial não cobre o
// restante. PIX aceita parcial (vira uma linha, como Dinheiro/Cartão); Fiado
// e Vale só funcionam fora dele — a RPC cria conta_receber pelo valor cheio.
export const mistoAtivo = (qtdLinhas: number, parcial: number, restante: number): boolean =>
  qtdLinhas > 0 || (parcial > 0 && parcial < restante - CENTAVO);

// Troco desta linha de Dinheiro; `null` quando o recebido não cobre o devido.
export const trocoDoRecebido = (recebido: number, devido: number): number | null =>
  recebido < devido - CENTAVO ? null : r2(recebido - devido);

// Editar o valor de uma linha: o teto é o que as outras deixam do total.
export const valorEditado = (totalFinal: number, linhas: LinhaPagamento[], idx: number, novo: number): number => {
  const outros = linhas.reduce((acc, p, i) => i === idx ? acc : acc + p.valor, 0);
  const teto = r2(totalFinal - outros);
  return r2(Math.min(novo, Math.max(teto, 0)));
};

// Texto gravado em `vendas.forma_pagamento`: a forma, ou
// "Misto: Dinheiro R$ 20,00 + PIX R$ 6,00". A RPC criar_venda_pdv cai no ELSE
// genérico (status='Pago') quando o texto não bate em 'Cartão Crédito'/'Fiado'
// — exatamente o que se quer para venda já paga em várias formas.
export const formaDoMisto = (linhas: LinhaPagamento[]): string => {
  if (linhas.length <= 1) return linhas[0]?.forma ?? '';
  const parts = linhas.map(p => `${p.forma} R$ ${formatBRL(p.valor)}`);
  return `Misto: ${parts.join(' + ')}`;
};

// PIX e Cartão: o MaxBank já confirmou, o valor é o que o cliente pagou.
// Editar a linha fecharia a venda com dinheiro que não entrou, e descartá-la
// não estorna nada — por isso uma e outra coisa pedem tratamento à parte.
export const ehLinhaEletronica = (p: LinhaPagamento): boolean =>
  p.forma === 'PIX' || p.forma === 'Cartão Crédito' || p.forma === 'Cartão Débito';

export const valorEletronicoPago = (linhas: LinhaPagamento[]): number =>
  r2(linhas.filter(ehLinhaEletronica).reduce((s, p) => s + p.valor, 0));

export const trocoTotal = (linhas: LinhaPagamento[]): number =>
  r2(linhas.reduce((s, p) => s + (p.troco ?? 0), 0));

// Só o VALOR das linhas em Dinheiro — o troco volta para o cliente, não fica
// na gaveta (migr. 562).
export const dinheiroNaGaveta = (linhas: LinhaPagamento[]): number =>
  r2(linhas.filter(p => p.forma === 'Dinheiro').reduce((s, p) => s + p.valor, 0));

// Parcelamento só aplica quando Cartão Crédito é forma única; em misto a RPC
// cai no ELSE genérico (status='Pago') e ignora p_parcelas.
export const parcelasDaVenda = (linhas: LinhaPagamento[]): number =>
  linhas.length === 1 && linhas[0].forma === 'Cartão Crédito' ? (linhas[0].parcelas ?? 1) : 1;

// Parte do misto paga em crédito, para `pdv_registrar_credito_misto`
// (migr. 415). Linhas de crédito com parcelamentos diferentes são raras no
// balcão — soma os valores e usa o maior parcelamento lançado.
export const creditoDoMisto = (linhas: LinhaPagamento[]): { valor: number; parcelas: number } => {
  const credito = linhas.filter(p => p.forma === 'Cartão Crédito');
  return {
    valor: r2(credito.reduce((s, p) => s + p.valor, 0)),
    parcelas: credito.reduce((mx, p) => Math.max(mx, p.parcelas ?? 1), 1),
  };
};
