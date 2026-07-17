import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Package, DollarSign, Users, Building2,
  Database, ShoppingCart, Megaphone, Monitor, Brain, ListTodo,
  ChevronRight,
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
// Mantém em sync com MATRIZ_ALLOWED_SUBMENUS de lib/matrizMenu.ts.
export const SESSOES_MATRIZ_MACROS: MacroDef[] = [
  {
    // Formas/Condições/Projetos/Tarefas são filialScoped (todas têm coluna
    // filial no schema) — em Matriz virariam consolidado read-only, escopo
    // que não temos ainda. Fica só Filiais (agora consolidado das 4 unidades)
    // e Cliente Especial, que é decisão de holding do admin/CEO.
    kind: 'group', id: 'empresa-macro', label: 'Empresa', icon: Building2, color: 'from-slate-500/20 to-slate-500/5 border-slate-500/30 text-slate-300',
    modulos: [
      { id: 'empresa', label: 'Empresa', icon: Building2, color: 'text-slate-300',
        submenus: ['Filiais'] },
      { id: 'vendas', label: 'Governança', icon: Users, color: 'text-slate-300',
        submenus: ['Cliente Especial'] },
    ],
  },
  {
    // Cadastros (Categorias/Produtos/Serviços) também são filialScoped — sem
    // consolidado read-only, sai do hub. Compras/Estoque mantêm só Gerenciamento
    // e Relatórios (que já leem consolidado).
    kind: 'group', id: 'logistica-matriz', label: 'Logística', icon: Package, color: 'from-sky-500/20 to-sky-500/5 border-sky-500/30 text-sky-400',
    modulos: [
      { id: 'compras', label: 'Compras', icon: ShoppingCart, color: 'text-sky-400',
        submenus: ['Gerenciamento', 'Relatórios'] },
      { id: 'estoque', label: 'Estoque', icon: Package, color: 'text-sky-400',
        submenus: ['Gerenciamento', 'Relatórios'] },
    ],
  },
  {
    kind: 'group', id: 'financeiro-matriz', label: 'Financeiro', icon: DollarSign, color: 'from-green-500/20 to-green-500/5 border-green-500/30 text-green-400',
    modulos: [
      // Aprovações de Cotação: admin/CEO precisa aprovar cotações acima da
      // alçada (migr. 204) mesmo em modo Matriz — antes tinha que trocar
      // pra cada filial. Alçadas: configuração é da holding, mora aqui.
      { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'text-green-400',
        submenus: ['Aprovações de Cotação', 'Alçadas', 'Gerenciamento', 'Relatórios'] },
    ],
  },
  {
    kind: 'group', id: 'rh-matriz', label: 'Recursos Humanos', icon: Users, color: 'from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-400',
    modulos: [
      { id: 'rh', label: 'RH', icon: Users, color: 'text-purple-400',
        submenus: ['Frequência de Trabalho', 'Gerenciamento', 'Relatórios'] },
    ],
  },
  {
    kind: 'group', id: 'ti-matriz', label: 'TI & Suporte', icon: Monitor, color: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/30 text-indigo-400',
    modulos: [
      { id: 'ti', label: 'TI & Suporte', icon: Monitor, color: 'text-indigo-400',
        submenus: ['Chamados', 'Desenvolvimento com IA'] },
    ],
  },
];

// Hub Análise com IA (Matriz only) — cards que navegam direto
export const ANALISE_IA_MACROS: MacroDef[] = [
  {
    kind: 'leaf', id: 'painel-bi', label: 'Painel de BI', icon: Brain,
    color: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30 text-cyan-400',
    viewId: 'painel-bi',
    description: 'Relatórios executivos com IA por setor',
  },
  {
    kind: 'leaf', id: 'briefing-diario', label: 'Briefing Diário', icon: ListTodo,
    color: 'from-teal-500/20 to-teal-500/5 border-teal-500/30 text-teal-400',
    viewId: 'briefing-diario',
    description: 'Pauta diária proposta pela IA por setor',
  },
];

// Hub Comparativos Matriz (Matriz only) — 5 comparativos
export const COMPARATIVOS_MATRIZ_MACROS: MacroDef[] = [
  { kind: 'leaf', id: 'matriz-rh',         label: 'RH Comparativo',        icon: Users,     color: 'from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-400', viewId: 'matriz-rh',         description: 'RH consolidado das 3 filiais' },
  { kind: 'leaf', id: 'matriz-financeiro', label: 'Financeiro Comparativo', icon: DollarSign, color: 'from-green-500/20 to-green-500/5 border-green-500/30 text-green-400',    viewId: 'matriz-financeiro', description: 'Financeiro consolidado' },
  { kind: 'leaf', id: 'matriz-logistica',  label: 'Logística Comparativo',  icon: Package,    color: 'from-sky-500/20 to-sky-500/5 border-sky-500/30 text-sky-400',            viewId: 'matriz-logistica',  description: 'Estoque e compras consolidados' },
  { kind: 'leaf', id: 'matriz-marketing',  label: 'Marketing Comparativo',  icon: Megaphone,  color: 'from-pink-500/20 to-pink-500/5 border-pink-500/30 text-pink-400',        viewId: 'matriz-marketing',  description: 'Marketing consolidado' },
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
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {macrosVisiveis.map(macro => {
              const total = macroBadge(macro);
              const Icon = macro.icon;
              return (
                <button
                  key={macro.id}
                  onClick={() => handleMacroClick(macro)}
                  className={`neu-flat rounded-3xl p-6 border bg-gradient-to-br text-left group hover:scale-[1.02] active:scale-[0.98] transition-transform ${macro.color}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <Icon size={32} strokeWidth={1.5} />
                    {total > 0 && (
                      <span className="text-[10px] font-black px-2 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                        {total} pendente{total > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-black mb-1">{macro.label}</h3>
                  <p className="text-xs text-gray-400">
                    {macro.kind === 'leaf'
                      ? (macro.description ?? '—')
                      : macro.modulos.map(m => m.label).join(' · ')}
                  </p>
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
              return (
                <button
                  key={mod.id}
                  onClick={() => setStage({ kind: 'submenus', macro: stage.macro, modulo: mod })}
                  className="neu-flat rounded-2xl p-5 border border-white/5 text-left hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <Icon size={22} className={mod.color} />
                    {b > 0 && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">
                        {b}
                      </span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-gray-100 mb-1">{mod.label}</h4>
                  <p className="text-xs text-gray-500">{mod.submenus.length} submódulo(s)</p>
                </button>
              );
            })}
          </motion.div>
        )}

        {stage.kind === 'submenus' && (
          <motion.div
            key="submenus"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            {stage.modulo.submenus
              .filter(s => subPermitido(s, profile))
              .map(s => {
                const label = subLabel(s);
                const viewId = `${stage.modulo.id}-${slug(label)}`;
                const b = badges[viewId] ?? 0;
                return (
                  <div key={label} className="relative group">
                    <button
                      onClick={() => navigate(viewId)}
                      className="w-full neu-flat rounded-xl px-4 py-3 border border-white/5 flex items-center justify-between text-left hover:border-accent/30 hover:bg-accent/5 transition-colors"
                    >
                      <span className="text-sm font-semibold text-gray-200 group-hover:text-accent">{label}</span>
                      {b > 0 && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">
                          {b}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
