import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'ceo' | 'gerente' | 'colaborador' | 'conselheiro';

export interface AuthedUser {
  id: string;
  email: string;
  role: UserRole;
  setor: string;
  setores_extras: string[];
  is_conselheiro: boolean;
}

/**
 * Espelha `hasSetor` do front (src/lib/rbac.ts): considera setor primário,
 * setores_extras, admin/CEO, conselheiro e o setor coringa 'all'. Endpoints
 * DEVEM usar isto em vez de `user.setor === 'X'`, senão um usuário multi-setor
 * (acesso via setores_extras) leva 403 mesmo com o botão liberado na UI.
 */
export function userHasSetor(user: AuthedUser, setor: string): boolean {
  if (user.role === 'admin' || user.role === 'ceo') return true;
  if (user.role === 'conselheiro' || (user.role === 'gerente' && user.is_conselheiro)) return true;
  if (user.setor === 'all') return true;
  if (user.setor === setor) return true;
  return user.setores_extras.includes(setor);
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

  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  // `Bearer ${session?.access_token}` no front vira "Bearer undefined" quando
  // a sessão morre — tratamos como ausente em vez de mandar pra getUser, que
  // devolveria "Auth session missing!" e confunde o usuário final.
  if (!token || token === 'undefined' || token === 'null') {
    res.status(401).json({ error: 'Sessão expirou. Faça login novamente.' });
    return null;
  }

  const { data: { user }, error } = await comRetentativa(
    () => client.auth.getUser(token),
    r => ehFalhaDeConexao(r.error),
  );
  if (error || !user) {
    // Depois das retentativas, ainda pode ser pane — e aí a resposta é 503
    // ("tente de novo"), não 401 ("saia e entre de novo"): mandar relogar quem
    // está com a sessão boa é apagar o trabalho que estava na tela.
    if (ehFalhaDeConexao(error)) {
      res.status(503).json({ error: MSG_CONEXAO });
      return null;
    }
    // "Auth session missing!" / "invalid JWT" / "JWT expired" do Supabase
    // viram todos uma mensagem amigável de re-login — o detalhe vai pro log.
    res.status(401).json({ error: 'Sessão expirou. Faça login novamente.' });
    return null;
  }

  const { data: profile, error: perfilErr, status: perfilStatus } = await comRetentativa(
    async () => await client
      .from('user_profiles')
      .select('role, setor, setores_extras, is_conselheiro')
      .eq('id', user.id)
      .single(),
    r => ehFalhaDeConexao(r.error, r.status),
  );

  // O `error` do select era descartado: consulta que não respondeu virava
  // "perfil não encontrado", que é a descrição de um cadastro que não existe.
  if (ehFalhaDeConexao(perfilErr, perfilStatus)) {
    res.status(503).json({ error: MSG_CONEXAO });
    return null;
  }
  if (!profile) {
    res.status(403).json({ error: `Perfil não encontrado para ${user.email ?? user.id}.` });
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile.role as UserRole,
    setor: profile.setor as string,
    setores_extras: Array.isArray(profile.setores_extras) ? (profile.setores_extras as string[]) : [],
    is_conselheiro: profile.is_conselheiro === true,
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
 *
 * `extraOrigins` existe para as lojas públicas, que vivem em projeto Vercel
 * separado e por isso chamam a API cross-origin. Elas entram SÓ no endpoint
 * que precisa (`api/loja.ts`), e não na allow-list global: os outros
 * endpoints exigem Bearer JWT, mas não há motivo para anunciar que aceitam
 * request de um domínio que nunca vai ter um token válido.
 */
export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  extraOrigins?: string[],
): boolean {
  const allowed = [
    process.env.VITE_APP_URL,                     // domínio principal de prod (configurar em Vercel)
    'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', // dev
    ...(extraOrigins ?? []),
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

// ── Pane de conexão ≠ credencial ruim ───────────────────────────────────
//
// Toda chamada daqui atravessa a rede duas vezes (Vercel → Supabase → Vercel),
// e essa travessia falha de vez em quando. O que o código fazia com essas
// falhas era pior que a falha: `getUser` que não respondeu virava "sua sessão
// não vale mais", e `select` que não respondeu virava "perfil não encontrado".
// As duas mensagens descrevem um estado PERMANENTE — mandam sair e entrar de
// novo, ou dizem que o cadastro sumiu — para um problema que passa sozinho em
// segundos. Foi assim que a criação de um usuário, em 13/09/2026, acusou
// sessão encerrada três vezes seguidas e funcionou na quarta, sem ninguém
// relogar: três chamadas DIFERENTES ao Supabase caíram em 25 segundos.
//
// A assinatura da pane, no log daquele dia, foi `error: "{}"` — o supabase-js
// serializa com `JSON.stringify` quando o fetch morre sem corpo, e sobra o
// objeto vazio. JWT vencido nunca dá isso: dá "invalid JWT: ...".

/** Mensagem única de indisponibilidade. Diz o que fazer: repetir, não relogar. */
export const MSG_CONEXAO =
  'Falha de conexão com o servidor. Nada foi alterado — tente de novo em alguns segundos.';

/**
 * O erro veio da travessia (rede, timeout, 5xx do upstream) e não da
 * credencial/estado do dado?
 *
 * `status` é o da resposta PostgREST, que vem FORA do objeto de erro (o
 * postgrest-js zera para 0 quando o fetch morre). `PGRST116` sai antes de
 * tudo: é "nenhuma linha", a resposta legítima de um `.single()` que não
 * achou — e tratá-la como pane esconderia um 404 de verdade.
 */
export function ehFalhaDeConexao(err: any, status?: number): boolean {
  if (!err) return false;
  if (err.code === 'PGRST116') return false;

  const nome = String(err.name ?? '');
  if (['AuthRetryableFetchError', 'FetchError', 'TypeError', 'AbortError'].includes(nome)) return true;

  const httpStatus = Number(err.status ?? err.statusCode ?? status ?? NaN);
  if (Number.isFinite(httpStatus) && (httpStatus === 0 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500)) {
    return true;
  }

  // postgrest-js zera o `code` no erro de fetch; o supabase-js deixa "{}" ou
  // vazio na mensagem quando não houve corpo para ler.
  const msg = String(err.message ?? '').trim();
  if (err.code === '' && /^(FetchError|TypeError|AbortError)/.test(msg)) return true;
  if (msg === '' || msg === '{}') return true;

  return /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(msg);
}

/**
 * Erro em campos separados para o log. `error: "{}"` sozinho não diz nada;
 * com nome e status dá para separar pane de rede de recusa do servidor.
 */
export function descreverErro(err: any, status?: number): Record<string, unknown> {
  return {
    error: String(err?.message ?? err ?? ''),
    error_name: err?.name ?? null,
    error_code: err?.code ?? null,
    error_status: err?.status ?? err?.statusCode ?? status ?? null,
    transitorio: ehFalhaDeConexao(err, status),
  };
}

/**
 * Repete uma chamada que falhou por conexão. Duas retentativas, espera curta e
 * crescente — a pane observada durou segundos, não minutos, e quem está do
 * outro lado é uma pessoa esperando o botão responder.
 *
 * SÓ para operação idempotente (leitura, `getUser`). Criar usuário não entra
 * aqui: repetir um POST que pode ter dado certo do lado do servidor é como se
 * fabrica conta duplicada.
 */
export async function comRetentativa<T>(
  executar: () => Promise<T>,
  falhouPorConexao: (resultado: T) => boolean,
  aoRepetir?: (tentativa: number) => void,
): Promise<T> {
  let resultado = await executar();
  for (let tentativa = 1; tentativa <= 2 && falhouPorConexao(resultado); tentativa++) {
    aoRepetir?.(tentativa);
    await new Promise(r => setTimeout(r, 300 * tentativa));
    resultado = await executar();
  }
  return resultado;
}
