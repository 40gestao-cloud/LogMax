import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Boxes, ClipboardList, ShoppingCart, TrendingUp, CreditCard, Package, Users, ShoppingBag, DollarSign, Megaphone, Star, Target, X } from 'lucide-react';
import type { UserProfile } from '../hooks/useUserProfile';
import { allSetores } from '../lib/rbac';
import { dataExtensoBR, saudacaoBR } from '../lib/dates';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { useTheme } from '../contexts/ThemeContext';
import { LoadingSpinner, FilialBadge } from '../components/ui';
import { PontoFAB } from '../components/PontoFAB';

const PESQUISA_LS_PREFIX = 'logmax:pesquisa-respondida:';

export const InicioView = ({
  onNavigate, profile, favorites, toggleFavorite, badges, matrizMode,
}: {
  onNavigate?: (view: string) => void;
  profile?: UserProfile;
  favorites?: { viewId: string; label: string }[];
  toggleFavorite?: (fav: { viewId: string; label: string }) => void;
  badges?: Record<string, number>;
  matrizMode?: boolean;
}) => {
  // Escopo por filial ativa: se colaborador/gerente está numa unidade, KPIs
  // do início refletem só a filial dele. Admin/CEO/Matriz (filialAtiva=null)
  // seguem vendo o consolidado das 3 unidades.
  const { filialAtiva } = useFilial();
  const { theme, accentColor } = useTheme();

  // Cores do gráfico lidas dos tokens de tema (dark/light/premium + accent),
  // recomputadas quando tema/accent muda. Recharts recebe hex concreto porque
  // `var(--...)` não resolve em atributos SVG de presentação.
  const chartColors = React.useMemo(() => {
    const fallback = {
      grid: '#1a1a1a', axis: '#6b7280', accent: '#F0B429',
      bar: 'rgba(240,180,41,0.12)', barStroke: 'rgba(240,180,41,0.35)',
      tooltipBg: '#0d0d0d', tooltipBorder: 'rgba(255,255,255,0.08)', legend: '#9ca3af',
    };
    if (typeof window === 'undefined') return fallback;
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    return {
      grid:          v('--color-border', fallback.grid),
      axis:          v('--color-text-dim', fallback.axis),
      accent:        v('--color-accent', fallback.accent),
      bar:           v('--color-surface-md', fallback.bar),
      barStroke:     v('--color-border-md', fallback.barStroke),
      tooltipBg:     v('--color-card-bg', fallback.tooltipBg),
      tooltipBorder: v('--color-card-border', fallback.tooltipBorder),
      legend:        v('--color-text-muted', fallback.legend),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, accentColor]);
  const relogioIcon = theme === 'light'
    ? '/icon-relogio-central-modoclaro.png'
    : '/icon-relogio-central.png';
  const filialFilter = filialAtiva ? { filial: filialAtiva } : undefined;
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview', filialFilter);
  const { data: contasPagar, isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview', filialFilter);
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview', filialFilter);
  const { data: artes } = useFetchData<any>('/api/marketingartesview', filialFilter);
  const isLoading = loadingCR || loadingCP || loadingPed;

  // Card de Artes Promocionais: aparece pra qualquer usuário logado se houver
  // pelo menos uma arte publicada. Marketing também vê (vai pro mesmo gallery).
  const artesPublicadasCount = artes?.length ?? 0;

  // Pesquisas pendentes para o usuário logado (qualquer role/setor).
  // Mesma semântica de elegibilidade que MinhasPesquisasView e a RPC.
  const ativasFilter = React.useMemo(() => ({ status: 'Ativa' }), []);
  const { data: pesquisasAtivas } = useFetchData<any>('/api/pesquisasview', ativasFilter);
  const minhasRespFilter = React.useMemo(
    () => (profile?.id ? { respondente_id: profile.id } : undefined),
    [profile?.id],
  );
  const { data: minhasRespostas } = useFetchData<any>('/api/pesquisarespostasview', minhasRespFilter);

  const pesquisasPendentesCount = React.useMemo(() => {
    if (!profile) return 0;
    const respondidasIds = new Set((minhasRespostas ?? []).map((r: any) => r.pesquisa_id));
    return (pesquisasAtivas ?? []).filter((p: any) => {
      if (respondidasIds.has(p.id)) return false;
      if (p.anonima && typeof window !== 'undefined' && localStorage.getItem(`${PESQUISA_LS_PREFIX}${p.id}`)) return false;
      const roles = p.alvo_roles as string[] | null;
      const setores = p.alvo_setores as string[] | null;
      if (roles && roles.length > 0 && !roles.includes(profile.role)) return false;
      if (setores && setores.length > 0 && profile.setor !== 'all') {
        if (!allSetores(profile).some(s => setores.includes(s))) return false;
      }
      return true;
    }).length;
  }, [pesquisasAtivas, minhasRespostas, profile]);

  const contasAberto = contasReceber.filter((c: any) => c.status !== 'Pago');
  const contasPagas  = contasReceber.filter((c: any) => c.status === 'Pago');
  const contasReceberCount = contasAberto.length;
  const contasReceberValor = contasAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Donut de progresso (pago / total). Fração calculada por VALOR — melhor
  // que por quantidade porque uma conta grande sozinha pesa diferente de 10
  // pequenas. Estático (sem animate-spin) — leitura calma, não "carregando".
  const totalRecebido = contasPagas.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const totalTitulos  = totalRecebido + contasAberto.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const pctPago = totalTitulos > 0 ? Math.round((totalRecebido / totalTitulos) * 100) : 0;

  // Contas a Pagar: mesmo cálculo do card de Contas a Receber, espelhado.
  const contasPagarAberto = contasPagar.filter((c: any) => c.status !== 'Pago');
  const contasPagarPagas  = contasPagar.filter((c: any) => c.status === 'Pago');
  const contasPagarCount = contasPagarAberto.length;
  const contasPagarValor = contasPagarAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const totalPagoCP = contasPagarPagas.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const totalTitulosCP = totalPagoCP + contasPagarAberto.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const pctPagoCP = totalTitulosCP > 0 ? Math.round((totalPagoCP / totalTitulosCP) * 100) : 0;

  // Saudação + data local do Acre — só recalcula ao montar a view.
  const primeiroNome = (profile?.nome ?? profile?.email?.split('@')[0] ?? '').split(' ')[0];
  const saudacaoTxt  = React.useMemo(() => saudacaoBR(), []);
  const dataExtenso  = React.useMemo(() => dataExtensoBR(), []);
  const SHORTCUTS_BY_MODULE: Record<string, { label: string; desc: string; icon: any; view: string }[]> = {
    empresa:    [
      { label: 'Filiais',          desc: 'Unidades e escritórios',    icon: Boxes,         view: 'empresa-filiais'           },
    ],
    cadastros:  [
      { label: 'Produtos',         desc: 'Catálogo de produtos',      icon: Package,       view: 'cadastros-produtos'        },
    ],
    compras:    [
      { label: 'Requisições',      desc: 'Solicitações de compra',    icon: ClipboardList, view: 'compras-requisições'       },
      { label: 'Pedidos',          desc: 'Pedidos em andamento',      icon: ShoppingCart,  view: 'compras-pedidos'           },
    ],
    estoque:    [
      { label: 'Saldos',           desc: 'Estoque atual por produto', icon: Package,       view: 'estoque-saldos'            },
      { label: 'Movimentações',    desc: 'Entradas e saídas',         icon: ArrowRight,    view: 'estoque-movimentações'     },
    ],
    financeiro: [
      { label: 'Controle de Caixa', desc: 'Abertura e fechamento',    icon: DollarSign,    view: 'financeiro-controledecaixa' },
      { label: 'Contas a Receber',  desc: 'Títulos a receber',        icon: TrendingUp,    view: 'financeiro-contasareceber'  },
      { label: 'Contas a Pagar',    desc: 'Títulos a pagar',          icon: CreditCard,    view: 'financeiro-contasapagar'    },
    ],
    rh:         [
      { label: 'Funcionários',     desc: 'Cadastro de funcionários',  icon: Users,         view: 'rh-funcionários'           },
      { label: 'Ponto Eletrônico', desc: 'Registro de ponto',         icon: ClipboardList, view: 'rh-pontoeletrônico'        },
    ],
    vendas:     [
      { label: 'PDV',              desc: 'Ponto de venda',            icon: ShoppingBag,   view: 'vendas-pdv'                },
      { label: 'Histórico',        desc: 'Histórico de vendas',       icon: TrendingUp,    view: 'vendas-históricodevendas'  },
    ],
    marketing:  [
      { label: 'Promoções',        desc: 'Campanhas e descontos',     icon: Megaphone,     view: 'marketing-promoções'       },
      { label: 'Tarefas',          desc: 'Tarefas de conteúdo',       icon: ClipboardList, view: 'marketing-tarefas'         },
    ],
  };

  const SETOR_MODS: Record<string, string[]> = {
    all:        ['compras', 'estoque', 'financeiro', 'rh', 'empresa', 'cadastros'],
    logistica:  ['estoque', 'compras', 'cadastros'],
    vendas:     ['empresa', 'vendas'],
    financeiro: ['financeiro'],
    rh:         ['rh'],
    marketing:  ['marketing'],
  };

  const isAdmin = profile?.role === 'admin';

  const baseShortcuts = (SETOR_MODS[profile?.setor ?? 'all'] ?? [])
    .flatMap(mod => SHORTCUTS_BY_MODULE[mod] ?? []);

  // Ponto Eletrônico no Acesso Rápido: CEO/gerente/colaborador (qualquer setor)
  // batem ponto — admin não. Pra não-admin garantimos o card no início da lista
  // (sem duplicar quando o setor já incluiria via SHORTCUTS_BY_MODULE.rh).
  const shortcutsComPonto = isAdmin
    ? baseShortcuts.filter(s => s.view !== 'rh-pontoeletrônico')
    : [
        { label: 'Ponto Eletrônico', desc: 'Registro de ponto', icon: ClipboardList, view: 'rh-pontoeletrônico' },
        ...baseShortcuts.filter(s => s.view !== 'rh-pontoeletrônico'),
      ];

  const shortcuts = shortcutsComPonto.slice(0, 6);

  const chartData = (() => {
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const doMes = pedidos.filter((p: any) => {
        const pd = new Date(p.created_at);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      });
      const qtd = doMes.length;
      const valor = doMes.reduce((s: number, p: any) => s + (Number(p.valor_total) || 0), 0);
      return { name: MESES[d.getMonth()], qtd, valor };
    });
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8 pb-8">
      {!isAdmin && <PontoFAB />}

      {/* Header — saudação + data + badge da filial ativa. Substitui a
          entrada "fria" nos cards e dá contexto imediato de quem/quando/onde. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-100 tracking-tight truncate">
            {saudacaoTxt}{primeiroNome ? `, ${primeiroNome}` : ''}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 first-letter:uppercase">{dataExtenso}</p>
        </div>
        <FilialBadge filial={filialAtiva ?? 'Matriz'} />
      </div>

      {pesquisasPendentesCount > 0 && (
        <button onClick={() => onNavigate?.('minhas-pesquisas')}
          className="neu-flat rounded-3xl p-5 sm:p-6 border border-accent/20 hover:border-accent/40 transition-colors flex items-center gap-4 text-left shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
            <ClipboardList size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-200">
              Você tem {pesquisasPendentesCount} {pesquisasPendentesCount === 1 ? 'pesquisa pendente' : 'pesquisas pendentes'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Sua opinião é importante. Clique para responder.</p>
          </div>
          <ArrowRight size={16} className="text-accent shrink-0" />
        </button>
      )}
      {artesPublicadasCount > 0 && (
        <button onClick={() => onNavigate?.('artes-promocionais')}
          className="neu-flat rounded-3xl p-5 sm:p-6 border border-accent/20 hover:border-accent/40 transition-colors flex items-center gap-4 text-left shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
            <Megaphone size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-200">
              {artesPublicadasCount} {artesPublicadasCount === 1 ? 'arte promocional publicada' : 'artes promocionais publicadas'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Veja o material do Marketing e dê seu feedback.</p>
          </div>
          <ArrowRight size={16} className="text-accent shrink-0" />
        </button>
      )}

      {isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-6 shrink-0">
          <h3 className="text-xl font-bold text-gray-200 pl-3 border-l-4 border-accent tracking-wide">Resumo Diário</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
            <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-accent/20">
              <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Contas a Receber</h4>
              {/* Donut estático: fração paga vs. total, calculado por VALOR.
                  Substitui o anel animate-spin que lia como "carregando". */}
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6 sm:mb-8">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.grid} strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.accent} strokeWidth="3"
                    strokeDasharray={`${pctPago} ${100 - pctPago}`} strokeDashoffset="0" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl sm:text-3xl font-black text-accent leading-none">{contasReceberCount}</span>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">em aberto</span>
                </div>
              </div>
              <div className="text-center mt-auto">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                  {pctPago}% recebido do total
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-gray-100">{contasReceberValor}</span>
              </div>
            </div>
            <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-accent/20">
              <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Contas a Pagar</h4>
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6 sm:mb-8">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.grid} strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.accent} strokeWidth="3"
                    strokeDasharray={`${pctPagoCP} ${100 - pctPagoCP}`} strokeDashoffset="0" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl sm:text-3xl font-black text-accent leading-none">{contasPagarCount}</span>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">em aberto</span>
                </div>
              </div>
              <div className="text-center mt-auto">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                  {pctPagoCP}% pago do total
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-gray-100">{contasPagarValor}</span>
              </div>
            </div>
            <div className="neu-flat rounded-3xl p-6 flex flex-col border border-accent/20">
              <h4 className="text-xs font-bold text-gray-400 mb-4 pl-2 uppercase tracking-widest">Pedidos de Compra</h4>
              <div className="flex-1 min-h-[140px] w-full mb-6">
                <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                    <XAxis dataKey="name" stroke={chartColors.axis} fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="qtd" stroke={chartColors.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis yAxisId="valor" orientation="right" stroke={chartColors.accent} fontSize={10} tickLine={false} axisLine={false} width={44}
                      tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}
                      itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                      labelStyle={{ color: chartColors.legend, fontSize: '11px' }}
                      formatter={(value: number, name: string) =>
                        name === 'Valor (R$)'
                          ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : value
                      } />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: chartColors.legend, paddingTop: '10px' }} />
                    <Bar yAxisId="qtd" dataKey="qtd" fill={chartColors.bar} radius={[4, 4, 0, 0]} stroke={chartColors.barStroke} strokeWidth={1} name="Pedidos" />
                    <Line yAxisId="valor" type="monotone" dataKey="valor" stroke={chartColors.accent} strokeWidth={3} dot={{ r: 3, fill: chartColors.tooltipBg, stroke: chartColors.accent, strokeWidth: 2 }} activeDot={{ r: 5, fill: chartColors.accent, strokeWidth: 0 }} name="Valor (R$)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-3 mt-auto">
                <button onClick={() => onNavigate?.('compras-pedidos')} className="flex-1 neu-pressed py-3 rounded-xl font-bold text-xs text-gray-300 hover:text-white transition-colors">Ver pedidos</button>
                <button onClick={() => onNavigate?.('compras-cotações')} className="flex-1 neu-button py-3 rounded-xl font-bold text-xs text-accent hover:text-white transition-colors">Cotações</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 shrink-0">
        <div className="lg:col-span-7 neu-flat rounded-3xl p-5 sm:p-8 flex flex-col gap-5 border border-accent/20">
          <h3 className="text-lg font-bold text-gray-200 shrink-0 flex items-center gap-2">
            <Star size={16} className="text-amber-400 fill-amber-400" /> Acesso Rápido
          </h3>

          {/* Filial: Metas fixo (aviso quando Matriz lança meta). Matriz: só favoritos. */}
          <div className="grid grid-cols-2 gap-3 flex-1 auto-rows-min">
            {!matrizMode && (
              <button
                onClick={() => onNavigate?.('metas')}
                className="neu-button rounded-2xl p-4 flex flex-col gap-2 text-left border border-accent/20 hover:border-accent/40 transition-all group relative"
              >
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent/20 transition-colors">
                    <Target size={16} />
                  </div>
                  {(badges?.['metas'] ?? 0) > 0 && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-accent text-black">
                      {badges['metas']} nova{badges['metas'] > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <span className="text-xs font-bold text-gray-200 group-hover:text-white transition-colors leading-tight">Metas</span>
                <span className="text-[10px] text-gray-600 leading-tight">
                  {(badges?.['metas'] ?? 0) > 0
                    ? 'Meta lançada pela Matriz — clique para ver'
                    : 'Suas metas ativas e histórico'}
                </span>
              </button>
            )}

            {(favorites ?? []).map(fav => {
              const b = badges?.[fav.viewId] ?? 0;
              return (
                <button
                  key={fav.viewId}
                  onClick={() => onNavigate?.(fav.viewId)}
                  className="neu-button rounded-2xl p-4 flex flex-col gap-2 text-left border border-transparent hover:border-accent/20 transition-all group relative"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-xl bg-amber-400/10 flex items-center justify-center text-amber-400">
                      <Star size={14} className="fill-amber-400" />
                    </div>
                    {b > 0 && (
                      <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-black text-black">
                        {b > 9 ? '9+' : b}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-gray-200 truncate">{fav.label}</span>
                  {toggleFavorite && (
                    <span
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(fav); }}
                      className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Remover dos favoritos"
                    >
                      <X size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className="lg:col-span-5 neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative overflow-hidden border border-accent/20"
        >
          <div className="flex flex-col items-center justify-center text-center w-full py-2">
            <img src={relogioIcon} alt="Relógio" className="w-24 h-24 object-contain mb-3" />
            <h3 className="text-xl font-bold text-accent mb-2">Central de Tempo</h3>
            <p className="text-xs text-gray-500 leading-snug mb-5">
              Relógio, alarmes, cronômetro e timer
            </p>
            <button
              onClick={() => onNavigate?.('central-tempo')}
              className="btn-shimmer py-3 px-6 rounded-2xl text-sm font-bold flex items-center gap-2 transition-all"
              style={{
                background:  'var(--color-accent)',
                color:       'var(--color-accent-text)',
                border:      'none',
                boxShadow:   '0 1px 2px rgba(0, 0, 0, 0.35)',
              }}>
              Abrir <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
