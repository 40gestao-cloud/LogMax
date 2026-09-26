import React, { useMemo, useEffect } from 'react';
import {
  Package, DollarSign, Users, Building2,
  Database, ShoppingCart, Megaphone, Monitor, Brain, ListTodo, TrendingUp,
  ChevronRight, Store,
} from 'lucide-react';
import { allSetores } from '../lib/rbac';
import { SETOR_MODULES } from '../lib/sectorAccess';
import type { UserProfile } from '../hooks/useUserProfile';

// ── Tipos ──────────────────────────────────────────────────────────────────
type SubItem = { label: string; requireRole?: string[]; requireSetor?: string[] };
type SubmenuLike = string | SubItem;

type ModuleDef = { id: string; label: string; icon: any; submenus: SubmenuLike[]; color: string };
type GroupMacro = { kind: 'group'; id: string; label: string; icon: any; color: string; modulos: ModuleDef[] };
type LeafMacro  = { kind: 'leaf';  id: string; label: string; icon: any; color: string; viewId: string; description?: string };
export type MacroDef = GroupMacro | LeafMacro;

const slug = (s: string) => s.toLowerCase().replace(/ /g, '').replace(/\//g, '');
const subLabel = (s: SubmenuLike) => (typeof s === 'string' ? s : s.label);

// Paleta de tints — mapeada a partir do primeiro token de cor de MacroDef.color.
// Classes listadas explicitamente pra o JIT do Tailwind gerar tudo.
type TintKey = 'slate'|'sky'|'blue'|'green'|'purple'|'indigo'|'cyan'|'teal'|'pink'|'amber'|'red'|'orange';
const TINTS: Record<TintKey, { icon: string; iconBg: string; iconRing: string; glow: string; hairline: string; bar: string }> = {
  slate:  { icon: 'text-slate-300',  iconBg: 'bg-slate-500/10',  iconRing: 'ring-slate-500/25',  glow: 'bg-slate-500/20',  hairline: 'border-slate-500/20', bar: 'bg-slate-400'  },
  sky:    { icon: 'text-sky-400',    iconBg: 'bg-sky-500/10',    iconRing: 'ring-sky-500/25',    glow: 'bg-sky-500/25',    hairline: 'border-sky-500/25', bar: 'bg-sky-500'    },
  blue:   { icon: 'text-blue-400',   iconBg: 'bg-blue-500/10',   iconRing: 'ring-blue-500/25',   glow: 'bg-blue-500/25',   hairline: 'border-blue-500/25', bar: 'bg-blue-500'   },
  green:  { icon: 'text-emerald-400',iconBg: 'bg-emerald-500/10',iconRing: 'ring-emerald-500/25',glow: 'bg-emerald-500/25',hairline: 'border-emerald-500/25', bar: 'bg-emerald-500'},
  purple: { icon: 'text-purple-400', iconBg: 'bg-purple-500/10', iconRing: 'ring-purple-500/25', glow: 'bg-purple-500/25', hairline: 'border-purple-500/25', bar: 'bg-purple-500' },
  indigo: { icon: 'text-indigo-400', iconBg: 'bg-indigo-500/10', iconRing: 'ring-indigo-500/25', glow: 'bg-indigo-500/25', hairline: 'border-indigo-500/25', bar: 'bg-indigo-500' },
  cyan:   { icon: 'text-cyan-400',   iconBg: 'bg-cyan-500/10',   iconRing: 'ring-cyan-500/25',   glow: 'bg-cyan-500/25',   hairline: 'border-cyan-500/25', bar: 'bg-cyan-500'   },
  teal:   { icon: 'text-teal-400',   iconBg: 'bg-teal-500/10',   iconRing: 'ring-teal-500/25',   glow: 'bg-teal-500/25',   hairline: 'border-teal-500/25', bar: 'bg-teal-500'   },
  pink:   { icon: 'text-pink-400',   iconBg: 'bg-pink-500/10',   iconRing: 'ring-pink-500/25',   glow: 'bg-pink-500/25',   hairline: 'border-pink-500/25', bar: 'bg-pink-500'   },
  amber:  { icon: 'text-amber-300',  iconBg: 'bg-amber-500/10',  iconRing: 'ring-amber-500/25',  glow: 'bg-amber-500/25',  hairline: 'border-amber-500/25', bar: 'bg-amber-500'  },
  red:    { icon: 'text-red-400',    iconBg: 'bg-red-500/10',    iconRing: 'ring-red-500/25',    glow: 'bg-red-500/25',    hairline: 'border-red-500/25', bar: 'bg-red-500'    },
  orange: { icon: 'text-orange-400', iconBg: 'bg-orange-500/10', iconRing: 'ring-orange-500/25', glow: 'bg-orange-500/25', hairline: 'border-orange-500/25', bar: 'bg-orange-500' },
};
function pickTint(color: string): typeof TINTS[TintKey] {
  const m = color.match(/(?:from-|text-)([a-z]+)-/);
  const raw = (m?.[1] ?? 'slate') as string;
  const key = (raw === 'emerald' ? 'green' : raw) as TintKey;
  return TINTS[key] ?? TINTS.slate;
}
const subPermitido = (s: SubmenuLike, profile: UserProfile | null) => {
  if (typeof s === 'string') return true;
  if (s.requireRole && !s.requireRole.includes(profile?.role ?? '')) return false;
  if (s.requireSetor) {
    if (profile?.role === 'admin' || profile?.role === 'ceo') return true;
    const setores = [profile?.setor, ...(profile?.setores_extras ?? [])].filter(Boolean);
    if (!s.requireSetor.some(sec => (setores as string[]).includes(sec))) return false;
  }
  return true;
};

// ── Configurações dos 3 hubs (todos usados só em modo Matriz) ─────────────
// Submenus reduzidos (Gerenciamento/Relatórios/Comparativos).
//
// Esta lista É o menu da Matriz — não há outra a manter em sync. Havia um
// lib/matrizMenu.ts com um mapa MATRIZ_ALLOWED_SUBMENUS que ninguém lia
// (App.tsx importava sem usar) e que já apontava para submenu extinto;
// removido em 2026-07-29 para não haver duas fontes, uma delas falsa.
export const SESSOES_MATRIZ_MACROS: MacroDef[] = [
  {
    // Formas/Condições/Projetos/Tarefas são filialScoped (todas têm coluna
    // filial no schema) — em Matriz virariam consolidado read-only, escopo
    // que não temos ainda. Fica só Filiais (agora consolidado das 4 unidades)
    // e Cliente Especial, que é decisão de holding do admin/CEO.
    kind: 'group', id: 'empresa-macro', label: 'Empresa', icon: Building2, color: 'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-300',
    modulos: [
      { id: 'empresa', label: 'Empresa', icon: Building2, color: 'text-amber-300',
        submenus: ['Filiais'] },
      { id: 'vendas', label: 'Governança', icon: Users, color: 'text-amber-300',
        submenus: ['Cliente Especial'] },
    ],
  },
  {
    // Cadastros (Categorias/Produtos/Serviços) também são filialScoped — sem
    // consolidado read-only, sai do hub. Compras/Estoque mantêm só Gerenciamento
    // e Relatórios (que já leem consolidado).
    kind: 'group', id: 'logistica-matriz', label: 'Logística', icon: Package, color: 'from-green-500/20 to-green-500/5 border-green-500/30 text-green-400',
    modulos: [
      { id: 'compras', label: 'Compras', icon: ShoppingCart, color: 'text-green-400',
        submenus: ['Gerenciamento', 'Relatórios'] },
      { id: 'estoque', label: 'Estoque', icon: Package, color: 'text-green-400',
        submenus: ['Gerenciamento', 'Relatórios'] },
    ],
  },
  {
    // Contas a pagar/receber entram aqui em 2026-08-01: a Matriz sempre teve
    // lançamentos próprios — `contas_pagar`/`contas_receber` nascem com
    // `filial = 'Matriz'` por DEFAULT desde a migr. 053 — e nunca teve tela
    // para eles. A holding paga a folha da diretoria e cobra das unidades o
    // rateio do custo corporativo; sem estes dois submenus, os dois lados do
    // par intercompany ficavam invisíveis.
    kind: 'group', id: 'financeiro-matriz', label: 'Financeiro', icon: DollarSign, color: 'from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-400',
    modulos: [
      { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'text-purple-400',
        // 'Caixa / Bancos' entra em 2026-08-01, junto com a convenção
        // `caixa_bancos.filial = 'Matriz'` (migr. 325). Sem ele a holding
        // tinha conta a pagar e capital próprio mas nenhuma conta de onde
        // debitar — o seletor de origem da baixa só oferecia caixa das
        // unidades, e pagar a folha da diretoria saía do bolso da filial.
        submenus: [
          'Contas a pagar', 'Contas a receber', 'Caixa / Bancos',
          { label: 'Rateio Administrativo', requireRole: ['admin', 'ceo', 'conselheiro'] },
          'Alçadas', 'Gerenciamento', 'Relatórios',
        ] },
    ],
  },
  {
    kind: 'group', id: 'rh-matriz', label: 'Recursos Humanos', icon: Users, color: 'from-blue-500/20 to-blue-500/5 border-blue-500/30 text-blue-400',
    modulos: [
      // 'Frequência de Trabalho' virou aba de Registro de Ponto (2026-07-29).
      // O que a Matriz vinha buscar aqui é o painel de cumprimento por
      // unidade, que mora na aba de lançamento manual — por isso a view abre
      // direto nela quando não há filial ativa.
      { id: 'rh', label: 'RH', icon: Users, color: 'text-blue-400',
        // 'Recrutamento e Seleção' abre a mesma view da filial (migrs. 311/312):
        // sem filial ativa ela mostra a fila de aprovação de headcount das 3
        // unidades e deixa abrir/conduzir o processo interno inter-filiais,
        // que é movimentação entre unidades — só a Matriz pode.
        //
        // 'Funcionários' e 'Folha de Pagamento' entram em 2026-08-01. A Matriz
        // é o empregador de admin, CEO e conselheiro — os cargos de holding
        // sempre foram lotados nela (migr. 315) —, mas a folha só existia
        // dentro de uma filial. Na prática a diretoria trabalhava de graça: sem
        // folha não há conta a pagar, sem conta a pagar não há custo
        // corporativo, e sem custo corporativo não há o que ratear.
        //
        // Cargos e Departamentos vêm junto porque as duas telas passaram a ser
        // escopadas por unidade no mesmo dia: sem elas aqui, o cargo da
        // diretoria não teria onde ser cadastrado e o salário-base não
        // apareceria no formulário de Funcionários da Matriz.
        submenus: [
          'Funcionários',
          { label: 'Departamentos', requireSetor: ['rh'] },
          { label: 'Cargos', requireSetor: ['rh'] },
          { label: 'Folha de Pagamento', requireSetor: ['rh'] },
          'Registro de Ponto', 'Recrutamento e Seleção', 'Gerenciamento', 'Relatórios',
        ] },
    ],
  },
  {
    kind: 'group', id: 'ti-matriz', label: 'TI & Suporte', icon: Monitor, color: 'from-red-500/20 to-red-500/5 border-red-500/30 text-red-400',
    modulos: [
      { id: 'ti', label: 'TI & Suporte', icon: Monitor, color: 'text-red-400',
        // 'Relógio das Máquinas' entra em 2026-08-28. Uma estação com o relógio
        // adiantado fazia o token de sessão nascer vencido, renovava em laço e
        // estourava o limite por IP — derrubando de volta pro login a turma
        // inteira daquela rede. O app deixou de depender do relógio local
        // (`lib/horaServidor.ts`); aqui é onde se vê QUAL máquina está fora de
        // hora, sem depender de aluno relatando sintoma.
        submenus: ['Desenvolvimento com IA', 'Relógio das Máquinas'] },
    ],
  },
  {
    // Marketing na Matriz — institucional da holding. A vitrine da tela de
    // login é uma só, então quem controla é a Matriz. Em filial o submenu
    // não aparece mais (removido do menuModules em App.tsx).
    //
    // O rótulo diz "Tela de Login" desde 2026-07-29 porque "Vitrine Pública"
    // colidia com a "Vitrine da loja" de Vendas → Pedidos Online: alguém
    // publicou produto aqui esperando que ele aparecesse na loja online da
    // filial, e ficou horas sem entender por que nada acontecia. São duas
    // perguntas diferentes (`vitrine_publica` × `loja_online`, migr. 294) e
    // agora cada tela diz no título qual delas responde.
    kind: 'group', id: 'marketing-matriz', label: 'Marketing', icon: Megaphone, color: 'from-pink-500/20 to-pink-500/5 border-pink-500/30 text-pink-400',
    modulos: [
      { id: 'marketing', label: 'Marketing', icon: Store, color: 'text-pink-400',
        submenus: [
          'Vitrine da Tela de Login',
          // Os limites da turma (migr. 539/540). `requireRole` admin literal:
          // CEO e conselheiro são alunos, e estes números os limitam.
          { label: 'Configurações', requireRole: ['admin'] },
        ] },
    ],
  },
  // Leaf — vai direto pro Relatório de Vendas (Orçamentos/Pedidos/Histórico
  // em abas). PDVView/OrcamentosView/PedidosVendaView/HistoricoVendasView
  // exigem filialAtiva (operação do dia a dia), não servem em Matriz —
  // esta tela é o consolidado read-only das 3 unidades.
  {
    kind: 'leaf', id: 'relatorio-vendas', label: 'Vendas', icon: TrendingUp,
    color: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30 text-cyan-400',
    viewId: 'relatorio-vendas',
    description: 'Orçamentos, Pedidos de Venda e Histórico das 3 unidades',
  },
];

// Hub Análise com IA (Matriz only) — cards que navegam direto
export const ANALISE_IA_MACROS: MacroDef[] = [
  {
    kind: 'leaf', id: 'painel-bi', label: 'Painel de BI', icon: Brain,
    color: 'from-orange-500/20 to-orange-500/5 border-orange-500/30 text-orange-400',
    viewId: 'painel-bi',
    description: 'Relatórios executivos com IA por setor',
  },
  {
    kind: 'leaf', id: 'briefing-diario', label: 'Briefing Diário', icon: ListTodo,
    color: 'from-red-500/20 to-red-500/5 border-red-500/30 text-red-400',
    viewId: 'briefing-diario',
    description: 'Pauta diária proposta pela IA por setor',
  },
];

// ── UI ─────────────────────────────────────────────────────────────────────
// Um cartão por área com as telas dentro, clicáveis direto. Antes eram três
// níveis (área → módulo → tela) e os chips do cartão pareciam botões sem ser.
export function HubView({
  title,
  macros,
  profile,
  navigate,
  badges = {},
  registerBackHandler,
}: {
  title: string;
  macros: MacroDef[];
  profile: UserProfile | null;
  navigate: (viewId: string) => void;
  badges?: Record<string, number>;
  registerBackHandler?: (h: (() => boolean) | null) => void;
}) {
  // Sem etapas internas: o Voltar segue o fluxo normal da navegação.
  useEffect(() => { registerBackHandler?.(null); }, [registerBackHandler]);

  // Filtro por setor: para group macros, mantém só módulos que o setor acessa
  const allowedModuleIds = useMemo(() => new Set(
    allSetores(profile).flatMap(s => SETOR_MODULES[String(s)] ?? []),
  ), [profile]);

  const macrosVisiveis = useMemo<MacroDef[]>(() =>
    macros.map(m => {
      if (m.kind === 'leaf') return m;
      const modulos = m.modulos
        .filter(md => allowedModuleIds.has(md.id))
        .map(md => ({ ...md, submenus: md.submenus.filter(s => subPermitido(s, profile)) }))
        .filter(md => md.submenus.length > 0);
      return { ...m, modulos };
    }).filter(m => m.kind === 'leaf' || m.modulos.length > 0),
  [macros, allowedModuleIds, profile]);

  const badgeDe = (viewId: string) => badges[viewId] ?? 0;
  const totalDe = (macro: MacroDef) =>
    macro.kind === 'leaf' ? badgeDe(macro.viewId)
      : macro.modulos.reduce((acc, md) =>
          acc + md.submenus.reduce((a, s) => a + badgeDe(`${md.id}-${slug(subLabel(s))}`), 0), 0);

  const Linha = ({ label, viewId, tint }: { label: string; viewId: string; tint: typeof TINTS[TintKey] }) => {
    const b = badgeDe(viewId);
    return (
      <button type="button" onClick={() => navigate(viewId)}
        className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-white/[0.05]">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tint.bar}`} />
        <span className="flex-1 min-w-0 text-sm font-semibold text-gray-200 truncate group-hover:text-accent transition-colors">{label}</span>
        {b > 0 && (
          <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-black tabular-nums flex items-center justify-center">
            {b}
          </span>
        )}
        <ChevronRight size={15} className="shrink-0 text-gray-600 group-hover:text-accent transition-colors" />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-5 pb-16">
      <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{title}</h2>

      {/* Mural: cada cartão tem a altura do que tem dentro, sem buracos na grade. */}
      <div className="columns-1 md:columns-2 2xl:columns-3 gap-4">
        {macrosVisiveis.map(macro => {
          const Icon = macro.icon;
          const tint = pickTint(macro.color);
          const total = totalDe(macro);
          const varios = macro.kind === 'group' && macro.modulos.length > 1;
          return (
            <section key={macro.id}
              className={`break-inside-avoid mb-4 neu-flat rounded-2xl border border-white/5 overflow-hidden relative ${
                macro.kind === 'leaf' ? 'group transition-colors hover:border-accent/40' : ''}`}>
              <div className={`h-1 ${tint.bar}`} />
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tint.iconBg}`}>
                  <Icon size={19} strokeWidth={2} className={tint.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-black text-gray-100 tracking-tight">{macro.label}</h3>
                  {macro.kind === 'leaf' && macro.description && (
                    <p className="text-xs text-gray-500 truncate">{macro.description}</p>
                  )}
                </div>
                {total > 0 && (
                  <span className="shrink-0 px-2 py-1 rounded-lg bg-red-600 text-white text-[11px] font-black tabular-nums">
                    {total} pend.
                  </span>
                )}
                {macro.kind === 'leaf' && (
                  <button type="button" onClick={() => navigate(macro.viewId)} aria-label={`Abrir ${macro.label}`}
                    className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                )}
                {macro.kind === 'leaf' && <ChevronRight size={16} className="shrink-0 text-gray-500 group-hover:text-accent transition-colors" />}
              </div>

              {macro.kind === 'group' && (
              <div className="px-2 pb-2 flex flex-col">
                {macro.modulos.map(md => (
                  <div key={md.id} className="flex flex-col">
                    {varios && (
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">{md.label}</p>
                    )}
                    {md.submenus.map(s => {
                      const label = subLabel(s);
                      return <Linha key={label} label={label} viewId={`${md.id}-${slug(label)}`} tint={tint} />;
                    })}
                  </div>
                ))}
              </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
