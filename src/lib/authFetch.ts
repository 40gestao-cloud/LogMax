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


// Lê a resposta de um endpoint /api que DEVERIA devolver JSON, sem confiar
// que ele devolveu.
//
// `resp.json()` direto estoura "Unexpected end of JSON input" quando o corpo
// vem vazio — e vazio é exatamente o que chega quando a função serverless é
// morta no meio (o teto de tempo do Vercel), quando o proxy devolve 502 seco
// ou quando se chama /api no `vite dev`, que não serve as funções. O erro do
// parser não diz nada disso, e foi assim que a geração de legenda apareceu
// como "Failed to execute 'json' on 'Response'".
//
// Aqui o corpo é lido como texto uma vez só e o diagnóstico sai em português,
// com o status HTTP — que é a pista que separa "IA recusou" de "o servidor
// não respondeu".
export async function lerJsonDaApi(resp: Response): Promise<any> {
  const bruto = await resp.text();
  if (!bruto.trim()) {
    throw new Error(
      resp.status >= 500 || resp.status === 0
        ? `O servidor não respondeu (HTTP ${resp.status}). A geração pode ter passado do tempo limite — tente de novo.`
        : `Resposta vazia do servidor (HTTP ${resp.status}).`,
    );
  }
  try {
    return JSON.parse(bruto);
  } catch {
    // HTML costuma ser página de erro do proxy ou o index.html da SPA (o
    // caso de rodar /api no dev server, onde a função nem existe).
    const pista = bruto.trimStart().startsWith('<')
      ? 'o endereço devolveu uma página, não dados'
      : bruto.slice(0, 120);
    throw new Error(`Resposta inesperada do servidor (HTTP ${resp.status}): ${pista}`);
  }
}
