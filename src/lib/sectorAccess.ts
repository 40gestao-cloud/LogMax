// --- acesso por setor (UX only — NÃO é segurança) ---
// Este mapa controla o que aparece no menu lateral por setor. NÃO é a fonte
// de verdade pra autorização: a RLS no Supabase (010_20260516_rls_hardening.sql
// e migrações posteriores) é quem realmente bloqueia leitura/escrita por
// `auth_user_setor()` / `auth_is_admin()`. Esconder do menu evita UX confusa
// ("o botão aparece e falha"), mas se alguém digitar o `activeView` direto
// no console, a RLS continua barrando.
//
// 'empresa' é cadastro base (filiais, clientes, produtos, fornecedores...)
// e fica disponível para todos os setores. Os demais seguem o recorte
// funcional de cada setor.
export const SETOR_MODULES: Record<string, string[]> = {
  all:        ['empresa', 'cadastros', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing', 'ti'],
  logistica:  ['empresa', 'cadastros', 'estoque', 'compras', 'ti'],
  vendas:     ['empresa', 'vendas', 'ti'],
  financeiro: ['empresa', 'financeiro', 'ti'],
  rh:         ['empresa', 'rh', 'ti'],
  marketing:  ['empresa', 'marketing', 'ti'],
  ti:         ['empresa', 'ti'],
  // Gerência: setor do cargo gerente (antes só existia o role, sem setor
  // próprio). Vê tudo da própria filial — mesma abrangência de 'all', mas
  // sem ser role global. O acesso real (RLS) vem de setores_extras com os
  // 6 setores operacionais, preenchido automaticamente pelo backend
  // (api/create-user.ts, api/update-user.ts) sempre que setor='gerencia'.
  gerencia:   ['empresa', 'cadastros', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing', 'ti'],
};
