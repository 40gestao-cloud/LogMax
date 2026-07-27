// Paleta Premium LogMax — preto puro + dourado + branco.
// Sincroniza com o tema Premium do app (ver project_theme_premium).
// Usada por todos os exports PDF/Excel (biExports, avaliacoesPdf,
// competicaoPdf, centralAvaliacaoExports).

export const GOLD:      [number, number, number] = [212, 175, 55];  // #D4AF37
export const GOLD_DARK: [number, number, number] = [180, 145, 30];  // #B4911E
export const BLACK:     [number, number, number] = [10, 10, 10];    // #0A0A0A
export const GRAY_INK:  [number, number, number] = [40, 40, 40];
export const GRAY_MID:  [number, number, number] = [110, 110, 110];
export const GRAY_SOFT: [number, number, number] = [190, 190, 190];
export const GOLD_TINT: [number, number, number] = [252, 248, 235]; // bg alternado

// Formatos ARGB para exceljs (não usa RGB por canal — usa hex ARGB único).
export const GOLD_HEX      = 'FFD4AF37';
export const BLACK_HEX     = 'FF0A0A0A';
export const GOLD_TINT_HEX = 'FFFCF8EB';
