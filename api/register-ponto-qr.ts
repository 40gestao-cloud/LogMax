import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { authenticate, getAdminClient, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

const CHECKPOINT_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  retorno: 'Retorno do Intervalo',
  saida:   'Saída',
};

// Horários-alvo em minutos desde meia-noite (hora do Acre = UTC-5)
const CHECKPOINT_TARGET_MINUTES: Record<string, number> = {
  entrada: 7 * 60 + 40,  // 07:40
  retorno: 9 * 60 + 20,  // 09:20
  saida:   11 * 60 + 20, // 11:20
};

const TOLERANCE_MINUTES = 1;

// Acre não observa horário de verão; offset fixo de -5h é seguro.
const ACRE_OFFSET_MIN = -5 * 60;

function computeStatus(checkpoint: string, now: Date): 'No Horário' | 'Atrasado' {
  const localMinutes =
    ((now.getUTCHours() * 60 + now.getUTCMinutes()) + ACRE_OFFSET_MIN + 1440) % 1440;

  const target = CHECKPOINT_TARGET_MINUTES[checkpoint];
  if (target === undefined) return 'No Horário';

  return localMinutes <= target + TOLERANCE_MINUTES ? 'No Horário' : 'Atrasado';
}

function acreDateString(now: Date): string {
  // YYYY-MM-DD na perspectiva de Rio Branco; necessário para detecção
  // de duplicidade não vazar entre dias quando o relógio UTC já virou.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Rio_Branco',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(now);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'register-ponto-qr');

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

    // Secret dedicado para o HMAC do QR — mesmo usado em qr-token.ts
    const qrSecret = process.env.QR_TOKEN_SECRET;
    if (!qrSecret) {
      log.error('config.missing', new Error('QR_TOKEN_SECRET ausente'));
      return res.status(500).json({ error: 'QR_TOKEN_SECRET não configurado.' });
    }

    const { token } = req.body ?? {};
    if (!token) {
      log.warn('request.validation_failed', { user_id: user.id, missing: 'token' });
      return res.status(400).json({ error: 'Token QR obrigatório.' });
    }

    // Validar token QR
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

    const [windowIdStr, checkpoint] = payload.split('|');
    const windowId = parseInt(windowIdStr, 10);
    if (Number.isNaN(windowId) || !CHECKPOINT_LABELS[checkpoint]) {
      log.warn('qr.token_malformed', { user_id: user.id, reason: 'payload_shape', payload });
      return res.status(400).json({ error: 'Token malformado.' });
    }

    // Verificar janela de tempo (aceita janela atual e anterior = até ~4 minutos)
    const currentWindow = Math.floor(Date.now() / 120000);
    if (windowId !== currentWindow && windowId !== currentWindow - 1) {
      log.warn('qr.token_expired', { user_id: user.id, windowId, currentWindow });
      return res.status(400).json({ error: 'QR Code expirado. Aguarde o próximo.' });
    }

    // Verificar duplo registro no mesmo checkpoint hoje (dia do Acre)
    const now = new Date();
    const hoje = acreDateString(now);
    // Acre = UTC-5, então o dia local começa às 05:00Z e termina às 04:59:59Z do dia seguinte.
    const inicio = `${hoje}T05:00:00Z`;
    const fimDate = new Date(`${hoje}T05:00:00Z`);
    fimDate.setUTCHours(fimDate.getUTCHours() + 24);
    const fim = fimDate.toISOString();
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

    // Calcular status com base na tolerância
    const status = computeStatus(checkpoint, now);

    // Inserir registro
    const { error: insertErr } = await admin.from('ponto_qr_registros').insert({
      user_id: user.id,
      tipo:    checkpoint,
      status,
    });

    if (insertErr) {
      log.error('ponto.insert_failed', insertErr, { user_id: user.id, checkpoint });
      return res.status(500).json({ error: 'Erro ao registrar ponto.' });
    }

    const hora = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco',
    });

    log.info('ponto.registered', { user_id: user.id, checkpoint, status, hora });

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
