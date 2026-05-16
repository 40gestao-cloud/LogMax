import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'delete-user');

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      log.error('config.missing', new Error('VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausente'));
      return res.status(500).json({ error: 'Servidor não configurado.' });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!token) {
      log.warn('auth.missing_token');
      return res.status(401).json({ error: 'Token obrigatório.' });
    }

    const { data: { user: caller }, error: tokenErr } = await admin.auth.getUser(token);
    if (tokenErr || !caller) {
      log.warn('auth.invalid_token', { error: tokenErr?.message });
      return res.status(401).json({ error: 'Token inválido.' });
    }

    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('role, setor')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || callerProfile.role === 'colaborador') {
      log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile?.role });
      return res.status(403).json({ error: 'Sem permissão para excluir usuários.' });
    }

    const { userId } = req.body ?? {};
    if (!userId) {
      log.warn('request.validation_failed', { missing: 'userId' });
      return res.status(400).json({ error: 'userId obrigatório.' });
    }
    if (userId === caller.id) {
      log.warn('user.self_delete_attempt', { caller_id: caller.id });
      return res.status(400).json({ error: 'Não é possível excluir sua própria conta.' });
    }

    const { data: targetProfile } = await admin
      .from('user_profiles')
      .select('role, setor')
      .eq('id', userId)
      .single();

    if (!targetProfile) {
      log.warn('user.not_found', { target_id: userId });
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (targetProfile.role === 'admin') {
      log.warn('user.permission_denied', { caller_id: caller.id, target_id: userId, target_role: 'admin', reason: 'admin_protected' });
      return res.status(403).json({ error: 'Administradores não podem ser excluídos.' });
    }

    // CEO só pode ser excluído por admin.
    if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin') {
      log.warn('user.permission_denied', { caller_id: caller.id, target_id: userId, target_role: 'ceo', caller_role: callerProfile.role, reason: 'non_admin_deleting_ceo' });
      return res.status(403).json({ error: 'Apenas administradores podem excluir CEO.' });
    }

    if (callerProfile.role === 'gerente') {
      if (targetProfile.role !== 'colaborador') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_role: targetProfile.role, reason: 'gerente_role_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem excluir colaboradores.' });
      }
      if (targetProfile.setor !== callerProfile.setor) {
        log.warn('user.permission_denied', { caller_id: caller.id, caller_setor: callerProfile.setor, target_setor: targetProfile.setor, reason: 'gerente_setor_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem excluir usuários do seu setor.' });
      }
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      log.error('auth.delete_failed', error, { target_id: userId });
      return res.status(500).json({ error: error.message });
    }

    log.info('user.deleted', { target_id: userId, target_role: targetProfile.role, caller_id: caller.id });
    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
