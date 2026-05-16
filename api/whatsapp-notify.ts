import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from './_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Qualquer utilizador autenticado pode enviar (decisão do utilizador na auditoria)
  const user = await authenticate(req, res);
  if (!user) return;

  const { instance, token, phone, message } = req.body ?? {};

  if (!instance || !token || !phone || !message) {
    return res.status(400).json({ error: 'instance, token, phone e message são obrigatórios' });
  }

  try {
    const endpoint = `https://api.z-api.io/instances/${instance}/token/${token}/send-text`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: String(phone), message: String(message) }),
    });

    const data = await response.json() as any;

    if (!response.ok || data.error) {
      return res.status(400).json({ error: data.error ?? 'Erro na Z-API' });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Erro interno' });
  }
}
