// Relógio da máquina contra o relógio do servidor.
//
// Bug de 2026-08-28: "faço login e, alguns segundos depois, volto para a tela
// de login". Os logs do Supabase mostraram o cliente pedindo token novo 20 ms
// DEPOIS de entrar — 101 refreshes numa sessão de três minutos e meio — até o
// GoTrue responder 429 e o `auth-js` emitir SIGNED_OUT.
//
// A causa não estava no app: o `auth-js` considera o token expirado quando
// falta menos de 90 s para o `exp`, e o `exp` vem do servidor em tempo
// absoluto. Numa máquina com o relógio ~1 h adiantado, todo token nasce
// "expirado" — o cliente renova em laço, estoura o limite do endpoint
// (150 renovações por 5 min POR IP, e o laboratório inteiro sai por um IP só)
// e derruba junto quem está na máquina do lado com o relógio certo.
//
// Nada disso dá para consertar no código: quem decide se o token expirou é o
// relógio do sistema operacional. O que dá para fazer — e é o que este arquivo
// serve — é parar de deixar a pessoa adivinhar. Medimos o desvio, e o aviso
// diz o que está errado e onde se acerta.
//
// A medição não custa rede: o próprio access token traz `iat` (instante em que
// o servidor o emitiu). A diferença para o `Date.now()` da recepção é o desvio,
// com o erro de uma viagem de rede — irrelevante ao pé da tolerância de 60 s.

/** Desvio a partir do qual o aviso aparece. */
export const TOLERANCIA_S = 60;

/**
 * A partir daqui o login entra em laço: `jwt_exp` é 3600 s e a margem do
 * `auth-js` é 90 s, então um relógio adiantado além disto faz o token nascer
 * vencido. Abaixo disto o desvio ainda estraga horário de ponto e relatório,
 * mas a sessão se sustenta.
 */
export const LIMITE_SESSAO_S = 3600 - 90;

const CHAVE = 'logmax:relogioSkew';

function decodificarPayload(accessToken: string): Record<string, unknown> | null {
  try {
    const parte = accessToken.split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const preenchido = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(preenchido));
  } catch {
    return null;
  }
}

/**
 * Desvio do relógio local, em segundos, medido contra o `iat` do token.
 * Positivo = máquina ADIANTADA (o caso que derruba a sessão).
 */
export function skewDoToken(accessToken: string | null | undefined): number | null {
  if (!accessToken) return null;
  const payload = decodificarPayload(accessToken);
  const iat = payload?.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  return Math.round(Date.now() / 1000 - iat);
}

/**
 * Mede e guarda o desvio. Guardar importa: quando o relógio está adiantado a
 * ponto de derrubar a sessão, a pessoa passa a maior parte do tempo na tela de
 * login — que é justamente onde ela precisa ler o aviso, e onde não há token
 * nenhum para medir.
 */
export function registrarSkewDoToken(accessToken: string | null | undefined): void {
  const skew = skewDoToken(accessToken);
  if (skew === null) return;
  try { localStorage.setItem(CHAVE, String(skew)); } catch { /* modo privado */ }
}

export function lerSkew(): number | null {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** Texto do desvio: "1 h 4 min adiantado". */
export function descreveSkew(skew: number): string {
  const seg = Math.abs(skew);
  const horas = Math.floor(seg / 3600);
  const min = Math.round((seg % 3600) / 60);
  const partes: string[] = [];
  if (horas > 0) partes.push(`${horas} h`);
  if (min > 0 || horas === 0) partes.push(`${min} min`);
  return `${partes.join(' ')} ${skew > 0 ? 'adiantado' : 'atrasado'}`;
}

/** Hora que o servidor teria agora, segundo o desvio medido. */
export function horaDoServidor(skew: number): string {
  return new Date(Date.now() - skew * 1000).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
  });
}
