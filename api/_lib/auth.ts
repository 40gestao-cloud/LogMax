import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'gerente' | 'colaborador';

export interface AuthedUser {
  id: string;
  email: string;
  role: UserRole;
  setor: string;
}

/**
 * Cria um cliente Supabase com service_role — uso server-side only.
 * Devolve null + envia 500 se as env vars não estão configuradas.
 */
export function getAdminClient(res: VercelResponse): SupabaseClient | null {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Servidor não configurado.' });
    return null;
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Valida o JWT do Bearer header e devolve o perfil do utilizador.
 * Se inválido, envia 401/403 e devolve null — handler deve retornar imediatamente.
 *
 * Uso:
 *   const user = await authenticate(req, res);
 *   if (!user) return;
 */
export async function authenticate(
  req: VercelRequest,
  res: VercelResponse,
  admin?: SupabaseClient,
): Promise<AuthedUser | null> {
  const client = admin ?? getAdminClient(res);
  if (!client) return null;

  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Token ausente.' });
    return null;
  }

  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Token inválido.' });
    return null;
  }

  const { data: profile } = await client
    .from('user_profiles')
    .select('role, setor')
    .eq('id', user.id)
    .single();

  if (!profile) {
    res.status(403).json({ error: 'Perfil não encontrado.' });
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile.role as UserRole,
    setor: profile.setor as string,
  };
}

/**
 * Verifica se o user tem um dos roles permitidos. Envia 403 e devolve false se não.
 */
export function authorize(
  user: AuthedUser,
  res: VercelResponse,
  ...allowed: UserRole[]
): boolean {
  if (!allowed.includes(user.role)) {
    res.status(403).json({ error: 'Permissão insuficiente.' });
    return false;
  }
  return true;
}

/**
 * CORS allow-list — substitui CORS '*' por origens explícitas.
 * Devolve true se a request OPTIONS foi tratada e o handler deve sair.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = [
    process.env.VITE_APP_URL,                     // domínio principal de prod (configurar em Vercel)
    'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', // dev
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
