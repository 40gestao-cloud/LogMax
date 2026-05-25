import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { authenticate, authorize, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import {
  CHECKPOINT_LABELS,
  CHECKPOINT_KEYS,
  WINDOW_MS,
  currentWindowId,
  generateCodigo,
} from '../lib/ponto.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'qr-token');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Apenas admin, ceo ou gerente podem gerar tokens QR.
    const user = await authenticate(req, res);
    if (!user) return;
    if (!authorize(user, res, 'admin', 'ceo', 'gerente')) {
      log.warn('user.permission_denied', { user_id: user.id, user_role: user.role });
      return;
    }

    // Secret dedicado — separado do service_role para limitar blast radius se vazar
    const secret = process.env.QR_TOKEN_SECRET;
    if (!secret) {
      log.error('config.missing', new Error('QR_TOKEN_SECRET ausente'));
      return res.status(500).json({ error: 'QR_TOKEN_SECRET não configurado.' });
    }

    const requested = req.query.checkpoint as string;
    const checkpoint = CHECKPOINT_KEYS.includes(requested as any) ? requested : 'entrada';

    const windowId = currentWindowId();
    const payload = `${windowId}|${checkpoint}`;
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    const token = `${Buffer.from(payload).toString('base64url')}.${hmac}`;
    const codigo = generateCodigo(checkpoint, windowId, secret);
    const expiresAt = new Date((windowId + 1) * WINDOW_MS).toISOString();

    log.info('qr.token_generated', { user_id: user.id, checkpoint });

    return res.status(200).json({
      token,
      codigo,
      checkpoint,
      checkpointLabel: CHECKPOINT_LABELS[checkpoint],
      expiresAt,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
