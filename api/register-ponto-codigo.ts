import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, getAdminClient, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import {
  CHECKPOINT_LABELS,
  acreDayBoundsIso,
  acreTimeString,
  computeStatus,
  verifyCodigo,
} from '../lib/ponto.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'register-ponto-codigo');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const admin = getAdminClient(res);
    if (!admin) {
      log.error('config.missing', new Error('Admin client unavailable'));
      return;
    }

    const user = await authenticate(req, res, admin);
    if (!user) return;

    const qrSecret = process.env.QR_TOKEN_SECRET;
    if (!qrSecret) {
      log.error('config.missing', new Error('QR_TOKEN_SECRET ausente'));
      return res.status(500).json({ error: 'QR_TOKEN_SECRET não configurado.' });
    }

    const { codigo } = req.body ?? {};
    if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
      log.warn('request.validation_failed', { user_id: user.id, motivo: 'formato_codigo' });
      return res.status(400).json({ error: 'Código deve ter 6 dígitos.' });
    }

    // verifyCodigo procura o checkpoint que casa (current + previous window).
    const checkpoint = verifyCodigo(codigo, qrSecret);
    if (!checkpoint) {
      log.warn('codigo.invalido_ou_expirado', { user_id: user.id });
      return res.status(400).json({ error: 'Código inválido ou expirado. Aguarde o próximo.' });
    }

    // Duplo registro no mesmo checkpoint hoje (dia do Acre).
    const now = new Date();
    const { inicio, fim } = acreDayBoundsIso(now);
    const { data: existing } = await admin
      .from('ponto_qr_registros')
      .select('id')
      .eq('user_id', user.id)
      .eq('tipo', checkpoint)
      .gte('registrado_em', inicio)
      .lt('registrado_em', fim)
      .maybeSingle();

    if (existing) {
      log.info('ponto.duplicate', { user_id: user.id, checkpoint });
      return res.status(409).json({ error: `${CHECKPOINT_LABELS[checkpoint]} já registrada hoje.` });
    }

    const status = computeStatus(checkpoint, now);

    const { error: insertErr } = await admin.from('ponto_qr_registros').insert({
      user_id: user.id,
      tipo:    checkpoint,
      status,
    });

    if (insertErr) {
      log.error('ponto.insert_failed', insertErr, { user_id: user.id, checkpoint });
      return res.status(500).json({ error: 'Erro ao registrar ponto.' });
    }

    const hora = acreTimeString(now);

    log.info('ponto.registered', { user_id: user.id, checkpoint, status, hora, via: 'codigo' });

    return res.status(200).json({
      success: true,
      tipo:    checkpoint,
      label:   CHECKPOINT_LABELS[checkpoint],
      status,
      hora,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
