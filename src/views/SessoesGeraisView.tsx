import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
const TINTS: Record<TintKey, { icon: string; iconBg: string; iconRing: string; glow: string; hairline: string }> = {
  slate:  { icon: 'text-slate-300',  iconBg: 'bg-slate-500/10',  iconRing: 'ring-slate-500/25',  glow: 'bg-slate-500/20',  hairline: 'border-slate-500/20'  },
  sky:    { icon: 'text-sky-400',    iconBg: 'bg-sky-500/10',    iconRing: 'ring-sky-500/25',    glow: 'bg-sky-500/25',    hairline: 'border-sky-500/25'    },
  blue:   { icon: 'text-blue-400',   iconBg: 'bg-blue-500/10',   iconRing: 'ring-blue-500/25',   glow: 'bg-blue-500/25',   hairline: 'border-blue-500/25'   },
  green:  { icon: 'text-emerald-400',iconBg: 'bg-emerald-500/10',iconRing: 'ring-emerald-500/25',glow: 'bg-emerald-500/25',hairline: 'border-emerald-500/25'},
  purple: { icon: 'text-purple-400', iconBg: 'bg-purple-500/10', iconRing: 'ring-purple-500/25', glow: 'bg-purple-500/25', hairline: 'border-purple-500/25' },
  indigo: { icon: 'text-indigo-400', iconBg: 'bg-indigo-500/10', iconRing: 'ring-indigo-500/25', glow: 'bg-indigo-500/25', hairline: 'border-indigo-500/25' },
  cyan:   { icon: 'text-cyan-400',   iconBg: 'bg-cyan-500/10',   iconRing: 'ring-cyan-500/25',   glow: 'bg-cyan-500/25',   hairline: 'border-cyan-500/25'   },
  teal:   { icon: 'text-teal-400',   iconBg: 'bg-teal-500/10',   iconRing: 'ring-teal-500/25',   glow: 'bg-teal-500/25',   hairline: 'border-teal-500/25'   },
  pink:   { icon: 'text-pink-400',   iconBg: 'bg-pink-500/10',   iconRing: 'ring-pink-500/25',   glow: 'bg-pink-500/25',   hairline: 'border-pink-500/25'   },
  amber:  { icon: 'text-amber-300',  iconBg: 'bg-amber-500/10',  iconRing: 'ring-amber-500/25',  glow: 'bg-amber-500/25',  hairline: 'border-amber-500/25'  },
  red:    { icon: 'text-red-400',    iconBg: 'bg-red-500/10',    iconRing: 'ring-red-500/25',    glow: 'bg-red-500/25',    hairline: 'border-red-500/25'    },
  orange: { icon: 'text-orange-400', iconBg: 'bg-orange-500/10', iconRing: 'ring-orange-500/25', glow: 'bg-orange-500/25', hairline: 'border-orange-500/25' },
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
    kind: 'group', id: 'financeiro-matriz', label: 'Financeiro', icon: DollarSign, color: 'from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-400',
    modulos: [
      { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'text-purple-400',
        submenus: ['Alçadas', 'Gerenciamento', 'Relatórios'] },
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
        submenus: ['Registro de Ponto', 'Gerenciamento', 'Relatórios'] },
    ],
  },
  {
    kind: 'group', id: 'ti-matriz', label: 'TI & Suporte', icon: Monitor, color: 'from-red-500/20 to-red-500/5 border-red-500/30 text-red-400',
    modulos: [
      { id: 'ti', label: 'TI & Suporte', icon: Monitor, color: 'text-red-400',
        submenus: ['Desenvolvimento com IA'] },
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
        submenus: ['Vitrine da Tela de Login'] },
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
type Stage =
  | { kind: 'macros' }
  | { kind: 'modulos'; macro: GroupMacro }
  | { kind: 'submenus'; macro: GroupMacro; modulo: ModuleDef };

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
  // Persistimos o estágio interno em sessionStorage keyado pelo título do hub,
  // pra que o botão Voltar (que traz o usuário de volta pro hub) restaure o
  // breadcrumb onde ele parou — em vez de sempre reabrir na tela de macros.
  const storageKey = `logmax:hub:${title}`;
  const [stage, setStage] = useState<Stage>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return { kind: 'macros' };
      const saved = JSON.parse(raw);
      if (saved.kind === 'modulos') {
        const macro = macros.find(m => m.kind === 'group' && m.id === saved.macroId);
        if (macro && macro.kind === 'group') return { kind: 'modulos', macro };
      }
      if (saved.kind === 'submenus') {
        const macro = macros.find(m => m.kind === 'group' && m.id === saved.macroId);
        if (macro && macro.kind === 'group') {
          const modulo = macro.modulos.find(m => m.id === saved.moduloId);
          if (modulo) return { kind: 'submenus', macro, modulo };
        }
      }
    } catch {}
    return { kind: 'macros' };
  });
  useEffect(() => {
    try {
      const s =
        stage.kind === 'macros'   ? { kind: 'macros' } :
        stage.kind === 'modulos'  ? { kind: 'modulos',  macroId: stage.macro.id } :
                                    { kind: 'submenus', macroId: stage.macro.id, moduloId: stage.modulo.id };
      sessionStorage.setItem(storageKey, JSON.stringify(s));
    } catch {}
  }, [stage, storageKey]);
  // Registra um back handler enquanto o hub estiver em nível interno; assim o
  // botão Voltar do topbar consome uma etapa do breadcrumb antes de sair da
  // view. Em macros o handler é nulo e o Voltar segue o fluxo normal (view
  // anterior). Também considera que grupos com 1 módulo pulam a etapa modulos.
  useEffect(() => {
    if (!registerBackHandler) return;
    if (stage.kind === 'macros') { registerBackHandler(null); return; }
    registerBackHandler(() => {
      if (stage.kind === 'submenus') {
        if (stage.macro.modulos.length === 1) setStage({ kind: 'macros' });
        else setStage({ kind: 'modulos', macro: stage.macro });
        return true;
      }
      if (stage.kind === 'modulos') {
        setStage({ kind: 'macros' });
        return true;
      }
      return false;
    });
    return () => registerBackHandler(null);
  }, [stage, registerBackHandler]);

  // Filtro por setor: para group macros, mantém só módulos que o setor acessa
  const allowedModuleIds = useMemo(() => new Set(
    allSetores(profile).flatMap(s => SETOR_MODULES[String(s)] ?? []),
  ), [profile]);

  const macrosVisiveis = useMemo<MacroDef[]>(() =>
    macros.map(m => {
      if (m.kind === 'leaf') return m;
      const modulos = m.modulos.filter(md => allowedModuleIds.has(md.id));
      return { ...m, modulos };
    }).filter(m => m.kind === 'leaf' || m.modulos.length > 0),
  [macros, allowedModuleIds]);

  const moduleBadge = (mod: ModuleDef) =>
    mod.submenus.reduce((acc, s) => acc + (badges[`${mod.id}-${slug(subLabel(s))}`] ?? 0), 0);
  const macroBadge = (macro: MacroDef) =>
    macro.kind === 'leaf' ? (badges[macro.viewId] ?? 0) : macro.modulos.reduce((acc, m) => acc + moduleBadge(m), 0);

  const handleMacroClick = (macro: MacroDef) => {
    if (macro.kind === 'leaf') { navigate(macro.viewId); return; }
    if (macro.modulos.length === 1) {
      setStage({ kind: 'submenus', macro, modulo: macro.modulos[0] });
    } else {
      setStage({ kind: 'modulos', macro });
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setStage({ kind: 'macros' })}
          className={`font-bold transition-colors ${stage.kind === 'macros' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}
        >
          {title}
        </button>
        {stage.kind !== 'macros' && (
          <>
            <ChevronRight size={14} className="text-gray-600" />
            <button
              onClick={() => stage.kind === 'submenus' ? setStage({ kind: 'modulos', macro: stage.macro }) : null}
              className={`font-bold transition-colors ${stage.kind === 'modulos' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {stage.macro.label}
            </button>
          </>
        )}
        {stage.kind === 'submenus' && (
          <>
            <ChevronRight size={14} className="text-gray-600" />
            <span className="font-bold text-accent">{stage.modulo.label}</span>
          </>
        )}
      </div>

      <AnimatePresence mode="wait">
        {stage.kind === 'macros' && (
          <motion.div
            key="macros"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {macrosVisiveis.map(macro => {
              const total = macroBadge(macro);
              const Icon = macro.icon;
              const tint = pickTint(macro.color);
              const chips = macro.kind === 'leaf'
                ? []
                : macro.modulos.flatMap(m => m.submenus.filter(s => subPermitido(s, profile)).map(subLabel));
              return (
                <button
                  key={macro.id}
                  onClick={() => handleMacroClick(macro)}
                  className="relative neu-flat rounded-2xl p-6 text-left overflow-hidden group hover:border-accent/40 hover:ring-1 hover:ring-accent/25 transition-all"
                >
                  {/* Halo colorido no canto — dá identidade sem apelar pra gradient washed */}
                  <div className={`pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full blur-3xl opacity-60 ${tint.glow}`} />

                  <div className="relative flex items-start justify-between gap-4 mb-5">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-1 ${tint.iconBg} ${tint.iconRing}`}>
                      <Icon size={22} strokeWidth={1.8} className={tint.icon} />
                    </div>
                    <div className="flex items-center gap-2">
                      {total > 0 && (
                        <span className="text-[10px] font-black px-2 py-1 rounded-full bg-red-500/15 text-red-300 ring-1 ring-red-500/30">
                          {total} pend.
                        </span>
                      )}
                      <ChevronRight size={16} className="text-gray-600 group-hover:text-accent transition-colors" />
                    </div>
                  </div>

                  <div className="relative">
                    <h3 className="text-lg font-black text-gray-100 tracking-tight">{macro.label}</h3>
                    {macro.kind === 'leaf' && macro.description && (
                      <p className="text-xs text-gray-400 mt-1 leading-snug">{macro.description}</p>
                    )}
                    {chips.length > 0 && (
                      <div className={`mt-4 pt-3 border-t ${tint.hairline} flex flex-wrap gap-1.5`}>
                        {chips.slice(0, 5).map(c => (
                          <span key={c} className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-400 ring-1 ring-white/5">
                            {c}
                          </span>
                        ))}
                        {chips.length > 5 && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-500 ring-1 ring-white/5">
                            +{chips.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}

        {stage.kind === 'modulos' && (
          <motion.div
            key="modulos"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {stage.macro.modulos.map(mod => {
              const Icon = mod.icon;
              const b = moduleBadge(mod);
              const tint = pickTint(mod.color);
              const submenusVisiveis = mod.submenus.filter(s => subPermitido(s, profile));
              return (
                <button
                  key={mod.id}
                  onClick={() => setStage({ kind: 'submenus', macro: stage.macro, modulo: mod })}
                  className="relative neu-flat rounded-2xl p-5 text-left overflow-hidden group hover:border-accent/40 hover:ring-1 hover:ring-accent/20 transition-all"
                >
                  <div className={`pointer-events-none absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-50 ${tint.glow}`} />

                  <div className="relative flex items-start justify-between gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${tint.iconBg} ${tint.iconRing}`}>
                      <Icon size={18} strokeWidth={1.8} className={tint.icon} />
                    </div>
                    <div className="flex items-center gap-2">
                      {b > 0 && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 ring-1 ring-red-500/30">
                          {b}
                        </span>
                      )}
                      <ChevronRight size={14} className="text-gray-600 group-hover:text-accent transition-colors" />
                    </div>
                  </div>

                  <div className="relative">
                    <h4 className="text-base font-black text-gray-100 tracking-tight">{mod.label}</h4>
                    <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mt-0.5">
                      {submenusVisiveis.length} submódulo{submenusVisiveis.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}

        {stage.kind === 'submenus' && (() => {
          const ModIcon = stage.modulo.icon;
          const tint = pickTint(stage.modulo.color);
          return (
          <motion.div
            key="submenus"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {stage.modulo.submenus
              .filter(s => subPermitido(s, profile))
              .map(s => {
                const label = subLabel(s);
                const viewId = `${stage.modulo.id}-${slug(label)}`;
                const b = badges[viewId] ?? 0;
                return (
                  <button
                    key={label}
                    onClick={() => navigate(viewId)}
                    className="relative neu-flat rounded-2xl p-5 text-left overflow-hidden group hover:border-accent/40 hover:ring-1 hover:ring-accent/20 transition-all"
                  >
                    <div className={`pointer-events-none absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-50 ${tint.glow}`} />

                    <div className="relative flex items-start justify-between gap-3 mb-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${tint.iconBg} ${tint.iconRing}`}>
                        <ModIcon size={18} strokeWidth={1.8} className={tint.icon} />
                      </div>
                      <div className="flex items-center gap-2">
                        {b > 0 && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 ring-1 ring-red-500/30">
                            {b} pend.
                          </span>
                        )}
                        <ChevronRight size={14} className="text-gray-600 group-hover:text-accent transition-colors" />
                      </div>
                    </div>

                    <div className="relative">
                      <h4 className="text-base font-black text-gray-100 tracking-tight group-hover:text-accent transition-colors">{label}</h4>
                      <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mt-0.5">
                        {stage.modulo.label}
                      </p>
                    </div>
                  </button>
                );
              })}
          </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
