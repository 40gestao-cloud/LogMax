import type { UserProfile, Setor } from '../hooks/useUserProfile';

/** Lista plana de todos os setores do usuário (primário + extras). */
export function allSetores(profile: Pick<UserProfile, 'setor' | 'setores_extras'> | null | undefined): Setor[] {
  if (!profile) return [];
  return [profile.setor, ...(profile.setores_extras ?? [])];
}

/**
 * Acesso de leitura/escrita: o usuário pertence (primário ou extra) a `setor`?
 * Admin/CEO ('all') sempre passam.
 *
 * Use para gates de funcionalidade ("posso operar no módulo X"). Para checks
 * que devem permanecer atrelados ao setor *primário* (ex.: "este gerente é
 * gerente DE RH"), compare diretamente `profile.setor === 'rh'`.
 */
export function hasSetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras'> | null | undefined,
  setor: Setor,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'ceo') return true;
  if (profile.setor === 'all') return true;
  if (profile.setor === setor) return true;
  return (profile.setores_extras ?? []).includes(setor);
}

/** Versão variádica: true se o usuário pertence a *qualquer* um dos setores. */
export function hasAnySetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras'> | null | undefined,
  ...setores: Setor[]
): boolean {
  return setores.some(s => hasSetor(profile, s));
}
