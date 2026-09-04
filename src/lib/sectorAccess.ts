// --- acesso por setor (UX only — NÃO é segurança) ---
// Este mapa controla o que aparece no menu lateral por setor. NÃO é a fonte
// de verdade pra autorização: a RLS no Supabase (010_20260516_rls_hardening.sql
// e migrações posteriores) é quem realmente bloqueia leitura/escrita por
// `auth_user_setor()` / `auth_is_admin()`. Esconder do menu evita UX confusa
// ("o botão aparece e falha"), mas se alguém digitar o `activeView` direto
// no console, a RLS continua barrando.
//
// 'empresa' é cadastro base (filiais, formas e condições de pagamento,
// projetos) e fica disponível para todos os setores. Os demais seguem o
// recorte funcional de cada setor.
//
// 'requisicoes' também é de todos, e por um motivo diferente: pedir o que a
// área precisa não é atribuição de um setor, é rotina de todos eles. Enquanto
// morava dentro de 'empresa' isso vinha de carona; agora que é módulo próprio,
// precisa estar em cada lista — se faltar em uma, aquele setor perde a porta
// de entrada do fluxo de compra inteiro.
export const SETOR_MODULES: Record<string, string[]> = {
  all:        ['empresa', 'requisicoes', 'cadastros', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing', 'ti'],
  logistica:  ['empresa', 'requisicoes', 'cadastros', 'estoque', 'compras', 'ti'],
  vendas:     ['empresa', 'requisicoes', 'vendas', 'ti'],
  financeiro: ['empresa', 'requisicoes', 'financeiro', 'ti'],
  rh:         ['empresa', 'requisicoes', 'rh', 'ti'],
  marketing:  ['empresa', 'requisicoes', 'marketing', 'ti'],
  ti:         ['empresa', 'requisicoes', 'ti'],
  // Gerência: setor do cargo gerente (antes só existia o role, sem setor
  // próprio). Vê tudo da própria filial — mesma abrangência de 'all', mas
  // sem ser role global. O acesso real (RLS) vem de setores_extras com os
  // 6 setores operacionais, preenchido automaticamente pelo backend
  // (api/create-user.ts, api/update-user.ts) sempre que setor='gerencia'.
  gerencia:   ['empresa', 'requisicoes', 'cadastros', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing', 'ti'],
};

// Mesma régua que a sidebar usa para decidir quais módulos aparecem. Foi
// extraída daqui porque tela que oferece um ATALHO para outro módulo precisa
// perguntar a mesma coisa — mandar o aluno para um módulo que o menu dele não
// tem é pior do que não oferecer o atalho: a tela abre negada e ele acha que
// quebrou. Continua sendo UX, não segurança: quem manda é a RLS.
export function podeVerModulo(
  profile: { role?: string | null; setor?: string | null; setores_extras?: string[] | null } | null | undefined,
  modulo: string,
): boolean {
  if (!profile) return false;
  // Gerente vê todos os módulos da própria filial (RLS recorta a linha).
  if (profile.role === 'gerente') return SETOR_MODULES.all.includes(modulo);
  const setores = [profile.setor, ...(profile.setores_extras ?? [])].filter(Boolean) as string[];
  return setores.some(s => (SETOR_MODULES[s] ?? []).includes(modulo));
}
