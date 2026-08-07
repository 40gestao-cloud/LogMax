// Ordem oficial do pódio da Competição entre Filiais.
//
// Espelha o critério da RPC `ranking_competicao` (migr. 372), em cascata:
//   avaliada antes de não-avaliada → média final → média do conselho →
//   taxa de frequência → nº de notas → nome da filial.
//
// Existia como `sort((a,b) => b.media - a.media)` na tela da Matriz e como
// `b.media - a.media || b.n - a.n` na tela da filial: em empate exato as duas
// apontavam campeãs diferentes, e a primeira caía na ordem do array (SuperMax
// sempre). Um lugar só decide isso agora — e é o mesmo que o banco usa pra
// validar a filial declarada.

export type LinhaRanking = {
  filial: string;
  media: number;
  n: number;
  media_conselho?: number;
  taxa?: number | null;
};

export function compararRanking(a: LinhaRanking, b: LinhaRanking): number {
  // n = 0 é "não avaliada", não "nota zero": vai pro fim da lista.
  const avaliada = Number(b.n > 0) - Number(a.n > 0);
  if (avaliada !== 0) return avaliada;

  const porMedia = b.media - a.media;
  if (porMedia !== 0) return porMedia;

  const porConselho = (b.media_conselho ?? 0) - (a.media_conselho ?? 0);
  if (porConselho !== 0) return porConselho;

  // Frequência ausente perde do número existente (NULLS LAST no SQL).
  const ta = a.taxa ?? -1;
  const tb = b.taxa ?? -1;
  if (tb !== ta) return tb - ta;

  const porN = b.n - a.n;
  if (porN !== 0) return porN;

  return a.filial.localeCompare(b.filial);
}

export function ordenarRanking<T extends LinhaRanking>(linhas: T[]): T[] {
  return [...linhas].sort(compararRanking);
}
