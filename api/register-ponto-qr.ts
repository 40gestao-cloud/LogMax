import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';
import { authenticate, getAdminClient, applyCors } from './_lib/auth';

const CHECKPOINT_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  retorno: 'Retorno do Intervalo',
  saida:   'Saída',
};

// Horários-alvo em minutos desde meia-noite (hora de Brasília = UTC-3)
const CHECKPOINT_TARGET_MINUTES: Record<string, number> = {
  entrada: 7 * 60 + 40,  // 07:40
  retorno: 9 * 60 + 20,  // 09:20
  saida:   11 * 60 + 20, // 11:20
};

const TOLERANCE_MINUTES = 1;

function computeStatus(checkpoint: string, now: Date): 'No Horário' | 'Atrasado' {
  // Ajustar para horário de Brasília (UTC-3)
  const brtOffset = -3 * 60;
  const localMinutes =
    ((now.getUTCHours() * 60 + now.getUTCMinutes()) + brtOffset + 1440) % 1440;

  const target = CHECKPOINT_TARGET_MINUTES[checkpoint];
  if (target === undefined) return 'No Horário';

  return localMinutes <= target + TOLERANCE_MINUTES ? 'No Horário' : 'Atrasado';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = getAdminClient(res);
  if (!admin) return;

  const user = await authenticate(req, res, admin);
  if (!user) return;

  // Secret dedicado para o HMAC do QR — mesmo usado em qr-token.ts
  const qrSecret = process.env.QR_TOKEN_SECRET;
  if (!qrSecret) return res.status(500).json({ error: 'QR_TOKEN_SECRET não configurado.' });

  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ error: 'Token QR obrigatório.' });

  // Validar token QR
  const parts = (token as string).split('.');
  if (parts.length !== 2) return res.status(400).json({ error: 'Token inválido.' });

  let payload: string;
  try {
    payload = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return res.status(400).json({ error: 'Token corrompido.' });
  }

  const expectedHmac = createHmac('sha256', qrSecret).update(payload).digest('hex');
  if (parts[1] !== expectedHmac) {
    return res.status(400).json({ error: 'Assinatura inválida.' });
  }

  const [windowIdStr, checkpoint] = payload.split('|');
  const windowId = parseInt(windowIdStr, 10);
  if (isNaN(windowId) || !CHECKPOINT_LABELS[checkpoint]) {
    return res.status(400).json({ error: 'Token malformado.' });
  }

  // Verificar janela de tempo (aceita janela atual e anterior = até ~4 minutos)
  const currentWindow = Math.floor(Date.now() / 120000);
  if (windowId !== currentWindow && windowId !== currentWindow - 1) {
    return res.status(400).json({ error: 'QR Code expirado. Aguarde o próximo.' });
  }

  // Verificar duplo registro no mesmo checkpoint hoje
  const now = new Date();
  const hoje = now.toISOString().slice(0, 10);
  const { data: existing } = await admin
    .from('ponto_qr_registros')
    .select('id')
    .eq('user_id', user.id)
    .eq('tipo', checkpoint)
    .gte('registrado_em', `${hoje}T00:00:00Z`)
    .lte('registrado_em', `${hoje}T23:59:59Z`)
    .maybeSingle();

  if (existing) {
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

  if (insertErr) return res.status(500).json({ error: 'Erro ao registrar ponto.' });

  const hora = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  return res.status(200).json({
    success: true,
    tipo:    checkpoint,
    label:   CHECKPOINT_LABELS[checkpoint],
    status,
    hora,
  });
}
