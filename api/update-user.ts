import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador', 'conselheiro'];
const VALID_SETORES = ['all', 'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia'];
// Extras não aceitam 'all' (faz parte só do escopo CEO).
const VALID_SETORES_EXTRAS = ['logistica','vendas','financeiro','rh','marketing','ti','compras','estoque','gerencia'];
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
      .select('role, setor, filial, pode_acessar_usuarios, is_conselheiro')
      .eq('id', caller.id)
      .single();

    const isConselheiroCaller = callerProfile?.role === 'conselheiro' || (callerProfile?.role === 'gerente' && callerProfile?.is_conselheiro === true);
    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente' && !isConselheiroCaller)) {
      log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile?.role });
      return res.status(403).json({ error: 'Sem permissão para editar usuários.' });
    }

    // Gerente com acesso revogado pelo admin/CEO: barrar antes de qualquer mutação.
    if (callerProfile.role === 'gerente' && callerProfile.pode_acessar_usuarios === false) {
      log.warn('user.permission_denied', { caller_id: caller.id, reason: 'gerente_access_revoked' });
      return res.status(403).json({ error: 'Acesso ao módulo Usuários foi desabilitado pelo administrador.' });
    }

    const { userId, nome, email, role, setor, filial, password, setores_extras, pode_acessar_usuarios, is_conselheiro } = req.body ?? {};

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

    // Gerente: só edita colaboradores (independente de setor) da própria
    // filial — gerente não cobre outras unidades.
    if (callerProfile.role === 'gerente') {
      if (targetProfile.role !== 'colaborador') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_role: targetProfile.role, reason: 'gerente_role_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem editar colaboradores.' });
      }
      if (targetProfile.filial !== callerProfile.filial) {
        log.warn('user.permission_denied', { caller_id: caller.id, target_filial: targetProfile.filial, caller_filial: callerProfile.filial, reason: 'gerente_outra_filial' });
        return res.status(403).json({ error: 'Gerentes só podem editar colaboradores da própria filial.' });
      }
    }

    const updates: Record<string, any> = {};

    if (typeof nome === 'string' && nome.trim()) updates.nome = nome.trim();

    if (typeof email === 'string' && email.trim()) updates.email = email.trim();

    // Apenas admin/CEO/Conselheiro podem alterar role/setor/filial-Matriz.
    const isGlobalCaller = callerProfile.role === 'admin' || callerProfile.role === 'ceo' || isConselheiroCaller;

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
      // Apenas admin pode atribuir CEO ou Conselheiro.
      if ((role === 'ceo' || role === 'conselheiro') && callerProfile.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores podem atribuir cargo de CEO ou Conselheiro.' });
      }
      updates.role = role;
    }

    if (setor !== undefined) {
      if (!VALID_SETORES.includes(setor)) {
        return res.status(400).json({ error: 'Setor inválido.' });
      }
      // Gerente não pode atribuir 'all' (escopo CEO).
      if (!isGlobalCaller && setor === 'all') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_setor: setor, reason: 'gerente_setor_all_forbidden' });
        return res.status(403).json({ error: 'Gerentes não podem atribuir o escopo global.' });
      }
      updates.setor = setor;
    }

    // CEO e Conselheiro são sempre globais ('all').
    if (updates.role === 'ceo' || updates.role === 'conselheiro') {
      updates.setor = 'all';
      updates.setores_extras = [];
    }

    // Setor 'gerencia' não existe nas tabelas de dados (RLS não conhece esse
    // valor) — é só o rótulo do cargo gerente, que antes não tinha setor
    // próprio. O acesso real "vê tudo da filial" vem de setores_extras com
    // os 6 setores operacionais, preenchido aqui automaticamente sempre que
    // o setor primário passa a ser 'gerencia' (independe do que veio em
    // setores_extras no corpo da requisição).
    if (updates.setor === 'gerencia') {
      updates.setores_extras = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];
    }

    // Setores extras: só admin/CEO podem alterar; CEO/Conselheiro ignoram (já são globais).
    if (setores_extras !== undefined && updates.role !== 'ceo' && updates.role !== 'conselheiro') {
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
      if (callerProfile.role === 'gerente' && filial !== callerProfile.filial) {
        log.warn('user.permission_denied', { caller_id: caller.id, target_filial: filial, caller_filial: callerProfile.filial, reason: 'gerente_reatribuir_outra_filial' });
        return res.status(403).json({ error: 'Gerentes só podem atribuir a própria filial.' });
      }
      // Colaborador/gerente com Matriz travam no FilialContext (só aceita
      // SuperMax/MaxLook/TechMax). Barrar mesmo com admin/CEO chamando.
      const targetRoleAfter = updates.role ?? targetProfile.role;
      if ((targetRoleAfter === 'colaborador' || targetRoleAfter === 'gerente') && filial === 'Matriz') {
        log.warn('user.validation_failed', { caller_id: caller.id, target_role: targetRoleAfter, target_filial: filial, reason: 'operational_role_needs_unit' });
        return res.status(400).json({ error: 'Colaboradores e gerentes precisam de uma unidade operacional (SuperMax, MaxLook ou TechMax).' });
      }
      updates.filial = filial;
    }

    // Toggle Conselheiro: só admin pode ativar; só faz sentido em gerentes.
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

    // Toggle de acesso ao módulo Usuários: só admin/CEO podem alterar e só faz sentido em gerentes.
    if (pode_acessar_usuarios !== undefined) {
      if (!isGlobalCaller) {
        log.warn('user.permission_denied', { caller_id: caller.id, reason: 'gerente_toggle_acesso_usuarios' });
        return res.status(403).json({ error: 'Apenas admin/CEO podem alterar o acesso ao módulo Usuários.' });
      }
      const targetRoleAfter = updates.role ?? targetProfile.role;
      if (targetRoleAfter !== 'gerente') {
        log.warn('user.invalid_field', { target_id: userId, target_role: targetRoleAfter, reason: 'pode_acessar_usuarios_non_gerente' });
        return res.status(400).json({ error: 'O toggle só se aplica a gerentes.' });
      }
      if (typeof pode_acessar_usuarios !== 'boolean') {
        return res.status(400).json({ error: 'pode_acessar_usuarios deve ser booleano.' });
      }
      updates.pode_acessar_usuarios = pode_acessar_usuarios;
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
