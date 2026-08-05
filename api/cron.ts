import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

// Dispatcher de tarefas agendadas — reduz nº de serverless functions
// (limite 12 no Hobby). Vercel Cron chama /api/cron?task=<nome> nos
// horários definidos em vercel.json > crons.
//
// `task` aceita LISTA separada por vírgula, e isso não é conveniência: o plano
// Hobby permite no máximo 2 cron jobs. Um terceiro item em vercel.json > crons
// faz a Vercel RECUSAR o deploy inteiro — e o efeito é traiçoeiro, porque o
// deploy anterior continua servindo e tudo parece no ar, só congelado numa
// versão velha. Tarefa nova entra numa entrada existente, não numa nova.
//
// Tasks disponíveis:
//   ?task=reverter-promocoes  → RPC reverter_promocoes_expiradas
//   ?task=expirar-competicoes → RPC expirar_competicoes
//   ?task=limpar-ip-hash      → RPC limpar_ip_hash_pedidos_online
//   ?task=lembrar-avaliacoes  → RPC lembrar_avaliacoes_pendentes
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
  // Lembra o conselho quando a competição está a ≤3 dias do fim e ainda
  // há participante sem nota. 1 aviso por competição por dia.
  'lembrar-avaliacoes':  'lembrar_avaliacoes_pendentes',
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

    const nomes = taskParam.split(',').map(s => s.trim()).filter(Boolean);
    const desconhecida = nomes.find(n => !TASKS[n]);
    if (nomes.length === 0 || desconhecida) {
      log.warn('task.unknown', { task: taskParam });
      return res.status(400).json({ error: `Task desconhecida: ${desconhecida ?? taskParam}` });
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

    // Uma task que falha não cancela as outras: são independentes, e perder a
    // limpeza de retenção porque a reversão de promoção quebrou seria juntar
    // dois problemas num só.
    const resultados: Record<string, number> = {};
    const falhas: Record<string, string> = {};

    for (const nome of nomes) {
      const { data, error } = await admin.rpc(TASKS[nome]);
      if (error) {
        log.error('rpc.failed', error, { task: nome });
        falhas[nome] = error.message;
        continue;
      }
      resultados[nome] = typeof data === 'number' ? data : 0;
    }

    if (Object.keys(falhas).length > 0) {
      return res.status(500).json({ success: false, resultados, falhas });
    }

    log.info('cron.ok', { task: taskParam, resultados });
    return res.status(200).json({ success: true, resultados });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
