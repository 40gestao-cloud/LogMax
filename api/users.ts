import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

// Endpoint unificado de gestão de usuários (Auth + user_profiles).
// Roteia por body.action ∈ 'create' | 'update' | 'delete'. Substitui os 3
// endpoints separados (fusão pra caber no limite 12 functions do Vercel Hobby).
// Toda a lógica RBAC/validação idêntica à das versões antigas.

const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador', 'conselheiro'];
const VALID_SETORES = ['all', 'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia'];
const VALID_SETORES_EXTRAS = ['logistica','vendas','financeiro','rh','marketing','ti','compras','estoque','gerencia'];
const VALID_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'];

type Log = ReturnType<typeof createLogger>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.body?.action ?? req.query?.action) as string | undefined;
  const log = createLogger(req, `users:${action ?? '?'}`);

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const admin = getAdminClient(res);
    if (!admin) return;

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
      .select('role, setor, filial, pode_acessar_usuarios, is_conselheiro')
      .eq('id', caller.id)
      .single();

    if (!callerProfile) {
      log.warn('caller.profile_missing', { caller_id: caller.id });
      return res.status(403).json({ error: 'Perfil não encontrado.' });
    }

    if (action === 'create') return await handleCreate(req, res, admin, caller.id, callerProfile, log);
    if (action === 'update') return await handleUpdate(req, res, admin, caller.id, callerProfile, log);
    if (action === 'delete') return await handleDelete(req, res, admin, caller.id, callerProfile, log);
    return res.status(400).json({ error: 'action deve ser "create", "update" ou "delete".' });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

// ── CREATE ──────────────────────────────────────────────────────────────
async function handleCreate(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente') {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Sem permissão para criar usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_access_revoked' });
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { email, password, nome, role, filial, setores_extras } = req.body ?? {};
  let { setor } = req.body ?? {};

  let extras: string[] = [];
  if (Array.isArray(setores_extras)) {
    extras = [...new Set(setores_extras as unknown[])]
      .filter((s): s is string => typeof s === 'string' && VALID_SETORES_EXTRAS.includes(s));
  }

  if (!email || !password || !nome || !role || !setor) {
    log.warn('request.validation_failed', { missing: { email: !email, password: !password, nome: !nome, role: !role, setor: !setor } });
    return res.status(400).json({ error: 'Campos obrigatórios: email, password, nome, role, setor.' });
  }
  if (!VALID_ROLES.includes(role))    return res.status(400).json({ error: 'Cargo inválido.' });
  if (!VALID_SETORES.includes(setor)) return res.status(400).json({ error: 'Setor inválido.' });

  if (role === 'ceo' || role === 'conselheiro') {
    if (callerProfile.role !== 'admin') {
      log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_global' });
      return res.status(403).json({ error: 'Apenas administradores podem criar CEO ou Conselheiro.' });
    }
    setor = 'all'; extras = [];
  }

  if (extras.length > 0 && callerProfile.role !== 'admin' && callerProfile.role !== 'ceo') {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_setores_extras' });
    return res.status(403).json({ error: 'Apenas admin/CEO podem atribuir setores extras.' });
  }
  extras = extras.filter(s => s !== setor);

  if (setor === 'gerencia') {
    extras = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
  }

  if (role === 'admin' && callerProfile.role !== 'admin') {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_admin' });
    return res.status(403).json({ error: 'Apenas administradores podem criar administradores.' });
  }

  if (callerProfile.role === 'gerente') {
    if (role !== 'colaborador') {
      log.warn('user.permission_denied', { caller_id: callerId, target_role: role, reason: 'gerente_role_mismatch' });
      return res.status(403).json({ error: 'Gerentes só podem criar colaboradores.' });
    }
    const targetFilial = (typeof filial === 'string' ? filial.trim() : '') || 'Matriz';
    if (targetFilial !== callerProfile.filial) {
      log.warn('user.permission_denied', { caller_id: callerId, target_filial: targetFilial, caller_filial: callerProfile.filial, reason: 'gerente_outra_filial' });
      return res.status(403).json({ error: 'Gerentes só podem criar colaboradores da própria filial.' });
    }
  }

  if (role === 'colaborador' || role === 'gerente') {
    const targetFilial = (typeof filial === 'string' ? filial.trim() : '') || 'Matriz';
    if (targetFilial === 'Matriz') {
      log.warn('user.validation_failed', { caller_id: callerId, target_role: role, target_filial: targetFilial, reason: 'operational_role_needs_unit' });
      return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional (SuperMax, MaxLook ou TechMax).' });
    }
  }

  const { data: { user: newUser }, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !newUser) {
    const msg = createErr?.message ?? 'Erro ao criar usuário.';
    const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
    log.warn('auth.create_failed', { error: msg, friendly });
    return res.status(400).json({ error: friendly });
  }

  const profilePayload: any = {
    id: newUser.id, nome, email, role, setor,
    setores_extras: extras,
    criado_por: callerId,
  };
  if (typeof filial === 'string' && filial.trim()) {
    profilePayload.filial = filial.trim();
  }
  const { error: profileErr } = await admin.from('user_profiles').insert(profilePayload);
  if (profileErr) {
    log.error('profile.insert_failed', profileErr, { new_user_id: newUser.id, rollback: 'deleting_auth_user' });
    await admin.auth.admin.deleteUser(newUser.id);
    return res.status(500).json({ error: 'Erro ao criar perfil. Usuário removido.' });
  }

  log.info('user.created', { user_id: newUser.id, role, setor, caller_id: callerId });
  return res.status(200).json({ success: true, userId: newUser.id });
}

// ── UPDATE ──────────────────────────────────────────────────────────────
async function handleUpdate(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  const isConselheiroCaller = callerProfile?.role === 'conselheiro'
    || (callerProfile?.role === 'gerente' && callerProfile?.is_conselheiro === true);
  if (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente' && !isConselheiroCaller) {
    log.warn('user.permission_denied', { caller_id: callerId, caller_role: callerProfile.role });
    return res.status(403).json({ error: 'Sem permissão para editar usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    log.warn('user.permission_denied', { caller_id: callerId, reason: 'gerente_access_revoked' });
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { userId, nome, email, role, setor, filial, password, setores_extras, pode_acessar_usuarios, is_conselheiro } = req.body ?? {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId obrigatório.' });
  }

  const { data: targetProfile } = await admin
    .from('user_profiles').select('role, setor, filial').eq('id', userId).single();
  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (targetProfile.role === 'admin' && callerId !== userId) {
    return res.status(403).json({ error: 'Administradores não podem ser editados.' });
  }
  if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin' && callerId !== userId) {
    return res.status(403).json({ error: 'Apenas administradores podem editar CEO.' });
  }
  if (callerProfile.role === 'gerente') {
    if (targetProfile.role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes só podem editar colaboradores.' });
    }
    if (targetProfile.filial !== callerProfile.filial) {
      return res.status(403).json({ error: 'Gerentes só podem editar colaboradores da própria filial.' });
    }
  }

  const updates: Record<string, any> = {};
  if (typeof nome === 'string' && nome.trim()) updates.nome = nome.trim();
  if (typeof email === 'string' && email.trim()) updates.email = email.trim();

  const isGlobalCaller = callerProfile.role === 'admin' || callerProfile.role === 'ceo' || isConselheiroCaller;

  if (role !== undefined) {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Gerentes não podem alterar cargo.' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Cargo inválido.' });
    if (role === 'admin' && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de administrador.' });
    }
    if ((role === 'ceo' || role === 'conselheiro') && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de CEO ou Conselheiro.' });
    }
    updates.role = role;
  }
  if (setor !== undefined) {
    if (!VALID_SETORES.includes(setor)) return res.status(400).json({ error: 'Setor inválido.' });
    if (!isGlobalCaller && setor === 'all') {
      return res.status(403).json({ error: 'Gerentes não podem atribuir o escopo global.' });
    }
    updates.setor = setor;
  }
  if (updates.role === 'ceo' || updates.role === 'conselheiro') {
    updates.setor = 'all';
    updates.setores_extras = [];
  }
  if (updates.setor === 'gerencia') {
    updates.setores_extras = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
  }
  if (setores_extras !== undefined && updates.role !== 'ceo' && updates.role !== 'conselheiro') {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Gerentes não podem alterar setores extras.' });
    if (!Array.isArray(setores_extras)) return res.status(400).json({ error: 'setores_extras deve ser um array.' });
    const extras = [...new Set(setores_extras as unknown[])]
      .filter((s): s is string => typeof s === 'string' && VALID_SETORES_EXTRAS.includes(s));
    const primaryAfter = updates.setor ?? targetProfile.setor;
    updates.setores_extras = extras.filter(s => s !== primaryAfter);
  }
  if (filial !== undefined) {
    if (typeof filial !== 'string' || !VALID_FILIAIS.includes(filial)) {
      return res.status(400).json({ error: 'Filial inválida.' });
    }
    if (!isGlobalCaller && filial === 'Matriz') {
      return res.status(403).json({ error: 'Gerentes não podem atribuir a filial Matriz.' });
    }
    if (callerProfile.role === 'gerente' && filial !== callerProfile.filial) {
      return res.status(403).json({ error: 'Gerentes só podem atribuir a própria filial.' });
    }
    const targetRoleAfter = updates.role ?? targetProfile.role;
    if ((targetRoleAfter === 'colaborador' || targetRoleAfter === 'gerente') && filial === 'Matriz') {
      return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional (SuperMax, MaxLook ou TechMax).' });
    }
    updates.filial = filial;
  }
  if (is_conselheiro !== undefined) {
    if (callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem ativar o modo Conselheiro.' });
    }
    const targetRoleAfter = updates.role ?? targetProfile.role;
    if (targetRoleAfter !== 'gerente') {
      return res.status(400).json({ error: 'O modo Conselheiro só se aplica a gerentes.' });
    }
    if (typeof is_conselheiro !== 'boolean') {
      return res.status(400).json({ error: 'is_conselheiro deve ser booleano.' });
    }
    updates.is_conselheiro = is_conselheiro;
  }
  if (pode_acessar_usuarios !== undefined) {
    if (!isGlobalCaller) return res.status(403).json({ error: 'Apenas admin/CEO podem alterar o acesso ao módulo Usuários.' });
    const targetRoleAfter = updates.role ?? targetProfile.role;
    if (targetRoleAfter !== 'gerente') {
      return res.status(400).json({ error: 'O toggle só se aplica a gerentes.' });
    }
    if (typeof pode_acessar_usuarios !== 'boolean') {
      return res.status(400).json({ error: 'pode_acessar_usuarios deve ser booleano.' });
    }
    updates.pode_acessar_usuarios = pode_acessar_usuarios;
  }

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
    return res.status(200).json({ success: true, noop: true });
  }

  const { error: profileErr } = await admin.from('user_profiles').update(updates).eq('id', userId);
  if (profileErr) {
    log.error('profile.update_failed', profileErr, { target_id: userId });
    return res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }

  log.info('user.updated', { target_id: userId, caller_id: callerId, fields: Object.keys(updates) });
  return res.status(200).json({ success: true });
}

// ── DELETE ──────────────────────────────────────────────────────────────
async function handleDelete(
  req: VercelRequest, res: VercelResponse, admin: SupabaseClient,
  callerId: string, callerProfile: any, log: Log,
) {
  const isConselheiroCaller = callerProfile?.role === 'conselheiro'
    || (callerProfile?.role === 'gerente' && callerProfile?.is_conselheiro === true);
  const AUTHORIZED_ROLES = ['admin', 'ceo', 'gerente'];
  if (!AUTHORIZED_ROLES.includes(callerProfile.role) && !isConselheiroCaller) {
    return res.status(403).json({ error: 'Sem permissão para excluir usuários.' });
  }
  if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
    return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
  }

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' });
  if (userId === callerId) return res.status(400).json({ error: 'Não é possível excluir sua própria conta.' });

  const { data: targetProfile } = await admin
    .from('user_profiles').select('role, setor').eq('id', userId).single();
  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (targetProfile.role === 'admin') {
    return res.status(403).json({ error: 'Administradores não podem ser excluídos.' });
  }
  if (targetProfile.role === 'ceo' && callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem excluir CEO.' });
  }
  if (callerProfile.role === 'gerente' || isConselheiroCaller) {
    if (targetProfile.role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes e conselheiros só podem excluir colaboradores.' });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    log.error('auth.delete_failed', error, { target_id: userId });
    return res.status(500).json({ error: error.message });
  }

  log.info('user.deleted', { target_id: userId, target_role: targetProfile.role, caller_id: callerId });
  return res.status(200).json({ success: true });
}
