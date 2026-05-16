import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { authenticate, authorize, applyCors } from '../lib/auth.js';

const CHECKPOINTS: Record<string, { label: string; target: number }> = {
  entrada: { label: 'Entrada',             target: 7*60+40  },
  retorno: { label: 'Retorno do Intervalo', target: 9*60+20  },
  saida:   { label: 'Saída',               target: 11*60+20 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Apenas admin ou gerente podem gerar tokens QR (decisão do utilizador na auditoria)
  const user = await authenticate(req, res);
  if (!user) return;
  if (!authorize(user, res, 'admin', 'gerente')) return;

  // Secret dedicado — separado do service_role para limitar blast radius se vazar
  const secret = process.env.QR_TOKEN_SECRET;
  if (!secret) return res.status(500).json({ error: 'QR_TOKEN_SECRET não configurado.' });

  const requested = req.query.checkpoint as string;
  const checkpoint = CHECKPOINTS[requested] ? requested : 'entrada';

  const windowId = Math.floor(Date.now() / 120000); // janela de 2 minutos
  const payload = `${windowId}|${checkpoint}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  const token = `${Buffer.from(payload).toString('base64url')}.${hmac}`;
  const expiresAt = new Date((windowId + 1) * 120000).toISOString();

  return res.status(200).json({
    token,
    checkpoint,
    checkpointLabel: CHECKPOINTS[checkpoint].label,
    expiresAt,
  });
}
