import { randomUUID } from 'crypto';
import type { VercelRequest } from '@vercel/node';

// Logger estruturado para endpoints serverless.
//
// Emite JSON em uma linha para stdout/stderr — o Vercel ingere e renderiza
// nativamente em Logs Drains. Cada linha tem:
//   ts, level, event, endpoint, request_id, + contexto + stack trace se erro
//
// Convenção dos `event`:
//   <recurso>.<acao>            ex: user.created, user.permission_denied
//   handler.unhandled           catch-all (try/catch global do handler)
//   request.validation_failed   inputs faltando/inválidos
//
// Uso:
//   const log = createLogger(req, 'create-user');
//   log.info('user.created', { user_id, role });
//   log.warn('user.permission_denied', { reason: 'gerente_setor_mismatch' });
//   log.error('handler.unhandled', err);

type Level = 'info' | 'warn' | 'error';

export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, err: unknown, data?: Record<string, unknown>): void;
}

function emit(
  level: Level,
  event: string,
  context: Record<string, unknown>,
  err?: unknown,
): void {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  if (err instanceof Error) {
    payload.error_name = err.name;
    payload.error_message = err.message;
    payload.error_stack = err.stack;
  } else if (err !== undefined && err !== null) {
    payload.error_value = String(err);
  }
  const line = JSON.stringify(payload);
  // Vercel ingere stdout + stderr separadamente; manter erros em stderr ajuda a
  // filtrar incidentes rapidamente no dashboard.
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(req: VercelRequest, endpoint: string): Logger {
  // Vercel injeta x-vercel-id em todas as requests. Em dev local cai no UUID.
  const headerId = req.headers['x-vercel-id'];
  const request_id = typeof headerId === 'string' && headerId ? headerId : randomUUID();
  const base: Record<string, unknown> = { endpoint, request_id };
  return {
    info: (event, data) => emit('info', event, { ...base, ...data }),
    warn: (event, data) => emit('warn', event, { ...base, ...data }),
    error: (event, err, data) => emit('error', event, { ...base, ...data }, err),
  };
}
