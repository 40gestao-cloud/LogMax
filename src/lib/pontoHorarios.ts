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

/**
 * Saída da turma gravada no banco (`ponto_jornada`), espelhada aqui pelo
 * `useJornadaTurma`. Existe para o `sessaoGuard`, que roda síncrono e antes do
 * login — não dá para esperar o banco. Vazio = vale o env.
 */
export const CHAVE_SAIDA_TURMA = 'logmax:saidaTurma';

export function saidaDaTurma(): string {
  try {
    const v = (localStorage.getItem(CHAVE_SAIDA_TURMA) ?? '').trim();
    if (/^\d{1,2}:\d{2}$/.test(v)) return v;
  } catch { /* modo privado */ }
  return PONTO_HORARIOS.saida;
}
