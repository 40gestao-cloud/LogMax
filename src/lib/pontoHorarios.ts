// Horários do ponto exibidos na UI. Cada projeto Vercel pode sobrescrever
// via VITE_PONTO_ENTRADA / VITE_PONTO_RETORNO / VITE_PONTO_SAIDA (HH:MM).
// O backend tem cópia paralela em lib/ponto.ts (lendo PONTO_*); manter ambos
// em sincronia por turma — backend decide "Atrasado", frontend só mostra.

const DEFAULTS = { entrada: '07:40', retorno: '09:20', saida: '11:20' } as const;

function pick(envValue: string | undefined, fallback: string): string {
  const v = (envValue ?? '').trim();
  return /^\d{1,2}:\d{2}$/.test(v) ? v : fallback;
}

export const PONTO_HORARIOS = {
  entrada: pick(import.meta.env.VITE_PONTO_ENTRADA, DEFAULTS.entrada),
  retorno: pick(import.meta.env.VITE_PONTO_RETORNO, DEFAULTS.retorno),
  saida:   pick(import.meta.env.VITE_PONTO_SAIDA,   DEFAULTS.saida),
} as const;

const minutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Jornada diária da turma, em horas (saída − entrada).
 *
 * O expediente aqui é de ~4h, não 8 — é turma de docência. A folha derivava
 * tudo de 8h/220h até a migr. 290: falta acertava por acaso (dois erros que se
 * cancelavam), atraso descontava metade e hora extra nunca disparava.
 *
 * Fonte única do número, para a tela e o banco não discordarem: a RPC calcula
 * o mesmo a partir dos horários que esta constante alimenta.
 */
export const PONTO_JORNADA_HORAS =
  Math.max((minutos(PONTO_HORARIOS.saida) - minutos(PONTO_HORARIOS.entrada)) / 60, 0);
