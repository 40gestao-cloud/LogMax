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

  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token obrigatório.' });

  const { data: { user: caller }, error: tokenErr } = await admin.auth.getUser(token);
  if (tokenErr || !caller) return res.status(401).json({ error: 'Token inválido.' });

  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('role, setor')
    .eq('id', caller.id)
    .single();

  if (!callerProfile || callerProfile.role === 'colaborador') {
    return res.status(403).json({ error: 'Sem permissão para excluir usuários.' });
  }

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' });
  if (userId === caller.id) return res.status(400).json({ error: 'Não é possível excluir sua própria conta.' });

  const { data: targetProfile } = await admin
    .from('user_profiles')
    .select('role, setor')
    .eq('id', userId)
    .single();

  if (!targetProfile) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (targetProfile.role === 'admin') {
    return res.status(403).json({ error: 'Administradores não podem ser excluídos.' });
  }

  if (callerProfile.role === 'gerente') {
    if (targetProfile.role !== 'colaborador') {
      return res.status(403).json({ error: 'Gerentes só podem excluir colaboradores.' });
    }
    if (targetProfile.setor !== callerProfile.setor) {
      return res.status(403).json({ error: 'Gerentes só podem excluir usuários do seu setor.' });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}
