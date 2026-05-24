import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Boxes, ClipboardList, ShoppingCart, TrendingUp, CreditCard, Package, Users, ShoppingBag, DollarSign, Megaphone, Clock } from 'lucide-react';
import type { UserProfile } from '../hooks/useUserProfile';
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
import { LoadingSpinner } from '../components/ui';
import { PontoFAB } from '../components/PontoFAB';

const PESQUISA_LS_PREFIX = 'logmax:pesquisa-respondida:';

export const InicioView = ({ onNavigate, showToast, profile }: { onNavigate?: (view: string) => void; showToast?: (msg: string, type?: string) => void; profile?: UserProfile }) => {
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview');
  const { data: notasRecebidas, isLoading: loadingNR } = useFetchData<any>('/api/notasrecebidasview');
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const { data: artes } = useFetchData<any>('/api/marketingartesview');
  const isLoading = loadingCR || loadingNR || loadingPed;

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
      if (setores && setores.length > 0 && profile.setor !== 'all' && !setores.includes(profile.setor)) return false;
      return true;
    }).length;
  }, [pesquisasAtivas, minhasRespostas, profile]);

  const contasAberto = contasReceber.filter((c: any) => c.status !== 'Pago');
  const contasReceberCount = contasAberto.length;
  const contasReceberValor = contasAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const notasCount = notasRecebidas.length;
  const SHORTCUTS_BY_MODULE: Record<string, { label: string; desc: string; icon: any; view: string }[]> = {
    empresa:    [
      { label: 'Produtos',         desc: 'Catálogo de produtos',      icon: Package,       view: 'empresa-produtos'          },
      { label: 'Filiais',          desc: 'Unidades e escritórios',    icon: Boxes,         view: 'empresa-filiais'           },
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
    all:        ['compras', 'estoque', 'financeiro', 'rh', 'empresa'],
    logistica:  ['estoque', 'compras'],
    vendas:     ['empresa', 'vendas'],
    financeiro: ['financeiro'],
    rh:         ['rh'],
    marketing:  ['marketing'],
  };

  const shortcuts = (SETOR_MODS[profile?.setor ?? 'all'] ?? [])
    .flatMap(mod => SHORTCUTS_BY_MODULE[mod] ?? [])
    .slice(0, 6);

  const isAdmin = profile?.role === 'admin';

  const chartData = (() => {
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const compra = pedidos.filter((p: any) => {
        const pd = new Date(p.created_at);
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
      }).length;
      return { name: MESES[d.getMonth()], compra, pedido: compra };
    });
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8 pb-8">
      {!isAdmin && <PontoFAB />}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 shrink-0">
        <div className="lg:col-span-5 neu-flat rounded-3xl p-5 sm:p-8 flex flex-col gap-5">
          <h3 className="text-lg font-bold text-gray-200 shrink-0">Acesso Rápido</h3>
          <div className="grid grid-cols-2 gap-3 flex-1">
            {shortcuts.map(({ label, desc, icon: Icon, view }) => (
              <button
                key={view}
                onClick={() => onNavigate?.(view)}
                className="neu-button rounded-2xl p-4 flex flex-col gap-2 text-left hover:border-accent/20 border border-transparent transition-all group"
              >
                <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent/20 transition-colors">
                  <Icon size={16} />
                </div>
                <span className="text-xs font-bold text-gray-200 group-hover:text-white transition-colors leading-tight">{label}</span>
                <span className="text-[10px] text-gray-600 leading-tight">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => onNavigate?.('central-tempo')}
          className="lg:col-span-7 neu-flat rounded-3xl p-5 sm:p-8 flex flex-col justify-center relative overflow-hidden text-left group hover:border-accent/20 border border-transparent transition-all"
        >
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full blur-3xl pointer-events-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }} />
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="w-14 h-14 neu-circle flex items-center justify-center text-accent">
              <Clock size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-200">Central de Tempo</h3>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Produtividade Operacional
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white leading-snug relative z-10">
            Relógio, alarmes, cronômetro e timer
            <span className="block mt-1 text-accent">numa só tela.</span>
          </h2>
          <p className="text-gray-500 text-sm mt-2 mb-5 relative z-10">
            Controle de Tempo
          </p>

          <span className="btn-shimmer py-3.5 px-7 rounded-2xl text-sm font-bold flex items-center gap-2 self-start transition-all relative z-10"
            style={{
              background:  'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
              color:       'var(--color-accent-text)',
              border:      'none',
              boxShadow:   '0 4px 20px color-mix(in srgb, var(--color-accent) 25%, transparent)',
            }}>
            Abrir Central de Tempo <ArrowRight size={16} />
          </span>
        </button>
      </div>

      {isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-6 shrink-0 mb-8">
          <h3 className="text-xl font-bold text-gray-200 pl-3 border-l-4 border-accent tracking-wide">Resumo Diário</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
            <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Contas a Receber</h4>
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full neu-flat flex items-center justify-center mb-6 sm:mb-8 border-[3px] border-[#0A0A0A] relative">
                <div className="absolute inset-0 rounded-full border-t-[3px] border-accent animate-spin-slow" style={{ animationDuration: '6s' }}></div>
                <span className="text-3xl sm:text-4xl font-black text-accent drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">{contasReceberCount}</span>
              </div>
              <div className="text-center mt-auto">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Valor Total</span>
                <span className="text-2xl sm:text-3xl font-bold text-gray-100">{contasReceberValor}</span>
              </div>
            </div>
            <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center relative border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 w-full text-left uppercase tracking-widest">Notas Fiscais</h4>
              <span className="text-5xl sm:text-7xl font-black text-white mb-2 tracking-tighter drop-shadow-md mt-4">{notasCount}</span>
              <span className="text-xs font-medium text-gray-500 mb-10 tracking-wide">Notas fiscais capturadas</span>
              <button onClick={() => onNavigate?.('compras-notasrecebidas')} className="neu-button-accent w-full py-4 rounded-xl font-bold text-sm mt-auto">Ver notas recebidas</button>
            </div>
            <div className="neu-flat rounded-3xl p-6 flex flex-col border border-white/5">
              <h4 className="text-xs font-bold text-gray-400 mb-4 pl-2 uppercase tracking-widest">Pedidos de Compra</h4>
              <div className="flex-1 min-h-[140px] w-full mb-6">
                <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                  <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                    <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#0A0A0A', border: '1px solid #1a1a1a', borderRadius: '12px', boxShadow: '8px 8px 16px #000' }} itemStyle={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '12px' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af', paddingTop: '10px' }} />
                    <Bar dataKey="compra" fill="#1f2937" radius={[4, 4, 0, 0]} activeBar={{ fill: '#374151' }} stroke="#111827" strokeWidth={1} name="Compra" />
                    <Line type="monotone" dataKey="pedido" stroke="#10B981" strokeWidth={3} dot={{ r: 3, fill: '#0A0A0A', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#10B981', strokeWidth: 0 }} name="Pedido" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 mt-auto">
                <button onClick={() => onNavigate?.('compras-pedidos')} className="flex-1 neu-pressed py-3.5 rounded-xl font-bold text-[10px] text-gray-400 hover:text-white transition-colors">SAIBA MAIS</button>
                <button onClick={() => onNavigate?.('compras-cotações')} className="flex-1 neu-button py-3.5 rounded-xl font-bold text-[10px] text-accent hover:text-white transition-colors">MAPA DE COTAÇÃO</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
