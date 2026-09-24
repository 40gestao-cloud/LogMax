import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useUserProfile } from './hooks/useUserProfile';
import { hasSetor, allSetores, isConselheiro, setAulaSetoresConcedidos } from './lib/rbac';
import { useSidebarBadges } from './hooks/useSidebarBadges';
import { useIdleLogout } from './hooks/useIdleLogout';
import { SessaoExpirandoModal } from './components/SessaoExpirandoModal';
import { useAlarmeGlobal } from './hooks/useAlarmesTurma';
import { AlarmeModal } from './components/AlarmeModal';
import { limparCarimbos, limparEstadoDeSessao, registrarMotivoSaida } from './lib/sessaoGuard';
import { reportarRelogioDaMaquina } from './lib/relogioDiagnostico';
import { useComandoRecarga } from './hooks/useComandoRecarga';
import { RecargaRemotaModal } from './components/RecargaRemotaModal';
import { useBlackout } from './hooks/useBlackout';
import { BlackoutBanner } from './components/BlackoutBanner';
import { useAulaConfig } from './hooks/useAulaConfig';
import { useAulaAtividades } from './hooks/useAulaAtividades';
import { aulaFiltraUsuario, aulaPermiteView, aulaSetoresConcedidos } from './lib/aulaModulos';
import { SETOR_MODULES } from './lib/sectorAccess';
import {
  SESSOES_MATRIZ_MACROS, ANALISE_IA_MACROS,
} from './views/SessoesGeraisView';
import { isSupabaseConfigured } from './lib/supabase';
import { LoginScreen } from './components/LoginScreen';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { setViewAtual } from './lib/viewAtual';
import { DesligamentoAviso } from './components/DesligamentoAviso';
import { Toast, LoadingSpinner, PageLoadingFallback } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FaixaEtapaFluxo } from './components/FaixaEtapaFluxo';
import { motion, AnimatePresence } from 'motion/react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { FilialProvider, useFilial } from './contexts/FilialContext';
import { FilialSelector, type FilialOp } from './components/FilialSelector';
import { ComandosProvider, BotaoComandos } from './components/ComandosGlobais';
import {
  Home, BarChart3, Building2, ShoppingCart, Package, DollarSign, Users,
  LogOut, User, ChevronDown, Loader2, Menu, X, UserCog, ShoppingBag,
  IdCard, ScanLine,
  Sun, Moon, Megaphone, ArrowLeft, Monitor, Eye,
  Star, MessageSquare, BookOpen, Database, Target, Brain, ListTodo,
  Layers, Landmark, GraduationCap, Lock, Trophy, ClipboardList, Inbox,
  Presentation, FileText, Hourglass, Dices, FileSignature, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { NotificationBell } from './components/NotificationBell';
import { AvisoDisjuntor } from './components/AvisoDisjuntor';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { PendenciasFAB } from './components/PendenciasFAB';
import { PerfilFotoModal } from './components/PerfilFotoModal';
import { AIAssistantProvider } from './contexts/AIAssistantContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { PromptProvider } from './contexts/PromptContext';

// --- lazy views ---
const InicioView              = lazyView(() => import('./views/InicioView').then(m => ({ default: m.InicioView })));
const DashboardAnalyticsView  = lazyView(() => import('./views/DashboardAnalyticsView').then(m => ({ default: m.DashboardAnalyticsView })));
const FiliaisView             = lazyView(() => import('./views/FiliaisView').then(m => ({ default: m.FiliaisView })));
const CRMView                 = lazyView(() => import('./views/CRMView').then(m => ({ default: m.CRMView })));
const ProdutosView            = lazyView(() => import('./views/ProdutosView').then(m => ({ default: m.ProdutosView })));
const RequisicoesView         = lazyView(() => import('./views/RequisicoesView').then(m => ({ default: m.RequisicoesView })));
const RequisicoesSetorView    = lazyView(() => import('./views/RequisicoesSetorView').then(m => ({ default: m.RequisicoesSetorView })));
const AprovacoesComprasView   = lazyView(() => import('./views/AprovacoesComprasView').then(m => ({ default: m.AprovacoesComprasView })));
const VitrinePublicaView      = lazyView(() => import('./views/VitrinePublicaView').then(m => ({ default: m.VitrinePublicaView })));
const MarketingConfigView     = lazyView(() => import('./views/MarketingConfigView').then(m => ({ default: m.MarketingConfigView })));
const ConfigJurosView         = lazyView(() => import('./views/ConfigJurosView').then(m => ({ default: m.ConfigJurosView })));
const CotacoesView            = lazyView(() => import('./views/CotacoesView').then(m => ({ default: m.CotacoesView })));
const PedidosView             = lazyView(() => import('./views/PedidosView').then(m => ({ default: m.PedidosView })));
const NotasRecebidasView      = lazyView(() => import('./views/NotasRecebidasView').then(m => ({ default: m.NotasRecebidasView })));
const RecebimentosView        = lazyView(() => import('./views/RecebimentosView').then(m => ({ default: m.RecebimentosView })));
const ContasPagarView         = lazyView(() => import('./views/ContasPagarView').then(m => ({ default: m.ContasPagarView })));
const ContasReceberView       = lazyView(() => import('./views/ContasReceberView').then(m => ({ default: m.ContasReceberView })));
const CaixaBancosView         = lazyView(() => import('./views/CaixaBancosView').then(m => ({ default: m.CaixaBancosView })));
const ConciliacaoMaquininhaView = lazyView(() => import('./views/ConciliacaoMaquininhaView').then(m => ({ default: m.ConciliacaoMaquininhaView })));
const GenericCRUDView         = lazyView(() => import('./views/GenericCRUDView').then(m => ({ default: m.GenericCRUDView })));
const ServicosView            = lazyView(() => import('./views/ServicosView').then(m => ({ default: m.ServicosView })));
const MovimentacoesEstoqueView = lazyView(() => import('./views/MovimentacoesEstoqueView').then(m => ({ default: m.MovimentacoesEstoqueView })));
const SaldosEstoqueView       = lazyView(() => import('./views/SaldosEstoqueView').then(m => ({ default: m.SaldosEstoqueView })));
const RequisicoesEstoqueView  = lazyView(() => import('./views/RequisicoesEstoqueView').then(m => ({ default: m.RequisicoesEstoqueView })));
const AprovacoesEstoqueView   = lazyView(() => import('./views/AprovacoesEstoqueView').then(m => ({ default: m.AprovacoesEstoqueView })));
const ExpedicaoView           = lazyView(() => import('./views/ExpedicaoView').then(m => ({ default: m.ExpedicaoView })));
const InventariosView         = lazyView(() => import('./views/InventariosView').then(m => ({ default: m.InventariosView })));
const ValidadesView           = lazyView(() => import('./views/ValidadesView').then(m => ({ default: m.ValidadesView })));
const RelatoriosComprasView        = lazyView(() => import('./views/RelatoriosComprasView').then(m => ({ default: m.RelatoriosComprasView })));
const RelatoriosVendasView         = lazyView(() => import('./views/RelatoriosVendasView').then(m => ({ default: m.RelatoriosVendasView })));
const RelatoriosEstoqueView        = lazyView(() => import('./views/RelatoriosEstoqueView').then(m => ({ default: m.RelatoriosEstoqueView })));
const SugestoesComprasView         = lazyView(() => import('./views/SugestoesComprasView').then(m => ({ default: m.SugestoesComprasView })));
const GerenciamentoComprasView     = lazyView(() => import('./views/GerenciamentoComprasView').then(m => ({ default: m.GerenciamentoComprasView })));
const GerenciamentoEstoqueView     = lazyView(() => import('./views/GerenciamentoEstoqueView').then(m => ({ default: m.GerenciamentoEstoqueView })));
const RelatoriosFinanceirosView    = lazyView(() => import('./views/RelatoriosFinanceirosView').then(m => ({ default: m.RelatoriosFinanceirosView })));
const RecibosVendasView            = lazyView(() => import('./views/RecibosVendasView').then(m => ({ default: m.RecibosVendasView })));
const NotasEmitidasView            = lazyView(() => import('./views/NotasEmitidasView').then(m => ({ default: m.NotasEmitidasView })));
const GerenciamentoFinanceiroView  = lazyView(() => import('./views/GerenciamentoFinanceiroView').then(m => ({ default: m.GerenciamentoFinanceiroView })));
const PatrimonioView               = lazyView(() => import('./views/PatrimonioView').then(m => ({ default: m.PatrimonioView })));
const FuncionariosView             = lazyView(() => import('./views/FuncionariosView').then(m => ({ default: m.FuncionariosView })));
const FolhaPagamentoView           = lazyView(() => import('./views/FolhaPagamentoView').then(m => ({ default: m.FolhaPagamentoView })));
const FeriasView                   = lazyView(() => import('./views/FeriasView').then(m => ({ default: m.FeriasView })));
const PontoEletronicoView          = lazyView(() => import('./views/PontoEletronicoView').then(m => ({ default: m.PontoEletronicoView })));
const AfastamentosView             = lazyView(() => import('./views/AfastamentosView').then(m => ({ default: m.AfastamentosView })));
const DesligamentosView            = lazyView(() => import('./views/DesligamentosView').then(m => ({ default: m.DesligamentosView })));
const RecrutamentoView             = lazyView(() => import('./views/RecrutamentoView').then(m => ({ default: m.RecrutamentoView })));
const PainelBIView                 = lazyView(() => import('./views/PainelBIView').then(m => ({ default: m.PainelBIView })));
const BriefingDiarioView           = lazyView(() => import('./views/BriefingDiarioView').then(m => ({ default: m.BriefingDiarioView })));
const TreinamentosView             = lazyView(() => import('./views/TreinamentosView').then(m => ({ default: m.TreinamentosView })));
const AvaliacoesView               = lazyView(() => import('./views/AvaliacoesView').then(m => ({ default: m.AvaliacoesView })));
const CentralAvaliacaoView         = lazyView(() => import('./views/CentralAvaliacaoView').then(m => ({ default: m.CentralAvaliacaoView })));
const DemandasView                 = lazyView(() => import('./views/DemandasView').then(m => ({ default: m.DemandasView })));
const FeedbackRequerimentosView    = lazyView(() => import('./views/FeedbackRequerimentosView').then(m => ({ default: m.FeedbackRequerimentosView })));
const GerenciamentoRHView          = lazyView(() => import('./views/GerenciamentoRHView').then(m => ({ default: m.GerenciamentoRHView })));
const RelatoriosRHView             = lazyView(() => import('./views/RelatoriosRHView').then(m => ({ default: m.RelatoriosRHView })));
const UsuariosView                 = lazyView(() => import('./views/UsuariosView').then(m => ({ default: m.UsuariosView })));
const PDVView                              = lazyView(() => import('./views/PDVView').then(m => ({ default: m.PDVView })));
const HistoricoVendasView                  = lazyView(() => import('./views/HistoricoVendasView').then(m => ({ default: m.HistoricoVendasView })));
const DevolucoesView                       = lazyView(() => import('./views/DevolucoesView').then(m => ({ default: m.DevolucoesView })));
const PedidosOnlineView                    = lazyView(() => import('./views/PedidosOnlineView').then(m => ({ default: m.PedidosOnlineView })));
const TreinamentoVendasView                = lazyView(() => import('./views/TreinamentoVendasView').then(m => ({ default: m.TreinamentoVendasView })));
const AlcadasView                          = lazyView(() => import('./views/AlcadasView').then(m => ({ default: m.AlcadasView })));
const DREView                              = lazyView(() => import('./views/DREView').then(m => ({ default: m.DREView })));
const PromocoesMarketingView               = lazyView(() => import('./views/PromocoesMarketingView').then(m => ({ default: m.PromocoesMarketingView })));
const CampanhasMarketingView               = lazyView(() => import('./views/CampanhasMarketingView').then(m => ({ default: m.CampanhasMarketingView })));
const CuponsMarketingView                  = lazyView(() => import('./views/CuponsMarketingView').then(m => ({ default: m.CuponsMarketingView })));
const CalendarioEditorialView              = lazyView(() => import('./views/CalendarioEditorialView').then(m => ({ default: m.CalendarioEditorialView })));
const AprovacoesPromocaoFinanceiroView     = lazyView(() => import('./views/AprovacoesPromocaoFinanceiroView').then(m => ({ default: m.AprovacoesPromocaoFinanceiroView })));
const PesquisasView                        = lazyView(() => import('./views/PesquisasView').then(m => ({ default: m.PesquisasView })));
const MinhasPesquisasView                  = lazyView(() => import('./views/MinhasPesquisasView').then(m => ({ default: m.MinhasPesquisasView })));
const MeuCrachaView                        = lazyView(() => import('./views/MeuCrachaView').then(m => ({ default: m.MeuCrachaView })));
const CrachaVirtualView                    = lazyView(() => import('./views/CrachaVirtualView').then(m => ({ default: m.CrachaVirtualView })));
const ArtesPromocionaisView                = lazyView(() => import('./views/ArtesPromocionaisView').then(m => ({ default: m.ArtesPromocionaisView })));
const AprovacoesConteudoMarketingView      = lazyView(() => import('./views/AprovacoesConteudoMarketingView').then(m => ({ default: m.AprovacoesConteudoMarketingView })));
const ControleCaixaView                    = lazyView(() => import('./views/ControleCaixaView').then(m => ({ default: m.ControleCaixaView })));
const SimuladorPagamentoView               = lazyView(() => import('./views/SimuladorPagamentoView').then(m => ({ default: m.SimuladorPagamentoView })));
const RegistroPontoExpressView             = lazyView(() => import('./views/RegistroPontoExpressView').then(m => ({ default: m.RegistroPontoExpressView })));
const DesenvolvimentoIAView                = lazyView(() => import('./views/DesenvolvimentoIAView').then(m => ({ default: m.DesenvolvimentoIAView })));
const RelogioMaquinasView                  = lazyView(() => import('./views/RelogioMaquinasView').then(m => ({ default: m.RelogioMaquinasView })));
const CentralTempoView                     = lazyView(() => import('./views/CentralTempoView').then(m => ({ default: m.CentralTempoView })));
const CategoriasProdutoView                = lazyView(() => import('./views/CategoriasProdutoView').then(m => ({ default: m.CategoriasProdutoView })));
const LixeiraView                          = lazyView(() => import('./views/LixeiraView').then(m => ({ default: m.LixeiraView })));
const CatalogoProdutosView                 = lazyView(() => import('./views/CatalogoProdutosView').then(m => ({ default: m.CatalogoProdutosView })));
const OrcamentosView                       = lazyView(() => import('./views/OrcamentosView').then(m => ({ default: m.OrcamentosView })));
const PedidosVendaView                     = lazyView(() => import('./views/PedidosVendaView').then(m => ({ default: m.PedidosVendaView })));
const ClienteEspecialView                  = lazyView(() => import('./views/ClienteEspecialView').then(m => ({ default: m.ClienteEspecialView })));
const MetricasRedesSociaisView             = lazyView(() => import('./views/MetricasRedesSociaisView').then(m => ({ default: m.MetricasRedesSociaisView })));
const MatrizCompeticaoView                 = lazyView(() => import('./views/MatrizCompeticaoView').then(m => ({ default: m.MatrizCompeticaoView })));
const MatrizAvaliacoesView                 = lazyView(() => import('./views/MatrizAvaliacoesView').then(m => ({ default: m.MatrizAvaliacoesView })));
const MatrizCapitalView                    = lazyView(() => import('./views/MatrizCapitalView').then(m => ({ default: m.MatrizCapitalView })));
const MatrizConteudoView                   = lazyView(() => import('./views/MatrizConteudoView').then(m => ({ default: m.MatrizConteudoView })));
const MandatosView                         = lazyView(() => import('./views/MandatosView').then(m => ({ default: m.MandatosView })));
const FilialCapitalView                    = lazyView(() => import('./views/FilialCapitalView').then(m => ({ default: m.FilialCapitalView })));
const RateioAdministrativoView             = lazyView(() => import('./views/RateioAdministrativoView').then(m => ({ default: m.RateioAdministrativoView })));
const HubView                              = lazyView(() => import('./views/SessoesGeraisView').then(m => ({ default: m.HubView })));
const AulaModoView                         = lazyView(() => import('./views/AulaModoView').then(m => ({ default: m.AulaModoView })));
const AulaAtividadeView                    = lazyView(() => import('./views/AulaAtividadeView').then(m => ({ default: m.AulaAtividadeView })));
const MaxShowsView                         = lazyView(() => import('./views/MaxShowsView').then(m => ({ default: m.MaxShowsView })));
const DocumentosView                       = lazyView(() => import('./views/DocumentosView').then(m => ({ default: m.DocumentosView })));
const ContratosView                        = lazyView(() => import('./views/ContratosView').then(m => ({ default: m.ContratosView })));
const PendenciasView                       = lazyView(() => import('./views/PendenciasView').then(m => ({ default: m.PendenciasView })));

// --- prefetch das views ---
//
// Toda view e `lazy`, entao o chunk dela so comecava a baixar no CLIQUE do
// menu — e ate chegar o utilizador olhava para o PageLoadingFallback. Sao
// 49 KB em Usuarios, 192 KB no PDV, 388 KB no Dashboard: na primeira visita
// de cada tela isso e uma espera visivel, e some na segunda (modulo ja em
// memoria). Era a maior fatia do "atraso ao apertar o menu".
//
// `lazyView` guarda o proprio loader do `lazy()` em `.preload`. Isto importa:
// a primeira versao repetia `import('./views/X')` numa tabela a parte, o que
// dava ao Rollup um segundo ponto de entrada dinamico para cada uma das 110
// views — o grafo de chunks inchou e o build morreu por falta de memoria.
// Assim nao existe nenhum import novo: o grafo e exatamente o de antes.
//
// A tabela e derivada do switch do `renderContent()`. View nova que nao entrar
// aqui apenas nao ganha prefetch — degrada para o comportamento antigo, nunca
// quebra.
type PreloadableView<T extends React.ComponentType<any>> =
  React.LazyExoticComponent<T> & { preload: () => Promise<unknown> };

function lazyView<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): PreloadableView<T> {
  const Componente = lazy(loader) as PreloadableView<T>;
  Componente.preload = loader;
  return Componente;
}

const PREFETCH_VIEW: Record<string, { preload: () => Promise<unknown> }> = {
  'inicio': InicioView,
  'sessoes-gerais': HubView,
  'analise-ia': HubView,
  'dashboard': DashboardAnalyticsView,
  'cadastros-categorias': CategoriasProdutoView,
  'empresa-filiais': FiliaisView,
  'requisicoes-dosetor': RequisicoesSetorView,
  'cadastros-fornecedores': CRMView,
  'cadastros-produtos': ProdutosView,
  'cadastros-serviços': ServicosView,
  'cadastros-lixeira': LixeiraView,
  'empresa-projetos': GenericCRUDView,
  'financeiro-dre': DREView,
  'financeiro-centrosdecusto': GenericCRUDView,
  'empresa-condiçõesdepagamento': GenericCRUDView,
  'empresa-formasdepagamento': GenericCRUDView,
  'compras-requisiçõesdecompra': RequisicoesView,
  'compras-cotações': CotacoesView,
  'compras-pedidos': PedidosView,
  'compras-notasrecebidas': NotasRecebidasView,
  'requisicoes-aprovações': AprovacoesComprasView,
  'compras-sugestõesdecompras': SugestoesComprasView,
  'compras-gerenciamento': GerenciamentoComprasView,
  'compras-relatórios': RelatoriosComprasView,
  'relatorio-vendas': RelatoriosVendasView,
  'estoque-liberarrequisições': AprovacoesEstoqueView,
  'estoque-recebimentos': RecebimentosView,
  'estoque-requisiçõesdematerial': RequisicoesEstoqueView,
  'estoque-expedição': ExpedicaoView,
  'estoque-movimentações': MovimentacoesEstoqueView,
  'estoque-saldos': SaldosEstoqueView,
  'estoque-validades': ValidadesView,
  'estoque-inventários': InventariosView,
  'estoque-gerenciamento': GerenciamentoEstoqueView,
  'estoque-relatórios': RelatoriosEstoqueView,
  'financeiro-controledecaixa': ControleCaixaView,
  'financeiro-contasareceber': ContasReceberView,
  'financeiro-contasapagar': ContasPagarView,
  'financeiro-patrimônio': PatrimonioView,
  'financeiro-caixabancos': CaixaBancosView,
  'financeiro-conciliaçãodamaquininha': ConciliacaoMaquininhaView,
  'financeiro-capital': FilialCapitalView,
  'financeiro-rateioadministrativo': RateioAdministrativoView,
  'rh-mandatos': MandatosView,
  'financeiro-juros&multa': ConfigJurosView,
  'financeiro-aprovaçõesdecotação': CotacoesView,
  'financeiro-aprovaçõesdepromoções': AprovacoesPromocaoFinanceiroView,
  'financeiro-aprovaçõesdeconteúdo': AprovacoesConteudoMarketingView,
  'financeiro-gerenciamento': GerenciamentoFinanceiroView,
  'financeiro-relatórios': RelatoriosFinanceirosView,
  'financeiro-recibosdevendas': RecibosVendasView,
  'financeiro-notasemitidas': NotasEmitidasView,
  'rh-funcionários': FuncionariosView,
  'rh-departamentos': GenericCRUDView,
  'rh-cargos': GenericCRUDView,
  'rh-folhadepagamento': FolhaPagamentoView,
  'rh-férias': FeriasView,
  'rh-registrodeponto': PontoEletronicoView,
  'rh-afastamentos': AfastamentosView,
  'rh-desligamento': DesligamentosView,
  'rh-recrutamentoeseleção': RecrutamentoView,
  'rh-benefícios': GenericCRUDView,
  'rh-treinamentos': TreinamentosView,
  'rh-pesquisas': PesquisasView,
  'rh-gerenciamento': GerenciamentoRHView,
  'rh-relatórios': RelatoriosRHView,
  'vendas-pdv': PDVView,
  'vendas-clientes': CRMView,
  'vendas-históricodevendas': HistoricoVendasView,
  'vendas-devoluções': DevolucoesView,
  'vendas-pedidosonline': PedidosOnlineView,
  'vendas-treinamento': TreinamentoVendasView,
  'financeiro-alçadas': AlcadasView,
  'vendas-orçamentos': OrcamentosView,
  'vendas-pedidosdevenda': PedidosVendaView,
  'vendas-clienteespecial': ClienteEspecialView,
  'estoque-pedidosdevenda': PedidosVendaView,
  'financeiro-pedidosdevenda': PedidosVendaView,
  'financeiro-aprovaçõesdeorçamento': OrcamentosView,
  'marketing-redessociais': MetricasRedesSociaisView,
  'marketing-campanhas': CampanhasMarketingView,
  'marketing-promoções': PromocoesMarketingView,
  'marketing-cupons': CuponsMarketingView,
  'marketing-calendário': CalendarioEditorialView,
  'marketing-vitrinepública': VitrinePublicaView,
  'marketing-configurações': MarketingConfigView,
  'minhas-pesquisas': MinhasPesquisasView,
  'artes-promocionais': ArtesPromocionaisView,
  'usuarios': UsuariosView,
  'meu-cracha': MeuCrachaView,
  'cracha-virtual': CrachaVirtualView,
  'catalogo-produtos': CatalogoProdutosView,
  'avaliacoes': CentralAvaliacaoView,
  'demandas': DemandasView,
  'demandas-metas': DemandasView,
  'demandas-conselho': DemandasView,
  'metas': DemandasView,
  'feedback-org': FeedbackRequerimentosView,
  'ti-desenvolvimentocomia': DesenvolvimentoIAView,
  'ti-relógiodasmáquinas': RelogioMaquinasView,
  'central-tempo': CentralTempoView,
  'painel-bi': PainelBIView,
  'briefing-diario': BriefingDiarioView,
  'matriz-competicao': MatrizCompeticaoView,
  'matriz-avaliacoes': CentralAvaliacaoView,
  'matriz-capital': MatrizCapitalView,
  'matriz-conteudo': MatrizConteudoView,
  'aula-modo': AulaModoView,
  'aula-atividade': AulaAtividadeView,
  'max-show': MaxShowsView,
  'documentos': DocumentosView,
  'contratos': ContratosView,
  'pendencias': PendenciasView,
};

// Hover-intent. Sem isto, arrastar o rato do topo da sidebar ate "Sair"
// atravessa todos os itens do caminho e dispara um import() em cada um — 10 a
// 20 chunks que ninguem pediu, e com a turma inteira a fazer o mesmo isso e um
// pico na wifi do laboratorio. Com 80ms de pousio, so o item onde o ponteiro
// realmente para e que baixa. O pointerdown nao passa por aqui: la a intencao
// e inequivoca e cada milissegundo conta.
//
// Um temporizador so chega: apenas um item pode estar sob o ponteiro de cada
// vez, e entrar no seguinte cancela o anterior.
const HOVER_INTENT_MS = 80;
let hoverIntentTimer: ReturnType<typeof setTimeout> | null = null;

function prefetchOnHover(view: string) {
  if (hoverIntentTimer !== null) clearTimeout(hoverIntentTimer);
  hoverIntentTimer = setTimeout(() => {
    hoverIntentTimer = null;
    prefetchView(view);
  }, HOVER_INTENT_MS);
}

function cancelPrefetchHover() {
  if (hoverIntentTimer === null) return;
  clearTimeout(hoverIntentTimer);
  hoverIntentTimer = null;
}

const viewPrefetched = new Set<string>();
function prefetchView(view: string) {
  if (viewPrefetched.has(view)) return;
  const alvo = PREFETCH_VIEW[view];
  if (!alvo) return;
  viewPrefetched.add(view);
  // Falha de rede aqui e irrelevante: o `lazy()` tenta de novo na montagem.
  // Tiramos do Set para o proximo toque poder reaquecer.
  alvo.preload().catch(() => viewPrefetched.delete(view));
}

// --- menu ---
// Submenu pode ser uma string (acesso conforme o módulo pai) ou um objeto
// { label, requireRole?, requireSetor? } pra esconder linha por role/setor
// (ex.: Cliente Especial só admin/CEO; Pedidos de Venda no Estoque só pra
// logística). Funções de filtro estão em filterSubmenus() abaixo.
// `requireMatriz` esconde a linha quando há filial ativa: é ato da Matriz, não
// operação da unidade. Não confundir com requireRole — o mesmo admin/CEO vê o
// item na Matriz e não vê depois de entrar numa filial.
type SubmenuItem = string | { label: string; requireRole?: string[]; requireSetor?: string[]; requireMatriz?: boolean };
const menuModules: { id: string; label: string; icon: any; submenus: SubmenuItem[]; isNew?: boolean; color?: string }[] = [
  {
    // Empresa é parametrização: filiais, formas e condições de pagamento,
    // projetos. Dado de referência que se configura uma vez.
    id: 'empresa', label: 'Empresa', icon: Building2,
    submenus: ['Filiais', 'Formas de pagamento', 'Condições de pagamento', 'Projetos']
  },
  {
    // Módulo próprio desde 2026-07-28. Requisições morava dentro de Empresa
    // por conveniência — era o único módulo que todo setor enxergava —, mas
    // Empresa é parametrização e requisição é trabalho transacional do dia.
    // Um colaborador tinha de abrir um menu chamado "Empresa" para pedir
    // papel A4; o nome não dizia nada sobre o que se faz ali.
    //
    // Aqui as duas pontas do fluxo ficam juntas e nomeadas pelo que são:
    // 'Do Setor' é o que a área pediu (escopo de setor, migr. 285 — a
    // requisição pertence a quem precisa do item, não a quem a digitou), e
    // 'Aprovações' é a caixa de decisão do gerente, role-gated: quem não
    // decide não vê. Compras e Estoque seguem com as filas de execução nos
    // próprios módulos ('Requisições Recebidas') — mesmo documento, outro
    // recorte.
    //
    // Visível a todo setor via SETOR_MODULES. Em Matriz não aparece porque
    // nenhum módulo operacional aparece (visibleModulesBase = [] lá; o menu
    // da holding são os 3 hubs), e é o certo — requisição é da filial.
    id: 'requisicoes', label: 'Requisições', icon: ClipboardList,
    submenus: ['Do Setor',
      { label: 'Aprovações', requireRole: ['gerente', 'admin', 'ceo'] }]
  },
  {
    // Cadastros operacionais — Produtos, Categorias, Fornecedores e Serviços.
    // Acesso restrito a admin/CEO (via SETOR_MODULES 'all') e setor logística.
    // Outros setores não veem o módulo nem suas rotas (RLS continua sendo
    // a fonte de verdade). Colaboradores foi movido para RH; Clientes vive
    // em Vendas; Centros de custo agora pertence ao Financeiro. Categorias
    // veio de Empresa — é pré-requisito de Produto, faz mais sentido aqui.
    id: 'cadastros', label: 'Cadastros', icon: Database,
    // Lixeira é do administrador do sistema, não do setor: restaurar e apagar
    // de vez cadastro alheio não é jogada de competição. `requireRole` literal
    // porque auth_is_admin() inclui CEO e conselheiro, que são alunos.
    submenus: ['Categorias', 'Produtos', 'Fornecedores', 'Serviços',
               { label: 'Lixeira', requireRole: ['admin'] }]
  },
  {
    // Compras compra: cota, emite pedido e lança a nota. NÃO aprova (a
    // decisão da requisição é do gerente, migr. 282) e NÃO recebe — quem
    // confere a mercadoria é o Estoque, senão quem emite o pedido confirma a
    // própria entrega (migr. 284).
    id: 'compras', label: 'Compras', icon: ShoppingCart,
    // 'Requisições de Compra', e não 'Requisições Recebidas': Estoque tinha um
    // submenu com esse nome idêntico apontando para outro documento
    // (`requisicoes_estoque`). Mesmo rótulo em dois módulos apagava justamente
    // a distinção que a aula quer ensinar — requisição de compra é uma coisa,
    // requisição de almoxarifado é outra.
    submenus: ['Requisições de Compra', 'Cotações', 'Pedidos',
      'Notas recebidas', 'Sugestões de compras', 'Gerenciamento', 'Relatórios']
  },
  {
    // Recebimentos veio de Compras (migr. 284): conferir e dar entrada é do
    // almoxarifado. É essa conferência que libera o pagamento no Financeiro.
    id: 'estoque', label: 'Estoque', icon: Package,
    // 'Requisições de Material' (conferir/corrigir) x 'Liberar Requisições'
    // (dar baixa). São etapas diferentes do mesmo documento, e o nome antigo
    // — 'Requisições Recebidas' — colidia com o submenu de Compras.
    submenus: ['Requisições de Material', 'Liberar Requisições', 'Recebimentos', 'Expedição', 'Movimentações', 'Saldos', 'Validades', 'Inventários',
      { label: 'Pedidos de Venda', requireSetor: ['logistica'] },
      'Gerenciamento', 'Relatórios']
  },
  {
    id: 'financeiro', label: 'Financeiro', icon: DollarSign,
    // 'Duplicatas' e 'Integração bancária' saíram do menu em 2026-07-28
    // (auditoria de veracidade): eram formulários que não geravam conta nem
    // conciliavam nada. As tabelas seguem no banco, como nas votações.
    submenus: ['Controle de Caixa', 'Contas a receber', 'Contas a pagar', 'Caixa / Bancos',
      // Migr. 570: onde a taxa da maquininha deixa de ser número na proposta e
      // vira despesa de verdade. Entra logo depois de Caixa / Bancos porque é a
      // tela que explica a diferença entre o que foi vendido e o que caiu na
      // conta.
      'Conciliação da Maquininha', 'Patrimônio',
      // Centros de Custo saiu de Empresa e ficou sem tela nenhuma: a tabela é
      // truncada no reset de produção e não havia por onde repovoar, então o
      // select de centro de custo da Requisição só mostrava "Não informar".
      // Escrita é admin/CEO porque a policy de centros_custo é auth_is_admin().
      { label: 'Centros de Custo', requireRole: ['admin', 'ceo'] },
      // Orçamento Anual (378) e Prestação de Contas (379) saíram em 2026-08-17
      // com a deliberação de valores do Conselho (migr. 441). Aprovações de
      // Orçamento, logo abaixo, é outra coisa: cotação de compra, e continua.
      // (Sem aspas nos nomes de propósito: o parser do tests/rotas.test.ts lê
      // este bloco como texto e leria label entre aspas como submenu real.)
      //
      // DRE (migr. 425). Fica antes das aprovações porque é leitura de
      // resultado, não fila de trabalho — e é a tela que responde "deu lucro?",
      // que o resto do módulo não respondia.
      'DRE',
      { label: 'Juros & Multa', requireSetor: ['financeiro'] },
      'Aprovações de Cotação', 'Aprovações de Orçamento', 'Aprovações de Promoções', 'Aprovações de Conteúdo',
      { label: 'Alçadas', requireRole: ['admin', 'ceo'] },
      { label: 'Pedidos de Venda', requireSetor: ['financeiro'] },
      { label: 'Recibos de Vendas', requireSetor: ['financeiro'] },
      'Notas Emitidas',
      'Capital',
      // Destinação do Resultado (381) saiu junto com o resto do trio: repartir
      // o lucro entre reserva, reinvestimento e distribuição era deliberação do
      // Conselho (migr. 441).
      'Gerenciamento', 'Relatórios']
  },
  {
    id: 'rh', label: 'Recursos Humanos', icon: Users,
    // Os submenus com dado de remuneração ou de vida do colaborador levam
    // `requireSetor: ['rh']`. Hoje isso não tira nada de ninguém — quem chega
    // no módulo já é RH, gerente ou Matriz (ver SETOR_MODULES). É defesa em
    // profundidade, e o precedente é concreto: 'gerencia' já foi adicionado à
    // lista de setores com 'rh', e naquele dia os 13 submenus abriram juntos
    // porque não havia régua nenhuma abaixo do módulo. Com o gate declarado,
    // a próxima inclusão abre só o que for decidido abrir.
    //
    // `subPermitido` deixa admin/CEO/gerente passar por cima de requireSetor —
    // gerente opera a filial inteira, inclusive a folha dela.
    submenus: [
      'Funcionários',
      { label: 'Departamentos', requireSetor: ['rh'] },
      { label: 'Cargos', requireSetor: ['rh'] },
      // 'Ponto Eletrônico' + 'Frequência de Trabalho' viraram um submenu só
      // (2026-07-29). Depois da migr. 289 os dois escreviam na mesma tabela:
      // eram dois modos de entrada do mesmo dado, não duas coisas.
      //
      // Com o totem removido da UI no mesmo dia, o colaborador deixou de ter o
      // que fazer aqui — marcar o próprio ponto era exatamente a função do
      // totem. Por isso o submenu ganhou requireSetor: sem ele, o colaborador
      // abriria uma tela com uma aba de lançamento que não pode usar.
      { label: 'Registro de Ponto', requireSetor: ['rh'] },
      'Férias',
      { label: 'Afastamentos', requireSetor: ['rh'] },
      // RH/gerência da unidade instruem o processo e admin/CEO decidem
      // (migr. 318 — a 307 deixava tudo na Matriz). Gate do módulo, não da
      // decisão: `subPermitido` já deixa gerente passar por requireSetor.
      { label: 'Desligamento', requireSetor: ['rh'] },
      // Abrir vaga é do RH da filial; aprovar o headcount é só admin/CEO
      // (migrs. 311/312) — mesma régua de Desligamento. A view é uma só: sem
      // filial ativa ela vira o modo Matriz, com a fila de aprovação das 3
      // unidades e o processo interno inter-filiais.
      { label: 'Recrutamento e Seleção', requireSetor: ['rh'] },
      { label: 'Folha de Pagamento', requireSetor: ['rh'] },
      // Mandatos (migr. 383) fica ao lado de Desligamento: os dois são o
      // começo e o fim da vida de um posto. Sem requireSetor — quem é o
      // titular da unidade não é dado sigiloso, e nomear/encerrar é a RPC
      // que barra, não o menu.
      // requireMatriz (2026-08-09): nomear o titular é ato da Matriz sobre a
      // unidade, não operação dentro dela. A filial não nomeia o próprio
      // gestor — e via o item mesmo sem poder concluir a ação.
      { label: 'Mandatos', requireMatriz: true },
      { label: 'Benefícios', requireSetor: ['rh'] },
      'Treinamentos',
      { label: 'Pesquisas', requireSetor: ['rh'] },
      'Gerenciamento',
      { label: 'Relatórios', requireSetor: ['rh'] },
    ]
  },
  {
    id: 'vendas', label: 'Vendas', icon: ShoppingBag,
    // 'Cliente Especial' NÃO entra aqui: é decisão de holding e já vive em
    // Matriz (Sessões Gerais → Governança). A filial faz o orçamento; quem
    // marca o cliente como especial — e recebe esse orçamento — é a Matriz.
    // Ter o submenu nos dois lugares duplicava a mesma tela e sugeria que a
    // filial decidia algo que não é dela. A rota 'vendas-clienteespecial'
    // continua existindo, servindo o hub da Matriz.
    submenus: ['PDV', 'Clientes', 'Orçamentos', 'Pedidos de Venda', 'Pedidos Online', 'Histórico de Vendas',
      { label: 'Devoluções', requireRole: ['admin', 'ceo', 'gerente'] }, 'Treinamento'],
  },
  {
    // Vitrine Pública saiu daqui em 2026-07-24 — passou a ser controlada
    // exclusivamente pela Matriz (Sessões Gerais → Marketing), já que a
    // tela de login é única e a vitrine é institucional da holding.
    id: 'marketing', label: 'Marketing', icon: Megaphone,
    submenus: [
      'Redes Sociais',
      'Campanhas', 'Promoções', 'Cupons', 'Calendário',
    ],
  },
  {
    id: 'ti', label: 'TI & Suporte', icon: Monitor,
    // Chamados removido em 2026-07-27: o fluxo de abertura de chamado saiu de
    // operação (tabela zerada nas 4 turmas). O módulo continua vivo por causa
    // de Desenvolvimento com IA, onde a agenda de tarefas segue sendo criada.
    submenus: ['Desenvolvimento com IA'],
  },
];

// Helpers: extrai label e checa RBAC granular do submenu.
const subLabel = (s: SubmenuItem): string => typeof s === 'string' ? s : s.label;
// `aulaAberta` = Modo Aula filtrando este usuário. Nesse caso a whitelist da
// aula substitui o recorte por setor (migr. 317 concede o setor na RLS junto),
// senão o aluno de vendas veria o módulo RH da aula pela metade. `requireRole`
// continua valendo: aula não promove colaborador a aprovador.
const subPermitido = (s: SubmenuItem, profile: any, aulaAberta = false, matrizMode = false): boolean => {
  if (typeof s === 'string') return true;
  // Modo, antes de papel: nomear é ato da Matriz. Vale inclusive na aula — a
  // whitelist escolhe QUAIS telas aparecem, não em que contexto elas existem.
  if (s.requireMatriz && !matrizMode) return false;
  if (s.requireRole && !s.requireRole.includes(profile?.role)) return false;
  if (s.requireSetor) {
    if (aulaAberta) return true;
    // admin/CEO/gerente sempre passam (gerente vê tudo da própria filial —
    // RLS confina via auth_gerente_da, ver 20260713i_gerente_ve_tudo_da_filial_v2).
    if (profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente') return true;
    const setores = [profile?.setor, ...(profile?.setores_extras ?? [])].filter(Boolean);
    if (!s.requireSetor.some((sec: string) => setores.includes(sec))) return false;
  }
  return true;
};

// Views que existem em UM modo só. O menu já as esconde, mas ele não é a única
// porta: activeView vem do sessionStorage, dos cards da Início e do botão
// Voltar. Sem esta lista, uma view da Matriz sobrevivia à troca pra filial
// (relatado em 2026-08-07) e vice-versa.
// Só entram aqui as views cujo item de menu é condicionado a `matrizMode` —
// as telas que aparecem nos dois modos e se adaptam por dentro (feedback-org,
// avaliacoes, financeiro-*) ficam de fora de propósito.
const MATRIZ_ONLY_VIEWS = new Set([
  'sessoes-gerais', 'analise-ia', 'matriz-capital', 'matriz-conteudo', 'matriz-competicao',
  'matriz-avaliacoes', 'aula-modo',
  // Único item de submenu com requireMatriz — precisa estar aqui pelo mesmo
  // motivo dos hubs: o menu não é a única porta pra chegar na view.
  'rh-mandatos',
]);
const FILIAL_ONLY_VIEWS = new Set(['demandas']);
// `pendencias` não cabe em nenhuma das duas listas porque o modo em que ela vive
// depende do PAPEL (migr. 527): para o professor é tela de Matriz — o mapa
// atravessa as três unidades, e abri-lo dentro de uma filial contradiz o
// contexto que ele acabou de escolher. Para o gerente é o oposto: ele nunca
// entra em Matriz, e a tela é justamente a da filial dele.
const viewPermitidaNoModo = (view: string, matrizMode: boolean, role?: string): boolean => {
  // CEO e conselheiro também têm modo Matriz, mas a RPC recusa os dois (são
  // alunos): sem o `role === 'admin'` aqui, eles chegariam na tela por uma porta
  // que não é o menu — sessionStorage, card da Início, botão Voltar — e leriam
  // um 42501 em vez de nada.
  if (view === 'pendencias') return role === 'gerente' ? !matrizMode : (role === 'admin' && matrizMode);
  return matrizMode ? !FILIAL_ONLY_VIEWS.has(view) : !MATRIZ_ONLY_VIEWS.has(view);
};

const SidebarNav = ({ activeView, navigate, openModules, toggleModule, handleSignOut, onClose, visibleModules, profile, badges, matrizMode, aulaAllow, aulaFiltro, atividadesAula, atividadesNaoLidas }: any) => (
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
        <button onClick={onClose} className="absolute right-0 top-1/2 -translate-y-1/2 modal-close-btn">
          <X size={16} />
        </button>
      )}
    </div>

    <nav className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
      <div className="flex flex-col gap-2">
        <button onPointerEnter={() => prefetchOnHover('inicio')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('inicio')} onClick={() => { navigate('inicio'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'inicio' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
          <Home size={18} /><span>Início</span>
        </button>
        {/* Atividade da aula: só aparece para quem recebeu alguma vigente, e por
            isso não tem condição de role — o filtro é a própria existência da
            atividade (a RLS da migr. 403 já recorta por filial e público). */}
        {atividadesAula > 0 && (
          <button onPointerEnter={() => prefetchOnHover('aula-atividade')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('aula-atividade')} onClick={() => { navigate('aula-atividade'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'aula-atividade' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <ClipboardList size={18} /><span className="flex-1 text-left">Atividade da aula</span>
            {atividadesNaoLidas > 0 && (
              <span className="text-[9px] font-black min-w-5 h-5 px-1.5 rounded-full bg-accent text-black flex items-center justify-center">
                {atividadesNaoLidas}
              </span>
            )}
          </button>
        )}
        {aulaAllow('dashboard') && (profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile)
          || profile?.role === 'gerente') && (
          <button onPointerEnter={() => prefetchOnHover('dashboard')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('dashboard')} onClick={() => { navigate('dashboard'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'dashboard' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <BarChart3 size={18} /><span>Dashboard</span>
          </button>
        )}
        {/* Painel de BI e Briefing Diário: em modo Matriz vivem no hub "Análise com IA". */}
        {/* Em modo filial estão ocultos por design. */}
        {aulaAllow('usuarios') && (profile?.role === 'admin' || profile?.role === 'ceo'
          || (profile?.role === 'gerente' && profile?.pode_acessar_usuarios !== false)
          || hasSetor(profile, 'rh')) && (
          <button onPointerEnter={() => prefetchOnHover('usuarios')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('usuarios')} onClick={() => { navigate('usuarios'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'usuarios' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <UserCog size={18} /><span>Usuários</span>
          </button>
        )}
        {/* Meu Crachá: o QR que o aluno mostra para ter a presença registrada.
            É crachá DELE — ligado à pessoa, não à tela. Por isso some para o
            professor: quem lê os crachás da turma faz isso por Crachá Virtual,
            e um "meu crachá" na barra dele seria um cartão que ninguém vai ler.
            CEO e conselheiro continuam vendo: são alunos como os outros.

            Sem `aulaAllow` de propósito: uma aula cuja whitelist não listasse
            este módulo tiraria o crachá da tela justamente no dia em que ele é
            usado. */}
        {profile?.role !== 'admin' && (
        <button onPointerEnter={() => prefetchOnHover('meu-cracha')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('meu-cracha')} onClick={() => { navigate('meu-cracha'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'meu-cracha' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
          <IdCard size={18} /><span>Meu Crachá</span>
        </button>
        )}
        {/* Crachá Virtual: o outro lado do mesmo par — quem LÊ o crachá e grava
            a presença. Só o professor, e só em modo Matriz: a leitura atravessa
            as unidades (a turma inteira passa na mesma fila), e de dentro de uma
            filial a lista viria pela metade. */}
        {matrizMode && profile?.role === 'admin' && (
          <button onPointerEnter={() => prefetchOnHover('cracha-virtual')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('cracha-virtual')} onClick={() => { navigate('cracha-virtual'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'cracha-virtual' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <ScanLine size={18} /><span>Crachá Virtual</span>
          </button>
        )}
        {/* Modo Aula: config global (whitelist de módulos por turma). Só admin/CEO,
            SEMPRE visível pra eles em modo Matriz — jamais cai no filtro do próprio
            Modo Aula (evita lockout). Some no modo filial: não faz sentido configurar
            turmas a partir de dentro de uma unidade. */}
        {matrizMode && (profile?.role === 'admin' || profile?.role === 'ceo') && (
          <button onPointerEnter={() => prefetchOnHover('aula-modo')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('aula-modo')} onClick={() => { navigate('aula-modo'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'aula-modo' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <GraduationCap size={18} /><span>Modo Aula</span>
          </button>
        )}
        {/* Max Show: era o submódulo "Show" do módulo Max Work, que também tinha
            Max Docs e Max Planilhas. Os dois saíram em 2026-07-29 — cinco dias no
            ar, zero documento e zero planilha criados nas 4 turmas, e levavam 157 MB
            de @univerjs no node_modules mais um bug recorrente de singleton
            duplicado. Sobrando um só, módulo colapsável com um item dentro era
            cerimônia sem conteúdo: virou item de primeiro nível.
            Aberto pra todo mundo; cada aluno edita só o próprio material; docente
            (admin/CEO/conselheiro) enxerga todos via RLS. Aula-aware. */}
        {aulaAllow('max-show') && (
          <button onPointerEnter={() => prefetchOnHover('max-show')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('max-show')} onClick={() => { navigate('max-show'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'max-show' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Presentation size={18} /><span>Max Show</span>
          </button>
        )}
        {/* Catálogo de Produtos: vitrine read-only visível pra todos os setores */}
        {aulaAllow('catalogo-produtos') && (
          <button onPointerEnter={() => prefetchOnHover('catalogo-produtos')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('catalogo-produtos')} onClick={() => { navigate('catalogo-produtos'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'catalogo-produtos' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <BookOpen size={18} /><span>Catálogo</span>
          </button>
        )}
        {/* Pendências (migr. 477): nasceu como aba do Modo Aula, mas a pergunta
            "o que está parado e com quem?" é de qualquer terça-feira, não só de
            dia de aula. Primeiro nível, e só para o professor: a tela atravessa
            as três unidades e diz o nome de quem está devendo.
            Mesmo componente da aba — uma tela, duas portas.

            Migr. 527: o gerente entra junto, mas só enxerga a unidade dele —
            e quem recorta é a RPC, não este `if`. "O que está parado na minha
            filial e com quem?" é o trabalho do gerente todo dia, não um
            relatório sobre ele.

            O modo depende do papel. Para o professor a tela é da MATRIZ: ela
            atravessa as três unidades, e oferecê-la dentro de uma filial
            contradiz o contexto que ele acabou de escolher. O gerente nunca
            entra em Matriz, então para ele é o contrário. `viewPermitidaNoModo`
            repete a mesma régua — o menu não é a única porta. */}
        {((profile?.role === 'admin' && matrizMode) || profile?.role === 'gerente') && (
          <button onPointerEnter={() => prefetchOnHover('pendencias')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('pendencias')} onClick={() => { navigate('pendencias'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'pendencias' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Hourglass size={18} /><span>Pendências</span>
          </button>
        )}
        {/* Documentos da Matriz: mão única — o professor publica, todo mundo
            baixa. Sem aulaAllow de propósito: o roteiro da atividade costuma
            ser um PDF, e some-lo no Modo Aula tiraria o módulo justamente da
            hora em que ele serve. */}
        <button onPointerEnter={() => prefetchOnHover('documentos')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('documentos')} onClick={() => { navigate('documentos'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'documentos' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
          <FileText size={18} /><span>Documentos</span>
        </button>
        {/* Contratos entre unidades (migr. 623). Papel de gestão: o gerente e o
            professor assinam, CEO e conselheiro acompanham. Colaborador não
            tem contrato nenhum para ver — a RLS devolveria a lista vazia. */}
        {['admin', 'ceo', 'conselheiro', 'gerente'].includes(profile?.role) && (
          <button onPointerEnter={() => prefetchOnHover('contratos')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('contratos')} onClick={() => { navigate('contratos'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'contratos' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <FileSignature size={18} /><span>Contratos</span>
          </button>
        )}
        {/* Central de Avaliação (modo filial): hub com abas Padrão/Metas.
            No modo Matriz o item vive sob Competição, na seção Matriz abaixo. */}
        {!matrizMode && aulaAllow('avaliacoes') && (
          <button onPointerEnter={() => prefetchOnHover('avaliacoes')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('avaliacoes')} onClick={() => { navigate('avaliacoes'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'avaliacoes' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Star size={18} /><span>Central de Avaliação</span>
          </button>
        )}
        {/* Demandas (modo filial): Metas Estratégicas + Demandas do Conselho.
            Admin/CEO em filial mode também veem — permite controlar o que
            chegou pra filial. Some em modo Matriz (lá as demandas são criadas). */}
        {!matrizMode && aulaAllow('demandas') && (
          <button onPointerEnter={() => prefetchOnHover('demandas')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('demandas')} onClick={() => { navigate('demandas'); onClose?.(); }} className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-semibold ${activeView === 'demandas' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <Inbox size={18} /><span>Demandas</span>
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
          <button onPointerEnter={() => prefetchOnHover('feedback-org')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('feedback-org')} onClick={() => { navigate('feedback-org'); onClose?.(); }} className={`flex items-start gap-3 p-2.5 rounded-xl text-sm font-semibold text-left ${activeView === 'feedback-org' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
            <MessageSquare size={18} className="shrink-0 mt-0.5" /><span className="leading-tight">Feedback & Requerimentos</span>
          </button>
        )}
        {/* Metas foi consolidada dentro da Central de Avaliação (aba Metas). */}
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
              <button onPointerEnter={() => prefetchOnHover('sessoes-gerais')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('sessoes-gerais')} onClick={() => { navigate('sessoes-gerais'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'sessoes-gerais' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Layers size={16} /><span>Sessões Gerais</span>
              </button>
              <button onPointerEnter={() => prefetchOnHover('analise-ia')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('analise-ia')} onClick={() => { navigate('analise-ia'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'analise-ia' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Brain size={16} /><span>Análise com IA</span>
              </button>
              <button onPointerEnter={() => prefetchOnHover('matriz-capital')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('matriz-capital')} onClick={() => { navigate('matriz-capital'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'matriz-capital' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Landmark size={16} /><span>Capital</span>
              </button>
              {profile?.role === 'admin' && (
                <button onPointerEnter={() => prefetchOnHover('matriz-conteudo')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('matriz-conteudo')} onClick={() => { navigate('matriz-conteudo'); onClose?.(); }}
                  className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'matriz-conteudo' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                  <Dices size={16} /><span>Conteúdo</span>
                </button>
              )}
              <button onPointerEnter={() => prefetchOnHover('matriz-competicao')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('matriz-competicao')} onClick={() => { navigate('matriz-competicao'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'matriz-competicao' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Trophy size={16} /><span>Competição</span>
              </button>
              <button onPointerEnter={() => prefetchOnHover('avaliacoes')} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView('avaliacoes')} onClick={() => { navigate('avaliacoes'); onClose?.(); }}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-sm font-medium ${activeView === 'avaliacoes' ? 'nav-item neu-pressed text-accent is-active' : 'nav-item neu-button text-gray-100'}`}>
                <Star size={16} /><span>Central de Avaliação</span>
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
                <button onClick={() => toggleModule(mod.id)} className={`flex items-center justify-between p-2.5 rounded-xl text-sm font-medium ${isOpen ? 'nav-item neu-flat text-gray-200 border border-white/5 is-active' : 'nav-item neu-button text-gray-100'}`}>
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
                            if (!subPermitido(sub, profile, aulaFiltro, matrizMode)) return false;
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
                                <button onPointerEnter={() => prefetchOnHover(viewId)} onPointerLeave={cancelPrefetchHover} onPointerDown={() => prefetchView(viewId)} onClick={() => { navigate(viewId); onClose?.(); }}
                                  className={`w-full nav-subitem flex items-center justify-between gap-2 text-xs py-2 px-3 pl-9 pr-3 rounded-lg leading-tight border-l-2 text-left ${isActive ? `is-active font-bold bg-white/5 ${!mod.color ? 'text-accent border-accent' : ''}` : 'text-gray-200 border-transparent'}`}
                                  style={isActive && mod.color ? { color: mod.color, borderColor: mod.color } : {}}>
                                  <span className="flex-1 min-w-0 text-left">{label}</span>
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
        // Auditoria inteira sai (2026-08-08): Comitê, trilha e Matriz de
        // Riscos. O histórico de cada documento continua dentro dele.
        .replace(/^comite-auditoria$/,         'inicio')
        .replace(/^auditoria$/,                'inicio')
        .replace(/^riscos$/,                   'inicio')
        // Remuneração Variável sai (2026-08-09): o placar da competição volta
        // a ser orgulho, não dinheiro. Folha e carteira seguem intactas.
        .replace(/^rh-remuneraçãovariável$/,   'inicio')
        // Políticas saiu: sobrepunha Avisos da Matriz + "Ciente" e nunca teve
        // uma linha em nenhuma das 4 turmas.
        .replace(/^politicas$/,                'inicio')
        // Deliberação de valores sai (2026-08-17, migr. 441): o Conselho não
        // delibera mais verba, contas nem repartição de lucro. Mandatos e o
        // Painel de Governança ficam.
        .replace(/^financeiro-orçamentoanual$/,        'inicio')
        .replace(/^financeiro-prestaçãodecontas$/,     'inicio')
        .replace(/^financeiro-destinaçãodoresultado$/, 'inicio')
        // Votações removida; Feedback + Requerimentos unificados numa só tela com abas.
        .replace(/^votacoes$/,                 'inicio')
        .replace(/^matriz-votacoes$/,          'inicio')
        .replace(/^requerimentos$/,            'feedback-org')
        .replace(/^matriz-requerimentos$/,     'feedback-org')
        // Categorias saiu de Empresa → Cadastros (pré-requisito de Produto).
        .replace(/^empresa-categorias$/,       'cadastros-categorias')
        // Ponto Eletrônico + Frequência de Trabalho → Registro de Ponto (abas).
        .replace(/^rh-pontoeletrônico$/,        'rh-registrodeponto')
        .replace(/^rh-frequênciadetrabalho$/,   'rh-registrodeponto')
        // Requisições saiu de Empresa e virou módulo próprio. Três nomes
        // antigos convergem: o original, o intermediário sem possessivo
        // (migr. 285) e a caixa de aprovação.
        .replace(/^empresa-minhasrequisições$/, 'requisicoes-dosetor')
        .replace(/^empresa-requisições$/,       'requisicoes-dosetor')
        .replace(/^empresa-aprovações$/,        'requisicoes-aprovações')
        // 'Requisições Recebidas' existia com nome idêntico em Compras e em
        // Estoque, para documentos diferentes. Cada um ganhou o nome do seu.
        .replace(/^compras-requisiçõesrecebidas$/, 'compras-requisiçõesdecompra')
        .replace(/^estoque-requisiçõesrecebidas$/, 'estoque-requisiçõesdematerial');
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
  // Espelha a tela aberta num módulo, para quem vive fora desta árvore: o
  // registador do service worker monta acima daqui e precisa saber se pode
  // recarregar a página (src/lib/viewAtual.ts).
  useEffect(() => {
    setViewAtual(activeView);
    return () => setViewAtual(null);
  }, [activeView]);
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
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() => {
    try { return localStorage.getItem('logmax:sidebar-recolhida') === '1'; } catch { return false; }
  });
  const alternarSidebar = useCallback(() => {
    setSidebarRecolhida(v => {
      try { localStorage.setItem('logmax:sidebar-recolhida', v ? '0' : '1'); } catch { /* aba privada */ }
      return !v;
    });
  }, []);
  const [perfilFotoOpen, setPerfilFotoOpen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Filial de sessão ── deve ficar ANTES dos early returns para respeitar Rules of Hooks ──
  const { filialAtiva, escolheu, setFilialAtiva, escolherMatriz, clearFilial } = useFilial();

  // Qualquer troca de contexto (Filial↔Matriz ou entre filiais) reseta
  // activeView pra 'inicio'. Cada contexto tem sidebar/RBAC diferentes,
  // manter a view anterior gera flash de "sem permissão" ou dados de
  // outra filial.
  // Feito durante o render (padrão "store info from previous renders") em
  // vez de useEffect: assim o reset acontece ANTES do commit, sem flash da
  // view antiga sob a nova filial.
  //
  // O ref guarda a última escolha COMMITADA (só é tocado quando escolheu=true)
  // e nasce com o sentinel 'UNSET' quando ninguém escolheu ainda. A primeira
  // escolha da sessão não reseta — é ali que o activeView restaurado do
  // sessionStorage (ou a filial injetada pelo efeito do colaborador) deve
  // sobreviver. Da segunda em diante, toda troca reseta.
  //
  // Versão anterior usava um `primeiraTrocaRef` booleano e vazava: quem abria
  // a sessão escolhendo Matriz não disparava mudança nenhuma (null === null),
  // então a flag continuava intacta e era consumida pela PRIMEIRA troca real
  // — Matriz → Filial mantinha a view da Matriz. O sentinel distingue
  // "nunca escolhi" de "escolhi Matriz", que é justamente o que faltava.
  const filialAnteriorRef = useRef<FilialOp | null | 'UNSET'>(escolheu ? filialAtiva : 'UNSET');
  if (escolheu && filialAnteriorRef.current !== filialAtiva) {
    const primeiraEscolha = filialAnteriorRef.current === 'UNSET';
    filialAnteriorRef.current = filialAtiva;
    if (!primeiraEscolha) setActiveView('inicio');
  }

  // Contagens de pendências por submódulo, exibidas como bolinha no Sidebar.
  // Passa filialAtiva pra filtrar badges em modo filial (evita ver pendências
  // de outras filiais). Modo Matriz (null) vê tudo.
  const badges = useSidebarBadges(profile, filialAtiva);
  const { config: aulaConfig } = useAulaConfig();
  // Atividade publicada pela Matriz (migr. 403). Vive no App, e não num FAB
  // como os avisos, porque todo FAB some no Modo Aula — justamente quando esta
  // é a informação mais importante da tela do aluno.
  //
  // FICA AQUI, junto dos outros hooks, e não lá embaixo perto de onde é usado:
  // deste ponto até o render há seis `return` (Supabase ausente, carregando,
  // não autenticado, sem perfil, escolha de filial, sem filial). Um hook depois
  // deles roda na tela do app e não na de login, e a contagem de hooks muda
  // entre um render e outro — React #310, tela preta em produção (2026-08-10).
  const { atividades: atividadesAula, naoLidas: atividadesNaoLidas } = useAulaAtividades(profile);
  const { blackout } = useBlackout();

  // ── Guard de sessão (lab compartilhado) ──────────────────────────────────
  // Camadas 1 e 3; a 2 roda no boot, em src/lib/sessaoGuard.ts. Fica AQUI em
  // cima, junto dos outros hooks, pelo mesmo motivo do useAulaAtividades: daqui
  // até o render há seis `return`, e hook depois deles muda a contagem de hooks
  // entre renders — React #310, tela preta em produção.
  const encerrarSessaoAutomatica = useCallback(async (motivo: 'inatividade' | 'fim-turno') => {
    limparEstadoDeSessao();
    limparCarimbos();
    // Antes do signOut: ele dispara onAuthStateChange e o LoginScreen pode
    // montar (e ler o motivo) antes deste `await` resolver.
    registrarMotivoSaida(motivo);
    clearFilial();
    await signOut();
  }, [clearFilial, signOut]);

  const { expiraEm: sessaoExpiraEm, continuar: continuarSessao } = useIdleLogout({
    enabled: isAuthenticated,
    onExpirar: encerrarSessaoAutomatica,
  });

  // ── Alarmes da aula (migr. 529) ──────────────────────────────────────────
  // Aqui em cima, junto dos outros hooks e ANTES dos early returns: é o que
  // faz o alarme tocar em qualquer tela. Dentro da Central de Tempo ele
  // morreria ao trocar de view — que era exatamente o defeito antigo.
  const { disparo: alarmeDisparo, silenciar: silenciarAlarme } = useAlarmeGlobal(isAuthenticated);

  // Comando de recarga disparado pelo professor (migr. 564). Aqui em cima pelo
  // mesmo motivo do alarme: tem de alcançar quem está em qualquer tela.
  const comandoRecarga = useComandoRecarga(isAuthenticated);

  // O modal é montado em TODAS as telas de usuário logado, não só na shell.
  // O áudio começa a tocar no hook, que vive acima dos early returns: se o
  // modal só existisse na shell, quem estivesse no seletor de filial ou na
  // tela de "aguardando alocação" ouviria o alarme em loop sem ter botão
  // nenhum para silenciar.
  const alarmeDaAula = alarmeDisparo
    ? <AlarmeModal alarme={alarmeDisparo} onFechar={silenciarAlarme} />
    : null;

  // Vai junto do alarme em todos os returns: a recarga precisa avisar mesmo
  // quem está no seletor de filial ou na tela de "aguardando alocação".
  const avisoDeRecarga = comandoRecarga
    ? <RecargaRemotaModal comando={comandoRecarga} />
    : null;

  // Publica os setores concedidos pela aula para o `hasSetor` global. Feito no
  // corpo do render (não em efeito) porque as views chamam `hasSetor` durante o
  // próprio render — um useEffect chegaria um frame atrasado e a primeira
  // pintura sairia com o gate antigo.
  setAulaSetoresConcedidos(aulaSetoresConcedidos(aulaConfig, profile));

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
    } else {
      // Perfil SEM unidade e sessionStorage com uma unidade antiga (outra conta
      // logada antes nesta aba, ou sessão que expirou sem passar pelo Sair):
      // sem este else o carimbo velho sobrevive, a tela "Aguardando alocação"
      // não aparece e a pessoa opera uma unidade que o banco não reconhece como
      // dela. Ler volta vazio e TODA gravação morre em RLS — foi assim que uma
      // aluna da MaxLook levou "erro de política de segurança" ao salvar
      // categoria, enquanto o resto da turma salvava normal.
      clearFilial();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);


  // Diagnóstico de relógio desta estação (migr. 563), que alimenta
  // Sessões Gerais → TI & Suporte → Relógio das Máquinas. Só depois do perfil:
  // a RPC carimba quem estava na máquina a partir de `auth.uid()`. Falha em
  // silêncio de propósito — é diagnóstico, não operação.
  useEffect(() => {
    if (!profile) return;
    void reportarRelogioDaMaquina();
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

  // Definido aqui em cima, antes dos early returns, porque as telas de "acesso
  // não configurado" e "aguardando alocação" também precisam dele — chamavam
  // `signOut` cru e deixavam os carimbos de sessão para trás.
  const handleSignOut = async () => {
    showToast("Saindo...", 'info', true);
    limparEstadoDeSessao();
    // Sem isto o carimbo de atividade sobrevive à saída manual e o próximo boot
    // acha que uma sessão expirou — o LoginScreen mostraria "sessão encerrada
    // por inatividade" para quem simplesmente clicou em Sair.
    limparCarimbos();
    clearFilial();
    await signOut();
  };

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
        {alarmeDaAula}{avisoDeRecarga}
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
        {alarmeDaAula}{avisoDeRecarga}
        <UserCog size={40} className="text-gray-600" />
        <h2 className="text-lg font-bold text-gray-300">Acesso não configurado</h2>
        <p className="text-sm text-gray-500 max-w-sm text-center">
          Seu usuário ainda não possui um perfil de acesso. Solicite ao administrador do sistema.
        </p>
        <button onClick={handleSignOut} className="mt-2 text-xs text-gray-600 hover:text-red-500 transition-colors">Sair</button>
      </div>
    );
  }

  const podeEscolherFilial = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);

  // Admin/CEO veem o seletor de filial antes de entrar no app.
  // 'escolheu' distingue "ainda não escolhi" de "escolhi Matriz (consolidado)".
  if (podeEscolherFilial && !escolheu) {
    return (
      // Os mesmos comandos valem aqui: nesta tela Alt+2 entra direto na
      // SuperMax, sem passar pelo card, e Alt+Q sai.
      <ComandosProvider
        podeTrocarUnidade
        activeView="seletor-filial"
        onTrocarUnidade={(d) => d === 'Matriz' ? escolherMatriz() : setFilialAtiva(d)}
        onAbrirSeletor={clearFilial}
        onSair={handleSignOut}
      >
      <div className="min-h-screen flex flex-col bg-base">
        {alarmeDaAula}{avisoDeRecarga}
        <div className="shrink-0 flex justify-end items-center px-6 py-4 border-b border-white/5">
          <button
            onClick={handleSignOut}
            // Discreto de propósito: sair é a ação secundária da tela, e em
            // dourado cheio ela competia com os cards — que são a escolha.
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-400 border border-white/10 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 transition-colors"
          >
            <LogOut size={15} />
            <span>Sair</span>
          </button>
        </div>
        <FilialSelector
          onSelect={(v) => v === 'Matriz' ? escolherMatriz() : setFilialAtiva(v)}
        />
      </div>
      </ComandosProvider>
    );
  }

  // Colaborador/gerente sem filial no perfil.
  // (podeEscolherFilial=false + filialAtiva=null; nunca cai em Matriz porque
  // esses perfis não têm o botão Matriz no seletor.)
  //
  // Desde a migr. 411 isto deixou de ser só erro de cadastro: `filial IS NULL`
  // é o estado de quem foi criado numa leva e ainda não foi distribuído nas
  // unidades. Esta tela é a sala de espera desse aluno, então o texto fala de
  // alocação pendente em vez de acusar configuração errada.
  if (!filialAtiva && !podeEscolherFilial) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base">
        {alarmeDaAula}{avisoDeRecarga}
        <Building2 size={40} className="text-gray-600" />
        <h2 className="text-lg font-bold text-gray-300">Aguardando alocação</h2>
        <p className="text-sm text-gray-500 max-w-sm text-center">
          Sua conta foi criada, mas você ainda não está em nenhuma unidade.
          O administrador vai alocar você em uma filial.
        </p>
        <button onClick={handleSignOut} className="mt-2 text-xs text-gray-600 hover:text-red-500 transition-colors">Sair</button>
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

  // Segunda camada da troca de contexto: mesmo que o reset acima não pegue
  // (view veio do sessionStorage de outra sessão, de um card da Início ou do
  // botão Voltar), uma view exclusiva do outro modo cai em 'inicio' aqui —
  // durante o render, antes do commit, então não há flash. 'inicio' é
  // permitida nos dois modos, o que garante que isto converge.
  if (!viewPermitidaNoModo(activeView, matrizMode, profile?.role)) setActiveView('inicio');

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
  // A whitelist da aula SUBSTITUI o recorte por setor — não intersecta com ele.
  // Enquanto era interseção (`visibleModulesBase.filter(...)`), uma aula de
  // Cadastros/Compras/Estoque deixava todo aluno que não fosse de logística com
  // conjunto vazio: só Início na sidebar, que foi o bug relatado em 2026-07-31.
  // A migr. 317 concede os setores correspondentes na RLS, então o que aparece
  // aqui também abre de verdade. Matriz segue fora (lá o menu são os 3 hubs) e
  // TI segue escondido em filial, como para todo mundo.
  const visibleModules = aulaFiltro
    ? (matrizMode ? [] : menuModules.filter(m => m.id !== 'ti' && aulaConfig.modulos_ativos.includes(m.id)))
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
      case 'dashboard':                       return <DashboardAnalyticsView profile={profile} />;
      case 'cadastros-categorias':             return <CategoriasProdutoView showToast={st} profile={profile} />;
      case 'empresa-filiais':                 return <FiliaisView showToast={st} />;
      case 'requisicoes-dosetor':             return <RequisicoesSetorView showToast={st} profile={profile} />;
      case 'cadastros-fornecedores':          return <CRMView type="fornecedores" showToast={st} />;
      case 'cadastros-produtos':              return <ProdutosView showToast={st} profile={profile} />;
      case 'cadastros-serviços':              return <ServicosView showToast={st} />;
      case 'cadastros-lixeira':               return <LixeiraView showToast={st} profile={profile} />;
      case 'empresa-projetos':                return <GenericCRUDView showToast={st} filialScoped title="Projetos" subtitle="Gerencie os projetos em andamento." endpoint="/api/projetosview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: PROJ-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Implantação ERP' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: Maria Santos' }, { key: 'data_inicio', label: 'Início', type: 'date' }, { key: 'data_fim', label: 'Fim', type: 'date' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Concluído', 'Cancelado'] }, { key: 'descricao', label: 'Descrição', type: 'textarea', placeholder: 'Objetivos, escopo, observações…' }]} />;
      // Sem filialScoped: centros_custo não tem coluna `filial` — o catálogo é
      // da holding inteira e todo authenticated lê (policy read_authenticated).
      case 'financeiro-dre':                  return <DREView showToast={st} />;
      // `grupo_dre` (migr. 425) é o que o DRE usa para agrupar despesa. Nasce
      // vazio de propósito: o que ninguém classificou aparece como linha
      // "Não classificado" no relatório, e classificar é a aula.
      case 'financeiro-centrosdecusto':       return <GenericCRUDView showToast={st} title="Centros de Custo" subtitle="Catálogo de centros de custo usado nas requisições, no rateio e no agrupamento de despesas do DRE." endpoint="/api/centroscustoview"
        fields={[{ key: 'codigo', label: 'Código', required: true, placeholder: 'Ex: CC-001' }, { key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: TI & Infraestrutura' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: Ana Lima' }, { key: 'orcamento', label: 'Orçamento (R$)', type: 'currency', placeholder: '0,00' }, { key: 'grupo_dre', label: 'Grupo no DRE', type: 'select', options: ['Pessoal', 'Comerciais', 'Administrativas', 'Ocupação', 'Outras'] }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'empresa-condiçõesdepagamento':    return <GenericCRUDView showToast={st} filialScoped title="Condições de Pagamento" subtitle="Gerencie as condições e prazos de pagamento." endpoint="/api/condicoespagamentoview"
        fields={[{ key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: 30/60/90 dias' }, { key: 'parcelas', label: 'Parcelas', type: 'number', placeholder: '3' }, { key: 'dias', label: 'Dias', placeholder: 'Ex: 30, 60, 90' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      // Migr. 568: este cadastro deixou de ser decorativo. Cada campo aqui
      // MUDA o preço da proposta em Vendas → Orçamentos:
      //   · Desconto à vista abate o total (Pix, dinheiro);
      //   · Juros a.m. + Parcelas sem juros acrescem pela Tabela Price;
      //   · Taxa é CUSTO DA LOJA — sai do líquido, não entra no preço;
      //   · Prazo é o D+n do 1º vencimento e Intervalo o espaço entre parcelas.
      case 'empresa-formasdepagamento':       return <GenericCRUDView showToast={st} filialScoped title="Formas de Pagamento" subtitle="Cada forma define o preço da proposta: desconto à vista, juros do parcelamento, taxa da maquininha e prazo de recebimento." endpoint="/api/formaspagamentoview"
        fields={[
          { key: 'descricao', label: 'Descrição', required: true, placeholder: 'Ex: Cartão de Crédito' },
          { key: 'desconto_percentual', label: 'Desconto à vista (%)', type: 'number', placeholder: '0' },
          { key: 'taxa', label: 'Taxa da maquininha (%)', type: 'number', placeholder: '0' },
          { key: 'juros_mensal', label: 'Juros ao cliente (% a.m.)', type: 'number', placeholder: '0' },
          { key: 'parcelas_max', label: 'Parcelas (máx.)', type: 'number', placeholder: '1' },
          { key: 'parcelas_sem_juros', label: 'Parcelas sem juros', type: 'number', placeholder: '1' },
          { key: 'prazo', label: 'Prazo do 1º recebimento (dias)', type: 'number', placeholder: '0' },
          { key: 'intervalo_dias', label: 'Intervalo entre parcelas (dias)', type: 'number', placeholder: '30' },
          { key: 'exige_limite_credito', label: 'Crediário da loja?', type: 'boolean' },
          { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] },
        ]} />;
      case 'compras-requisiçõesdecompra':     return <RequisicoesView showToast={st} profile={profile} />;
      case 'compras-cotações':                return <CotacoesView showToast={st} profile={profile} mode="compras" onNavigate={navigate} />;
      case 'compras-pedidos':                 return <PedidosView showToast={st} profile={profile} />;
      case 'compras-notasrecebidas':          return <NotasRecebidasView showToast={st} />;
      case 'requisicoes-aprovações':          return <AprovacoesComprasView showToast={st} profile={profile} />;

      case 'compras-sugestõesdecompras':       return <SugestoesComprasView showToast={st} profile={profile} />;
      case 'compras-gerenciamento':            return <GerenciamentoComprasView />;
      case 'compras-relatórios':              return <RelatoriosComprasView showToast={st} />;
      case 'relatorio-vendas':                return <RelatoriosVendasView showToast={st} />;
      case 'estoque-liberarrequisições':      return <AprovacoesEstoqueView showToast={st} profile={profile} />;
      case 'estoque-recebimentos':            return <RecebimentosView showToast={st} />;
      case 'estoque-requisiçõesdematerial':   return <RequisicoesEstoqueView showToast={st} profile={profile} />;
      case 'estoque-expedição':               return <ExpedicaoView showToast={st} />;
      case 'estoque-movimentações':           return <MovimentacoesEstoqueView showToast={st} profile={profile} />;
      case 'estoque-saldos':                  return <SaldosEstoqueView />;
      case 'estoque-validades':               return <ValidadesView showToast={st} />;
      case 'estoque-inventários':             return <InventariosView showToast={st} />;
      case 'estoque-gerenciamento':            return <GerenciamentoEstoqueView />;
      case 'estoque-relatórios':              return <RelatoriosEstoqueView showToast={st} />;
      case 'financeiro-controledecaixa':      return <ControleCaixaView showToast={st} profile={profile} />;
      case 'financeiro-contasareceber':       return <ContasReceberView showToast={st} />;
      case 'financeiro-contasapagar':         return <ContasPagarView showToast={st} />;
      case 'financeiro-patrimônio':           return <PatrimonioView showToast={st} />;
      case 'financeiro-caixabancos':          return <CaixaBancosView showToast={st} profile={profile} />;
      // Migr. 570. Fica ao lado de Caixa / Bancos porque é o lançamento que
      // faz o saldo do banco fechar com o extrato da adquirente.
      case 'financeiro-conciliaçãodamaquininha': return <ConciliacaoMaquininhaView showToast={st} profile={profile} />;
      case 'financeiro-capital':               return <FilialCapitalView showToast={st} profile={profile} />;
      // Só no hub da Matriz (migr. 323): distribui o custo da holding entre as
      // 3 unidades e gera o par conta a pagar (filial) / conta a receber (Matriz).
      case 'financeiro-rateioadministrativo':  return <RateioAdministrativoView showToast={st} profile={profile} />;
      case 'rh-mandatos':                      return <MandatosView showToast={st} profile={profile} />;
      case 'financeiro-juros&multa':                return <ConfigJurosView showToast={st} />;
      case 'financeiro-aprovaçõesdecotação':       return <CotacoesView showToast={st} profile={profile} mode="financeiro" />;
      case 'financeiro-aprovaçõesdepromoções':   return <AprovacoesPromocaoFinanceiroView showToast={st} />;
      case 'financeiro-aprovaçõesdeconteúdo':   return <AprovacoesConteudoMarketingView showToast={st} />;
      case 'financeiro-gerenciamento':            return <GerenciamentoFinanceiroView profile={profile} />;
      case 'financeiro-relatórios':               return <RelatoriosFinanceirosView showToast={st} />;
      case 'financeiro-recibosdevendas':          return <RecibosVendasView showToast={st} profile={profile} />;
      case 'financeiro-notasemitidas':            return <NotasEmitidasView showToast={st} profile={profile} />;
      case 'rh-funcionários':     return <FuncionariosView showToast={st} />;
      // filialScoped + permiteMatriz desde 2026-08-01: a coluna `filial` existe
      // desde a migr. 145, mas a tela ignorava — gravava tudo no default
      // 'SuperMax' enquanto FuncionariosView filtrava pela unidade ativa, e o
      // cargo criado na MaxLook nunca reaparecia no select de lá. `permiteMatriz`
      // porque a holding também emprega: CEO e conselheiro têm cargo.
      case 'rh-departamentos':    return <GenericCRUDView showToast={st} filialScoped permiteMatriz title="Departamentos" subtitle="Estrutura departamental desta unidade." endpoint="/api/departamentosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Tecnologia da Informação' }, { key: 'responsavel', label: 'Responsável', placeholder: 'Ex: João Silva' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-cargos':           return <GenericCRUDView showToast={st} filialScoped permiteMatriz title="Cargos" subtitle="Cargos e faixas salariais desta unidade." endpoint="/api/cargosview"
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Analista de Sistemas' }, { key: 'nivel', label: 'Nível', type: 'select', options: ['Júnior', 'Pleno', 'Sênior', 'Gerência', 'Diretoria'] }, { key: 'salario_base', label: 'Salário Base (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-folhadepagamento': return <FolhaPagamentoView showToast={st} profile={profile} />;
      case 'rh-férias':           return <FeriasView showToast={st} profile={profile} />;
      case 'rh-registrodeponto':  return <PontoEletronicoView showToast={st} profile={profile} />;
      case 'rh-afastamentos':     return <AfastamentosView showToast={st} profile={profile} />;
      case 'rh-desligamento':    return <DesligamentosView showToast={st} profile={profile} />;
      case 'rh-recrutamentoeseleção': return <RecrutamentoView showToast={st} profile={profile} />;
      case 'rh-benefícios':       return <GenericCRUDView showToast={st} title="Benefícios" subtitle="Catálogo de benefícios da unidade. A atribuição por pessoa é feita em Funcionários." endpoint="/api/beneficiosview" filialScoped
        fields={[{ key: 'nome', label: 'Nome', required: true, placeholder: 'Ex: Vale Refeição' }, { key: 'tipo', label: 'Tipo', type: 'select', options: ['Vale Refeição', 'Vale Transporte', 'Plano de Saúde', 'Plano Odontológico', 'Auxílio Home Office', 'Outros'] }, { key: 'valor', label: 'Valor (R$)', type: 'currency', placeholder: '0,00' }, { key: 'status', label: 'Status', type: 'select', options: ['Ativo', 'Inativo'] }]} />;
      case 'rh-treinamentos':     return <TreinamentosView showToast={st} />;
      case 'rh-pesquisas':        return <PesquisasView showToast={st} profile={profile} />;
      case 'rh-gerenciamento':    return <GerenciamentoRHView />;
      case 'rh-relatórios':       return <RelatoriosRHView showToast={st} />;
      case 'vendas-pdv':                    return <PDVView showToast={st} profile={profile} filialAtiva={filialAtiva} />;
      case 'vendas-clientes':               return <CRMView type="clientes" showToast={st} />;
      case 'vendas-históricodevendas':     return <HistoricoVendasView showToast={st} />;
      case 'vendas-devoluções':            return <DevolucoesView showToast={st} profile={profile} />;
      case 'vendas-pedidosonline':          return <PedidosOnlineView showToast={st} profile={profile} />;
      case 'vendas-treinamento':            return <TreinamentoVendasView />;
      case 'financeiro-alçadas':           return <AlcadasView showToast={st} profile={profile} />;
      case 'vendas-orçamentos':            return <OrcamentosView showToast={st} profile={profile} />;
      case 'vendas-pedidosdevenda':        return <PedidosVendaView showToast={st} profile={profile} mode="vendas" />;
      case 'vendas-clienteespecial':       return <ClienteEspecialView showToast={st} profile={profile} />;
      case 'estoque-pedidosdevenda':       return <PedidosVendaView showToast={st} profile={profile} mode="estoque" />;
      case 'financeiro-pedidosdevenda':    return <PedidosVendaView showToast={st} profile={profile} mode="financeiro" />;
      case 'financeiro-aprovaçõesdeorçamento': return <OrcamentosView showToast={st} profile={profile} mode="financeiro" />;
      case 'marketing-redessociais':        return <MetricasRedesSociaisView showToast={st} profile={profile} />;
      case 'marketing-campanhas':          return <CampanhasMarketingView showToast={st} profile={profile} />;
      case 'marketing-promoções':          return <PromocoesMarketingView showToast={st} profile={profile} />;
      case 'marketing-cupons':             return <CuponsMarketingView showToast={st} profile={profile} />;
      case 'marketing-calendário':         return <CalendarioEditorialView showToast={st} profile={profile} />;
      // Rota mudou junto com o rótulo (slug vem do label). A antiga fica de
      // alias: `activeView` vive no sessionStorage, e quem estivesse nessa
      // tela no momento do deploy cairia num switch sem case ao recarregar.
      case 'marketing-vitrinedateladelogin':
      case 'marketing-vitrinepública':     return <VitrinePublicaView showToast={st} profile={profile} />;
      // Migr. 539/540 — os dois limites do Marketing. Só o professor abre: o
      // submenu tem requireRole e a policy de UPDATE recusa o resto.
      case 'marketing-configurações':      return <MarketingConfigView showToast={st} />;
      case 'minhas-pesquisas':             return <MinhasPesquisasView showToast={st} profile={profile} />;
      case 'artes-promocionais':           return <ArtesPromocionaisView />;
      case 'usuarios':                     return <UsuariosView showToast={st} profile={profile} />;
      case 'meu-cracha':                   return <MeuCrachaView profile={profile} />;
      case 'cracha-virtual':               return <CrachaVirtualView showToast={st} profile={profile} />;
      case 'catalogo-produtos':            return <CatalogoProdutosView showToast={st} profile={profile} />;
      case 'avaliacoes':                   return <CentralAvaliacaoView showToast={st} profile={profile} />;
      case 'demandas':                     return <DemandasView showToast={st} profile={profile} />;
      case 'demandas-metas':               return <DemandasView showToast={st} profile={profile} initialTab="metas" />;
      case 'demandas-conselho':            return <DemandasView showToast={st} profile={profile} initialTab="conselho" />;
      // Rota antiga 'metas' redireciona pra Demandas > Metas Estratégicas.
      case 'metas':                        return <DemandasView showToast={st} profile={profile} initialTab="metas" />;
      case 'feedback-org':                 return <FeedbackRequerimentosView showToast={st} profile={profile} />;
      case 'ti-desenvolvimentocomia':      return <DesenvolvimentoIAView showToast={st} profile={profile} />;
      // Com acento: o viewId sai do `slug()` de SessoesGeraisView, que só tira
      // espaço e barra — 'Relatórios' vira 'relatórios' em todos os módulos.
      // Sem os acentos aqui, o case não casa e a tela cai no PlaceholderView
      // ("Módulo em Desenvolvimento").
      case 'ti-relógiodasmáquinas':        return <RelogioMaquinasView profile={profile} showToast={st} />;
      case 'central-tempo':                return <CentralTempoView />;
      case 'painel-bi':                    return <PainelBIView showToast={st} profile={profile} />;
      case 'briefing-diario':              return <BriefingDiarioView showToast={st} profile={profile} />;
      case 'matriz-competicao':            return <MatrizCompeticaoView showToast={st} profile={profile} navigate={navigate} />;
      // `matriz-avaliacoes` existe só para cair na Competição do Conselho —
      // é o destino do botão "Central de Avaliação" da tela de Competição.
      // Sem o initialTab ele abria em Padrão, que não tem nada a ver.
      case 'matriz-avaliacoes':            return <CentralAvaliacaoView showToast={st} profile={profile} initialTab="competicao" />;
      case 'matriz-capital':               return <MatrizCapitalView showToast={st} profile={profile} />;
      case 'matriz-conteudo':               return <MatrizConteudoView showToast={st} profile={profile} />;
      case 'aula-modo':                    return <AulaModoView showToast={st} profile={profile} />;
      case 'aula-atividade':               return <AulaAtividadeView profile={profile} showToast={st} />;
      // Rota mudou com o rótulo. A antiga fica de alias porque `activeView` vive
      // no sessionStorage: quem estivesse no Max Show no momento do deploy
      // recarregaria num switch sem case. Vide o mesmo caso na Vitrine.
      case 'max-work-show':
      case 'max-show':                     return <MaxShowsView showToast={st} profile={profile} />;
      case 'documentos':                   return <DocumentosView showToast={st} profile={profile} />;
      case 'contratos':                    return <ContratosView showToast={st} profile={profile} />;
      case 'pendencias':                   return <PendenciasView showToast={st} profile={profile} />;
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
    {/* Comandos globais (teclado, Ctrl+K e voz). Aqui dentro porque precisa do
        `profile` e do contexto de filial — e envolve a shell inteira para que o
        botão do topbar alcance o `abrir()`. */}
    <ComandosProvider
      podeTrocarUnidade={podeEscolherFilial}
      activeView={activeView}
      onTrocarUnidade={(d) => d === 'Matriz' ? escolherMatriz() : setFilialAtiva(d)}
      onAbrirSeletor={clearFilial}
      onSair={handleSignOut}
    >
    {/* `relative` não é cosmético: sem ancestral posicionado, qualquer
        descendente `absolute` (um `sr-only`, um badge esquecido) resolve o
        bloco contêiner no documento, escapa do `overflow-hidden` daqui e
        estica o scroll da página — a shell some pra cima e a tela parece
        quebrada. `fixed` não é afetado por isto, os FABs seguem iguais. */}
    <div className="relative flex h-screen w-full bg-base overflow-hidden" style={{ color: 'var(--color-text-primary)', height: '100dvh' }}>
      <Toast message={toast.message} visible={toast.show} type={toast.type} />
      {/* Aviso dos 60s finais antes do logout por inatividade. Renderizado só
          aqui, na shell do app: nas telas dos early returns (seletor de filial,
          "aguardando alocação") a sessão simplesmente cai para o login — não há
          formulário nem trabalho em andamento para o aviso proteger. */}
      {sessaoExpiraEm !== null && (
        <SessaoExpirandoModal
          expiraEm={sessaoExpiraEm}
          onContinuar={continuarSessao}
          onSairAgora={handleSignOut}
        />
      )}
      {/* Alarme da aula: modal central em qualquer tela (migr. 529). */}
      {alarmeDaAula}{avisoDeRecarga}
      {/* Comunicação, não bloqueio: quem barra a escrita do desligado é a RLS
          (migr. 307). Ver o comentário no próprio componente. */}
      <DesligamentoAviso profile={profile} />
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
            <motion.aside initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }}
              transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
              className="fixed top-0 left-0 w-72 h-full flex flex-col pt-8 pb-5 px-5 gap-6 z-50 neu-flat sidebar-dark lg:hidden">
              <SidebarNav
                activeView={activeView} navigate={navigate}
                openModules={openModules} toggleModule={toggleModule}
                handleSignOut={handleSignOut} onClose={() => setMobileMenuOpen(false)}
                visibleModules={visibleModules} profile={profile} badges={badges}
                matrizMode={matrizMode}
                aulaAllow={aulaAllow} aulaFiltro={aulaFiltro}
                atividadesAula={atividadesAula.length} atividadesNaoLidas={atividadesNaoLidas}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <aside className={`hidden ${sidebarRecolhida ? '' : 'lg:flex'} w-72 h-full flex-col pt-8 pb-5 px-5 gap-6 shrink-0 z-10 neu-flat sidebar-dark relative`}>
        <SidebarNav
          activeView={activeView} navigate={navigate}
          openModules={openModules} toggleModule={toggleModule}
          handleSignOut={handleSignOut}
          visibleModules={visibleModules} profile={profile} badges={badges}
          matrizMode={matrizMode}
          aulaAllow={aulaAllow} aulaFiltro={aulaFiltro}
                atividadesAula={atividadesAula.length} atividadesNaoLidas={atividadesNaoLidas}
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
            <button onClick={alternarSidebar}
              title={sidebarRecolhida ? 'Mostrar menu lateral' : 'Recolher menu lateral'}
              aria-label={sidebarRecolhida ? 'Mostrar menu lateral' : 'Recolher menu lateral'}
              aria-pressed={sidebarRecolhida}
              className="hidden lg:flex neu-button w-9 h-9 rounded-xl items-center justify-center text-gray-400 hover:text-accent transition-colors shrink-0">
              {sidebarRecolhida ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
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
            {/* Fica ANTES do sino e visível em Modo Aula também: rede lenta é
                informação de infraestrutura, não conteúdo de módulo, e é
                justamente o aluno sob a whitelist que tem menos pistas do que
                está acontecendo. */}
            <AvisoDisjuntor />
            {!aulaFiltro && <NotificationBell setor={profile.setor} filial={filialAtiva} onNavigate={navigate} />}
            {canUseMaxAI && !aulaFiltro && <AIAssistantFAB />}
            {podeEscolherFilial && (
              <button
                onClick={clearFilial}
                title="Trocar filial (Alt+0) — comandos em Ctrl+K"
                className="neu-button h-9 px-3 rounded-xl flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent border border-accent/20 hover:bg-accent/10 transition-colors shrink-0"
              >
                <Building2 size={13} />
                <span className="hidden sm:inline">{filialAtiva ?? 'Matriz'}</span>
              </button>
            )}
            <BotaoComandos />
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
            {/* Atalho no banner porque é onde o aluno olha ao estranhar a
                sidebar curta — e é de lá que ele precisa chegar ao enunciado. */}
            {atividadesAula.length > 0 && activeView !== 'aula-atividade' && (
              <button
                onClick={() => navigate('aula-atividade')}
                className="ml-auto shrink-0 text-[10px] font-black uppercase tracking-widest text-accent border border-accent/30 rounded-full px-2.5 py-1 hover:bg-accent/10 transition-colors"
              >
                Ver atividade{atividadesNaoLidas > 0 ? ` (${atividadesNaoLidas})` : ''}
              </button>
            )}
          </div>
        )}
        <BlackoutBanner
          ativo={blackout.ativo}
          mensagem={blackout.mensagem}
          por={blackout.iniciado_nome}
          desde={blackout.iniciado_em}
          isento={profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile)}
        />
        {/* Onde esta tela está na cadeia (Requisição → Cotação → Pedido →
            Recebimento). Lê a mesma lista do diagrama do Modo Aula. Só aparece
            em tela que pertence a uma cadeia. */}
        <FaixaEtapaFluxo activeView={activeView} onNavigate={navigate} />
        <div className="flex-1 min-h-0">
          <ErrorBoundary key={activeView}>
            <Suspense fallback={<PageLoadingFallback />}>
              {renderContent()}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* FAB único de pendências (plano de requisições, fase 5): Aviso da
          Matriz, documento novo, pedido da loja online, convite de vaga e
          requisição devolvida/corrigida viviam empilhados, um botão fixo cada,
          seis cores pulsando ao mesmo tempo no mesmo canto. Este componente
          soma as contagens numa pílula só; cada fila continua dona do próprio
          modal e do próprio auto-abrir (naoInterromper) — só o botão
          individual saiu da tela. Regras de Modo Aula preservadas por dentro
          do componente: Aviso/Pedido online/Convite somem, Documento e
          Requisição continuam (mesmo motivo de antes). */}
      <PendenciasFAB profile={profile} showToast={showToast} activeView={activeView} onNavigate={navigate} aulaFiltro={!!aulaFiltro} />
    </div>
    </ComandosProvider>
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
          <PromptProvider>
            <PwaUpdatePrompt />
            <LogMaxAppInner />
          </PromptProvider>
        </ConfirmProvider>
      </FilialProvider>
    </ThemeProvider>
  );
}
