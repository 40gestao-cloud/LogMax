import { createHmac } from 'crypto';

/**
 * Helpers compartilhados pelos endpoints de Ponto Eletrônico
 * (qr-token, register-ponto-qr, register-ponto-codigo).
 * Toda lógica de fuso usa Acre (UTC-5, sem DST).
 */

export const CHECKPOINT_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  retorno: 'Retorno do Intervalo',
  saida:   'Saída',
};

// Defaults = turma da manhã. Cada projeto Vercel pode sobrescrever via env
// PONTO_ENTRADA / PONTO_RETORNO / PONTO_SAIDA (formato "HH:MM").
const PONTO_DEFAULTS = { entrada: '07:40', retorno: '09:20', saida: '11:20' };

function parseHHMM(value: string | undefined, fallback: string): number {
  const raw = (value ?? fallback).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  // Em vez de cair em fallback silenciosamente, derrubamos o boot: env
  // mal-formada significa horário errado pra turma inteira.
  if (!m) throw new Error(`PONTO env inválida: "${raw}" (esperado HH:MM)`);
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h > 23 || mm > 59) throw new Error(`PONTO env fora do range: "${raw}"`);
  return h * 60 + mm;
}

/** Horários-alvo em minutos desde meia-noite (hora do Acre). */
export const CHECKPOINT_TARGET_MINUTES: Record<string, number> = {
  entrada: parseHHMM(process.env.PONTO_ENTRADA, PONTO_DEFAULTS.entrada),
  retorno: parseHHMM(process.env.PONTO_RETORNO, PONTO_DEFAULTS.retorno),
  saida:   parseHHMM(process.env.PONTO_SAIDA,   PONTO_DEFAULTS.saida),
};

export const CHECKPOINT_KEYS = ['entrada', 'retorno', 'saida'] as const;

export const TOLERANCE_MINUTES = 1;

/** Janela do QR/código: 2 minutos. */
export const WINDOW_MS = 120_000;

/** Acre = UTC-5, sem horário de verão. */
export const ACRE_OFFSET_MIN = -5 * 60;

export function currentWindowId(now: Date = new Date()): number {
  return Math.floor(now.getTime() / WINDOW_MS);
}

/** Aceita janela atual e a anterior (≈ até 4 min de tolerância). */
export function windowIsValid(id: number, now: Date = new Date()): boolean {
  const c = currentWindowId(now);
  return id === c || id === c - 1;
}

export function computeStatus(checkpoint: string, now: Date = new Date()): 'No Horário' | 'Atrasado' {
  const localMinutes =
    ((now.getUTCHours() * 60 + now.getUTCMinutes()) + ACRE_OFFSET_MIN + 1440) % 1440;
  const target = CHECKPOINT_TARGET_MINUTES[checkpoint];
  if (target === undefined) return 'No Horário';
  return localMinutes <= target + TOLERANCE_MINUTES ? 'No Horário' : 'Atrasado';
}

/** YYYY-MM-DD na perspectiva de Rio Branco. Necessário para detecção de
 *  duplicidade não vazar entre dias quando o relógio UTC já virou. */
export function acreDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Rio_Branco',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(now);
}

export function acreTimeString(now: Date = new Date()): string {
  return now.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco',
  });
}

/** Início e fim do dia local (Acre) em ISO UTC — pra `gte/lt` no Postgres. */
export function acreDayBoundsIso(now: Date = new Date()): { inicio: string; fim: string } {
  const hoje = acreDateString(now);
  const inicio = `${hoje}T05:00:00Z`; // 00:00 ACT = 05:00 UTC
  const fimDate = new Date(inicio);
  fimDate.setUTCHours(fimDate.getUTCHours() + 24);
  return { inicio, fim: fimDate.toISOString() };
}

/**
 * Código curto humano (6 dígitos numéricos). Determinístico para
 * (windowId, checkpoint, secret). Mesma janela do token QR.
 *
 * Domínio efetivo: 10^6 = 1.000.000 valores por checkpoint a cada 2 min.
 * Risco de brute-force aceitável: 6 dígitos ≈ 1 em 1M por tentativa, com
 * janela curta. Considerar rate-limit no endpoint se virar alvo.
 */
export function generateCodigo(checkpoint: string, windowId: number, secret: string): string {
  const hmac = createHmac('sha256', secret)
    .update(`code:${windowId}|${checkpoint}`)
    .digest();
  // 4 primeiros bytes do HMAC → uint32 → mod 1_000_000.
  const n = hmac.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/**
 * Tenta verificar um código contra os 3 checkpoints, current e previous window.
 * Retorna o checkpoint que casou, ou null. Comparação tempo-constante por checkpoint
 * via comparação de strings com loop completo (curto, baixo risco de timing leak).
 */
export function verifyCodigo(
  code: string,
  secret: string,
  now: Date = new Date(),
): string | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = currentWindowId(now);
  for (const cp of CHECKPOINT_KEYS) {
    for (const w of [current, current - 1]) {
      const expected = generateCodigo(cp, w, secret);
      if (constantTimeEq(expected, code)) return cp;
    }
  }
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
