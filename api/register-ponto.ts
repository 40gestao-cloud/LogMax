import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import {
  authenticate, getAdminClient, applyCors,
  MSG_CONEXAO, ehFalhaDeConexao, descreverErro,
} from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import {
  CHECKPOINT_LABELS,
  acreDayBoundsIso,
  acreTimeString,
  computeStatus,
  verifyCodigo,
  windowIsValid,
} from '../lib/ponto.js';

// Endpoint unificado de registro de ponto. Roteia por body.method ('codigo'|'qr').
// Substitui /api/register-ponto-codigo e /api/register-ponto-qr (fusão pra caber
// no limite 12 functions do Vercel Hobby).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = (req.body?.method ?? req.query?.method) as string | undefined;
  const log = createLogger(req, `register-ponto:${method ?? '?'}`);

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (method !== 'codigo' && method !== 'qr') {
      return res.status(400).json({ error: 'method deve ser "codigo" ou "qr".' });
    }

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

    let checkpoint: string | null = null;

    if (method === 'codigo') {
      const { codigo } = req.body ?? {};
      if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
        log.warn('request.validation_failed', { user_id: user.id, motivo: 'formato_codigo' });
        return res.status(400).json({ error: 'Código deve ter 6 dígitos.' });
      }
      checkpoint = verifyCodigo(codigo, qrSecret);
      if (!checkpoint) {
        log.warn('codigo.invalido_ou_expirado', { user_id: user.id });
        return res.status(400).json({ error: 'Código inválido ou expirado. Aguarde o próximo.' });
      }
    } else {
      const { token } = req.body ?? {};
      if (!token) {
        log.warn('request.validation_failed', { user_id: user.id, missing: 'token' });
        return res.status(400).json({ error: 'Token QR obrigatório.' });
      }
      const parts = (token as string).split('.');
      if (parts.length !== 2) {
        log.warn('qr.token_malformed', { user_id: user.id, reason: 'parts_count' });
        return res.status(400).json({ error: 'Token inválido.' });
      }
      let payload: string;
      try {
        payload = Buffer.from(parts[0], 'base64url').toString('utf8');
      } catch {
        log.warn('qr.token_malformed', { user_id: user.id, reason: 'base64_decode' });
        return res.status(400).json({ error: 'Token corrompido.' });
      }
      const expectedHmac = createHmac('sha256', qrSecret).update(payload).digest('hex');
      if (parts[1] !== expectedHmac) {
        log.warn('qr.signature_invalid', { user_id: user.id });
        return res.status(400).json({ error: 'Assinatura inválida.' });
      }
      const [windowIdStr, cp] = payload.split('|');
      const windowId = parseInt(windowIdStr, 10);
      if (Number.isNaN(windowId) || !CHECKPOINT_LABELS[cp]) {
        log.warn('qr.token_malformed', { user_id: user.id, reason: 'payload_shape', payload });
        return res.status(400).json({ error: 'Token malformado.' });
      }
      if (!windowIsValid(windowId)) {
        log.warn('qr.token_expired', { user_id: user.id, windowId });
        return res.status(400).json({ error: 'QR Code expirado. Aguarde o próximo.' });
      }
      checkpoint = cp;
    }

    if (!checkpoint) return res.status(400).json({ error: 'Checkpoint inválido.' });

    // Dedup por checkpoint no dia (Acre) + insert.
    const now = new Date();
    const { inicio, fim } = acreDayBoundsIso(now);
    const { data: existing, error: dedupErr, status: dedupStatus } = await admin
      .from('ponto_qr_registros')
      .select('id')
      .eq('user_id', user.id)
      .eq('tipo', checkpoint)
      .gte('registrado_em', inicio)
      .lt('registrado_em', fim)
      .maybeSingle();

    // Consulta que não respondeu NÃO é "ainda não bateu ponto": seguir em
    // frente aqui grava a segunda entrada do dia e falsifica a frequência, que
    // vale 20% do placar. Sem resposta, ninguém registra — o aluno tenta de novo.
    if (ehFalhaDeConexao(dedupErr, dedupStatus)) {
      log.error('ponto.dedup_unavailable', dedupErr, { user_id: user.id, checkpoint, ...descreverErro(dedupErr, dedupStatus) });
      return res.status(503).json({ error: MSG_CONEXAO });
    }

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
    log.info('ponto.registered', { user_id: user.id, checkpoint, status, hora, via: method });
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
