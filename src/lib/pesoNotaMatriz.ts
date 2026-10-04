// Peso da nota na Competição entre Filiais — espelho de
// `public._peso_nota_matriz(role)` (migr. 671). A nota da Administração vale 3
// dentro do item; CEO e conselheiros valem 1. Mexeu no peso? Mexe nos dois.
//
// Papel ausente é lido como conselheiro, a mesma leitura do COALESCE da 609.

export const PESO_NOTA_ADMIN = 3;

export const pesoNotaMatriz = (role: string | null | undefined): number =>
  (role ?? 'conselheiro') === 'admin' ? PESO_NOTA_ADMIN : 1;

// Média ponderada de um item: SUM(nota × peso) / SUM(peso). Null sem nota.
export function mediaPonderada(notas: { nota: number; role: string | null | undefined }[]): number | null {
  let soma = 0;
  let pesos = 0;
  for (const n of notas) {
    const p = pesoNotaMatriz(n.role);
    soma += n.nota * p;
    pesos += p;
  }
  return pesos > 0 ? soma / pesos : null;
}
