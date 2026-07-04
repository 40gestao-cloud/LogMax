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
  return (profile.setores_extras ?? []).includes(setor);
}

/** Versão variádica: true se o usuário pertence a *qualquer* um dos setores. */
export function hasAnySetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras' | 'is_conselheiro'> | null | undefined,
  ...setores: Setor[]
): boolean {
  return setores.some(s => hasSetor(profile, s));
}
