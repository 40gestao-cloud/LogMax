import type { UserProfile, Setor } from '../hooks/useUserProfile';

/** Lista plana de todos os setores do usuário (primário + extras). */
export function allSetores(profile: Pick<UserProfile, 'setor' | 'setores_extras'> | null | undefined): Setor[] {
  if (!profile) return [];
  return [profile.setor, ...(profile.setores_extras ?? [])];
}

/**
 * True se o usuário tem nível de conselheiro: role='conselheiro' puro
 * ou role='gerente' com is_conselheiro=true.
 */
export function isConselheiro(
  profile: Pick<UserProfile, 'role' | 'is_conselheiro'> | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role === 'conselheiro' || (profile.role === 'gerente' && profile.is_conselheiro === true);
}

/**
 * True se o usuário pertence ao **Conselho deliberativo**: conselheiro puro,
 * gerente-conselheiro ou admin (o professor, que destrava qualquer etapa).
 *
 * **CEO fica de fora de propósito** — espelha `auth_is_conselho()` da migr.
 * 386. O CEO propõe orçamento, executa e presta contas; quem delibera sobre
 * o que ele fez é outro corpo. Se ele deliberasse também, o loop de
 * accountability não fecharia — era exatamente o buraco que o bloco G1–G8
 * existia para tapar.
 *
 * Use para *atos de deliberação* (aprovar verba, dar parecer, encerrar).
 * Para visibilidade — ver as propostas das 4 unidades, abrir a tela — o
 * teste continua sendo o amplo, que inclui o CEO.
 */
export function isConselho(
  profile: Pick<UserProfile, 'role' | 'is_conselheiro'> | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role === 'admin' || isConselheiro(profile);
}

// --- Modo Aula: setores concedidos temporariamente ---
// Enquanto a aula está ativa, o aluno opera os módulos da whitelist mesmo fora
// do setor dele — e a RLS concede o mesmo (migr. 317, `auth_aula_setores()`).
// Sem espelhar isso aqui, o módulo abriria mas as ~25 views que fazem
// `hasSetor(profile, 'X')` para liberar botão/aba continuariam em modo leitura.
//
// Registry de módulo em vez de parâmetro porque `hasSetor` é chamado de dezenas
// de views que não conhecem a config da aula. App.tsx mantém isto em dia a cada
// render (o realtime de aula_config dispara um), e a lista é [] com aula
// desligada — fora da aula o comportamento é idêntico ao de antes.
let aulaSetoresConcedidos: string[] = [];

export function setAulaSetoresConcedidos(setores: string[]): void {
  aulaSetoresConcedidos = setores;
}

/**
 * Acesso de leitura/escrita: o usuário pertence (primário ou extra) a `setor`?
 * Admin/CEO/Conselheiro ('all') sempre passam.
 *
 * Use para gates de funcionalidade ("posso operar no módulo X"). Para checks
 * que devem permanecer atrelados ao setor *primário* (ex.: "este gerente é
 * gerente DE RH"), compare diretamente `profile.setor === 'rh'`.
 */
export function hasSetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras' | 'is_conselheiro'> | null | undefined,
  setor: Setor,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'ceo') return true;
  if (isConselheiro(profile)) return true;
  if (profile.setor === 'all') return true;
  if (profile.setor === setor) return true;
  if ((profile.setores_extras ?? []).includes(setor)) return true;
  return aulaSetoresConcedidos.includes(setor);
}

/** Versão variádica: true se o usuário pertence a *qualquer* um dos setores. */
export function hasAnySetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras' | 'is_conselheiro'> | null | undefined,
  ...setores: Setor[]
): boolean {
  return setores.some(s => hasSetor(profile, s));
}
