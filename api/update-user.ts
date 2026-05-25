import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador'];
const VALID_SETORES = ['all', 'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
// Extras não aceitam 'all' (faz parte só do escopo CEO).
const VALID_SETORES_EXTRAS = ['logistica','vendas','financeiro','rh','marketing','ti','compras','estoque'];
const VALID_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'update-user');

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

    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente')) {
      log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile?.role });
      return res.status(403).json({ error: 'Sem permissão para editar usuários.' });
    }

    const { userId, nome, email, role, setor, filial, password, setores_extras } = req.body ?? {};

    if (!userId || typeof userId !== 'string') {
      log.warn('request.validation_failed', { missing: 'userId' });
      return res.status(400).json({ error: 'userId obrigatório.' });
    }

    const { data: targetProfile } = await admin
      .from('user_profiles')
      .select('role, setor, filial')
      .eq('id', userId)
      .single();

    if (!targetProfile) {
      log.warn('user.not_found', { target_id: userId });
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Admins não podem ser editados por ninguém (defesa em profundidade).
    if (targetProfile.role === 'admin' && caller.id !== userId) {
      log.warn('user.permission_denied', { caller_id: caller.id, target_id: userId, reason: 'admin_protected' });
      return res.status(403).json({ error: 'Administradores não podem ser editados.' });
    }

    // CEO só pode ser editado por admin ou pelo próprio CEO.
    if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin' && caller.id !== userId) {
      log.warn('user.permission_denied', { caller_id: caller.id, target_id: userId, target_role: 'ceo', caller_role: callerProfile.role });
      return res.status(403).json({ error: 'Apenas administradores podem editar CEO.' });
    }

    // Gerente: só edita colaboradores do seu próprio setor.
    if (callerProfile.role === 'gerente') {
      if (targetProfile.role !== 'colaborador') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_role: targetProfile.role, reason: 'gerente_role_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem editar colaboradores.' });
      }
      if (targetProfile.setor !== callerProfile.setor) {
        log.warn('user.permission_denied', { caller_id: caller.id, caller_setor: callerProfile.setor, target_setor: targetProfile.setor, reason: 'gerente_setor_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem editar usuários do seu setor.' });
      }
    }

    const updates: Record<string, any> = {};

    if (typeof nome === 'string' && nome.trim()) updates.nome = nome.trim();

    if (typeof email === 'string' && email.trim()) updates.email = email.trim();

    // Apenas admin/CEO podem alterar role/setor/filial-Matriz.
    const isGlobalCaller = callerProfile.role === 'admin' || callerProfile.role === 'ceo';

    if (role !== undefined) {
      if (!isGlobalCaller) {
        log.warn('user.permission_denied', { caller_id: caller.id, reason: 'gerente_role_change' });
        return res.status(403).json({ error: 'Gerentes não podem alterar cargo.' });
      }
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Cargo inválido.' });
      }
      // Apenas admin pode promover/manter admin.
      if (role === 'admin' && callerProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de administrador.' });
      }
      // Apenas admin pode atribuir CEO.
      if (role === 'ceo' && callerProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de CEO.' });
      }
      updates.role = role;
    }

    if (setor !== undefined) {
      if (!isGlobalCaller) {
        log.warn('user.permission_denied', { caller_id: caller.id, reason: 'gerente_setor_change' });
        return res.status(403).json({ error: 'Gerentes não podem alterar setor.' });
      }
      if (!VALID_SETORES.includes(setor)) {
        return res.status(400).json({ error: 'Setor inválido.' });
      }
      updates.setor = setor;
    }

    // CEO é sempre global ('all') — independente do que vier no payload.
    if (updates.role === 'ceo') {
      updates.setor = 'all';
      updates.setores_extras = []; // CEO já é global; zera extras.
    }

    // Setores extras: só admin/CEO podem alterar; CEO ignora (já é global).
    if (setores_extras !== undefined && updates.role !== 'ceo') {
      if (!isGlobalCaller) {
        log.warn('user.permission_denied', { caller_id: caller.id, reason: 'gerente_setores_extras' });
        return res.status(403).json({ error: 'Gerentes não podem alterar setores extras.' });
      }
      if (!Array.isArray(setores_extras)) {
        return res.status(400).json({ error: 'setores_extras deve ser um array.' });
      }
      const extras = [...new Set(setores_extras as unknown[])]
        .filter((s): s is string => typeof s === 'string' && VALID_SETORES_EXTRAS.includes(s));
      // Remove o setor primário (efetivo após este update) da lista.
      const primaryAfter = updates.setor ?? targetProfile.setor;
      updates.setores_extras = extras.filter(s => s !== primaryAfter);
    }

    if (filial !== undefined) {
      if (typeof filial !== 'string' || !VALID_FILIAIS.includes(filial)) {
        return res.status(400).json({ error: 'Filial inválida.' });
      }
      if (!isGlobalCaller && filial === 'Matriz') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_filial: filial, reason: 'gerente_matriz_forbidden' });
        return res.status(403).json({ error: 'Gerentes não podem atribuir a filial Matriz.' });
      }
      updates.filial = filial;
    }

    // Atualizar Auth (email/password) se necessário — admin SDK.
    const authUpdates: { email?: string; password?: string } = {};
    if (updates.email) authUpdates.email = updates.email;
    if (typeof password === 'string' && password.length >= 6) authUpdates.password = password;

    if (Object.keys(authUpdates).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(userId, authUpdates);
      if (authErr) {
        const msg = authErr.message ?? 'Erro ao atualizar credenciais.';
        const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
        log.warn('auth.update_failed', { error: msg, target_id: userId });
        return res.status(400).json({ error: friendly });
      }
    }

    if (Object.keys(updates).length === 0) {
      log.info('user.update.noop', { target_id: userId });
      return res.status(200).json({ success: true, noop: true });
    }

    const { error: profileErr } = await admin
      .from('user_profiles')
      .update(updates)
      .eq('id', userId);

    if (profileErr) {
      log.error('profile.update_failed', profileErr, { target_id: userId });
      return res.status(500).json({ error: 'Erro ao atualizar perfil.' });
    }

    log.info('user.updated', { target_id: userId, caller_id: caller.id, fields: Object.keys(updates) });
    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
