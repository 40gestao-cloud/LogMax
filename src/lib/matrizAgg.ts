// Helpers compartilhados pelos Comparativos da Matriz (Financeiro, RH,
// Logística, Marketing). Antes cada view duplicava sumByFilial /
// countByFilial / periodStartISO — extraído aqui pra reduzir drift.

import { daysAgoBR, todayBR } from './dates';
import { OP_FILIAIS, type FilialOp } from '../components/FilialsComparativo';

export type Period = '7d' | '30d' | '3m';
export const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '3m': '3 meses' };

/** Corte ISO no fuso do Acre — permite comparar com created_at/vencimento
 *  como string (ISO 8601 lex-comparável) sem instanciar Date. */
export function periodStartISO(p: Period): string {
  if (p === '7d')  return daysAgoBR(6);
  if (p === '30d') return daysAgoBR(29);
  return daysAgoBR(89);
}

/** Hoje ISO no fuso do Acre — atalho pro cálculo de sobreposição de
 *  janelas (ex.: campanhas ativas no período). */
export const todayISO = () => todayBR();

/** Soma `arr[*][key]` agrupando por `filial`. Ignora filiais fora do
 *  triplete operacional (Matriz/global caem fora). */
export function sumByFilial(arr: any[], key: string): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial] += Number(r[key]) || 0;
  return out as Record<FilialOp, number>;
}

/** Conta linhas por filial. Mesma regra de escopo do sumByFilial. */
export function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}

/** Zera os 3 buckets — útil pra inicializar um acumulador manual. */
export function zerosByFilial(): Record<FilialOp, number> {
  return { SuperMax: 0, MaxLook: 0, TechMax: 0 };
}

export { OP_FILIAIS };
export type { FilialOp };
