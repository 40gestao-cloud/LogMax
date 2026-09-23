// Numeração de nota fiscal — sequencial, nunca sorteada. É assim que o
// documento existe em qualquer empresa de verdade: sem buraco, sem repetição,
// crescente. O botão "Gerar" em Recebimentos não inventa um número — lê o
// maior já usado na filial e sugere o próximo, do mesmo jeito que "Gerar" em
// Cadastros > Produtos reserva o próximo código.
//
// Série NÃO tem gerador (ver RecebimentosView): série de nota é `1` em quase
// toda empresa — constante, não sorteio. Um botão ali ensinaria o contrário.
//
// ─── ONDE MORA O "MAIOR JÁ USADO" ──────────────────────────────────────────
//
// No banco, na RPC `resumo_recebimentos` (migr. 618). Havia aqui um
// `proximoNumeroNf(lista)` que recebia TODOS os números da unidade e reduzia
// ao máximo no navegador — e, para alimentá-lo, a tela relia `recebimentos`
// inteira a cada evento de realtime. Em 22/09 isso foi metade das 638 leituras
// que a turma da tarde fez em 15 minutos, e metade da manada que encheu o pool
// de conexões e deixou a sala oito minutos com a tela pendurada.
//
// O descarte de caracteres não-dígito (`\D`) agora é o `regexp_replace` da
// migração. Não há mais um gêmeo em TypeScript: um teste daqui não provaria o
// SQL, e dois lugares com a mesma regra é a regra em nenhum.

/** 9 dígitos com zeros à esquerda — o mesmo tamanho de uma numeração de NF-e. */
const CASAS = 9;

/**
 * Próximo número de NF a partir do maior já usado na filial, que vem somado do
 * banco (`resumo_recebimentos.max_nf`).
 *
 * `maior` inválido — NaN, negativo, ausente, ou a unidade que ainda não emitiu
 * nota nenhuma — conta como 0, e a numeração começa em `000000001`.
 */
export const proximoNumeroNfDeMaior = (maior: number | null | undefined): string => {
  const base = Number(maior);
  const piso = Number.isFinite(base) && base > 0 ? Math.floor(base) : 0;
  return String(piso + 1).padStart(CASAS, '0');
};
