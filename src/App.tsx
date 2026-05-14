import React, { useState, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useUserProfile } from './hooks/useUserProfile';
import { LoginScreen } from './components/LoginScreen';
import { Toast, LoadingSpinner, PlaceholderView } from './components/ui';
import { motion, AnimatePresence } from 'motion/react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import {
  Home, BarChart3, Building2, ShoppingCart, Package, DollarSign, Users,
  LogOut, User, ChevronDown, Loader2, Menu, X, UserCog, ShoppingBag,
  Sun, Moon
} from 'lucide-react';

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
const GerenciamentoRHView          = lazy(() => import('./views/GerenciamentoRHView').then(m => ({ default: m.GerenciamentoRHView })));
const RelatoriosRHView             = lazy(() => import('./views/RelatoriosRHView').then(m => ({ default: m.RelatoriosRHView })));
const UsuariosView                 = lazy(() => import('./views/UsuariosView').then(m => ({ default: m.UsuariosView })));
const QRTotemView                  = lazy(() => import('./views/QRTotemView').then(m => ({ default: m.QRTotemView })));
const PDVView                      = lazy(() => import('./views/PDVView').then(m => ({ default: m.PDVView })));
const HistoricoVendasView          = lazy(() => import('./views/HistoricoVendasView').then(m => ({ default: m.HistoricoVendasView })));

// --- acesso por setor ---
const SETOR_MODULES: Record<string, string[]> = {
  all:        ['empresa', 'compras', 'estoque', 'financeiro', 'rh', 'vendas'],
  logistica:  ['estoque', 'compras'],
  vendas:     ['vendas', 'empresa'],
  financeiro: ['financeiro'],
  rh:         ['rh'],
};

// --- menu ---
const menuModules = [
  {
    id: 'empresa', label: 'Empresa', icon: Building2,
    submenus: ['Filiais', 'Colaboradores', 'Clientes', 'Fornecedores', 'Produtos', 'Serviços', 'Centros de custo', 'Projetos', 'Condições de pagamento', 'Classificações auxiliares', 'Mapeamentos de rateio', 'Formas de pagamento']
  },
  {
    id: 'compras', label: 'Compras', icon: ShoppingCart,
    submenus: ['Requisições', 'Cotações', 'Pedidos', 'Minhas aprovações', 'Recebimentos', 'Notas recebidas', 'Sugestões de compras', 'Planejamento orçamentário', 'Gerenciamento', 'Relatórios']
  },
  {
    id: 'estoque', label: 'Estoque', icon: Package,
    submenus: ['Minhas Aprovações', 'Requisições', 'Expedição', 'Movimentações', 'Saldos', 'Inventários', 'Previsão de vencimentos', 'Gerenciamento', 'Relatórios']
  },
  {
    id: 'financeiro', label: 'Financeiro', icon: DollarSign,
    submenus: ['Contas a receber', 'Contas a pagar', 'Previsões', 'Duplicatas', 'Caixa / Bancos', 'Integração bancária', 'Gerenciamento', 'Relatórios']
  },
  {
    id: 'rh', label: 'Recursos Humanos', icon: Users,
    submenus: ['Funcionários', 'Departamentos', 'Cargos', 'Folha de Pagamento', 'Férias', 'Ponto Eletrônico', 'Totem QR', 'Benefícios', 'Treinamentos', 'Gerenciamento', 'Relatórios']
  },
  {
    id: 'vendas', label: 'Vendas', icon: ShoppingBag,
    submenus: ['PDV', 'Histórico de Vendas'],
    color: '#FACC15',
  }
];

const SidebarNav = ({ activeView, setActiveView, openModules, toggleModule, handleSignOut, onClose, visibleModules, profile }: any) => (
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
        <button onClick={() => { setActiveView('inicio'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'inicio' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
          <Home size={18} /><span>Início</span>
        </button>
        {profile?.setor === 'all' && (
          <button onClick={() => { setActiveView('dashboard'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'dashboard' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            <BarChart3 size={18} /><span>Dashboard</span>
          </button>
        )}
        {(profile?.role === 'admin' || profile?.role === 'gerente') && (
          <button onClick={() => { setActiveView('usuarios'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all text-sm font-semibold ${activeView === 'usuarios' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
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
                            <button key={sub} onClick={() => { setActiveView(viewId); onClose?.(); }}
                              className={`text-left text-xs py-2 px-3 pl-9 rounded-lg transition-colors leading-tight border-l-2 ${isActive ? `font-bold bg-white/5 ${!mod.color ? 'text-accent border-accent' : ''}` : 'text-gray-500 hover:text-gray-300 border-transparent hover:border-gray-500'}`}
                              style={isActive && mod.color ? { color: mod.color, borderColor: mod.color } : {}}>
                              {sub}
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
      className="flex items-center justify-center gap-2 p-3 rounded-xl neu-button text-gray-400 hover:text-red-400 transition-all mt-auto border border-transparent hover:border-red-500/10 text-sm font-medium">
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

function LogMaxAppInner() {
  const { user, isLoading: authLoading, isAuthenticated, signOut } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile();
  const [activeView, setActiveView] = useState('inicio');
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({ empresa: true });
  const [toast, setToast] = useState({ show: false, message: '', type: 'info' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleModule = (id: string) => setOpenModules(prev => ({ ...prev, [id]: !prev[id] }));

  const showToast = (message: string, type = 'info', autoHide = true) => {
    setToast({ show: true, message, type });
    if (autoHide) {
      setTimeout(() => {
        setToast(prev => prev.message === message ? { ...prev, show: false } : prev);
      }, 3000);
    }
  };

  if (authLoading || (isAuthenticated && profileLoading)) {
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
        <button onClick={signOut} className="mt-2 text-xs text-gray-600 hover:text-red-400 transition-colors">Sair</button>
      </div>
    );
  }

  // Módulos visíveis pelo setor do usuário
  const allowedModuleIds = SETOR_MODULES[profile.setor] ?? [];
  const visibleModules = menuModules.filter(m => allowedModuleIds.includes(m.id));

  const handleSignOut = async () => {
    showToast("Saindo...", 'info', true);
    await signOut();
  };

  const renderContent = () => {
    const st = showToast;
    switch (activeView) {
      case 'inicio':                          return <InicioView onNavigate={setActiveView} showToast={st} profile={profile} />;
      case 'dashboard':                       return <DashboardAnalyticsView />;
      case 'empresa-filiais':                 return <FiliaisView showToast={st} />;
      case 'empresa-colaboradores':           return <ColaboradoresView showToast={st} />;
      case 'empresa-clientes':                return <CRMView type="clientes" showToast={st} />;
      case 'empresa-fornecedores':            return <CRMView type="fornecedores" showToast={st} />;
      case 'empresa-produtos':                return <ProdutosView showToast={st} />;
      case 'empresa-serviços':                return <GenericCRUDView showToast={st} title="Serviços" subtitle="Gerencie os serviços prestados." endpoint="/api/servicosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: SRV-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Instalação' }, { key: 'tipo', label: 'Tipo', placeholder: 'Ex: Manutenção' }, { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-centrosdecusto':          return <GenericCRUDView showToast={st} title="Centros de Custo" subtitle="Gerencie centros de custo e orçamentos." endpoint="/api/centroscustoview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: CC-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: TI' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'number', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-projetos':                return <GenericCRUDView showToast={st} title="Projetos" subtitle="Gerencie os projetos em andamento." endpoint="/api/projetosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: PROJ-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Implantação ERP' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: Maria Santos' }, { key: 'data_inicio', label: 'Início', type: 'date' }, { key: 'data_fim', label: 'Fim', type: 'date' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'number', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Concluído', 'Cancelado'] }]} />;
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
      case 'financeiro-contasareceber':       return <ContasReceberView showToast={st} />;
      case 'financeiro-contasapagar':         return <ContasPagarView showToast={st} />;
      case 'financeiro-previsões':            return <GenericCRUDView showToast={st} title="Previsões Financeiras" subtitle="Gerencie previsões de receitas e despesas." endpoint="/api/previsoesview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: Aluguel Janeiro' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Receita', 'Despesa'] }, { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00' }, { key: 'data', label: 'Data', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['Previsto', 'Realizado', 'Cancelado'] }]} />;
      case 'financeiro-duplicatas':           return <GenericCRUDView showToast={st} title="Duplicatas" subtitle="Gerencie duplicatas a receber e a pagar." endpoint="/api/duplicatasview"
        fields={[{ key: 'numero', label: 'Número', required: true, placeholder: 'Ex: DUP-001' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['A Receber', 'A Pagar'] }, { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00' }, { key: 'vencimento', label: 'Vencimento', type: 'date' }, { key: 'sacado', label: 'Sacado', placeholder: 'Ex: Empresa XYZ' }, { key: 'status', label: 'Status', type: 'select', options: ['Emitida', 'Paga', 'Vencida', 'Cancelada'] }]} />;
      case 'financeiro-caixabancos':          return <GenericCRUDView showToast={st} title="Caixa / Bancos" subtitle="Gerencie contas bancárias e saldos." endpoint="/api/caixabancosview"
        fields={[{ key: 'conta', label: 'Conta', required: true, placeholder: 'Ex: 12345-6' }, { key: 'banco', label: 'Banco', placeholder: 'Ex: Banco do Brasil' }, { key: 'agencia', label: 'Agência', placeholder: 'Ex: 0001' }, { key: 'saldo', label: 'Saldo (R$)', type: 'number', placeholder: '0,00' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Conta Corrente', 'Conta Poupança', 'Caixa', 'Investimento'] }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'financeiro-integraçãobancária':   return <IntegracaoBancariaView showToast={st} />;
      case 'financeiro-gerenciamento':        return <GerenciamentoFinanceiroView />;
      case 'financeiro-relatórios':           return <RelatoriosFinanceirosView showToast={st} />;
      case 'rh-funcionários':     return <FuncionariosView showToast={st} />;
      case 'rh-departamentos':    return <GenericCRUDView showToast={st} title="Departamentos" subtitle="Gerencie os departamentos da empresa." endpoint="/api/departamentosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Tecnologia da Informação' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-cargos':           return <GenericCRUDView showToast={st} title="Cargos" subtitle="Gerencie os cargos e níveis salariais." endpoint="/api/cargosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Analista de Sistemas' }, { key: 'nivel', label: 'Nível', type: 'select', options: ['Júnior', 'Pleno', 'Sênior', 'Gerência', 'Diretoria'] }, { key: 'salario_base', label: 'Salário Base (R$)', type: 'number', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-folhadepagamento': return <FolhaPagamentoView showToast={st} />;
      case 'rh-férias':           return <FeriasView showToast={st} />;
      case 'rh-pontoeletrônico':  return <PontoEletronicoView showToast={st} profile={profile} />;
      case 'rh-totemqr':          return <QRTotemView />;
      case 'rh-benefícios':       return <GenericCRUDView showToast={st} title="Benefícios" subtitle="Gerencie os benefícios oferecidos aos funcionários." endpoint="/api/beneficiosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Vale Refeição' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Vale Refeição', 'Vale Transporte', 'Plano de Saúde', 'Plano Odontológico', 'Auxílio Home Office', 'Outros'] }, { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-treinamentos':     return <TreinamentosView showToast={st} />;
      case 'rh-gerenciamento':    return <GerenciamentoRHView />;
      case 'rh-relatórios':       return <RelatoriosRHView showToast={st} />;
      case 'vendas-pdv':                    return <PDVView showToast={st} profile={profile} />;
      case 'vendas-históricodevendas':     return <HistoricoVendasView showToast={st} />;
      case 'usuarios':                     return <UsuariosView showToast={st} profile={profile} />;
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

  return (
    <div className="flex h-screen w-full bg-base overflow-hidden" style={{ color: 'var(--color-text-primary)' }}>
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
                activeView={activeView} setActiveView={setActiveView}
                openModules={openModules} toggleModule={toggleModule}
                handleSignOut={handleSignOut} onClose={() => setMobileMenuOpen(false)}
                visibleModules={visibleModules} profile={profile}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <aside className="hidden lg:flex w-64 h-full flex-col pt-8 pb-5 px-5 gap-6 shrink-0 z-10 neu-flat relative">
        <SidebarNav
          activeView={activeView} setActiveView={setActiveView}
          openModules={openModules} toggleModule={toggleModule}
          handleSignOut={handleSignOut}
          visibleModules={visibleModules} profile={profile}
        />
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-base p-8">
        <header className="flex justify-between items-center shrink-0 mb-8 border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent transition-colors">
              <Menu size={18} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-200 tracking-wide">Plataforma LogMax</h2>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-1">Ambiente seguro</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            <div className="neu-flat rounded-2xl py-2 px-3 flex items-center gap-4 border border-white/5">
              <div className="w-9 h-9 rounded-full neu-pressed flex items-center justify-center border border-accent/20"
                style={{ background: 'var(--color-avatar-bg)' }}>
                <User size={16} className="text-accent" />
              </div>
              <div className="flex flex-col pr-2">
                <span className="text-sm font-bold text-gray-200 capitalize">{displayName}</span>
                <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5 uppercase tracking-widest font-bold">
                  <span className="text-gray-600">{userEmail}</span>
                  <span className="text-accent">•</span>
                  <button onClick={handleSignOut} className="hover:text-red-400 transition-colors cursor-pointer">Sair</button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<LoadingSpinner />}>
            {renderContent()}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

export default function LogMaxApp() {
  return (
    <ThemeProvider>
      <LogMaxAppInner />
    </ThemeProvider>
  );
}
