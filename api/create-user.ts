import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/log.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'create-user');

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

    // Validar token do chamador
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

    // Buscar perfil do chamador
    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('role, setor')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'ceo' && callerProfile.role !== 'gerente')) {
      log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile?.role });
      return res.status(403).json({ error: 'Sem permissão para criar usuários.' });
    }

    const { email, password, nome, role, filial } = req.body ?? {};
    let { setor } = req.body ?? {};

    if (!email || !password || !nome || !role || !setor) {
      log.warn('request.validation_failed', { missing: { email: !email, password: !password, nome: !nome, role: !role, setor: !setor } });
      return res.status(400).json({ error: 'Campos obrigatórios: email, password, nome, role, setor.' });
    }

    const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador'];
    if (!VALID_ROLES.includes(role)) {
      log.warn('request.invalid_role', { role });
      return res.status(400).json({ error: 'Cargo inválido.' });
    }

    // CEO é global por definição: só admin cria CEO e setor é forçado para 'all'.
    if (role === 'ceo') {
      if (callerProfile.role !== 'admin') {
        log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_ceo' });
        return res.status(403).json({ error: 'Apenas administradores podem criar CEO.' });
      }
      setor = 'all';
    }

    // Apenas admin pode criar outro admin (defesa em profundidade).
    if (role === 'admin' && callerProfile.role !== 'admin') {
      log.warn('user.permission_denied', { caller_id: caller.id, caller_role: callerProfile.role, target_role: role, reason: 'non_admin_creating_admin' });
      return res.status(403).json({ error: 'Apenas administradores podem criar administradores.' });
    }

    // Gerente só pode criar colaboradores do seu próprio setor.
    // Filial: pode atribuir SuperMax/MaxLook/TechMax, mas não Matriz (reservada a admin/CEO).
    if (callerProfile.role === 'gerente') {
      if (role !== 'colaborador') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_role: role, reason: 'gerente_role_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem criar colaboradores.' });
      }
      if (setor !== callerProfile.setor) {
        log.warn('user.permission_denied', { caller_id: caller.id, caller_setor: callerProfile.setor, target_setor: setor, reason: 'gerente_setor_mismatch' });
        return res.status(403).json({ error: 'Gerentes só podem criar usuários do seu setor.' });
      }
      // Sem filial explícita cairia no default do schema ('Matriz'), por isso checamos ambos os casos.
      const targetFilial = (typeof filial === 'string' ? filial.trim() : '') || 'Matriz';
      if (targetFilial === 'Matriz') {
        log.warn('user.permission_denied', { caller_id: caller.id, target_filial: targetFilial, reason: 'gerente_matriz_forbidden' });
        return res.status(403).json({ error: 'Gerentes não podem atribuir a filial Matriz.' });
      }
    }

    // Criar usuário no Supabase Auth
    const { data: { user: newUser }, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr || !newUser) {
      const msg = createErr?.message ?? 'Erro ao criar usuário.';
      const friendly = msg.includes('already registered') ? 'E-mail já cadastrado.' : msg;
      log.warn('auth.create_failed', { error: msg, friendly });
      return res.status(400).json({ error: friendly });
    }

    // Criar perfil. Filial é opcional no payload — default 'Matriz' (default
    // do schema). Frontend valida contra FILIAIS_HOLDING.
    const profilePayload: any = {
      id:         newUser.id,
      nome,
      email,
      role,
      setor,
      criado_por: caller.id,
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

    log.info('user.created', { user_id: newUser.id, role, setor, caller_id: caller.id });
    return res.status(200).json({ success: true, userId: newUser.id });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
