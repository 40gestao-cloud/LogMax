// Numeração de nota fiscal — sequencial, nunca sorteada. É assim que o
// documento existe em qualquer empresa de verdade: sem buraco, sem repetição,
// crescente. O botão "Gerar" em Recebimentos não inventa um número — lê o
// maior já usado na filial e sugere o próximo, do mesmo jeito que "Gerar" em
// Cadastros > Produtos reserva o próximo código.
//
// Série NÃO tem gerador (ver RecebimentosView): série de nota é `1` em quase
// toda empresa — constante, não sorteio. Um botão ali ensinaria o contrário.

/** 9 dígitos com zeros à esquerda — o mesmo tamanho de uma numeração de NF-e. */
const CASAS = 9;

/**
 * Próximo número de NF, a partir dos números já usados nesta filial.
 * Lixo (texto sem dígito, string vazia, null) é ignorado, não interrompe a
 * conta. Sem nenhum número válido, começa em `000000001`.
 */
export const proximoNumeroNf = (numerosExistentes: (string | null | undefined)[]): string => {
  const maior = numerosExistentes.reduce((max, n) => {
    const digitos = String(n ?? '').replace(/\D/g, '');
    if (!digitos) return max;
    const valor = parseInt(digitos, 10);
    return Number.isFinite(valor) && valor > max ? valor : max;
  }, 0);
  return String(maior + 1).padStart(CASAS, '0');
};
