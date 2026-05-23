import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useUserProfile } from './hooks/useUserProfile';
import { useFetchData } from './hooks/useSupabaseData';
import { LoginScreen } from './components/LoginScreen';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { Toast, LoadingSpinner, PageLoadingFallback, PlaceholderView } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { motion, AnimatePresence } from 'motion/react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import {
  Home, BarChart3, Building2, ShoppingCart, Package, DollarSign, Users,
  LogOut, User, ChevronDown, Loader2, Menu, X, UserCog, ShoppingBag,
  Sun, Moon, Megaphone, Palette, Check, ArrowLeft, Monitor, Accessibility
} from 'lucide-react';
import { NotificationBell } from './components/NotificationBell';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { AIAssistantProvider } from './contexts/AIAssistantContext';

// --- lazy views ---
const InicioView              = lazy(() => import('./views/InicioView').then(m => ({ default: m.InicioView })));
const DashboardAnalyticsView  = lazy(() => import('./views/DashboardAnalyticsView').then(m => ({ default: m.DashboardAnalyticsView })));
const FiliaisView             = lazy(() => import('./views/FiliaisView').then(m => ({ default: m.FiliaisView })));
const ColaboradoresView       = lazy(() => import('./views/ColaboradoresView').then(m => ({ default: m.ColaboradoresView })));
const CRMView                 = lazy(() => import('./views/CRMView').then(m => ({ default: m.CRMView })));
const ProdutosView            = lazy(() => import('./views/ProdutosView').then(m => ({ default: m.ProdutosView })));
const RequisicoesView         = lazy(() => import('./views/RequisicoesView').then(m => ({ default: m.RequisicoesView })));
const AprovacoesComprasView   = lazy(() => import('./views/AprovacoesComprasView').then(m => ({ default: m.AprovacoesComprasView })));
const CotacoesView            = lazy(() => import('./views/CotacoesView').then(m => ({ default: m.CotacoesView })));
const PedidosView             = lazy(() => import('./views/PedidosView').then(m => ({ default: m.PedidosView })));
const NotasRecebidasView      = lazy(() => import('./views/NotasRecebidasView').then(m => ({ default: m.NotasRecebidasView })));
const RecebimentosView        = lazy(() => import('./views/RecebimentosView').then(m => ({ default: m.RecebimentosView })));
const ContasPagarView         = lazy(() => import('./views/ContasPagarView').then(m => ({ default: m.ContasPagarView })));
const ContasReceberView       = lazy(() => import('./views/ContasReceberView').then(m => ({ default: m.ContasReceberView })));
const GenericCRUDView         = lazy(() => import('./views/GenericCRUDView').then(m => ({ default: m.GenericCRUDView })));
const MovimentacoesEstoqueView = lazy(() => import('./views/MovimentacoesEstoqueView').then(m => ({ default: m.MovimentacoesEstoqueView })));
const SaldosEstoqueView       = lazy(() => import('./views/SaldosEstoqueView').then(m => ({ default: m.SaldosEstoqueView })));
const RequisicoesEstoqueView  = lazy(() => import('./views/RequisicoesEstoqueView').then(m => ({ default: m.RequisicoesEstoqueView })));
const AprovacoesEstoqueView   = lazy(() => import('./views/AprovacoesEstoqueView').then(m => ({ default: m.AprovacoesEstoqueView })));
const ExpedicaoView           = lazy(() => import('./views/ExpedicaoView').then(m => ({ default: m.ExpedicaoView })));
const InventariosView         = lazy(() => import('./views/InventariosView').then(m => ({ default: m.InventariosView })));
const VencimentosEstoqueView  = lazy(() => import('./views/VencimentosEstoqueView').then(m => ({ default: m.VencimentosEstoqueView })));
const RelatoriosComprasView        = lazy(() => import('./views/RelatoriosComprasView').then(m => ({ default: m.RelatoriosComprasView })));
const RelatoriosEstoqueView        = lazy(() => import('./views/RelatoriosEstoqueView').then(m => ({ default: m.RelatoriosEstoqueView })));
const SugestoesComprasView         = lazy(() => import('./views/SugestoesComprasView').then(m => ({ default: m.SugestoesComprasView })));
const PlanejamentoOrcamentarioView = lazy(() => import('./views/PlanejamentoOrcamentarioView').then(m => ({ default: m.PlanejamentoOrcamentarioView })));
const GerenciamentoComprasView     = lazy(() => import('./views/GerenciamentoComprasView').then(m => ({ default: m.GerenciamentoComprasView })));
const GerenciamentoEstoqueView     = lazy(() => import('./views/GerenciamentoEstoqueView').then(m => ({ default: m.GerenciamentoEstoqueView })));
const RelatoriosFinanceirosView    = lazy(() => import('./views/RelatoriosFinanceirosView').then(m => ({ default: m.RelatoriosFinanceirosView })));
const IntegracaoBancariaView       = lazy(() => import('./views/IntegracaoBancariaView').then(m => ({ default: m.IntegracaoBancariaView })));
const GerenciamentoFinanceiroView  = lazy(() => import('./views/GerenciamentoFinanceiroView').then(m => ({ default: m.GerenciamentoFinanceiroView })));
const FuncionariosView             = lazy(() => import('./views/FuncionariosView').then(m => ({ default: m.FuncionariosView })));
const FolhaPagamentoView           = lazy(() => import('./views/FolhaPagamentoView').then(m => ({ default: m.FolhaPagamentoView })));
const FeriasView                   = lazy(() => import('./views/FeriasView').then(m => ({ default: m.FeriasView })));
const PontoEletronicoView          = lazy(() => import('./views/PontoEletronicoView').then(m => ({ default: m.PontoEletronicoView })));
const TreinamentosView             = lazy(() => import('./views/TreinamentosView').then(m => ({ default: m.TreinamentosView })));
const AvaliacoesView               = lazy(() => import('./views/AvaliacoesView').then(m => ({ default: m.AvaliacoesView })));
const GerenciamentoRHView          = lazy(() => import('./views/GerenciamentoRHView').then(m => ({ default: m.GerenciamentoRHView })));
const RelatoriosRHView             = lazy(() => import('./views/RelatoriosRHView').then(m => ({ default: m.RelatoriosRHView })));
const UsuariosView                 = lazy(() => import('./views/UsuariosView').then(m => ({ default: m.UsuariosView })));
const QRTotemView                  = lazy(() => import('./views/QRTotemView').then(m => ({ default: m.QRTotemView })));
const PDVView                              = lazy(() => import('./views/PDVView').then(m => ({ default: m.PDVView })));
const HistoricoVendasView                  = lazy(() => import('./views/HistoricoVendasView').then(m => ({ default: m.HistoricoVendasView })));
const PromocoesMarketingView               = lazy(() => import('./views/PromocoesMarketingView').then(m => ({ default: m.PromocoesMarketingView })));
const AprovacoesPromocaoFinanceiroView     = lazy(() => import('./views/AprovacoesPromocaoFinanceiroView').then(m => ({ default: m.AprovacoesPromocaoFinanceiroView })));
const TarefasMarketingView                 = lazy(() => import('./views/TarefasMarketingView').then(m => ({ default: m.TarefasMarketingView })));
const TarefasView                          = lazy(() => import('./views/TarefasView').then(m => ({ default: m.TarefasView })));
const PesquisasView                        = lazy(() => import('./views/PesquisasView').then(m => ({ default: m.PesquisasView })));
const MinhasPesquisasView                  = lazy(() => import('./views/MinhasPesquisasView').then(m => ({ default: m.MinhasPesquisasView })));
const ArtesPromocionaisView                = lazy(() => import('./views/ArtesPromocionaisView').then(m => ({ default: m.ArtesPromocionaisView })));
const AprovacoesConteudoMarketingView      = lazy(() => import('./views/AprovacoesConteudoMarketingView').then(m => ({ default: m.AprovacoesConteudoMarketingView })));
const ControleCaixaView                    = lazy(() => import('./views/ControleCaixaView').then(m => ({ default: m.ControleCaixaView })));
const SimuladorPagamentoView               = lazy(() => import('./views/SimuladorPagamentoView').then(m => ({ default: m.SimuladorPagamentoView })));
const TIView                               = lazy(() => import('./views/TIView').then(m => ({ default: m.TIView })));

// --- acesso por setor (UX only — NÃO é segurança) ---
// Este mapa controla o que aparece no menu lateral por setor. NÃO é a fonte
// de verdade pra autorização: a RLS no Supabase (20260516_rls_hardening.sql
// e migrações posteriores) é quem realmente bloqueia leitura/escrita por
// `auth_user_setor()` / `auth_is_admin()`. Esconder do menu evita UX confusa
// ("o botão aparece e falha"), mas se alguém digitar o `activeView` direto
// no console, a RLS continua barrando.
//
// 'empresa' é cadastro base (filiais, colaboradores, clientes, produtos...)
// e fica disponível para todos os setores. Os demais seguem o recorte
// funcional de cada setor.
const SETOR_MODULES: Record<string, string[]> = {
  all:        ['empresa', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing', 'ti'],
  logistica:  ['empresa', 'estoque', 'compras', 'ti'],
  vendas:     ['empresa', 'vendas', 'ti'],
  financeiro: ['empresa', 'financeiro', 'ti'],
  rh:         ['empresa', 'rh', 'ti'],
  marketing:  ['empresa', 'marketing', 'ti'],
  ti:         ['empresa', 'ti'],
};

// --- menu ---
const menuModules = [
  {
    id: 'empresa', label: 'Empresa', icon: Building2,
    submenus: ['Filiais', 'Colaboradores', 'Clientes', 'Fornecedores', 'Produtos', 'Serviços', 'Centros de custo', 'Projetos', 'Condições de pagamento', 'Classificações auxiliares', 'Mapeamentos de rateio', 'Formas de pagamento', 'Tarefas']
  },
  {
    id: 'compras', label: 'Compras', icon: ShoppingCart,
    submenus: ['Requisições', 'Cotações', 'Pedidos', 'Minhas aprovações', 'Recebimentos', 'Notas recebidas', 'Sugestões de compras', 'Planejamento orçamentário', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'estoque', label: 'Estoque', icon: Package,
    submenus: ['Minhas Aprovações', 'Requisições', 'Expedição', 'Movimentações', 'Saldos', 'Inventários', 'Previsão de vencimentos', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'financeiro', label: 'Financeiro', icon: DollarSign,
    submenus: ['Controle de Caixa', 'Contas a receber', 'Contas a pagar', 'Previsões', 'Duplicatas', 'Caixa / Bancos', 'Integração bancária', 'Aprovações de Promoções', 'Aprovações de Conteúdo', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'rh', label: 'Recursos Humanos', icon: Users,
    submenus: ['Funcionários', 'Departamentos', 'Cargos', 'Folha de Pagamento', 'Férias', 'Ponto Eletrônico', 'Totem QR', 'Benefícios', 'Treinamentos', 'Avaliações', 'Pesquisas', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'vendas', label: 'Vendas', icon: ShoppingBag,
    submenus: ['PDV', 'Clientes', 'Histórico de Vendas', 'Tarefas'],
  },
  {
    id: 'marketing', label: 'Marketing', icon: Megaphone,
    submenus: ['Promoções', 'Tarefas'],
  },
  {
    id: 'ti', label: 'TI & Suporte', icon: Monitor,
    submenus: ['Chamados'],
    isNew: true,
  },
];

const SidebarNav = ({ activeView, navigate, openModules, toggleModule, handleSignOut, onClose, visibleModules, profile, badges }: any) => (
  <>
    <div className="flex items-center gap-3 px-1 mb-2">
      <div className="w-9 h-9 neu-circle flex items-center justify-center text-accent">
        <Package size={20} strokeWidth={2.5} />
      </div>
      <h1 className="text-2xl font-bold text-accent tracking-wider">LogMax</h1>
      {onClose && (
        <button onClick={onClose} className="ml-auto w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <X size={16} />
        </button>
      )}
    </div>

    <nav className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
      <div className="flex flex-col gap-2">
        <button onClick={() => { navigate('inicio'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'inicio' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
          <Home size={18} /><span>Início</span>
        </button>
        {profile?.setor === 'all' && (
          <button onClick={() => { navigate('dashboard'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'dashboard' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            <BarChart3 size={18} /><span>Dashboard</span>
          </button>
        )}
        {(profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente') && (
          <button onClick={() => { navigate('usuarios'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'usuarios' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            <UserCog size={18} /><span>Usuários</span>
          </button>
        )}
      </div>

      <div>
        <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-3 px-2">Módulos</h3>
        <div className="flex flex-col gap-1.5">
          {visibleModules.map((mod: any) => {
            const isOpen = openModules[mod.id];
            const Icon = mod.icon;
            return (
              <div key={mod.id} className="flex flex-col">
                <button onClick={() => toggleModule(mod.id)} className={`flex items-center justify-between p-2.5 rounded-xl transition-all text-sm font-medium ${isOpen ? 'neu-flat text-gray-200 border border-white/5' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
                  <div className="flex items-center gap-3">
                    <Icon size={16}
                      className={isOpen && !mod.color ? 'text-accent' : ''}
                      style={isOpen && mod.color ? { color: mod.color } : {}} />
                    <span>{mod.label}</span>
                    {mod.isNew && (
                      <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                        Novo
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14}
                    className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : 'text-gray-500'} ${isOpen && !mod.color ? 'text-accent' : ''}`}
                    style={isOpen && mod.color ? { color: mod.color } : {}} />
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex flex-col overflow-hidden">
                      <div className="flex flex-col pt-2 pb-1">
                        {mod.submenus.map((sub: any) => {
                          const viewId = `${mod.id}-${sub.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;
                          const isActive = activeView === viewId;
                          return (
                            <button key={sub} onClick={() => { navigate(viewId); onClose?.(); }}
                              className={`flex items-center justify-between text-xs py-2 px-3 pl-9 rounded-lg transition-colors leading-tight border-l-2 ${isActive ? `font-bold bg-white/5 ${!mod.color ? 'text-accent border-accent' : ''}` : 'text-gray-500 hover:text-gray-300 border-transparent hover:border-gray-500'}`}
                              style={isActive && mod.color ? { color: mod.color, borderColor: mod.color } : {}}>
                              <span>{sub}</span>
                              {(badges?.[viewId] ?? 0) > 0 && (
                                <span className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[9px] font-black text-black shrink-0 ml-1">
                                  {badges[viewId] > 9 ? '9+' : badges[viewId]}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </nav>

    <button onClick={handleSignOut}
      className="flex items-center justify-center gap-2 p-3 rounded-xl neu-button text-gray-400 hover:text-red-500 transition-all mt-auto border border-transparent hover:border-red-500/10 text-sm font-medium">
      <LogOut size={16} /><span>Sair</span>
    </button>
  </>
);

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
      className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

type AccentOption = {
  id: 'green' | 'yellow' | 'purple' | 'orange' | 'blue' | 'pink' | 'acessivel';
  hex: string;
  label: string;
  /** Cor secundária (renderizada como swatch bicolor) — usada no preset de acessibilidade */
  secondaryHex?: string;
  /** Marca o preset como destinado a acessibilidade visual (selo + título descritivo) */
  accessible?: boolean;
};

const ACCENT_OPTIONS: readonly AccentOption[] = [
  { id: 'green',  hex: '#10B981', label: 'Verde'   },
  { id: 'yellow', hex: '#FACC15', label: 'Amarelo' },
  { id: 'purple', hex: '#A855F7', label: 'Roxo'    },
  { id: 'orange', hex: '#F97316', label: 'Laranja' },
  { id: 'blue',   hex: '#3B82F6', label: 'Azul'    },
  { id: 'pink',   hex: '#EC4899', label: 'Rosa'    },
  // Preset de acessibilidade: laranja + azul claro (alto contraste, amigável
  // para daltonismo). Ver paleta em src/index.css [data-accent="acessivel"].
  { id: 'acessivel', hex: '#F97316', secondaryHex: '#7DD3FC',
    label: 'Acessibilidade', accessible: true },
] as const;

function AccentPicker() {
  const { accentColor, setAccentColor } = useTheme();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fecha o popover ao clicar fora ou no Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Separa presets normais do(s) de acessibilidade para destacar visualmente
  const normalAccents = ACCENT_OPTIONS.filter(o => !o.accessible);
  const accessibleAccents = ACCENT_OPTIONS.filter(o => o.accessible);

  return (
    <>
      {/* Desktop (sm+): bolinhas inline */}
      <div className="neu-flat rounded-xl hidden sm:flex items-center gap-2 px-3 py-2.5 border border-white/5" title="Cor do tema">
        {normalAccents.map(({ id, hex, label }) => (
          <button
            key={id}
            title={label}
            onClick={() => setAccentColor(id)}
            className="w-[14px] h-[14px] rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0"
            style={{
              background: hex,
              boxShadow: accentColor === id
                ? `0 0 0 2px var(--color-bg-base), 0 0 0 3.5px ${hex}`
                : undefined,
            }}
          />
        ))}
        {/* Divider + presets de acessibilidade */}
        {accessibleAccents.length > 0 && (
          <span aria-hidden className="mx-1 h-4 w-px bg-white/10" />
        )}
        {accessibleAccents.map(({ id, hex, secondaryHex }) => {
          const isActive = accentColor === id;
          return (
            <button
              key={id}
              title="Acessibilidade — laranja com ícones azul claro (alto contraste)"
              aria-label="Tema de acessibilidade: laranja com ícones azul claro"
              onClick={() => setAccentColor(id)}
              className="w-[18px] h-[18px] rounded-full transition-transform hover:scale-125 focus:outline-none shrink-0 flex items-center justify-center relative"
              style={{
                background: `linear-gradient(135deg, ${hex} 0%, ${hex} 50%, ${secondaryHex} 50%, ${secondaryHex} 100%)`,
                boxShadow: isActive
                  ? `0 0 0 2px var(--color-bg-base), 0 0 0 3.5px ${hex}`
                  : undefined,
              }}
            >
              <Accessibility size={10} className="text-white" strokeWidth={3} />
            </button>
          );
        })}
      </div>

      {/* Mobile (<sm): ícone de paleta + popover ao toque */}
      <div ref={popoverRef} className="relative sm:hidden">
        <button
          onClick={() => setOpen(v => !v)}
          aria-label="Escolher cor do tema"
          aria-expanded={open}
          className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors"
        >
          <Palette size={16} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 neu-flat rounded-2xl p-3 border border-white/10 z-50 shadow-2xl"
              style={{ background: 'var(--color-bg-base)', minWidth: 200 }}
            >
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 text-center">Cor do tema</p>
              <div className="grid grid-cols-3 gap-3 justify-items-center">
                {normalAccents.map(({ id, hex, label }) => {
                  const isActive = accentColor === id;
                  // Cores claras (amarelo) precisam de tick escuro para visibilidade
                  const tickColor = id === 'yellow' ? '#0A0A0A' : '#ffffff';
                  return (
                    <button
                      key={id}
                      aria-label={label}
                      aria-pressed={isActive}
                      onClick={() => { setAccentColor(id); setOpen(false); }}
                      className="w-9 h-9 rounded-full transition-transform hover:scale-110 active:scale-95 focus:outline-none flex items-center justify-center"
                      style={{
                        background: hex,
                        boxShadow: isActive
                          ? `0 0 0 2px var(--color-bg-base), 0 0 0 3.5px ${hex}`
                          : undefined,
                      }}
                    >
                      {isActive && <Check size={14} style={{ color: tickColor }} strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
              {accessibleAccents.length > 0 && (
                <>
                  <div className="mt-4 mb-2 h-px bg-white/10" aria-hidden />
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 text-center">Acessibilidade</p>
                  {accessibleAccents.map(({ id, hex, secondaryHex, label }) => {
                    const isActive = accentColor === id;
                    return (
                      <button
                        key={id}
                        aria-label={`${label}: laranja com ícones azul claro (alto contraste)`}
                        aria-pressed={isActive}
                        onClick={() => { setAccentColor(id); setOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl neu-button hover:scale-[1.02] active:scale-95 transition-transform focus:outline-none"
                        style={{
                          boxShadow: isActive
                            ? `inset 0 0 0 2px ${hex}`
                            : undefined,
                        }}
                      >
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: `linear-gradient(135deg, ${hex} 0%, ${hex} 50%, ${secondaryHex} 50%, ${secondaryHex} 100%)`,
                          }}
                        >
                          <Accessibility size={14} className="text-white" strokeWidth={2.5} />
                        </span>
                        <span className="flex flex-col items-start text-left">
                          <span className="text-[11px] font-bold text-gray-200">{label}</span>
                          <span className="text-[9px] text-gray-500 uppercase tracking-widest">Laranja + azul claro</span>
                        </span>
                        {isActive && <Check size={14} className="ml-auto text-accent" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function ApprovalBadges({ onBadges }: { onBadges: (b: Record<string, number>) => void }) {
  const { data: pendCompras } = useFetchData<any>('/api/minhasaprovacoesview',        { status: 'Pendente' },              true);
  const { data: pendEstoque } = useFetchData<any>('/api/minhasaprovacoesestoqueview', { status: 'Pendente' },              true);
  const { data: pendPromo   } = useFetchData<any>('/api/marketingpromocoesview',  { status: 'Aguardando Aprovação' },      true);
  const { data: pendLinks   } = useFetchData<any>('/api/marketingtarefasview',    { status_link: 'Aguardando Aprovação' }, true);
  useEffect(() => {
    onBadges({
      'compras-minhasaprovações':          pendCompras.length,
      'estoque-minhasaprovações':          pendEstoque.length,
      'financeiro-aprovaçõesdepromoções': pendPromo.length,
      'financeiro-aprovaçõesdeconteúdo':  pendLinks.length,
    });
  }, [pendCompras.length, pendEstoque.length, pendPromo.length, pendLinks.length, onBadges]);
  return null;
}

function LogMaxAppInner() {
  const { user, isLoading: authLoading, isAuthenticated, signOut } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile();
  const [badges, setBadges] = useState<Record<string, number>>({});
  const handleBadges = useCallback((b: Record<string, number>) => setBadges(b), []);
  // Persistido em sessionStorage para sobreviver a F5/pull-to-refresh
  // sem voltar para 'inicio'. Limpa ao fechar a aba e no logout.
  const [activeView, setActiveView] = useState<string>(() => {
    try { return sessionStorage.getItem('logmax:activeView') || 'inicio'; } catch { return 'inicio'; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('logmax:activeView', activeView); } catch {}
  }, [activeView]);
  // Pilha de histórico para o botão "voltar". Persistida em sessionStorage
  // junto com activeView para sobreviver a F5 / pull-to-refresh.
  const [viewHistory, setViewHistory] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem('logmax:viewHistory');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('logmax:viewHistory', JSON.stringify(viewHistory)); } catch {}
  }, [viewHistory]);
  const navigate = useCallback((view: string) => {
    setActiveView(prev => {
      if (prev === view) return prev;
      setViewHistory(h => [...h, prev]);
      return view;
    });
  }, []);
  const goBack = useCallback(() => {
    setViewHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setActiveView(prev);
      return h.slice(0, -1);
    });
  }, []);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({ empresa: true });
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleModule = (id: string) => setOpenModules(prev => ({ ...prev, [id]: !prev[id] }));

  const showToast = useCallback((message: string, type = 'info', autoHide = true) => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    if (autoHide) {
      toastTimerRef.current = setTimeout(() => {
        setToast(prev => ({ ...prev, show: false }));
        toastTimerRef.current = null;
      }, 3000);
    }
  }, []);

  if (authLoading || (isAuthenticated && profileLoading && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-accent animate-spin" />
          <span className="text-xs text-gray-500 font-bold tracking-widest uppercase">
            {authLoading ? 'Verificando sessão...' : 'Carregando perfil...'}
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={() => {}} />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base">
        <UserCog size={40} className="text-gray-600" />
        <h2 className="text-lg font-bold text-gray-300">Acesso não configurado</h2>
        <p className="text-sm text-gray-500 max-w-sm text-center">
          Seu usuário ainda não possui um perfil de acesso. Solicite ao administrador do sistema.
        </p>
        <button onClick={signOut} className="mt-2 text-xs text-gray-600 hover:text-red-500 transition-colors">Sair</button>
      </div>
    );
  }

  // Módulos visíveis pelo setor do usuário
  const allowedModuleIds = SETOR_MODULES[profile.setor] ?? [];
  const visibleModules = menuModules.filter(m => allowedModuleIds.includes(m.id));

  const handleSignOut = async () => {
    showToast("Saindo...", 'info', true);
    try {
      sessionStorage.removeItem('logmax:activeView');
      sessionStorage.removeItem('logmax:viewHistory');
    } catch {}
    await signOut();
  };

  const renderContent = () => {
    const st = showToast;
    switch (activeView) {
      case 'inicio':                          return <InicioView onNavigate={navigate} showToast={st} profile={profile} />;
      case 'dashboard':                       return <DashboardAnalyticsView />;
      case 'empresa-filiais':                 return <FiliaisView showToast={st} />;
      case 'empresa-colaboradores':           return <ColaboradoresView showToast={st} />;
      case 'empresa-clientes':                return <CRMView type="clientes" showToast={st} />;
      case 'empresa-fornecedores':            return <CRMView type="fornecedores" showToast={st} />;
      case 'empresa-produtos':                return <ProdutosView showToast={st} />;
      case 'empresa-serviços':                return <GenericCRUDView showToast={st} title="Serviços" subtitle="Gerencie os serviços prestados." endpoint="/api/servicosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: SRV-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Instalação' }, { key: 'tipo', label: 'Tipo', placeholder: 'Ex: Manutenção' }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-centrosdecusto':          return <GenericCRUDView showToast={st} title="Centros de Custo" subtitle="Gerencie centros de custo e orçamentos." endpoint="/api/centroscustoview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: CC-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: TI' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-projetos':                return <GenericCRUDView showToast={st} title="Projetos" subtitle="Gerencie os projetos em andamento." endpoint="/api/projetosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: PROJ-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Implantação ERP' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: Maria Santos' }, { key: 'data_inicio', label: 'Início', type: 'date' }, { key: 'data_fim', label: 'Fim', type: 'date' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Concluído', 'Cancelado'] }]} />;
      case 'empresa-condiçõesdepagamento':    return <GenericCRUDView showToast={st} title="Condições de Pagamento" subtitle="Gerencie as condições e prazos de pagamento." endpoint="/api/condicoespagamentoview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: 30/60/90 dias' }, { key: 'parcelas', label: 'Parcelas', type: 'number', placeholder: '3' }, { key: 'dias', label: 'Dias', placeholder: 'Ex: 30, 60, 90' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-classificaçõesauxiliares': return <GenericCRUDView showToast={st} title="Classificações Auxiliares" subtitle="Gerencie classificações e categorias auxiliares." endpoint="/api/classificacoesauxiliaresview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: CLA-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Categoria A' }, { key: 'tipo', label: 'Tipo', placeholder: 'Ex: Despesa' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-mapeamentosderateio':     return <GenericCRUDView showToast={st} title="Mapeamentos de Rateio" subtitle="Gerencie como custos são rateados entre centros." endpoint="/api/mapeamentosrateioview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Rateio TI' }, { key: 'centros_custo', label: 'Centros de Custo', placeholder: 'Ex: CC-001, CC-002' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-formasdepagamento':       return <GenericCRUDView showToast={st} title="Formas de Pagamento" subtitle="Gerencie as formas de pagamento aceitas." endpoint="/api/formaspagamentoview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: Boleto Bancário' }, { key: 'taxa', label: 'Taxa (%)', type: 'number', placeholder: '0,00' }, { key: 'prazo', label: 'Prazo (dias)', type: 'number', placeholder: '0' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'compras-requisições':             return <RequisicoesView showToast={st} />;
      case 'compras-cotações':                return <CotacoesView showToast={st} />;
      case 'compras-pedidos':                 return <PedidosView showToast={st} />;
      case 'compras-notasrecebidas':          return <NotasRecebidasView showToast={st} />;
      case 'compras-minhasaprovações':        return <AprovacoesComprasView showToast={st} />;
      case 'compras-recebimentos':            return <RecebimentosView showToast={st} />;
      case 'compras-sugestõesdecompras':       return <SugestoesComprasView showToast={st} />;
      case 'compras-planejamentoorçamentário': return <PlanejamentoOrcamentarioView showToast={st} />;
      case 'compras-gerenciamento':            return <GerenciamentoComprasView />;
      case 'compras-relatórios':              return <RelatoriosComprasView showToast={st} />;
      case 'estoque-minhasaprovações':        return <AprovacoesEstoqueView showToast={st} />;
      case 'estoque-requisições':             return <RequisicoesEstoqueView showToast={st} />;
      case 'estoque-expedição':               return <ExpedicaoView showToast={st} />;
      case 'estoque-movimentações':           return <MovimentacoesEstoqueView showToast={st} />;
      case 'estoque-saldos':                  return <SaldosEstoqueView />;
      case 'estoque-inventários':             return <InventariosView showToast={st} />;
      case 'estoque-previsãodevencimentos':   return <VencimentosEstoqueView showToast={st} />;
      case 'estoque-gerenciamento':            return <GerenciamentoEstoqueView />;
      case 'estoque-relatórios':              return <RelatoriosEstoqueView showToast={st} />;
      case 'financeiro-controledecaixa':      return <ControleCaixaView showToast={st} profile={profile} />;
      case 'financeiro-contasareceber':       return <ContasReceberView showToast={st} />;
      case 'financeiro-contasapagar':         return <ContasPagarView showToast={st} />;
      case 'financeiro-previsões':            return <GenericCRUDView showToast={st} title="Previsões Financeiras" subtitle="Gerencie previsões de receitas e despesas." endpoint="/api/previsoesview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: Aluguel Janeiro' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Receita', 'Despesa'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'data', label: 'Data', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['Previsto', 'Realizado', 'Cancelado'] }]} />;
      case 'financeiro-duplicatas':           return <GenericCRUDView showToast={st} title="Duplicatas" subtitle="Gerencie duplicatas a receber e a pagar." endpoint="/api/duplicatasview"
        fields={[{ key: 'numero', label: 'Número', required: true, placeholder: 'Ex: DUP-001' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['A Receber', 'A Pagar'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'vencimento', label: 'Vencimento', type: 'date' }, { key: 'sacado', label: 'Sacado', placeholder: 'Ex: Empresa XYZ' }, { key: 'status', label: 'Status', type: 'select', options: ['Emitida', 'Paga', 'Vencida', 'Cancelada'] }]} />;
      case 'financeiro-caixabancos':          return <GenericCRUDView showToast={st} title="Caixa / Bancos" subtitle="Gerencie contas bancárias e saldos." endpoint="/api/caixabancosview"
        fields={[{ key: 'conta', label: 'Conta', required: true, placeholder: 'Ex: 12345-6' }, { key: 'banco', label: 'Banco', placeholder: 'Ex: Banco do Brasil' }, { key: 'agencia', label: 'Agência', placeholder: 'Ex: 0001' }, { key: 'saldo', label: 'Saldo (R$)', type: 'currency', placeholder: '0,00' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Conta Corrente', 'Conta Poupança', 'Caixa', 'Investimento'] }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'financeiro-integraçãobancária':        return <IntegracaoBancariaView showToast={st} />;
      case 'financeiro-aprovaçõesdepromoções':   return <AprovacoesPromocaoFinanceiroView showToast={st} />;
      case 'financeiro-aprovaçõesdeconteúdo':   return <AprovacoesConteudoMarketingView showToast={st} />;
      case 'financeiro-gerenciamento':            return <GerenciamentoFinanceiroView />;
      case 'financeiro-relatórios':               return <RelatoriosFinanceirosView showToast={st} />;
      case 'rh-funcionários':     return <FuncionariosView showToast={st} />;
      case 'rh-departamentos':    return <GenericCRUDView showToast={st} title="Departamentos" subtitle="Gerencie os departamentos da empresa." endpoint="/api/departamentosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Tecnologia da Informação' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-cargos':           return <GenericCRUDView showToast={st} title="Cargos" subtitle="Gerencie os cargos e níveis salariais." endpoint="/api/cargosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Analista de Sistemas' }, { key: 'nivel', label: 'Nível', type: 'select', options: ['Júnior', 'Pleno', 'Sênior', 'Gerência', 'Diretoria'] }, { key: 'salario_base', label: 'Salário Base (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-folhadepagamento': return <FolhaPagamentoView showToast={st} />;
      case 'rh-férias':           return <FeriasView showToast={st} />;
      case 'rh-pontoeletrônico':  return <PontoEletronicoView showToast={st} profile={profile} />;
      case 'rh-totemqr':          return <QRTotemView />;
      case 'rh-benefícios':       return <GenericCRUDView showToast={st} title="Benefícios" subtitle="Gerencie os benefícios oferecidos aos funcionários." endpoint="/api/beneficiosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Vale Refeição' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Vale Refeição', 'Vale Transporte', 'Plano de Saúde', 'Plano Odontológico', 'Auxílio Home Office', 'Outros'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-treinamentos':     return <TreinamentosView showToast={st} />;
      case 'rh-avaliações':       return <AvaliacoesView showToast={st} profile={profile} />;
      case 'rh-pesquisas':        return <PesquisasView showToast={st} profile={profile} />;
      case 'rh-gerenciamento':    return <GerenciamentoRHView />;
      case 'rh-relatórios':       return <RelatoriosRHView showToast={st} />;
      case 'vendas-pdv':                    return <PDVView showToast={st} profile={profile} />;
      case 'vendas-clientes':               return <CRMView type="clientes" showToast={st} />;
      case 'vendas-históricodevendas':     return <HistoricoVendasView showToast={st} />;
      case 'marketing-promoções':          return <PromocoesMarketingView showToast={st} profile={profile} />;
      case 'marketing-tarefas':            return <TarefasMarketingView showToast={st} profile={profile} />;
      case 'empresa-tarefas':              return <TarefasView showToast={st} profile={profile} modulo="empresa" />;
      case 'compras-tarefas':              return <TarefasView showToast={st} profile={profile} modulo="compras" />;
      case 'estoque-tarefas':              return <TarefasView showToast={st} profile={profile} modulo="estoque" />;
      case 'financeiro-tarefas':           return <TarefasView showToast={st} profile={profile} modulo="financeiro" />;
      case 'rh-tarefas':                   return <TarefasView showToast={st} profile={profile} modulo="rh" />;
      case 'vendas-tarefas':               return <TarefasView showToast={st} profile={profile} modulo="vendas" />;
      case 'minhas-pesquisas':             return <MinhasPesquisasView showToast={st} profile={profile} />;
      case 'artes-promocionais':           return <ArtesPromocionaisView showToast={st} profile={profile} />;
      case 'usuarios':                     return <UsuariosView showToast={st} profile={profile} />;
      case 'ti-chamados':                  return <TIView showToast={st} profile={profile} />;
      default:
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full items-center justify-center flex-col gap-4 text-center">
            <div className="neu-pressed w-20 h-20 rounded-full flex items-center justify-center shadow-inner">
              <Package size={28} className="text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-300">Módulo em Desenvolvimento</h2>
              <p className="text-sm text-gray-500 mt-2 max-w-sm">A visualização para <strong>"{activeView}"</strong> estará disponível em breve.</p>
            </div>
          </motion.div>
        );
    }
  };

  const userEmail = user?.email ?? 'Administrador';
  const displayName = userEmail.split('@')[0];

  // MaxAI disponível apenas para admin/CEO (visão global) e setor Financeiro.
  // Endpoint /api/ai-chat também valida server-side (defense-in-depth).
  const canUseMaxAI =
    profile.role === 'admin' || profile.role === 'ceo' || profile.setor === 'financeiro';

  return (
    <AIAssistantProvider>
    <div className="flex h-screen w-full bg-base overflow-hidden" style={{ color: 'var(--color-text-primary)', height: '100dvh' }}>
      <ApprovalBadges onBadges={handleBadges} />
      {canUseMaxAI && <AIAssistantFAB />}
      <Toast message={toast.message} visible={toast.show} type={toast.type} />

      {/* MOBILE SIDEBAR OVERLAY */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 w-64 h-full flex flex-col pt-8 pb-5 px-5 gap-6 z-50 neu-flat lg:hidden">
              <SidebarNav
                activeView={activeView} navigate={navigate}
                openModules={openModules} toggleModule={toggleModule}
                handleSignOut={handleSignOut} onClose={() => setMobileMenuOpen(false)}
                visibleModules={visibleModules} profile={profile} badges={badges}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <aside className="hidden lg:flex w-64 h-full flex-col pt-8 pb-5 px-5 gap-6 shrink-0 z-10 neu-flat relative">
        <SidebarNav
          activeView={activeView} navigate={navigate}
          openModules={openModules} toggleModule={toggleModule}
          handleSignOut={handleSignOut}
          visibleModules={visibleModules} profile={profile} badges={badges}
        />
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 h-full overflow-y-auto flex flex-col bg-base p-4 sm:p-8 main-scrollbar">
        <header className="shrink-0 flex justify-between items-center sticky top-0 z-30 bg-base mb-4 sm:mb-8 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors">
              <Menu size={18} />
            </button>
            {viewHistory.length > 0 && (
              <button
                onClick={goBack}
                title="Voltar para a tela anterior"
                aria-label="Voltar"
                className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-gray-200 tracking-wide truncate">
                <span className="hidden sm:inline">Plataforma </span>LogMax
              </h2>
              <p className="hidden sm:block text-[11px] text-gray-500 uppercase tracking-widest mt-1">Ambiente seguro</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationBell setor={profile.setor} onNavigate={navigate} />
            <ThemeToggle />
            <AccentPicker />

            <div className="neu-flat rounded-2xl py-2 px-3 flex items-center gap-3 border border-white/5">
              <div className="w-9 h-9 rounded-full neu-pressed flex items-center justify-center border border-accent/20 shrink-0"
                style={{ background: 'var(--color-avatar-bg)' }}>
                <User size={16} className="text-accent" />
              </div>
              <div className="hidden sm:flex flex-col pr-2">
                <span className="text-sm font-bold text-gray-200 capitalize">{displayName}</span>
                <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5 uppercase tracking-widest font-bold">
                  <span className="text-gray-600">{userEmail}</span>
                  <span className="text-accent">•</span>
                  <button onClick={handleSignOut} className="hover:text-red-500 transition-colors cursor-pointer">Sair</button>
                </div>
              </div>
              <button onClick={handleSignOut} className="sm:hidden text-[10px] font-bold text-gray-500 hover:text-red-500 transition-colors">Sair</button>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          <ErrorBoundary key={activeView}>
            <Suspense fallback={<PageLoadingFallback />}>
              {renderContent()}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
    </AIAssistantProvider>
  );
}

// Rota pública: simulador de pagamento Pix (cliente fora do ERP, sem login).
// É verificada antes do gate de autenticação para que o cliente possa abrir
// a URL no telemóvel e usar a câmara diretamente.
function isSimuladorPagamentoRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/simulador-pagamento';
}

export default function LogMaxApp() {
  if (isSimuladorPagamentoRoute()) {
    return (
      <ThemeProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <SimuladorPagamentoView />
        </Suspense>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <PwaUpdatePrompt />
      <LogMaxAppInner />
    </ThemeProvider>
  );
}
