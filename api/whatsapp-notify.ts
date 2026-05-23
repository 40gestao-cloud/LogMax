import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, getAdminClient } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

type WppConfig = { instance: string; token: string; phone: string };

// Carrega a config oficial do banco (RLS: chave configuracoes.whatsapp_config
// é admin/CEO-write/read). Usa service_role pra ignorar RLS no servidor —
// até colaborador conseguir disparar notificação automática (ex: ao finalizar
// venda no PDV) sem precisar ler `configuracoes` direto.
async function loadConfigFromDB(admin: ReturnType<typeof getAdminClient>): Promise<WppConfig | null> {
  if (!admin) return null;
  const { data } = await admin
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'whatsapp_config')
    .maybeSingle();
  if (!data?.valor) return null;
  try {
    const parsed = JSON.parse(data.valor) as WppConfig;
    if (parsed.instance && parsed.token && parsed.phone) return parsed;
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'whatsapp-notify');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const admin = getAdminClient(res);
    if (!admin) return;

    const user = await authenticate(req, res, admin);
    if (!user) return;

    const body = (req.body ?? {}) as Partial<WppConfig> & { message?: string };
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) {
      log.warn('request.validation_failed', { user_id: user.id, missing: 'message' });
      return res.status(400).json({ error: 'message é obrigatório' });
    }

    // Modo de teste: admin/CEO pode passar instance+token+phone diretamente
    // para validar uma config nova antes de salvar. Para qualquer outro
    // perfil (gerente/colaborador), os campos do body são ignorados.
    const isAdmin = user.role === 'admin' || user.role === 'ceo';
    let cfg: WppConfig | null = null;

    if (isAdmin && body.instance && body.token && body.phone) {
      cfg = {
        instance: String(body.instance),
        token:    String(body.token),
        phone:    String(body.phone),
      };
    } else {
      cfg = await loadConfigFromDB(admin);
    }

    if (!cfg) {
      log.info('config.absent', { user_id: user.id });
      // Não é erro 4xx: notificação WhatsApp é best-effort. PDV não falha.
      return res.status(200).json({ ok: false, reason: 'WhatsApp não configurado' });
    }

    const endpoint = `https://api.z-api.io/instances/${encodeURIComponent(cfg.instance)}/token/${encodeURIComponent(cfg.token)}/send-text`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cfg.phone, message }),
    });

    const data = await response.json() as any;

    if (!response.ok || data.error) {
      log.warn('zapi.failed', {
        user_id: user.id,
        status: response.status,
        zapi_error: data.error,
      });
      return res.status(400).json({ error: data.error ?? 'Erro na Z-API' });
    }

    log.info('zapi.sent', { user_id: user.id, phone_len: cfg.phone.length });
    return res.status(200).json({ ok: true });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
