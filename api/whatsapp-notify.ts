import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'whatsapp-notify');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Qualquer utilizador autenticado pode enviar (decisão do utilizador na auditoria)
    const user = await authenticate(req, res);
    if (!user) return;

    const { instance, token, phone, message } = req.body ?? {};

    if (!instance || !token || !phone || !message) {
      log.warn('request.validation_failed', {
        user_id: user.id,
        missing: { instance: !instance, token: !token, phone: !phone, message: !message },
      });
      return res.status(400).json({ error: 'instance, token, phone e message são obrigatórios' });
    }

    const endpoint = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: String(phone), message: String(message) }),
    });

    const data = await response.json() as any;

    if (!response.ok || data.error) {
      log.warn('zapi.failed', {
        user_id: user.id,
        status: response.status,
        zapi_error: data.error,
      });
      return res.status(400).json({ error: data.error ?? 'Erro na Z-API' });
    }

    log.info('zapi.sent', { user_id: user.id, phone_len: String(phone).length });
    return res.status(200).json({ ok: true });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
