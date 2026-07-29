import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

// Dispatcher de tarefas agendadas — reduz nº de serverless functions
// (limite 12 no Hobby). Vercel Cron chama /api/cron?task=<nome> nos
// horários definidos em vercel.json > crons.
//
// Tasks disponíveis:
//   ?task=reverter-promocoes  → RPC reverter_promocoes_expiradas
//   ?task=expirar-competicoes → RPC expirar_competicoes
//   ?task=limpar-ip-hash      → RPC limpar_ip_hash_pedidos_online
//
// Cada task chama uma RPC idempotente que retorna nº de linhas
// afetadas.

const TASKS: Record<string, string> = {
  'reverter-promocoes':  'reverter_promocoes_expiradas',
  'expirar-competicoes': 'expirar_competicoes',
  // Retenção: o hash de origem do pedido serve para contar pedidos numa janela
  // de uma hora. Depois de 30 dias não responde mais pergunta nenhuma, e dado
  // guardado sem finalidade é o oposto do que a LGPD pede (arts. 15 e 16).
  'limpar-ip-hash':      'limpar_ip_hash_pedidos_online',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const taskParam = String(req.query.task ?? '');
  const log = createLogger(req, `cron:${taskParam || 'unknown'}`);

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

    const rpc = TASKS[taskParam];
    if (!rpc) {
      log.warn('task.unknown', { task: taskParam });
      return res.status(400).json({ error: `Task desconhecida: ${taskParam}` });
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

    const { data, error } = await admin.rpc(rpc);
    if (error) {
      log.error('rpc.failed', error);
      return res.status(500).json({ error: error.message });
    }

    const total = typeof data === 'number' ? data : 0;
    log.info('cron.ok', { task: taskParam, total });
    return res.status(200).json({ success: true, task: taskParam, total });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
