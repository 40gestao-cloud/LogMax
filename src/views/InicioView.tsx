import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Boxes, ClipboardList, ShoppingCart, TrendingUp, CreditCard, Package, Users, Check, Settings, Loader2, X, MessageCircle, ShoppingBag, DollarSign, Megaphone } from 'lucide-react';
import { useWhatsApp } from '../hooks/useWhatsApp';
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

export const InicioView = ({ onNavigate, showToast, profile }: { onNavigate?: (view: string) => void; showToast?: (msg: string, type?: string) => void; profile?: UserProfile }) => {
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview');
  const { data: notasRecebidas, isLoading: loadingNR } = useFetchData<any>('/api/notasrecebidasview');
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const isLoading = loadingCR || loadingNR || loadingPed;

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

  const { config: wppConfig, isActive: wppActive, isLoading: wppLoading, saveConfig: wppSave, disableIntegration: wppDisable, testConnection: wppTest } = useWhatsApp();
  const [showWppForm, setShowWppForm] = useState(false);
  const [wppInput, setWppInput] = useState({ instance: '', token: '', phone: '' });
  const [wppTesting, setWppTesting] = useState(false);
  const [wppError, setWppError] = useState('');
  const isAdmin = profile?.role === 'admin';

  const handleWppSave = async () => {
    if (!wppInput.instance.trim() || !wppInput.token.trim() || !wppInput.phone.trim()) {
      setWppError('Preencha todos os campos'); return;
    }
    setWppTesting(true); setWppError('');
    const { ok, error } = await wppTest(wppInput);
    if (!ok) { setWppError(error ?? 'Falha no teste de conexão'); setWppTesting(false); return; }
    await wppSave(wppInput);
    setShowWppForm(false);
    setWppTesting(false);
    showToast?.('WhatsApp integrado com sucesso!', 'success');
  };

  const handleWppDisable = async () => {
    await wppDisable();
    showToast?.('Integração WhatsApp desativada.', 'info');
  };

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

        <div className="lg:col-span-7 neu-flat rounded-3xl p-5 sm:p-8 flex flex-col justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full blur-3xl pointer-events-none transition-colors"
            style={{ background: wppActive ? 'rgba(37,211,102,0.06)' : 'rgba(16,185,129,0.04)' }} />
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 neu-circle flex items-center justify-center" style={{ color: '#25D366' }}>
                <MessageCircle size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-200">Integração WhatsApp</h3>
                {!wppLoading && (
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: wppActive ? '#25D366' : 'var(--color-text-dim)' }}>
                    {wppActive ? '● Ativo' : '○ Inativo'}
                  </span>
                )}
              </div>
            </div>
            {wppActive && isAdmin && (
              <div className="flex items-center gap-2 relative z-10">
                <button onClick={() => { setWppInput(wppConfig); setShowWppForm(v => !v); setWppError(''); }}
                  className="neu-button rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition-colors">
                  <Settings size={13} /> Configurar
                </button>
                <button onClick={handleWppDisable}
                  className="neu-button rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-500 transition-colors">
                  <X size={13} /> Desativar
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {wppLoading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-gray-500 text-sm relative z-10">
                <Loader2 size={14} className="animate-spin" /> Carregando configuração...
              </motion.div>
            ) : wppActive && !showWppForm ? (
              <motion.div key="active" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="flex flex-col gap-4 relative z-10">
                <p className="text-gray-400 text-sm leading-relaxed">
                  Mensagens automáticas são enviadas via WhatsApp quando requisições são aprovadas e pedidos avançam de status.
                </p>
                <div className="flex items-center gap-3 p-4 rounded-2xl"
                  style={{ background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.15)' }}>
                  <Check size={16} style={{ color: '#25D366' }} className="shrink-0" />
                  <div>
                    <p className="text-xs font-bold" style={{ color: '#25D366' }}>Z-API configurada</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Instância: <span className="font-mono">{wppConfig.instance}</span> · Destino: <span className="font-mono">{wppConfig.phone}</span>
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="inactive-or-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="flex flex-col gap-4 relative z-10">
                {!showWppForm ? (
                  <>
                    <h2 className="text-2xl font-bold text-white leading-snug">
                      Receba notificações automáticas <span style={{ color: '#25D366' }} className="block mt-1">direto no WhatsApp</span>
                    </h2>
                    <p className="text-gray-500 text-sm">Configure sua instância Z-API e o LogMax enviará mensagens a cada aprovação e avanço de pedido.</p>
                    {isAdmin && (
                      <button onClick={() => { setShowWppForm(true); setWppInput({ instance: '', token: '', phone: '' }); setWppError(''); }}
                        className="py-3.5 px-7 rounded-2xl text-sm font-bold flex items-center gap-2 self-start transition-all"
                        style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)', color: '#fff', border: 'none',
                          boxShadow: '0 4px 20px rgba(37,211,102,0.25)' }}>
                        Ativar integração <ArrowRight size={16} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-gray-500">Preencha os dados da sua instância Z-API. Uma mensagem de teste será enviada antes de salvar.</p>
                    {(['instance', 'token', 'phone'] as const).map(field => (
                      <input
                        key={field}
                        value={wppInput[field]}
                        onChange={e => { setWppInput(p => ({ ...p, [field]: e.target.value })); setWppError(''); }}
                        placeholder={field === 'instance' ? 'ID da instância' : field === 'token' ? 'Token da instância' : 'Número destino (ex: 5511999999999)'}
                        style={{
                          background: 'var(--color-input-bg)',
                          boxShadow: 'var(--color-input-shadow)',
                          border: wppError ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--color-input-border)',
                          borderRadius: '0.875rem', padding: '0.7rem 1rem',
                          color: 'var(--color-input-text)', fontSize: '0.8rem', outline: 'none', width: '100%',
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(37,211,102,0.3)'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = wppError ? 'rgba(239,68,68,0.4)' : 'var(--color-input-border)'; }}
                      />
                    ))}
                    {wppError && (
                      <p className="text-xs text-red-500 flex items-center gap-1.5">
                        <X size={11} /> {wppError}
                      </p>
                    )}
                    <div className="flex gap-2 mt-1">
                      <button onClick={handleWppSave} disabled={wppTesting}
                        className="py-2.5 px-5 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50 transition-all"
                        style={{ background: wppTesting ? 'rgba(37,211,102,0.4)' : 'linear-gradient(135deg, #25D366, #128C7E)',
                          color: '#fff', border: 'none' }}>
                        {wppTesting ? <><Loader2 size={12} className="animate-spin" /> Testando...</> : <><Check size={12} /> Testar e Salvar</>}
                      </button>
                      <button onClick={() => { setShowWppForm(false); setWppError(''); }}
                        className="neu-button py-2.5 px-4 rounded-xl text-xs font-bold text-gray-500 hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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
