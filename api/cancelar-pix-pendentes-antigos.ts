import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

// Vercel Cron — cancela pix_pendentes em 'aguardando' há mais de 30 min.
// Evita resíduo quando o caixa fecha a aba antes da confirmação do
// cliente. Vercel injeta Authorization: Bearer ${CRON_SECRET}.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'cancelar-pix-pendentes-antigos');

  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      log.error('config.missing', new Error('CRON_SECRET não configurado'));
      return res.status(500).json({ error: 'Servidor não configurado.' });
    }
    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
      log.warn('auth.invalid_secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      log.error('config.missing', new Error('VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausente'));
      return res.status(500).json({ error: 'Servidor não configurado.' });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.rpc('cancelar_pix_pendentes_antigos', { p_idade_min: 30 });
    if (error) {
      log.error('rpc.failed', error);
      return res.status(500).json({ error: error.message });
    }

    const total = typeof data === 'number' ? data : 0;
    log.info('pix.cancelled', { total });
    return res.status(200).json({ success: true, total });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
