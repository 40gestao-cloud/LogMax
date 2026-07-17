import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useUserProfile } from './hooks/useUserProfile';
import { hasSetor, allSetores, isConselheiro } from './lib/rbac';
import { useSidebarBadges } from './hooks/useSidebarBadges';
import { useAulaConfig } from './hooks/useAulaConfig';
import { aulaFiltraUsuario, aulaPermiteView } from './lib/aulaModulos';
import { SETOR_MODULES } from './lib/sectorAccess';
import {
  SESSOES_MATRIZ_MACROS, ANALISE_IA_MACROS, COMPARATIVOS_MATRIZ_MACROS,
} from './views/SessoesGeraisView';
import { MATRIZ_ALLOWED_SUBMENUS, MATRIZ_MODULES } from './lib/matrizMenu';
import { isSupabaseConfigured } from './lib/supabase';
import { LoginScreen } from './components/LoginScreen';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { Toast, LoadingSpinner, PageLoadingFallback } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { motion, AnimatePresence } from 'motion/react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { FilialProvider, useFilial } from './contexts/FilialContext';
import { FilialSelector, type FilialOp } from './components/FilialSelector';
import {
  Home, BarChart3, Building2, ShoppingCart, Package, DollarSign, Users,
  LogOut, User, ChevronDown, Loader2, Menu, X, UserCog, ShoppingBag,
  Sun, Moon, Megaphone, ArrowLeft, Monitor, Eye,
  Star, MessageSquare, BookOpen, Database, Target, Brain, ListTodo,
  Layers, Landmark, GraduationCap, Lock,
} from 'lucide-react';
import { NotificationBell } from './components/NotificationBell';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { PerfilFotoModal } from './components/PerfilFotoModal';
import { AIAssistantProvider } from './contexts/AIAssistantContext';
import { AuditoriaProvider } from './contexts/AuditoriaContext';
import { ConfirmProvider } from './contexts/ConfirmContext';

// --- lazy views ---
const InicioView              = lazy(() => import('./views/InicioView').then(m => ({ default: m.InicioView })));
const DashboardAnalyticsView  = lazy(() => import('./views/DashboardAnalyticsView').then(m => ({ default: m.DashboardAnalyticsView })));
const FiliaisView             = lazy(() => import('./views/FiliaisView').then(m => ({ default: m.FiliaisView })));
const CRMView                 = lazy(() => import('./views/CRMView').then(m => ({ default: m.CRMView })));
const ProdutosView            = lazy(() => import('./views/ProdutosView').then(m => ({ default: m.ProdutosView })));
const RequisicoesView         = lazy(() => import('./views/RequisicoesView').then(m => ({ default: m.RequisicoesView })));
const AprovacoesComprasView   = lazy(() => import('./views/AprovacoesComprasView').then(m => ({ default: m.AprovacoesComprasView })));
const VitrinePublicaView      = lazy(() => import('./views/VitrinePublicaView').then(m => ({ default: m.VitrinePublicaView })));
const ConfigJurosView         = lazy(() => import('./views/ConfigJurosView').then(m => ({ default: m.ConfigJurosView })));
const CotacoesView            = lazy(() => import('./views/CotacoesView').then(m => ({ default: m.CotacoesView })));
const PedidosView             = lazy(() => import('./views/PedidosView').then(m => ({ default: m.PedidosView })));
const NotasRecebidasView      = lazy(() => import('./views/NotasRecebidasView').then(m => ({ default: m.NotasRecebidasView })));
const RecebimentosView        = lazy(() => import('./views/RecebimentosView').then(m => ({ default: m.RecebimentosView })));
const ContasPagarView         = lazy(() => import('./views/ContasPagarView').then(m => ({ default: m.ContasPagarView })));
const ContasReceberView       = lazy(() => import('./views/ContasReceberView').then(m => ({ default: m.ContasReceberView })));
const CaixaBancosView         = lazy(() => import('./views/CaixaBancosView').then(m => ({ default: m.CaixaBancosView })));
const GenericCRUDView         = lazy(() => import('./views/GenericCRUDView').then(m => ({ default: m.GenericCRUDView })));
const ServicosView            = lazy(() => import('./views/ServicosView').then(m => ({ default: m.ServicosView })));
const MovimentacoesEstoqueView = lazy(() => import('./views/MovimentacoesEstoqueView').then(m => ({ default: m.MovimentacoesEstoqueView })));
const SaldosEstoqueView       = lazy(() => import('./views/SaldosEstoqueView').then(m => ({ default: m.SaldosEstoqueView })));
const RequisicoesEstoqueView  = lazy(() => import('./views/RequisicoesEstoqueView').then(m => ({ default: m.RequisicoesEstoqueView })));
const AprovacoesEstoqueView   = lazy(() => import('./views/AprovacoesEstoqueView').then(m => ({ default: m.AprovacoesEstoqueView })));
const ExpedicaoView           = lazy(() => import('./views/ExpedicaoView').then(m => ({ default: m.ExpedicaoView })));
const InventariosView         = lazy(() => import('./views/InventariosView').then(m => ({ default: m.InventariosView })));
const RelatoriosComprasView        = lazy(() => import('./views/RelatoriosComprasView').then(m => ({ default: m.RelatoriosComprasView })));
const RelatoriosEstoqueView        = lazy(() => import('./views/RelatoriosEstoqueView').then(m => ({ default: m.RelatoriosEstoqueView })));
const SugestoesComprasView         = lazy(() => import('./views/SugestoesComprasView').then(m => ({ default: m.SugestoesComprasView })));
const GerenciamentoComprasView     = lazy(() => import('./views/GerenciamentoComprasView').then(m => ({ default: m.GerenciamentoComprasView })));
const GerenciamentoEstoqueView     = lazy(() => import('./views/GerenciamentoEstoqueView').then(m => ({ default: m.GerenciamentoEstoqueView })));
const RelatoriosFinanceirosView    = lazy(() => import('./views/RelatoriosFinanceirosView').then(m => ({ default: m.RelatoriosFinanceirosView })));
const RecibosVendasView            = lazy(() => import('./views/RecibosVendasView').then(m => ({ default: m.RecibosVendasView })));
const IntegracaoBancariaView       = lazy(() => import('./views/IntegracaoBancariaView').then(m => ({ default: m.IntegracaoBancariaView })));
const GerenciamentoFinanceiroView  = lazy(() => import('./views/GerenciamentoFinanceiroView').then(m => ({ default: m.GerenciamentoFinanceiroView })));
const PatrimonioView               = lazy(() => import('./views/PatrimonioView').then(m => ({ default: m.PatrimonioView })));
const FuncionariosView             = lazy(() => import('./views/FuncionariosView').then(m => ({ default: m.FuncionariosView })));
const FolhaPagamentoView           = lazy(() => import('./views/FolhaPagamentoView').then(m => ({ default: m.FolhaPagamentoView })));
const FeriasView                   = lazy(() => import('./views/FeriasView').then(m => ({ default: m.FeriasView })));
const MetasView                    = lazy(() => import('./views/MetasView').then(m => ({ default: m.MetasView })));
const PontoEletronicoView          = lazy(() => import('./views/PontoEletronicoView').then(m => ({ default: m.PontoEletronicoView })));
const AfastamentosView             = lazy(() => import('./views/AfastamentosView').then(m => ({ default: m.AfastamentosView })));
const FrequenciaTrabalhoView       = lazy(() => import('./views/FrequenciaTrabalhoView').then(m => ({ default: m.FrequenciaTrabalhoView })));
const PainelBIView                 = lazy(() => import('./views/PainelBIView').then(m => ({ default: m.PainelBIView })));
const BriefingDiarioView           = lazy(() => import('./views/BriefingDiarioView').then(m => ({ default: m.BriefingDiarioView })));
const TreinamentosView             = lazy(() => import('./views/TreinamentosView').then(m => ({ default: m.TreinamentosView })));
const AvaliacoesView               = lazy(() => import('./views/AvaliacoesView').then(m => ({ default: m.AvaliacoesView })));
const FeedbackRequerimentosView    = lazy(() => import('./views/FeedbackRequerimentosView').then(m => ({ default: m.FeedbackRequerimentosView })));
const GerenciamentoRHView          = lazy(() => import('./views/GerenciamentoRHView').then(m => ({ default: m.GerenciamentoRHView })));
const RelatoriosRHView             = lazy(() => import('./views/RelatoriosRHView').then(m => ({ default: m.RelatoriosRHView })));
const UsuariosView                 = lazy(() => import('./views/UsuariosView').then(m => ({ default: m.UsuariosView })));
const PDVView                              = lazy(() => import('./views/PDVView').then(m => ({ default: m.PDVView })));
const HistoricoVendasView                  = lazy(() => import('./views/HistoricoVendasView').then(m => ({ default: m.HistoricoVendasView })));
const DevolucoesView                       = lazy(() => import('./views/DevolucoesView').then(m => ({ default: m.DevolucoesView })));
const AlcadasView                          = lazy(() => import('./views/AlcadasView').then(m => ({ default: m.AlcadasView })));
const PromocoesMarketingView               = lazy(() => import('./views/PromocoesMarketingView').then(m => ({ default: m.PromocoesMarketingView })));
const CampanhasMarketingView               = lazy(() => import('./views/CampanhasMarketingView').then(m => ({ default: m.CampanhasMarketingView })));
const CuponsMarketingView                  = lazy(() => import('./views/CuponsMarketingView').then(m => ({ default: m.CuponsMarketingView })));
const CalendarioEditorialView              = lazy(() => import('./views/CalendarioEditorialView').then(m => ({ default: m.CalendarioEditorialView })));
const AprovacoesPromocaoFinanceiroView     = lazy(() => import('./views/AprovacoesPromocaoFinanceiroView').then(m => ({ default: m.AprovacoesPromocaoFinanceiroView })));
const TarefasMarketingView                 = lazy(() => import('./views/TarefasMarketingView').then(m => ({ default: m.TarefasMarketingView })));
const TarefasView                          = lazy(() => import('./views/TarefasView').then(m => ({ default: m.TarefasView })));
const PesquisasView                        = lazy(() => import('./views/PesquisasView').then(m => ({ default: m.PesquisasView })));
const MinhasPesquisasView                  = lazy(() => import('./views/MinhasPesquisasView').then(m => ({ default: m.MinhasPesquisasView })));
const ArtesPromocionaisView                = lazy(() => import('./views/ArtesPromocionaisView').then(m => ({ default: m.ArtesPromocionaisView })));
const AprovacoesConteudoMarketingView      = lazy(() => import('./views/AprovacoesConteudoMarketingView').then(m => ({ default: m.AprovacoesConteudoMarketingView })));
const ControleCaixaView                    = lazy(() => import('./views/ControleCaixaView').then(m => ({ default: m.ControleCaixaView })));
const SimuladorPagamentoView               = lazy(() => import('./views/SimuladorPagamentoView').then(m => ({ default: m.SimuladorPagamentoView })));
const RegistroPontoExpressView             = lazy(() => import('./views/RegistroPontoExpressView').then(m => ({ default: m.RegistroPontoExpressView })));
const TIView                               = lazy(() => import('./views/TIView').then(m => ({ default: m.TIView })));
const DesenvolvimentoIAView                = lazy(() => import('./views/DesenvolvimentoIAView').then(m => ({ default: m.DesenvolvimentoIAView })));
const CentralTempoView                     = lazy(() => import('./views/CentralTempoView').then(m => ({ default: m.CentralTempoView })));
const CategoriasProdutoView                = lazy(() => import('./views/CategoriasProdutoView').then(m => ({ default: m.CategoriasProdutoView })));
const CatalogoProdutosView                 = lazy(() => import('./views/CatalogoProdutosView').then(m => ({ default: m.CatalogoProdutosView })));
const OrcamentosView                       = lazy(() => import('./views/OrcamentosView').then(m => ({ default: m.OrcamentosView })));
const PedidosVendaView                     = lazy(() => import('./views/PedidosVendaView').then(m => ({ default: m.PedidosVendaView })));
const ClienteEspecialView                  = lazy(() => import('./views/ClienteEspecialView').then(m => ({ default: m.ClienteEspecialView })));
const MetricasRedesSociaisView             = lazy(() => import('./views/MetricasRedesSociaisView').then(m => ({ default: m.MetricasRedesSociaisView })));
const MatrizRHView                         = lazy(() => import('./views/MatrizRHView').then(m => ({ default: m.MatrizRHView })));
const MatrizFinanceiroView                 = lazy(() => import('./views/MatrizFinanceiroView').then(m => ({ default: m.MatrizFinanceiroView })));
const MatrizLogisticaView                  = lazy(() => import('./views/MatrizLogisticaView').then(m => ({ default: m.MatrizLogisticaView })));
const MatrizMarketingView                  = lazy(() => import('./views/MatrizMarketingView').then(m => ({ default: m.MatrizMarketingView })));
const MatrizOperacoesView                  = lazy(() => import('./views/MatrizOperacoesView').then(m => ({ default: m.MatrizOperacoesView })));
const MatrizCapitalView                    = lazy(() => import('./views/MatrizCapitalView').then(m => ({ default: m.MatrizCapitalView })));
const FilialCapitalView                    = lazy(() => import('./views/FilialCapitalView').then(m => ({ default: m.FilialCapitalView })));
const HubView                              = lazy(() => import('./views/SessoesGeraisView').then(m => ({ default: m.HubView })));
const AulaModoView                         = lazy(() => import('./views/AulaModoView').then(m => ({ default: m.AulaModoView })));

// --- menu ---
// Submenu pode ser uma string (acesso conforme o módulo pai) ou um objeto
// { label, requireRole?, requireSetor? } pra esconder linha por role/setor
// (ex.: Cliente Especial só admin/CEO; Pedidos de Venda no Estoque só pra
// logística). Funções de filtro estão em filterSubmenus() abaixo.
type SubmenuItem = string | { label: string; requireRole?: string[]; requireSetor?: string[] };
const menuModules: { id: string; label: string; icon: any; submenus: SubmenuItem[]; isNew?: boolean; color?: string }[] = [
  {
    id: 'empresa', label: 'Empresa', icon: Building2,
    submenus: ['Filiais', 'Formas de pagamento', 'Condições de pagamento', 'Projetos', 'Tarefas']
  },
  {
    // Cadastros operacionais — Produtos, Categorias, Fornecedores e Serviços.
    // Acesso restrito a admin/CEO (via SETOR_MODULES 'all') e setor logística.
    // Outros setores não veem o módulo nem suas rotas (RLS continua sendo
    // a fonte de verdade). Colaboradores foi movido para RH; Clientes vive
    // em Vendas; Centros de custo agora pertence ao Financeiro. Categorias
    // veio de Empresa — é pré-requisito de Produto, faz mais sentido aqui.
    id: 'cadastros', label: 'Cadastros', icon: Database,
    submenus: ['Categorias', 'Produtos', 'Fornecedores', 'Serviços']
  },
  {
    id: 'compras', label: 'Compras', icon: ShoppingCart,
    submenus: ['Requisições', 'Cotações', 'Pedidos', 'Minhas aprovações', 'Recebimentos', 'Notas recebidas', 'Sugestões de compras', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'estoque', label: 'Estoque', icon: Package,
    submenus: ['Requisições', 'Minhas Aprovações', 'Expedição', 'Movimentações', 'Saldos', 'Inventários',
      { label: 'Pedidos de Venda', requireSetor: ['logistica'] },
      'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'financeiro', label: 'Financeiro', icon: DollarSign,
    submenus: ['Controle de Caixa', 'Contas a receber', 'Contas a pagar', 'Caixa / Bancos', 'Patrimônio', 'Duplicatas',
      { label: 'Juros & Multa', requireSetor: ['financeiro'] },
      'Aprovações de Cotação', 'Aprovações de Orçamento', 'Aprovações de Promoções', 'Aprovações de Conteúdo',
      { label: 'Alçadas', requireRole: ['admin', 'ceo'] },
      { label: 'Pedidos de Venda', requireSetor: ['financeiro'] },
      { label: 'Recibos de Vendas', requireSetor: ['financeiro'] },
      'Capital', 'Integração bancária', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'rh', label: 'Recursos Humanos', icon: Users,
    submenus: ['Funcionários', 'Departamentos', 'Cargos', 'Ponto Eletrônico', 'Frequência de Trabalho', 'Férias', 'Afastamentos', 'Folha de Pagamento', 'Benefícios', 'Treinamentos', 'Pesquisas', 'Gerenciamento', 'Relatórios', 'Tarefas']
  },
  {
    id: 'vendas', label: 'Vendas', icon: ShoppingBag,
    submenus: ['PDV', 'Clientes', 'Orçamentos', 'Pedidos de Venda', 'Histórico de Vendas',
      { label: 'Devoluções', requireRole: ['admin', 'ceo', 'gerente'] },
      { label: 'Cliente Especial', requireRole: ['admin', 'ceo'] },
      'Tarefas'],
  },
  {
    id: 'marketing', label: 'Marketing', icon: Megaphone,
    submenus: [
      'Redes Sociais',
      'Campanhas', 'Promoções', 'Cupons', 'Calendário',
      { label: 'Vitrine Pública', requireSetor: ['marketing'] },
      'Tarefas',
    ],
  },
  {
    id: 'ti', label: 'TI & Suporte', icon: Monitor,
    submenus: ['Chamados', 'Desenvolvimento com IA'],
  },
];

// Helpers: extrai label e checa RBAC granular do submenu.
const subLabel = (s: SubmenuItem): string => typeof s === 'string' ? s : s.label;
const subPermitido = (s: SubmenuItem, profile: any): boolean => {
  if (typeof s === 'string') return true;
  if (s.requireRole && !s.requireRole.includes(profile?.role)) return false;
  if (s.requireSetor) {
    // admin/CEO/gerente sempre passam (gerente vê tudo da própria filial —
    // RLS confina via auth_gerente_da, ver 20260713i_gerente_ve_tudo_da_filial_v2).
    if (profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente') return true;
    const setores = [profile?.setor, ...(profile?.setores_extras ?? [])].filter(Boolean);
    if (!s.requireSetor.some((sec: string) => setores.includes(sec))) return false;
  }
  return true;
};

const SidebarNav = ({ activeView, navigate, openModules, toggleModule, handleSignOut, onClose, visibleModules, profile, badges, matrizMode, aulaAllow }: any) => (
  <>
    <div className="relative flex justify-center px-1 mb-4">
      <div className="logo-shimmer inline-block">
        <img
          src="/icon-logmax.png"
          alt="LogMax"
          className="w-36 h-36 object-contain block"
        />
      </div>
      {onClose && (
        <button onClick={onClose} className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <X size={16} />
        </button>
      )}
    </div>

    <nav className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
      <div className="flex flex-col gap-2">
        <button onClick={() => { navigate('inicio'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'inicio' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
          <Home size={18} /><span>Início</span>
        </button>
        {aulaAllow('dashboard') && (profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile)
          || profile?.role === 'gerente') && (
          <button onClick={() => { navigate('dashboard'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'dashboard' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <BarChart3 size={18} /><span>Dashboard</span>
          </button>
        )}
        {/* Painel de BI e Briefing Diário: em modo Matriz vivem no hub "Análise com IA". */}
        {/* Em modo filial estão ocultos por design. */}
        {aulaAllow('usuarios') && (profile?.role === 'admin' || profile?.role === 'ceo'
          || (profile?.role === 'gerente' && profile?.pode_acessar_usuarios !== false)
          || hasSetor(profile, 'rh')) && (
          <button onClick={() => { navigate('usuarios'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'usuarios' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <UserCog size={18} /><span>Usuários</span>
          </button>
        )}
        {/* Modo Aula: config global (whitelist de módulos por turma). Só admin/CEO,
            SEMPRE visível pra eles em modo Matriz — jamais cai no filtro do próprio
            Modo Aula (evita lockout). Some no modo filial: não faz sentido configurar
            turmas a partir de dentro de uma unidade. */}
        {matrizMode && (profile?.role === 'admin' || profile?.role === 'ceo') && (
          <button onClick={() => { navigate('aula-modo'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'aula-modo' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <GraduationCap size={18} /><span>Modo Aula</span>
          </button>
        )}
        {/* Catálogo de Produtos: vitrine read-only visível pra todos os setores */}
        {aulaAllow('catalogo-produtos') && (
          <button onClick={() => { navigate('catalogo-produtos'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'catalogo-produtos' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <BookOpen size={18} /><span>Catálogo</span>
          </button>
        )}
        {/* Avaliações: só no modo Matriz */}
        {matrizMode && aulaAllow('avaliacoes') && (
          <button onClick={() => { navigate('avaliacoes'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'avaliacoes' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Star size={18} /><span>Avaliações</span>
          </button>
        )}
        {/* Sessões Gerais: no modo Matriz, aparece dentro da seção Matriz abaixo.
            No modo filial já foi renderizado acima. */}
        {/* Feedback & Requerimentos: unificado numa tela com abas — canal anônimo
            (colaborador/gerente envia, admin/CEO lê) + requerimentos formais
            (todos criam, gerente/Matriz respondem). Funciona nos dois modos:
            a view decide internamente Requerimentos vs MatrizRequerimentos
            olhando filialAtiva. */}
        {aulaAllow('feedback-org') && (
          <button onClick={() => { navigate('feedback-org'); onClose?.(); }} className={`flex items-start gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold text-left ${activeView === 'feedback-org' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <MessageSquare size={18} className="shrink-0 mt-0.5" /><span className="leading-tight">Feedback & Requerimentos</span>
          </button>
        )}
        {/* Metas — em ambos os modos. No filial, também replica no Acesso Rápido da Início. */}
        {aulaAllow('metas') && (
          <button onClick={() => { navigate('metas'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'metas' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Target size={18} /><span>Metas</span>
          </button>
        )}
      </div>

      <div>
        <div className="flex flex-col gap-1.5">
          {/* Modo Matriz: 3 hubs top-level (Sessões Gerais, Análise com IA, Comparativos)
              + Capital, que continua na sidebar. Requerimentos vive na aba
              unificada "Feedback & Requerimentos" acima. */}
          {matrizMode && (
            <>
              <div className="mt-4 mb-1.5 px-1">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full"
                  style={{ color: '#000000', background: '#F0B429', border: '1px solid #F0B429' }}>
                  <Layers size={10} /> Matriz
                </span>
              </div>
              <button onClick={() => { navigate('sessoes-gerais'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-medium ${activeView === 'sessoes-gerais' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Layers size={16} /><span>Sessões Gerais</span>
              </button>
              <button onClick={() => { navigate('analise-ia'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-medium ${activeView === 'analise-ia' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Brain size={16} /><span>Análise com IA</span>
              </button>
              <button onClick={() => { navigate('comparativos-matriz'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-medium ${activeView === 'comparativos-matriz' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <BarChart3 size={16} /><span>Comparativos Matriz</span>
              </button>
              <button onClick={() => { navigate('matriz-capital'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-medium ${activeView === 'matriz-capital' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Landmark size={16} /><span>Capital</span>
              </button>
            </>
          )}

          {visibleModules.map((mod: any) => {
            // Cabeçalhos de bloco inseridos antes de módulos âncora
            const blockLabel =
              mod.id === 'empresa'    ? 'Geral' :
              mod.id === 'cadastros'  ? 'Logística' :
              mod.id === 'financeiro' ? 'Finanças' :
              mod.id === 'rh'         ? 'Gestão de Pessoas' :
              mod.id === 'vendas'     ? 'Vendas e Atendimento' :
              mod.id === 'marketing'  ? 'Marketing e Brand' :
              mod.id === 'ti'         ? 'Tecnologia e IA' :
              null;
            const isOpen = openModules[mod.id];
            const Icon = mod.icon;
            return (
              <div key={mod.id} className="flex flex-col">
                {blockLabel && (
                  <div className="mt-4 mb-1.5 px-1">
                    <span className="inline-block text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full"
                      style={{ color: '#000000', background: '#F0B429', border: '1px solid #F0B429' }}>
                      {blockLabel}
                    </span>
                  </div>
                )}
                <button onClick={() => toggleModule(mod.id)} className={`flex items-center justify-between p-2.5 rounded-xl transition-all text-sm font-medium ${isOpen ? 'nav-item neu-flat text-gray-200 border border-white/5 is-active' : 'nav-item neu-button text-gray-100'}`}>
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
                        {mod.submenus
                          .filter((sub: any) => {
                            if (!subPermitido(sub, profile)) return false;
                            const label = subLabel(sub);
                            const viewId = `${mod.id}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;
                            return aulaAllow(viewId);
                          })
                          .map((sub: any) => {
                            const label = subLabel(sub);
                            const viewId = `${mod.id}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;
                            const isActive = activeView === viewId;
                            return (
                              <div key={label} className="relative">
                                <button onClick={() => { navigate(viewId); onClose?.(); }}
                                  className={`w-full nav-subitem flex items-center justify-between text-xs py-2 px-3 pl-9 pr-3 rounded-lg leading-tight border-l-2 ${isActive ? `is-active font-bold bg-white/5 ${!mod.color ? 'text-accent border-accent' : ''}` : 'text-gray-200 border-transparent'}`}
                                  style={isActive && mod.color ? { color: mod.color, borderColor: mod.color } : {}}>
                                  <span>{label}</span>
                                  {(badges?.[viewId] ?? 0) > 0 && (
                                    <span className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[9px] font-black text-black shrink-0 ml-1">
                                      {badges[viewId] > 9 ? '9+' : badges[viewId]}
                                    </span>
                                  )}
                                </button>
                              </div>
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
      className="flex items-center justify-center gap-2 p-3 rounded-xl neu-button text-gray-100 hover:text-red-500 transition-all mt-auto border border-transparent hover:border-red-500/10 text-sm font-medium">
      <LogOut size={16} /><span>Sair</span>
    </button>
  </>
);

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'claro' : 'escuro';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      onClick={toggleTheme}
      title={`Mudar para modo ${next}`}
      className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors"
    >
      <Icon size={16} />
    </button>
  );
}


type AccentOption = {
  id: 'green' | 'yellow' | 'purple' | 'orange' | 'blue' | 'pink' | 'red' | 'acessivel';
  hex: string;
  label: string;
  /** Cor secundária (renderizada como swatch bicolor) — usada no preset de acessibilidade */
  secondaryHex?: string;
  /** Marca o preset como destinado a acessibilidade visual (selo + título descritivo) */
  accessible?: boolean;
};

const ACCENT_OPTIONS: readonly AccentOption[] = [
  { id: 'acessivel', hex: '#F97316', secondaryHex: '#7DD3FC',
    label: 'Acessibilidade', accessible: true },
] as const;

function AccentPicker() {
  const { accentColor, setAccentColor } = useTheme();
  const isActive = accentColor === 'acessivel';

  return (
    <button
      title={isActive ? 'Desativar modo acessibilidade' : 'Ativar modo acessibilidade — alto contraste'}
      aria-label="Tema de acessibilidade: laranja com ícones azul claro"
      aria-pressed={isActive}
      onClick={() => setAccentColor(isActive ? 'green' : 'acessivel')}
      className={`neu-button w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${isActive ? 'text-accent' : 'text-gray-400 hover:text-accent'}`}
    >
      <Eye size={16} />
    </button>
  );
}

function LogMaxAppInner() {
  const { user, isLoading: authLoading, isAuthenticated, signOut } = useAuth();
  const { profile, isLoading: profileLoading, refetch: refetchProfile } = useUserProfile();
  const { theme } = useTheme();
  // Assinatura tem 2 variantes: padrão (dourado claro) para fundos escuros e
  // -modoclaro (escura) para fundo branco do tema light.
  const assinaturaSrc = theme === 'light' ? '/icon-assinatura-modoclaro.png' : '/icon-assinatura.png';
  // Persistido em sessionStorage para sobreviver a F5/pull-to-refresh
  // sem voltar para 'inicio'. Limpa ao fechar a aba e no logout.
  const [activeView, setActiveView] = useState<string>(() => {
    try {
      const raw = sessionStorage.getItem('logmax:activeView') || 'inicio';
      // Migração de rotas após reorganização dos submenus:
      //   - Produtos/Serviços saíram de Empresa → módulo Cadastros (novo).
      //   - Colaboradores removido (redundante com Funcionários em RH).
      //   - Clientes saiu de Empresa (já existia em Vendas).
      //   - Centros de custo saiu de Empresa → Financeiro.
      // Redireciona sessões antigas pra não cair no fallback "em desenvolvimento".
      const migrado = raw
        .replace(/^empresa-produtos$/,         'cadastros-produtos')
        .replace(/^empresa-serviços$/,         'cadastros-serviços')
        .replace(/^empresa-colaboradores$/,    'rh-funcionários')
        .replace(/^rh-colaboradores$/,         'rh-funcionários')
        .replace(/^empresa-clientes$/,         'vendas-clientes')
        .replace(/^empresa-fornecedores$/,     'cadastros-fornecedores')
        // Votações removida; Feedback + Requerimentos unificados numa só tela com abas.
        .replace(/^votacoes$/,                 'inicio')
        .replace(/^matriz-votacoes$/,          'inicio')
        .replace(/^requerimentos$/,            'feedback-org')
        .replace(/^matriz-requerimentos$/,     'feedback-org')
        // Categorias saiu de Empresa → Cadastros (pré-requisito de Produto).
        .replace(/^empresa-categorias$/,       'cadastros-categorias');
      return migrado;
    } catch { return 'inicio'; }
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
  // Refs espelham o estado atual pra que navigate/goBack não precisem chamar
  // setState aninhado (padrão anti-React: updater pode reexecutar em StrictMode
  // dev ou em renders concorrentes, duplicando entradas na pilha e fazendo o
  // botão Voltar pular vários passos de uma vez).
  const activeViewRef = useRef(activeView);
  const viewHistoryRef = useRef(viewHistory);
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);
  useEffect(() => { viewHistoryRef.current = viewHistory; }, [viewHistory]);
  // Ref usado pelo navigate/goBack pra bloquear views fora da whitelist do
  // Modo Aula sem exigir aulaConfig como dep (evita recriar o callback e
  // invalidar props memoizadas). O ref é atualizado logo abaixo.
  const aulaGuardRef = useRef<(view: string) => boolean>(() => true);
  // Views com navegação interna (HubView macros→modulos→submenus, wizards)
  // registram um back handler que consome um passo interno. Se retornar true,
  // Voltar é considerado tratado e a pilha de views não é despilhada.
  const backHandlerRef = useRef<null | (() => boolean)>(null);
  const registerBackHandler = useCallback((h: (() => boolean) | null) => {
    backHandlerRef.current = h;
  }, []);
  const navigate = useCallback((view: string) => {
    if (!aulaGuardRef.current(view)) return;
    const prev = activeViewRef.current;
    if (prev === view) return;
    // Sair da view atual descarta qualquer back handler interno pendente —
    // ele pertence à view que está saindo.
    backHandlerRef.current = null;
    setViewHistory(h => [...h, prev]);
    setActiveView(view);
  }, []);
  const goBack = useCallback(() => {
    // Primeiro tenta consumir um passo interno da view atual (ex.: HubView
    // volta de submenus → modulos → macros antes de despilhar a view).
    if (backHandlerRef.current?.()) return;
    const h = viewHistoryRef.current;
    if (h.length === 0) return;
    // Pula pra trás enquanto encontrar views bloqueadas pelo Modo Aula
    // (evita o botão Voltar "engolir" a pilha em loop).
    let idx = h.length - 1;
    while (idx >= 0 && !aulaGuardRef.current(h[idx])) idx--;
    if (idx < 0) {
      setActiveView('inicio');
      setViewHistory([]);
      return;
    }
    setActiveView(h[idx]);
    setViewHistory(h.slice(0, idx));
  }, []);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({ empresa: true });
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [perfilFotoOpen, setPerfilFotoOpen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Filial de sessão ── deve ficar ANTES dos early returns para respeitar Rules of Hooks ──
  const { filialAtiva, escolheu, setFilialAtiva, escolherMatriz, clearFilial } = useFilial();

  // Transição Filial → Matriz: reseta activeView pra 'inicio'. Entre filiais
  // (SuperMax → MaxLook) a view atual continua fazendo sentido (produtos,
  // vendas etc.); pra Matriz a maioria das views operacionais é irrelevante.
  const filialAnteriorRef = useRef<FilialOp | null>(filialAtiva);
  useEffect(() => {
    if (filialAnteriorRef.current !== null && filialAtiva === null && escolheu) {
      setActiveView('inicio');
    }
    filialAnteriorRef.current = filialAtiva;
  }, [filialAtiva, escolheu]);

  // Contagens de pendências por submódulo, exibidas como bolinha no Sidebar.
  // Passa filialAtiva pra filtrar badges em modo filial (evita ver pendências
  // de outras filiais). Modo Matriz (null) vê tudo.
  const badges = useSidebarBadges(profile, filialAtiva);
  const { config: aulaConfig } = useAulaConfig();

  // Atualiza o guard que navigate/goBack consultam. Assim clique em card da
  // Início, favorito ou botão Voltar que aponte pra view bloqueada é
  // silenciosamente ignorado — não há flash da view tentando montar.
  useEffect(() => {
    aulaGuardRef.current = (view: string) => aulaPermiteView(aulaConfig, profile, view);
  }, [aulaConfig, profile]);

  // Bloqueio defensivo do Modo Aula: se a view atual deixou de ser permitida
  // (config mudou em realtime ou veio de sessionStorage antigo), redireciona
  // pra Início. Precisa vir antes dos early returns pra respeitar Rules of Hooks.
  useEffect(() => {
    if (!profile) return;
    if (!aulaFiltraUsuario(aulaConfig, profile)) return;
    if (!aulaPermiteView(aulaConfig, profile, activeView)) {
      setActiveView('inicio');
    }
  }, [profile, aulaConfig, activeView]);
  useEffect(() => {
    if (!profile) return;
    const isGlobal = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
    if (isGlobal) return;
    const f = profile.filial as FilialOp | undefined;
    if (f === 'SuperMax' || f === 'MaxLook' || f === 'TechMax') {
      setFilialAtiva(f);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

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

  // Supabase não configurado: sistema fora do ar. Tela específica
  // antes do LoginScreen porque o form de login não consegue chamar
  // signInWithPassword sem o client.
  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base px-6 text-center">
        <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
          <Package size={28} className="text-gray-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-300">Sistema indisponível</h2>
        <p className="text-sm text-gray-500 max-w-md">
          O LogMax está temporariamente fora do ar (configuração do servidor ausente).
          Tente novamente em alguns minutos. Se o problema persistir, avise o administrador.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

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

  const handleSignOut = async () => {
    showToast("Saindo...", 'info', true);
    try {
      sessionStorage.removeItem('logmax:activeView');
      sessionStorage.removeItem('logmax:viewHistory');
    } catch {}
    await signOut();
  };

  const podeEscolherFilial = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);

  // Admin/CEO veem o seletor de filial antes de entrar no app.
  // 'escolheu' distingue "ainda não escolhi" de "escolhi Matriz (consolidado)".
  if (podeEscolherFilial && !escolheu) {
    return (
      <div className="min-h-screen flex flex-col bg-base">
        <div className="shrink-0 flex justify-end items-center px-6 py-4 border-b border-white/5">
          <button
            onClick={handleSignOut}
            className="btn-shimmer btn-shimmer-gold relative flex items-center gap-2.5 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, rgba(212,175,55,0.18) 0%, rgba(255,220,100,0.08) 50%, rgba(212,175,55,0.14) 100%)',
              border: '1px solid rgba(212,175,55,0.45)',
              boxShadow: 'inset 0 1px 0 rgba(255,220,100,0.20), inset 0 0 12px 4px rgba(212,175,55,0.08), 0 2px 12px rgba(212,175,55,0.15)',
              color: 'rgba(212,175,55,0.90)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <LogOut size={15} />
            <span>Sair</span>
          </button>
        </div>
        <FilialSelector
          onSelect={(v) => v === 'Matriz' ? escolherMatriz() : setFilialAtiva(v)}
        />
      </div>
    );
  }

  // Colaborador/gerente sem filial configurada no perfil — erro de cadastro.
  // (podeEscolherFilial=false + filialAtiva=null; nunca cai em Matriz porque
  // esses perfis não têm o botão Matriz no seletor.)
  if (!filialAtiva && !podeEscolherFilial) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base">
        <Building2 size={40} className="text-gray-600" />
        <h2 className="text-lg font-bold text-gray-300">Filial não configurada</h2>
        <p className="text-sm text-gray-500 max-w-sm text-center">
          Seu perfil não possui filial atribuída. Solicite ao administrador.
        </p>
        <button onClick={signOut} className="mt-2 text-xs text-gray-600 hover:text-red-500 transition-colors">Sair</button>
      </div>
    );
  }

  // Módulos visíveis pelo setor do usuário
  // Multi-setor: união dos módulos de todos os setores do usuário (primário + extras).
  // Admin/CEO (setor='all') passam direto. Sem isso, gerente Vendas com extra=ti
  // não veria o módulo TI no menu (RLS já permitiria, só a UX que falhava).
  // Regra de negócio: role='gerente' vê todos os módulos da própria filial
  // — RLS restringe a linha à filial do gerente via auth_gerente_da() (ver
  // 20260713i_gerente_ve_tudo_da_filial_v2.sql).
  const allowedModuleIds = profile?.role === 'gerente'
    ? Array.from(new Set(SETOR_MODULES.all))
    : Array.from(new Set(
        allSetores(profile).flatMap(s => SETOR_MODULES[s] ?? [])
      ));
  const allVisibleModules = menuModules.filter(m => allowedModuleIds.includes(m.id));

  // Em modo Matriz (filialAtiva===null + podeEscolherFilial) a sidebar mostra
  // apenas gerenciamentos/relatórios — operações unit-scoped ficam ocultas.
  const matrizMode = podeEscolherFilial && filialAtiva === null;
  const visibleModulesBase = matrizMode
    // Em Matriz, TODOS os módulos operacionais vivem nos 3 hubs (Sessões Gerais,
    // Análise com IA, Comparativos Matriz). Sidebar top-level fica só com os
    // hubs + Votações/Capital/Requerimentos (injetados manualmente no SidebarNav).
    ? []
    // Em filial: sidebar tradicional com todos os módulos operacionais
    // (velocidade importa mais que hub aqui). Esconde TI — só aparece em
    // Matriz. Empresa aparece pra todo mundo (RBAC já filtra por setor
    // via SETOR_MODULES); filial vê/edita os próprios dados em
    // Categorias, os demais cadastros são globais da empresa toda.
    : allVisibleModules.filter(m => m.id !== 'ti');

  // Modo Aula: whitelist temporária definida pelo admin/CEO. Aplica-se aos
  // roles configurados (admin é sempre isento pra não travar quem administra).
  const aulaFiltro = aulaFiltraUsuario(aulaConfig, profile);
  const aulaAllow = (viewId: string) => !aulaFiltro || aulaPermiteView(aulaConfig, profile, viewId);
  const visibleModules = aulaFiltro
    ? visibleModulesBase.filter(m => aulaConfig.modulos_ativos.includes(m.id))
    : visibleModulesBase;

  const renderContent = () => {
    const st = showToast;
    // Terceira camada de defesa do Modo Aula: se por qualquer motivo a view
    // atual está fora da whitelist (navigate/goBack já filtram; useEffect
    // defensivo redireciona), mostra a tela dedicada em vez de tentar
    // montar a view — evita flash e chamadas de rede desnecessárias.
    if (aulaFiltro && !aulaPermiteView(aulaConfig, profile, activeView)) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full items-center justify-center flex-col gap-4 text-center">
          <div className="neu-pressed w-20 h-20 rounded-full flex items-center justify-center shadow-inner">
            <Lock size={28} className="text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-300">Módulo indisponível na aula</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-sm">
              O Modo Aula está ativo e este módulo não faz parte da whitelist definida pela Matriz.
              Use a barra lateral para acessar os módulos liberados.
            </p>
          </div>
        </motion.div>
      );
    }
    switch (activeView) {
      case 'inicio':                          return <InicioView onNavigate={navigate} profile={profile} badges={badges} matrizMode={matrizMode} />;
      case 'sessoes-gerais':                  return <HubView title="Sessões Gerais" macros={SESSOES_MATRIZ_MACROS} profile={profile} navigate={navigate} badges={badges} registerBackHandler={registerBackHandler} />;
      case 'analise-ia':                      return <HubView title="Análise com IA" macros={ANALISE_IA_MACROS} profile={profile} navigate={navigate} badges={badges} registerBackHandler={registerBackHandler} />;
      case 'comparativos-matriz':             return <HubView title="Comparativos Matriz" macros={COMPARATIVOS_MATRIZ_MACROS} profile={profile} navigate={navigate} badges={badges} registerBackHandler={registerBackHandler} />;
      case 'dashboard':                       return <DashboardAnalyticsView profile={profile} />;
      case 'cadastros-categorias':             return <CategoriasProdutoView showToast={st} profile={profile} />;
      case 'empresa-filiais':                 return <FiliaisView showToast={st} />;
      case 'cadastros-fornecedores':          return <CRMView type="fornecedores" showToast={st} />;
      case 'cadastros-produtos':              return <ProdutosView showToast={st} />;
      case 'cadastros-serviços':              return <ServicosView showToast={st} />;
      case 'empresa-projetos':                return <GenericCRUDView showToast={st} filialScoped title="Projetos" subtitle="Gerencie os projetos em andamento." endpoint="/api/projetosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: PROJ-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Implantação ERP' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: Maria Santos' }, { key: 'data_inicio', label: 'Início', type: 'date' }, { key: 'data_fim', label: 'Fim', type: 'date' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Concluído', 'Cancelado'] }, { key: 'descricao', label: 'Descrição', type: 'textarea', placeholder: 'Objetivos, escopo, observações…' }]} />;
      case 'empresa-condiçõesdepagamento':    return <GenericCRUDView showToast={st} filialScoped title="Condições de Pagamento" subtitle="Gerencie as condições e prazos de pagamento." endpoint="/api/condicoespagamentoview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: 30/60/90 dias' }, { key: 'parcelas', label: 'Parcelas', type: 'number', placeholder: '3' }, { key: 'dias', label: 'Dias', placeholder: 'Ex: 30, 60, 90' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-formasdepagamento':       return <GenericCRUDView showToast={st} filialScoped title="Formas de Pagamento" subtitle="Gerencie as formas de pagamento aceitas." endpoint="/api/formaspagamentoview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: Boleto Bancário' }, { key: 'taxa', label: 'Taxa (%)', type: 'number', placeholder: '0,00' }, { key: 'prazo', label: 'Prazo (dias)', type: 'number', placeholder: '0' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'compras-requisições':             return <RequisicoesView showToast={st} />;
      case 'compras-cotações':                return <CotacoesView showToast={st} profile={profile} />;
      case 'compras-pedidos':                 return <PedidosView showToast={st} />;
      case 'compras-notasrecebidas':          return <NotasRecebidasView showToast={st} />;
      case 'compras-minhasaprovações':        return <AprovacoesComprasView showToast={st} />;
      case 'compras-recebimentos':            return <RecebimentosView showToast={st} />;
      case 'compras-sugestõesdecompras':       return <SugestoesComprasView showToast={st} />;
      case 'compras-gerenciamento':            return <GerenciamentoComprasView />;
      case 'compras-relatórios':              return <RelatoriosComprasView showToast={st} />;
      case 'estoque-minhasaprovações':        return <AprovacoesEstoqueView showToast={st} />;
      case 'estoque-requisições':             return <RequisicoesEstoqueView showToast={st} />;
      case 'estoque-expedição':               return <ExpedicaoView showToast={st} />;
      case 'estoque-movimentações':           return <MovimentacoesEstoqueView showToast={st} />;
      case 'estoque-saldos':                  return <SaldosEstoqueView />;
      case 'estoque-inventários':             return <InventariosView showToast={st} />;
      case 'estoque-gerenciamento':            return <GerenciamentoEstoqueView />;
      case 'estoque-relatórios':              return <RelatoriosEstoqueView showToast={st} />;
      case 'financeiro-controledecaixa':      return <ControleCaixaView showToast={st} profile={profile} />;
      case 'financeiro-contasareceber':       return <ContasReceberView showToast={st} />;
      case 'financeiro-contasapagar':         return <ContasPagarView showToast={st} />;
      case 'financeiro-duplicatas':           return <GenericCRUDView showToast={st} title="Duplicatas" subtitle="Gerencie duplicatas a receber e a pagar." endpoint="/api/duplicatasview"
        fields={[{ key: 'numero', label: 'Número', required: true, placeholder: 'Ex: DUP-001' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['A Receber', 'A Pagar'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'vencimento', label: 'Vencimento', type: 'date' }, { key: 'sacado', label: 'Sacado', placeholder: 'Ex: Empresa XYZ' }, { key: 'status', label: 'Status', type: 'select', options: ['Emitida', 'Paga', 'Vencida', 'Cancelada'] }]} />;
      case 'financeiro-patrimônio':           return <PatrimonioView showToast={st} />;
      case 'financeiro-caixabancos':          return <CaixaBancosView showToast={st} profile={profile} />;
      case 'financeiro-capital':               return <FilialCapitalView showToast={st} profile={profile} />;
      case 'financeiro-integraçãobancária':        return <IntegracaoBancariaView showToast={st} />;
      case 'financeiro-juros&multa':                return <ConfigJurosView showToast={st} />;
      case 'financeiro-aprovaçõesdecotação':       return <CotacoesView showToast={st} profile={profile} />;
      case 'financeiro-aprovaçõesdepromoções':   return <AprovacoesPromocaoFinanceiroView showToast={st} />;
      case 'financeiro-aprovaçõesdeconteúdo':   return <AprovacoesConteudoMarketingView showToast={st} />;
      case 'financeiro-gerenciamento':            return <GerenciamentoFinanceiroView profile={profile} />;
      case 'financeiro-relatórios':               return <RelatoriosFinanceirosView showToast={st} />;
      case 'financeiro-recibosdevendas':          return <RecibosVendasView showToast={st} profile={profile} />;
      case 'rh-funcionários':     return <FuncionariosView showToast={st} />;
      case 'rh-departamentos':    return <GenericCRUDView showToast={st} title="Departamentos" subtitle="Gerencie os departamentos da empresa." endpoint="/api/departamentosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Tecnologia da Informação' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-cargos':           return <GenericCRUDView showToast={st} title="Cargos" subtitle="Gerencie os cargos e níveis salariais." endpoint="/api/cargosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Analista de Sistemas' }, { key: 'nivel', label: 'Nível', type: 'select', options: ['Júnior', 'Pleno', 'Sênior', 'Gerência', 'Diretoria'] }, { key: 'salario_base', label: 'Salário Base (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-folhadepagamento': return <FolhaPagamentoView showToast={st} profile={profile} />;
      case 'rh-férias':           return <FeriasView showToast={st} />;
      case 'rh-pontoeletrônico':  return <PontoEletronicoView showToast={st} profile={profile} />;
      case 'rh-frequênciadetrabalho': return <FrequenciaTrabalhoView showToast={st} profile={profile} />;
      case 'rh-afastamentos':     return <AfastamentosView showToast={st} profile={profile} />;
      case 'rh-benefícios':       return <GenericCRUDView showToast={st} title="Benefícios" subtitle="Gerencie os benefícios oferecidos aos funcionários." endpoint="/api/beneficiosview" filialScoped
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Vale Refeição' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Vale Refeição', 'Vale Transporte', 'Plano de Saúde', 'Plano Odontológico', 'Auxílio Home Office', 'Outros'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-treinamentos':     return <TreinamentosView showToast={st} />;
      case 'rh-pesquisas':        return <PesquisasView showToast={st} profile={profile} />;
      case 'rh-gerenciamento':    return <GerenciamentoRHView />;
      case 'rh-relatórios':       return <RelatoriosRHView showToast={st} />;
      case 'vendas-pdv':                    return <PDVView showToast={st} profile={profile} filialAtiva={filialAtiva} />;
      case 'vendas-clientes':               return <CRMView type="clientes" showToast={st} />;
      case 'vendas-históricodevendas':     return <HistoricoVendasView showToast={st} />;
      case 'vendas-devoluções':            return <DevolucoesView showToast={st} profile={profile} />;
      case 'financeiro-alçadas':           return <AlcadasView showToast={st} profile={profile} />;
      case 'vendas-orçamentos':            return <OrcamentosView showToast={st} profile={profile} />;
      case 'vendas-pedidosdevenda':        return <PedidosVendaView showToast={st} profile={profile} />;
      case 'vendas-clienteespecial':       return <ClienteEspecialView showToast={st} profile={profile} />;
      case 'estoque-pedidosdevenda':       return <PedidosVendaView showToast={st} profile={profile} />;
      case 'financeiro-pedidosdevenda':    return <PedidosVendaView showToast={st} profile={profile} />;
      case 'financeiro-aprovaçõesdeorçamento': return <OrcamentosView showToast={st} profile={profile} mode="financeiro" />;
      case 'marketing-redessociais':        return <MetricasRedesSociaisView showToast={st} profile={profile} />;
      case 'marketing-campanhas':          return <CampanhasMarketingView showToast={st} profile={profile} />;
      case 'marketing-promoções':          return <PromocoesMarketingView showToast={st} profile={profile} />;
      case 'marketing-cupons':             return <CuponsMarketingView showToast={st} profile={profile} />;
      case 'marketing-calendário':         return <CalendarioEditorialView showToast={st} profile={profile} />;
      case 'marketing-vitrinepública':     return <VitrinePublicaView showToast={st} />;
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
      case 'catalogo-produtos':            return <CatalogoProdutosView showToast={st} profile={profile} />;
      case 'avaliacoes':                   return <AvaliacoesView showToast={st} profile={profile} />;
      case 'feedback-org':                 return <FeedbackRequerimentosView showToast={st} profile={profile} />;
      case 'metas':                        return <MetasView showToast={st} profile={profile} />;
      case 'ti-chamados':                  return <TIView showToast={st} profile={profile} />;
      case 'ti-desenvolvimentocomia':      return <DesenvolvimentoIAView showToast={st} profile={profile} />;
      case 'central-tempo':                return <CentralTempoView />;
      case 'painel-bi':                    return <PainelBIView showToast={st} profile={profile} />;
      case 'briefing-diario':              return <BriefingDiarioView showToast={st} profile={profile} />;
      case 'matriz-rh':                    return <MatrizRHView />;
      case 'matriz-financeiro':            return <MatrizFinanceiroView />;
      case 'matriz-logistica':             return <MatrizLogisticaView />;
      case 'matriz-marketing':             return <MatrizMarketingView />;
      case 'matriz-operacoes':             return <MatrizOperacoesView />;
      case 'matriz-capital':               return <MatrizCapitalView showToast={st} profile={profile} />;
      case 'aula-modo':                    return <AulaModoView showToast={st} profile={profile} />;
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
  const canUseMaxAI = hasSetor(profile, 'financeiro');

  return (
    <AIAssistantProvider>
    <AuditoriaProvider>
    <div className="flex h-screen w-full bg-base overflow-hidden" style={{ color: 'var(--color-text-primary)', height: '100dvh' }}>
      <Toast message={toast.message} visible={toast.show} type={toast.type} />
      <PerfilFotoModal
        open={perfilFotoOpen}
        profile={profile}
        onClose={() => setPerfilFotoOpen(false)}
        onUpdated={refetchProfile}
        showToast={showToast}
      />

      {/* MOBILE SIDEBAR OVERLAY */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 w-64 h-full flex flex-col pt-8 pb-5 px-5 gap-6 z-50 neu-flat sidebar-dark lg:hidden">
              <SidebarNav
                activeView={activeView} navigate={navigate}
                openModules={openModules} toggleModule={toggleModule}
                handleSignOut={handleSignOut} onClose={() => setMobileMenuOpen(false)}
                visibleModules={visibleModules} profile={profile} badges={badges}
                matrizMode={matrizMode}
                aulaAllow={aulaAllow}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <aside className="hidden lg:flex w-64 h-full flex-col pt-8 pb-5 px-5 gap-6 shrink-0 z-10 neu-flat sidebar-dark relative">
        <SidebarNav
          activeView={activeView} navigate={navigate}
          openModules={openModules} toggleModule={toggleModule}
          handleSignOut={handleSignOut}
          visibleModules={visibleModules} profile={profile} badges={badges}
          matrizMode={matrizMode}
          aulaAllow={aulaAllow}
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
            <div className="min-w-0 hidden sm:block">
              <img src={assinaturaSrc} alt="Assinatura" className="h-16 w-auto opacity-85 mt-1" />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Modo Aula: sino de notificações e MaxAI ficam ocultos pra quem
                está sob a whitelist — evita vazamento de contexto de módulos
                fora da aula (notificação de outro setor, IA respondendo sobre
                dados que o aluno não deveria ver naquela sessão). */}
            {!aulaFiltro && <NotificationBell setor={profile.setor} onNavigate={navigate} />}
            {canUseMaxAI && !aulaFiltro && <AIAssistantFAB />}
            {podeEscolherFilial && (
              <button
                onClick={clearFilial}
                title="Trocar filial"
                className="neu-button h-9 px-3 rounded-xl flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent border border-accent/20 hover:bg-accent/10 transition-colors shrink-0"
              >
                <Building2 size={13} />
                <span className="hidden sm:inline">{filialAtiva ?? 'Matriz'}</span>
              </button>
            )}
            <ThemeToggle />
            <AccentPicker />

            <div className="neu-flat rounded-2xl py-2 px-3 flex items-center gap-3 border border-white/5">
              <button
                type="button"
                onClick={() => setPerfilFotoOpen(true)}
                title="Trocar foto de perfil"
                className="w-9 h-9 rounded-full neu-pressed flex items-center justify-center border border-accent/20 shrink-0 overflow-hidden hover:border-accent transition-colors"
                style={{ background: 'var(--color-avatar-bg)' }}
              >
                {profile.foto_url ? (
                  <img src={profile.foto_url} alt="Foto de perfil" className="w-full h-full object-cover" />
                ) : (
                  <User size={16} className="text-accent" />
                )}
              </button>
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

        {aulaFiltro && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-accent/20 bg-accent/5">
            <GraduationCap size={16} className="text-accent shrink-0" />
            <span className="text-xs font-bold text-accent uppercase tracking-widest">Modo Aula ativo</span>
            <span className="text-[11px] text-gray-400 truncate">
              {aulaConfig.modulos_ativos.length} módulo{aulaConfig.modulos_ativos.length === 1 ? '' : 's'} liberado{aulaConfig.modulos_ativos.length === 1 ? '' : 's'} pela Matriz
            </span>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ErrorBoundary key={activeView}>
            <Suspense fallback={<PageLoadingFallback />}>
              {renderContent()}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
    </AuditoriaProvider>
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

// Rota /p?t=<token>: destino do QR Code de ponto eletrônico lido pela
// câmera nativa do celular. Faz o auth gate dentro do componente (LoginScreen
// se preciso) e dispara o registro assim que a sessão estiver ativa.
function isPontoExpressRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === '/p';
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
  if (isPontoExpressRoute()) {
    return (
      <ThemeProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <RegistroPontoExpressView />
        </Suspense>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <FilialProvider>
        <ConfirmProvider>
          <PwaUpdatePrompt />
          <LogMaxAppInner />
        </ConfirmProvider>
      </FilialProvider>
    </ThemeProvider>
  );
}
