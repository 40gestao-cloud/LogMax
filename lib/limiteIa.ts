import type { VercelResponse } from '@vercel/node';
import { getAdminClient, descreverErro, type AuthedUser } from './auth.js';
import type { Logger } from './log.js';

/**
 * Chamadas à IA por pessoa por hora, somando todos os endpoints `api/ai-*`
 * (migr. 640). As chaves são free tier e compartilhadas pela escola: sem teto,
 * um aluno num laço esgota a cota e derruba o MaxAI de todo mundo.
 */
export const MAX_CHAMADAS_IA_POR_HORA = 40;

/**
 * Conta uma chamada e diz se ela passou do teto. Chamar LOGO ANTES do
 * `callLLM` — resposta vinda de cache não gasta cota e não deve contar.
 *
 * Devolve true quando barrou (a resposta 429 já foi enviada). O professor
 * (`role = 'admin'`) fica de fora: é quem conduz a aula e não pode travar no
 * meio dela.
 *
 * Falha do contador deixa passar. Diferente do ponto, aqui não há dado a
 * falsificar: o teto protege cota, e travar a IA da turma porque o contador
 * piscou seria causar a queda que ele existe para evitar.
 */
export async function barrarExcessoIa(
  res: VercelResponse,
  user: AuthedUser,
  log: Logger,
): Promise<boolean> {
  if (user.role === 'admin') return false;

  const admin = getAdminClient(res);
  if (!admin) return true; // getAdminClient já respondeu 500

  const hora = Math.floor(Date.now() / 3_600_000);
  const { data: chamadas, error } = await admin.rpc('contar_uso_ia', { p_user: user.id, p_hora: hora });
  if (error || typeof chamadas !== 'number') {
    log.warn('ia.contador_unavailable', { user_id: user.id, ...descreverErro(error) });
    return false;
  }

  if (chamadas > MAX_CHAMADAS_IA_POR_HORA) {
    log.warn('ia.rate_limited', { user_id: user.id, chamadas });
    const minutos = 60 - new Date().getUTCMinutes();
    res.setHeader('Retry-After', String(minutos * 60));
    res.status(429).json({
      error: `Limite de ${MAX_CHAMADAS_IA_POR_HORA} usos da IA por hora atingido. Tente de novo em ${minutos} min.`,
    });
    return true;
  }
  return false;
}
