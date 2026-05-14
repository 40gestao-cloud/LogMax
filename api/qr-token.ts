import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const CHECKPOINTS: Record<string, { label: string; target: number }> = {
  entrada: { label: 'Entrada',             target: 7*60+40  },
  retorno: { label: 'Retorno do Intervalo', target: 9*60+20  },
  saida:   { label: 'Saída',               target: 11*60+20 },
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return res.status(500).json({ error: 'Servidor não configurado.' });

  // O admin escolhe o tipo; fallback para 'entrada'
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
