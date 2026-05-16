import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Servidor não configurado.' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validar token do chamador
  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token obrigatório.' });

  const { data: { user: caller }, error: tokenErr } = await admin.auth.getUser(token);
  if (tokenErr || !caller) return res.status(401).json({ error: 'Token inválido.' });

  // Buscar perfil do chamador
  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('role, setor')
    .eq('id', caller.id)
    .single();

  if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'gerente')) {
    return res.status(403).json({ error: 'Sem permissão para criar usuários.' });
  }

  const { email, password, nome, role } = req.body ?? {};
  let { setor } = req.body ?? {};

  if (!email || !password || !nome || !role || !setor) {
    return res.status(400).json({ error: 'Campos obrigatórios: email, password, nome, role, setor.' });
  }

  const VALID_ROLES = ['admin', 'ceo', 'gerente', 'colaborador'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Cargo inválido.' });
  }

  // CEO é global por definição: só admin cria CEO e setor é forçado para 'all'.
  if (role === 'ceo') {
    if (callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar CEO.' });
    }
    setor = 'all';
  }

  // Apenas admin pode criar outro admin (defesa em profundidade).
  if (role === 'admin' && callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem criar administradores.' });
  }

  // Gerente só pode criar colaboradores do seu próprio setor
  if (callerProfile.role === 'gerente') {
    if (role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes só podem criar colaboradores.' });
    }
    if (setor !== callerProfile.setor) {
      return res.status(403).json({ error: 'Gerentes só podem criar usuários do seu setor.' });
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
    return res.status(400).json({ error: msg.includes('already registered') ? 'E-mail já cadastrado.' : msg });
  }

  // Criar perfil
  const { error: profileErr } = await admin.from('user_profiles').insert({
    id:         newUser.id,
    nome,
    email,
    role,
    setor,
    criado_por: caller.id,
  });

  if (profileErr) {
    await admin.auth.admin.deleteUser(newUser.id);
    return res.status(500).json({ error: 'Erro ao criar perfil. Usuário removido.' });
  }

  return res.status(200).json({ success: true, userId: newUser.id });
}
