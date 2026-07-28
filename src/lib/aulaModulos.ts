// Modo Aula — catálogo de módulos configuráveis + utilitários.
// A trava aqui é UX only (esconde e redireciona no client). RLS continua
// sendo a fonte de verdade — quem digitar activeView no console cai na
// tela "bloqueado por Modo Aula" mas RLS já barra qualquer chamada de rede.

import type { AulaConfig } from '../hooks/useAulaConfig';
import type { UserProfile } from '../hooks/useUserProfile';

export interface AulaModuloDef {
  id: string;
  label: string;
  grupo: string;
}

export const AULA_MODULOS: AulaModuloDef[] = [
  { id: 'dashboard',         label: 'Dashboard',        grupo: 'Geral' },
  { id: 'usuarios',          label: 'Usuários',         grupo: 'Geral' },
  { id: 'catalogo-produtos', label: 'Catálogo',         grupo: 'Geral' },
  { id: 'avaliacoes',        label: 'Avaliações',       grupo: 'Geral' },
  { id: 'feedback-org',      label: 'Feedback & Requerimentos', grupo: 'Geral' },
  { id: 'metas',             label: 'Metas',            grupo: 'Geral' },
  { id: 'empresa',           label: 'Empresa',          grupo: 'Operacional' },
  { id: 'cadastros',         label: 'Cadastros',        grupo: 'Logística' },
  { id: 'compras',           label: 'Compras',          grupo: 'Logística' },
  { id: 'estoque',           label: 'Estoque',          grupo: 'Logística' },
  { id: 'financeiro',        label: 'Financeiro',       grupo: 'Finanças' },
  { id: 'rh',                label: 'Recursos Humanos', grupo: 'Pessoas' },
  { id: 'vendas',            label: 'Vendas',           grupo: 'Comercial' },
  { id: 'marketing',         label: 'Marketing',        grupo: 'Comercial' },
  { id: 'ti',                label: 'TI & Suporte',     grupo: 'Tecnologia' },
  { id: 'max-work',          label: 'Max Work',         grupo: 'Didático' },
];

export const AULA_PRESETS: { nome: string; modulos: string[] }[] = [
  { nome: 'Logística',    modulos: ['cadastros', 'compras', 'estoque'] },
  { nome: 'Vendas + PDV', modulos: ['vendas', 'catalogo-produtos'] },
  { nome: 'Finanças',     modulos: ['financeiro'] },
  { nome: 'RH',           modulos: ['rh'] },
  { nome: 'Marketing',    modulos: ['marketing'] },
  { nome: 'Todos',        modulos: AULA_MODULOS.map(m => m.id) },
  { nome: 'Só Início',    modulos: [] },
];

export const AULA_ROLES_ALVO: { id: string; label: string }[] = [
  { id: 'colaborador', label: 'Colaborador' },
  { id: 'gerente',     label: 'Gerente' },
  { id: 'ceo',         label: 'CEO' },
];

// Espelha exatamente os labels de `menuModules[*].submenus` em App.tsx.
// Se um dia adicionar/remover submenu lá, atualizar aqui também — testes
// visuais na tela de Modo Aula deixam isso óbvio.
export const AULA_SUBMENUS: Record<string, string[]> = {
  empresa:    ['Filiais', 'Formas de pagamento', 'Condições de pagamento', 'Projetos'],
  cadastros:  ['Categorias', 'Produtos', 'Fornecedores', 'Serviços'],
  compras:    ['Requisições', 'Cotações', 'Pedidos', 'Minhas aprovações', 'Recebimentos', 'Notas recebidas', 'Sugestões de compras', 'Gerenciamento', 'Relatórios'],
  estoque:    ['Requisições', 'Minhas Aprovações', 'Expedição', 'Movimentações', 'Saldos', 'Inventários', 'Pedidos de Venda', 'Gerenciamento', 'Relatórios'],
  financeiro: ['Controle de Caixa', 'Contas a receber', 'Contas a pagar', 'Caixa / Bancos', 'Patrimônio', 'Juros & Multa', 'Alçadas', 'Notas Emitidas', 'Aprovações de Cotação', 'Aprovações de Orçamento', 'Aprovações de Promoções', 'Aprovações de Conteúdo', 'Pedidos de Venda', 'Recibos de Vendas', 'Capital', 'Gerenciamento', 'Relatórios'],
  rh:         ['Funcionários', 'Departamentos', 'Cargos', 'Ponto Eletrônico', 'Frequência de Trabalho', 'Férias', 'Afastamentos', 'Folha de Pagamento', 'Benefícios', 'Treinamentos', 'Pesquisas', 'Gerenciamento', 'Relatórios'],
  vendas:     ['PDV', 'Clientes', 'Orçamentos', 'Pedidos de Venda', 'Histórico de Vendas', 'Devoluções', 'Cliente Especial'],
  marketing:  ['Redes Sociais', 'Campanhas', 'Promoções', 'Cupons', 'Calendário'],
  ti:         ['Desenvolvimento com IA'],
  'max-work': ['Docs', 'Planilhas', 'Show'],
};

/** Reproduz o cálculo de viewId dos submenus feito em App.tsx.SidebarNav. */
export function aulaSubmenuId(modId: string, label: string): string {
  return `${modId}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;
}

/**
 * Retorna a whitelist de submenus deste módulo (viewIds), ou null se o
 * módulo não tem restrição (= todos os submenus liberados).
 */
export function aulaSubmenusDoModulo(config: AulaConfig, modId: string): string[] | null {
  const prefixo = `${modId}-`;
  const items = config.submenus_ativos.filter(s => s.startsWith(prefixo));
  return items.length > 0 ? items : null;
}

// Views SEMPRE liberadas quando aula ativa (fail-safe pra não quebrar navegação).
// - 'inicio' e 'aula-modo': sempre.
// - hubs de Matriz e views que só existem em Matriz: admin/CEO já é isento
//   ou tá em contexto onde a trava não faz sentido.
const SEMPRE_LIBERADO = new Set([
  'inicio', 'aula-modo',
  'sessoes-gerais', 'analise-ia', 'comparativos-matriz',
  'painel-bi', 'briefing-diario', 'central-tempo',
]);

const VIEW_TO_MODULO_OVERRIDE: Record<string, string> = {
  // Standalone top-level views (id === modulo)
  'dashboard':         'dashboard',
  'usuarios':          'usuarios',
  'catalogo-produtos': 'catalogo-produtos',
  'avaliacoes':        'avaliacoes',
  'feedback-org':      'feedback-org',
  'metas':             'metas',
  // Aliases pra views top-level que pertencem a um módulo
  'artes-promocionais': 'marketing',
  'minhas-pesquisas':   'rh',
  // max-work-docs / max-work-planilhas seguem regra padrão: split('-')[0]='max',
  // mas queremos que caiam sob 'max-work'. Override explícito abaixo.
  'max-work-docs':       'max-work',
  'max-work-planilhas':  'max-work',
  'max-work-show':       'max-work',
};

/** Retorna o id do módulo a ser checado, ou null se a view é sempre liberada. */
export function aulaViewModuloId(view: string): string | null {
  if (SEMPRE_LIBERADO.has(view)) return null;
  if (view.startsWith('matriz-')) return null;
  if (VIEW_TO_MODULO_OVERRIDE[view]) return VIEW_TO_MODULO_OVERRIDE[view];
  return view.split('-')[0];
}

/** True quando este usuário DEVE ser filtrado pela config atual. */
export function aulaFiltraUsuario(
  config: AulaConfig,
  profile: Pick<UserProfile, 'role'> | null | undefined,
): boolean {
  if (!config.ativo) return false;
  if (!profile) return false;
  if (profile.role === 'admin') return false;  // admin nunca é filtrado
  return config.roles_afetados.includes(profile.role);
}

/** True se a view está permitida pra esse usuário considerando aula. */
export function aulaPermiteView(
  config: AulaConfig,
  profile: Pick<UserProfile, 'role'> | null | undefined,
  view: string,
): boolean {
  if (!aulaFiltraUsuario(config, profile)) return true;
  const mod = aulaViewModuloId(view);
  if (mod === null) return true;
  if (!config.modulos_ativos.includes(mod)) return false;
  // Módulo permitido. Se há whitelist de submenu pra esse módulo, view precisa
  // estar nela. Se view === mod (top-level standalone), sempre libera.
  if (view === mod) return true;
  const submenus = aulaSubmenusDoModulo(config, mod);
  if (submenus === null) return true;  // sem restrição de submenu → todos liberados
  return submenus.includes(view);
}
