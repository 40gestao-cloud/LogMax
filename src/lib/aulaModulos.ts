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
  { id: 'requisicoes',       label: 'Requisições',      grupo: 'Operacional' },
  { id: 'cadastros',         label: 'Cadastros',        grupo: 'Logística' },
  { id: 'compras',           label: 'Compras',          grupo: 'Logística' },
  { id: 'estoque',           label: 'Estoque',          grupo: 'Logística' },
  { id: 'financeiro',        label: 'Financeiro',       grupo: 'Finanças' },
  { id: 'rh',                label: 'Recursos Humanos', grupo: 'Pessoas' },
  { id: 'vendas',            label: 'Vendas',           grupo: 'Comercial' },
  { id: 'marketing',         label: 'Marketing',        grupo: 'Comercial' },
  { id: 'ti',                label: 'TI & Suporte',     grupo: 'Tecnologia' },
  { id: 'max-show',          label: 'Max Show',         grupo: 'Didático' },
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

// `id` é comparado direto com `user_profiles.role` — tanto aqui no front
// (`aulaFiltraUsuario`) quanto na RLS da migr. 317. Por isso 'conselheiro'
// alcança só quem tem a role pura: o gerente com `is_conselheiro = true`
// segue caindo pela linha 'gerente', que é a role dele no banco.
export const AULA_ROLES_ALVO: { id: string; label: string; hint?: string }[] = [
  { id: 'colaborador', label: 'Colaborador' },
  { id: 'gerente',     label: 'Gerente' },
  { id: 'ceo',         label: 'CEO' },
  { id: 'conselheiro', label: 'Conselheiro', hint: 'Só a role pura — gerente-conselheiro entra por "Gerente".' },
];

// Espelha exatamente os labels de `menuModules[*].submenus` em App.tsx.
// Se um dia adicionar/remover submenu lá, atualizar aqui também — testes
// visuais na tela de Modo Aula deixam isso óbvio.
export const AULA_SUBMENUS: Record<string, string[]> = {
  empresa:     ['Filiais', 'Formas de pagamento', 'Condições de pagamento', 'Projetos'],
  requisicoes: ['Do Setor', 'Aprovações'],
  cadastros:  ['Categorias', 'Produtos', 'Fornecedores', 'Serviços'],
  compras:    ['Requisições de Compra', 'Cotações', 'Pedidos', 'Notas recebidas', 'Sugestões de compras', 'Gerenciamento', 'Relatórios'],
  estoque:    ['Requisições de Material', 'Liberar Requisições', 'Recebimentos', 'Expedição', 'Movimentações', 'Saldos', 'Inventários', 'Pedidos de Venda', 'Gerenciamento', 'Relatórios'],
  financeiro: ['Controle de Caixa', 'Contas a receber', 'Contas a pagar', 'Caixa / Bancos', 'Patrimônio', 'Centros de Custo', 'Orçamento Anual', 'Prestação de Contas', 'Juros & Multa', 'Alçadas', 'Notas Emitidas', 'Aprovações de Cotação', 'Aprovações de Orçamento', 'Aprovações de Promoções', 'Aprovações de Conteúdo', 'Pedidos de Venda', 'Recibos de Vendas', 'Capital', 'Destinação do Resultado', 'Gerenciamento', 'Relatórios'],
  rh:         ['Funcionários', 'Departamentos', 'Cargos', 'Registro de Ponto', 'Férias', 'Afastamentos', 'Desligamento', 'Recrutamento e Seleção', 'Folha de Pagamento', 'Mandatos', 'Benefícios', 'Treinamentos', 'Pesquisas', 'Gerenciamento', 'Relatórios'],
  vendas:     ['PDV', 'Clientes', 'Orçamentos', 'Pedidos de Venda', 'Pedidos Online', 'Histórico de Vendas', 'Devoluções'],
  marketing:  ['Redes Sociais', 'Campanhas', 'Promoções', 'Cupons', 'Calendário'],
  ti:         ['Desenvolvimento com IA'],
  // `max-show` fica FORA daqui de propósito: virou view top-level sem submenu, e
  // módulo sem submenu não entra em AULA_SUBMENUS — a whitelist é por submenu.
};

/** Reproduz o cálculo de viewId dos submenus feito em App.tsx.SidebarNav. */
export function aulaSubmenuId(modId: string, label: string): string {
  return `${modId}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;
}

// Submenus que mudaram de nome ou de módulo: a config gravada no banco guarda
// o viewId antigo, e a tela ficaria invisível na turma cujo professor já
// montou a whitelist — o mesmo bug que a 26fc1bc consertou. Traduzir na
// leitura é mais seguro que migrar a coluna: não depende de rodar SQL em 4
// projetos, e não quebra se um deles ficar para trás.
const AULA_SUBMENU_ALIAS: Record<string, string> = {
  // Requisições saiu de Empresa e virou módulo próprio (2026-07-28).
  'empresa-minhasrequisições': 'requisicoes-dosetor',
  'empresa-requisições':       'requisicoes-dosetor',
  'empresa-aprovações':        'requisicoes-aprovações',
  // 'Requisições Recebidas' era o mesmo rótulo em Compras e Estoque.
  'compras-requisiçõesrecebidas': 'compras-requisiçõesdecompra',
  'estoque-requisiçõesrecebidas': 'estoque-requisiçõesdematerial',
  // Ponto Eletrônico + Frequência de Trabalho viraram Registro de Ponto,
  // com os dois modos de entrada como abas (2026-07-29). Os dois viewIds
  // antigos convergem: quem liberou qualquer um dos dois liberou o novo.
  'rh-pontoeletrônico':      'rh-registrodeponto',
  'rh-frequênciadetrabalho': 'rh-registrodeponto',
};

// Módulos que se desmembraram: quem liberou o módulo antigo liberou junto o
// que morava dentro dele. Sem esta herança, toda turma com 'empresa' na
// whitelist perderia Requisições de uma vez — a trava esconderia um módulo
// que o professor tinha, de fato, liberado.
//
// Só concede, nunca tira: se 'requisicoes' já está na config, isto não faz
// diferença nenhuma.
const AULA_MODULO_HERDADO: Record<string, string> = {
  requisicoes: 'empresa',
};

/**
 * Retorna a whitelist de submenus deste módulo (viewIds), ou null se o
 * módulo não tem restrição (= todos os submenus liberados).
 */
export function aulaSubmenusDoModulo(config: AulaConfig, modId: string): string[] | null {
  const prefixo = `${modId}-`;
  const items = config.submenus_ativos
    .map(s => AULA_SUBMENU_ALIAS[s] ?? s)
    .filter(s => s.startsWith(prefixo));
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
  // A regra padrão faria split('-')[0]='max', que não é módulo nenhum — daí o
  // override. A rota antiga fica mapeada junto porque `activeView` vive no
  // sessionStorage e sobrevive ao deploy.
  'max-show':      'max-show',
  'max-work-show': 'max-show',
};

/** Retorna o id do módulo a ser checado, ou null se a view é sempre liberada. */
export function aulaViewModuloId(view: string): string | null {
  if (SEMPRE_LIBERADO.has(view)) return null;
  if (view.startsWith('matriz-')) return null;
  if (VIEW_TO_MODULO_OVERRIDE[view]) return VIEW_TO_MODULO_OVERRIDE[view];
  return view.split('-')[0];
}

// Módulo da sidebar → setores que ele exige na RLS. ESPELHA
// `aula_setores_do_modulo()` da migr. 317: se mudar aqui, mudar lá, senão a
// UI libera um botão que o banco recusa (ou o contrário).
//
// Módulos abertos a todo setor (empresa, requisicoes) e views sem setor próprio
// (dashboard, metas, catálogo, avaliações, feedback-org, usuarios, max-show)
// não concedem nada — já são acessíveis sem setor específico.
export const AULA_MODULO_SETORES: Record<string, string[]> = {
  cadastros:  ['logistica', 'compras'],
  compras:    ['compras', 'logistica'],
  estoque:    ['logistica', 'estoque'],
  financeiro: ['financeiro'],
  rh:         ['rh'],
  vendas:     ['vendas'],
  marketing:  ['marketing'],
  ti:         ['ti'],
};

/**
 * Setores que a aula concede a este usuário agora. Vazio quando a aula está
 * desligada ou o role não está no alvo — aí `hasSetor` volta ao normal.
 */
export function aulaSetoresConcedidos(
  config: AulaConfig,
  profile: Pick<UserProfile, 'role'> | null | undefined,
): string[] {
  if (!aulaFiltraUsuario(config, profile)) return [];
  const setores = new Set<string>();
  for (const mod of config.modulos_ativos) {
    for (const s of AULA_MODULO_SETORES[mod] ?? []) setores.add(s);
  }
  return Array.from(setores);
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
  const herdado = AULA_MODULO_HERDADO[mod];
  const moduloAtivo = config.modulos_ativos.includes(mod)
    || (herdado !== undefined && config.modulos_ativos.includes(herdado));
  if (!moduloAtivo) return false;
  // Módulo permitido. Se há whitelist de submenu pra esse módulo, view precisa
  // estar nela. Se view === mod (top-level standalone), sempre libera.
  if (view === mod) return true;
  const submenus = aulaSubmenusDoModulo(config, mod);
  if (submenus === null) return true;  // sem restrição de submenu → todos liberados
  return submenus.includes(view);
}
