// Condição de pagamento da proposta comercial (migr. 568).
//
// ESTE ARQUIVO NÃO DECIDE NADA. Quem calcula o preço que fica gravado é o
// gatilho `fn_orcamento_condicao_pagamento` no banco — mesma régua da migr. 554
// ("o preço da venda vem do catálogo, não do carrinho"). O que está aqui é a
// PRÉVIA que o vendedor vê enquanto monta a proposta, e ela precisa bater
// número a número com o gatilho. Mexeu num, mexa no outro.

/** Linha de `formas_pagamento` — o cadastro por filial (Empresa → Formas de Pagamento). */
export interface FormaPagamento {
  id: string;
  descricao: string;
  status?: string;
  filial?: string;
  /** Taxa da adquirente em %. Custo da loja: sai do líquido, não entra no preço. */
  taxa?: number | string | null;
  /** Dias até o 1º recebimento (D+n). */
  prazo?: number | string | null;
  desconto_percentual?: number | string | null;
  juros_mensal?: number | string | null;
  parcelas_max?: number | string | null;
  parcelas_sem_juros?: number | string | null;
  intervalo_dias?: number | string | null;
  exige_limite_credito?: boolean | null;
}

export interface ResumoCondicao {
  /** Mercadoria menos o desconto comercial digitado pelo vendedor. */
  base: number;
  /** Desconto que veio da forma de pagamento (à vista). */
  descontoCondicao: number;
  /** Juros do parcelamento (Tabela Price). */
  acrescimoJuros: number;
  /** O que o cliente paga. */
  valorTotal: number;
  parcelas: number;
  valorParcela: number;
  /** Custo estimado da maquininha — NÃO está dentro de valorTotal. */
  taxaAdquirente: number;
  /** O que a loja espera receber de fato. */
  valorLiquido: number;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const cent = (v: number) => Math.round(v * 100) / 100;

/** Teto de parcelas da forma; 1 quando não há forma escolhida. */
export const parcelasMaximas = (forma?: FormaPagamento | null): number =>
  Math.max(1, Math.min(36, num(forma?.parcelas_max, 1)));

/**
 * A conta da proposta.
 *
 * Ordem que importa: o desconto COMERCIAL entra primeiro (é negociação do
 * vendedor), o desconto da FORMA incide sobre o que sobrou, e só então o
 * parcelamento acrescenta juros — pela Tabela Price, que é como a parcela
 * nasce na vida real. Somar `base × i × n` seria juros simples e ensinaria
 * errado.
 */
export function calcularCondicao(
  subtotal: number,
  descontoComercial: number,
  forma: FormaPagamento | null | undefined,
  parcelas: number,
): ResumoCondicao {
  const base0 = Math.max(0, cent(num(subtotal) - num(descontoComercial)));

  if (!forma) {
    return {
      base: base0,
      descontoCondicao: 0,
      acrescimoJuros: 0,
      valorTotal: base0,
      parcelas: 1,
      valorParcela: base0,
      taxaAdquirente: 0,
      valorLiquido: base0,
    };
  }

  const n = Math.max(1, Math.min(parcelasMaximas(forma), Math.trunc(num(parcelas, 1)) || 1));
  const descontoCondicao = cent(base0 * num(forma.desconto_percentual) / 100);
  const base = base0 - descontoCondicao;

  const juros = num(forma.juros_mensal);
  const semJuros = Math.max(1, num(forma.parcelas_sem_juros, 1));

  let valorTotal: number;
  let acrescimoJuros = 0;
  if (n > semJuros && juros > 0) {
    const i = juros / 100;
    const parcela = base * i / (1 - Math.pow(1 + i, -n));
    valorTotal = cent(parcela * n);
    acrescimoJuros = cent(valorTotal - cent(base));
  } else {
    valorTotal = cent(base);
  }

  const taxaAdquirente = cent(valorTotal * num(forma.taxa) / 100);

  return {
    base: base0,
    descontoCondicao,
    acrescimoJuros,
    valorTotal,
    parcelas: n,
    valorParcela: cent(valorTotal / n),
    taxaAdquirente,
    valorLiquido: cent(valorTotal - taxaAdquirente),
  };
}

/** "Pix — à vista" / "Cartão de Crédito — 6x de R$ 184,54". */
export function rotuloCondicao(
  forma: string | null | undefined,
  parcelas: number | null | undefined,
  valorParcela?: number | null,
): string {
  if (!forma) return '—';
  const n = Math.max(1, num(parcelas, 1));
  if (n <= 1) return `${forma} — à vista`;
  const valor = valorParcela != null && Number(valorParcela) > 0
    ? ` de R$ ${Number(valorParcela).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
  return `${forma} — ${n}x${valor}`;
}

/**
 * Datas dos vencimentos que a conversão em pedido vai gerar.
 *
 * Espelha o laço de `converter_orcamento_em_pedido`: a 1ª vence em D+prazo e
 * as seguintes a cada `intervalo_dias`. Serve só para mostrar ao vendedor
 * quando o dinheiro entra — o título de verdade nasce no banco.
 */
export function vencimentosPrevistos(
  forma: FormaPagamento | null | undefined,
  parcelas: number,
  hoje: Date,
): Date[] {
  const prazo = Math.max(0, num(forma?.prazo, forma ? 0 : 30));
  const intervalo = Math.max(1, num(forma?.intervalo_dias, 30));
  const n = Math.max(1, Math.trunc(num(parcelas, 1)) || 1);
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(hoje.getTime());
    d.setDate(d.getDate() + prazo + k * intervalo);
    return d;
  });
}
