import { supabase } from './supabase';

// Retorna o access_token vigente, refresha se estiver perto do vencimento.
// Sempre chamar isso antes de bater num endpoint em /api — usar session do
// useAuth() vira "Token invalido" quando a aba fica em background e o auto-
// refresh do Supabase perde a janela (JWT default = 1h).
export async function freshToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Wrapper de fetch que injeta Authorization com token fresco. Merge dos
// headers preserva Content-Type customizado. Devolve o Response cru — o
// caller trata json/erro como quiser.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await freshToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');
  return fetch(input, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
}
