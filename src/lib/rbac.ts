import type { UserProfile, Setor } from '../hooks/useUserProfile';

/**
 * Rótulo do papel como a turma o lê — é a coluna "Cargo" da tela de Usuários.
 * Mora aqui, e não dentro de uma view, porque RH → Funcionários passou a
 * mostrar a mesma palavra ao trazer o cadastro de um usuário: duas cópias do
 * mapa acabariam divergindo, e o aluno veria "gerente" numa tela e "Gerente"
 * na outra para a mesma pessoa.
 *
 * Há uma cópia inevitável em `api/users.ts` (`ROLE_CARGO`), que sincroniza
 * `funcionarios.cargo` quando o papel muda — serverless não importa de `src/`.
 * Mudou aqui, muda lá.
 */
export const ROLE_LABEL: Record<string, string> = {
  admin:       'Administrador',
  ceo:         'CEO',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
  conselheiro: 'Conselheiro',
};

export const roleLabel = (role: string | null | undefined): string =>
  ROLE_LABEL[String(role ?? '')] ?? String(role ?? '');

// ── Funções sobre o perfil (migr. 690) ──────────────────────────────────────
// Espelho de `auth_user_setores()` / `auth_e_gerencia()` no banco. Mudou lá,
// muda aqui — a tela que discorda da RLS mostra botão que falha.

/** Setores que o Gerente Assistente opera: os do gerente, sem RH. */
export const SETORES_GERENTE_ASSISTENTE: Setor[] = ['logistica', 'vendas', 'financeiro', 'marketing', 'ti'];

type PerfilFuncoes = Pick<UserProfile, 'role'> & Partial<Pick<UserProfile, 'gerente_assistente' | 'head_comunicacao'>>;

/** Colaborador que é o braço direito do gerente na filial. */
export const isGerenteAssistente = (p: PerfilFuncoes | null | undefined): boolean =>
  !!p && p.role === 'colaborador' && p.gerente_assistente === true;

/** Gerência da filial: o gerente titular ou o Gerente Assistente. */
export const isGerencia = (p: PerfilFuncoes | null | undefined): boolean =>
  !!p && (p.role === 'gerente' || isGerenteAssistente(p));

/** Head de Comunicação da filial (colaborador ou gerente). */
export const isHeadComunicacao = (p: PerfilFuncoes | null | undefined): boolean =>
  !!p && (p.role === 'colaborador' || p.role === 'gerente') && p.head_comunicacao === true;

/**
 * Quem vê a fila de Aprovações de Conteúdo. O banco decide entre o Head e a
 * gerência (a gerência só aprova sem Head na unidade — `decidir_conteudo`).
 */
export const podeAprovarConteudo = (p: PerfilFuncoes | null | undefined): boolean =>
  !!p && (p.role === 'admin' || isHeadComunicacao(p) || isGerencia(p));

/** "Colaborador · Gerente Assistente", "Gerente · Head de Comunicação"… */
export const cargoComFuncoes = (p: PerfilFuncoes | null | undefined): string => {
  if (!p) return '';
  const partes = [roleLabel(p.role)];
  if (isGerenteAssistente(p)) partes.push('Gerente Assistente');
  if (isHeadComunicacao(p)) partes.push('Head de Comunicação');
  return partes.join(' · ');
};

/**
 * Lista plana de todos os setores do usuário (primário + extras + os que as
 * funções concedem: assistente → operacionais sem RH; Head → marketing).
 */
export function allSetores(
  profile: (Pick<UserProfile, 'setor' | 'setores_extras'> & Partial<Pick<UserProfile, 'role' | 'gerente_assistente' | 'head_comunicacao'>>) | null | undefined,
): Setor[] {
  if (!profile) return [];
  const extras: Setor[] = [];
  if (profile.role && isGerenteAssistente(profile as PerfilFuncoes)) extras.push(...SETORES_GERENTE_ASSISTENTE);
  if (profile.role && isHeadComunicacao(profile as PerfilFuncoes)) extras.push('marketing');
  return Array.from(new Set([profile.setor, ...(profile.setores_extras ?? []), ...extras]));
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
 * 386. O CEO executa; quem delibera sobre o que ele fez é outro corpo. Se ele
 * deliberasse também, o loop de accountability não fecharia.
 *
 * Restou um ato só: nomear, reconduzir e encerrar mandato (383). A deliberação
 * de valores — verba, parecer de contas, repartição do lucro — saiu do produto
 * em 2026-08-17 (migr. 441). Para visibilidade, o teste continua sendo o
 * amplo, que inclui o CEO.
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
  // Migr. 690: setores concedidos pela função (assistente / Head).
  if (allSetores(profile as any).includes(setor)) return true;
  return aulaSetoresConcedidos.includes(setor);
}

/** Versão variádica: true se o usuário pertence a *qualquer* um dos setores. */
export function hasAnySetor(
  profile: Pick<UserProfile, 'role' | 'setor' | 'setores_extras' | 'is_conselheiro'> | null | undefined,
  ...setores: Setor[]
): boolean {
  return setores.some(s => hasSetor(profile, s));
}
