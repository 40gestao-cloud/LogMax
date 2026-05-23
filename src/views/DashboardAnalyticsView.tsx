import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Package, Banknote, CreditCard, TrendingUp, TrendingDown, ShieldAlert, FileDown, Sheet, Building2, X, ChevronDown } from 'lucide-react';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';
import type { UserProfile } from '../hooks/useUserProfile';

type Period = '7d' | '30d' | 'year';
type KpiKey = 'receita' | 'despesa' | 'ordens' | 'estoque';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const sum = (arr: any[], key: string) =>
  arr.reduce((s: number, r: any) => s + (parseFloat(r[key]) || 0), 0);

export const DashboardAnalyticsView = ({ profile }: { profile?: UserProfile | null }) => {
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview');
  const { data: contasPagar,   isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview');
  const { data: pedidos,       isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const { data: produtos,      isLoading: loadingProd } = useFetchData<any>('/api/produtosview');
  const { data: vendas,        isLoading: loadingVendas } = useFetchData<any>('/api/vendasview');
  const isLoading = loadingCR || loadingCP || loadingPed || loadingProd || loadingVendas;

  // Drill-down dos KPIs liberado para: Admin, CEO, Gerente Financeiro,
  // Gerente Logística. Os demais perfis (e visitantes via deep-link) veem
  // os cards mas eles não respondem a clique. RLS continua sendo a defesa
  // real — gerentes só veem os registros do próprio escopo.
  const canExpandKpis = !!profile && (
    profile.role === 'admin' ||
    profile.role === 'ceo' ||
    (profile.role === 'gerente' && (profile.setor === 'financeiro' || profile.setor === 'logistica'))
  );
  const [expandedKpi, setExpandedKpi] = useState<KpiKey | null>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // Se o usuário perder a permissão em runtime (troca de perfil, refetch),
  // limpa o estado pra não deixar um painel órfão referenciado.
  useEffect(() => {
    if (!canExpandKpis && expandedKpi) setExpandedKpi(null);
  }, [canExpandKpis, expandedKpi]);

  // No mobile o painel abre DEPOIS dos 4 cards stacked — sem este scroll
  // o usuário toca e parece não acontecer nada (painel está fora do
  // viewport). Atrasamos 220ms (transition de 200ms + folga) pra rolar
  // só quando o painel já tem altura; rolar antes faz o scrollIntoView
  // tratar a div de height:0 como "já visível" e ignorar.
  // `block: 'nearest'` evita rolagem desnecessária no desktop se já
  // estiver no viewport.
  useEffect(() => {
    if (!expandedKpi) return;
    const id = setTimeout(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 220);
    return () => clearTimeout(id);
  }, [expandedKpi]);

  const [period, setPeriod] = useState<Period>('30d');

  const dateFrom = useMemo(() => {
    const now = new Date();
    if (period === '7d')  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    if (period === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    return new Date(now.getFullYear(), 0, 1);
  }, [period]);

  const filteredCR  = useMemo(() => contasReceber.filter((r: any) => new Date(r.created_at) >= dateFrom), [contasReceber, dateFrom]);
  const filteredCP  = useMemo(() => contasPagar.filter((r: any)   => new Date(r.created_at) >= dateFrom), [contasPagar,   dateFrom]);
  const filteredPed = useMemo(() => pedidos.filter((r: any)       => new Date(r.created_at) >= dateFrom), [pedidos,       dateFrom]);
  const filteredVendas = useMemo(
    () => vendas.filter((v: any) => v.status !== 'Cancelada' && new Date(v.created_at) >= dateFrom),
    [vendas, dateFrom]
  );

  // Faturamento por filial — agrupa vendas pelo campo `filial`. Vendas sem
  // filial (antigas, pré-migration) caem em 'Não atribuído'.
  const faturamentoPorFilial = useMemo(() => {
    const bucket: Record<string, { total: number; count: number }> = {};
    for (const f of FILIAIS_HOLDING) bucket[f] = { total: 0, count: 0 };
    for (const v of filteredVendas) {
      const key = v.filial && (FILIAIS_HOLDING as readonly string[]).includes(v.filial)
        ? v.filial
        : 'Não atribuído';
      if (!bucket[key]) bucket[key] = { total: 0, count: 0 };
      bucket[key].total += Number(v.total_final) || 0;
      bucket[key].count += 1;
    }
    return bucket;
  }, [filteredVendas]);

  // Classes Tailwind devem ser literais para o JIT detectar — não usar
  // template strings como `text-${color}-400`.
  const filialTextClass: Record<string, string> = {
    SuperMax:        'text-sky-400',
    MaxLook:         'text-fuchsia-400',
    TechMax:         'text-emerald-400',
    Matriz:          'text-gray-400',
    'Não atribuído': 'text-red-400',
  };

  const receitaTotal = sum(filteredCR, 'valor').toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const despesasTotal = sum(filteredCP, 'valor').toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ordensCount = String(filteredPed.length);
  const ordensNovas = filteredPed.filter((p: any) =>
    new Date(p.created_at).toDateString() === new Date().toDateString()
  ).length;
  const estoqueCritico = String(produtos.filter((p: any) => {
    const minimo = Number(p.estoque_minimo ?? 0) || 10;
    return (p.estoque ?? 0) <= minimo;
  }).length);

  const bars = useMemo(() => {
    const now = new Date();
    const sumVal = (arr: any[]) => arr.reduce((s: number, r: any) => s + (parseFloat(r.valor) || 0), 0);

    if (period === '7d') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i);
        const inDay = (arr: any[]) => arr.filter((r: any) =>
          new Date(r.created_at).toDateString() === d.toDateString()
        );
        const receita = Math.round(sumVal(inDay(contasReceber)));
        const despesa = Math.round(sumVal(inDay(contasPagar)));
        return {
          name: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
          receita, despesa, saldo: receita - despesa,
        };
      });
    }

    if (period === '30d') {
      return Array.from({ length: 4 }, (_, i) => {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27 + i * 7);
        const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27 + i * 7 + 6, 23, 59, 59);
        const inWeek = (arr: any[]) => arr.filter((r: any) => {
          const d = new Date(r.created_at);
          return d >= start && d <= end;
        });
        const receita = Math.round(sumVal(inWeek(contasReceber)));
        const despesa = Math.round(sumVal(inWeek(contasPagar)));
        return { name: `S${i + 1}`, receita, despesa, saldo: receita - despesa };
      });
    }

    // year — 12 meses
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return Array.from({ length: 12 }, (_, i) => {
      const inMonth = (arr: any[]) => arr.filter((r: any) => {
        const d = new Date(r.created_at);
        return d.getMonth() === i && d.getFullYear() === now.getFullYear();
      });
      const receita = Math.round(sumVal(inMonth(contasReceber)));
      const despesa = Math.round(sumVal(inMonth(contasPagar)));
      return { name: MESES[i], receita, despesa, saldo: receita - despesa };
    });
  }, [period, contasReceber, contasPagar]);

  const movimentos = [
    ...filteredPed.slice(0, 2).map((p: any) => ({
      bg: 'bg-accent/10', color: 'text-accent', icon: ShoppingCart,
      title: 'Pedido de Compra',
      doc: (p.id as string)?.slice(0, 8).toUpperCase() ?? '—',
      val: `R$ ${(parseFloat(p.valor_total) || 0).toFixed(2).replace('.', ',')}`,
    })),
    ...filteredCR.slice(0, 2).map((c: any) => ({
      bg: 'bg-blue-500/10', color: 'text-blue-400', icon: Banknote,
      title: 'Conta a Receber',
      doc: (c.id as string)?.slice(0, 8).toUpperCase() ?? '—',
      val: `R$ ${(parseFloat(c.valor) || 0).toFixed(2).replace('.', ',')}`,
    })),
    ...filteredCP.slice(0, 2).map((c: any) => ({
      bg: 'bg-red-500/10', color: 'text-red-500', icon: CreditCard,
      title: 'Conta a Pagar',
      doc: (c.id as string)?.slice(0, 8).toUpperCase() ?? '—',
      val: `R$ ${(parseFloat(c.valor) || 0).toFixed(2).replace('.', ',')}`,
    })),
  ].slice(0, 5);

  const periodLabel = period === '7d' ? '7dias' : period === '30d' ? '30dias' : 'ano';

  const buildExportData = () => {
    const cols = ['Indicador / Período', 'Valor / Receita (R$)', 'Despesas (R$)', 'Saldo (R$)'];
    const rows: any[][] = [
      ['— RESUMO —',       '',                              '',  ''],
      ['Receita Total',    receitaTotal,                    '',  ''],
      ['Despesas',         despesasTotal,                   '',  ''],
      ['Ordens de Compra', ordensCount,                     '',  ''],
      ['Estoque Crítico',  `${estoqueCritico} produtos`,    '',  ''],
      ['',                 '',                              '',  ''],
      ['— GRÁFICO —',      'Receita (R$)', 'Despesas (R$)', 'Saldo (R$)'],
      ...bars.map(b => [b.name, b.receita, b.despesa, b.saldo]),
    ];
    return { cols, rows };
  };

  const handleExportPDF = () => {
    const { cols, rows } = buildExportData();
    exportToPDF(`Dashboard LogMax — ${periodLabel}`, cols, rows, `logmax-dashboard-${periodLabel}`);
  };

  const handleExportExcel = () => {
    const { cols, rows } = buildExportData();
    exportToExcel('Dashboard', cols, rows, `logmax-dashboard-${periodLabel}`);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8 pb-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Dashboard</h2>
          <p className="text-sm text-gray-400 mt-1">Visão geral da sua operação.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as Period)}
            className="neu-input py-2 px-3 rounded-xl text-xs text-gray-300"
          >
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="year">Este ano</option>
          </select>
          <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
          <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 shrink-0">
        {([
          { key: 'receita',  label: 'Receita Total',          val: receitaTotal,  growth: `${filteredCR.length} lançamentos`,  Icon: Banknote,    color: 'text-accent',   trendColor: 'text-accent',  accent: false },
          { key: 'despesa',  label: 'Despesas Operacionais',  val: despesasTotal, growth: `${filteredCP.length} lançamentos`,  Icon: TrendingDown, color: 'text-gray-100', trendColor: 'text-red-500', accent: false },
          { key: 'ordens',   label: 'Ordens de Compra',       val: ordensCount,   growth: `${ordensNovas} novas hoje`,         Icon: Package,     color: 'text-gray-100', trendColor: 'text-accent',  accent: false },
          { key: 'estoque',  label: 'Estoque Crítico',        val: estoqueCritico, growth: 'Produtos no estoque de segurança', Icon: ShieldAlert, color: 'text-accent',   trendColor: 'text-accent',  accent: true  },
        ] as const).map(({ key, label, val, growth, Icon, color, trendColor, accent }) => {
          const isExpanded = expandedKpi === key;
          const interactive = canExpandKpis;
          // O card inteiro vira <button> quando o usuário tem permissão —
          // alvo grande facilita touch no mobile. O ícone decorativo passa
          // a indicar a interatividade (opacidade sobe + chevron aparece).
          const baseCls = `neu-flat p-6 rounded-3xl border flex flex-col gap-4 relative overflow-hidden text-left transition-all ${
            accent ? 'bg-accent/5 border-accent/20' : 'border-white/5'
          }`;
          const interactiveCls = interactive
            ? 'cursor-pointer hover:border-accent/40 hover:scale-[1.01] active:scale-[0.99]'
            : 'cursor-default';
          const expandedCls = isExpanded ? 'ring-2 ring-accent/60' : '';
          const Inner = (
            <>
              <div className={`absolute top-0 right-0 p-6 transition-opacity ${interactive ? 'opacity-25' : 'opacity-10'}`}>
                <Icon size={48} />
              </div>
              {interactive && (
                <ChevronDown
                  size={16}
                  className={`absolute top-4 right-4 text-accent transition-transform z-10 ${isExpanded ? 'rotate-180' : ''}`}
                />
              )}
              <span className={`text-[10px] font-bold uppercase tracking-widest relative z-10 ${accent ? 'text-accent' : 'text-gray-500'}`}>{label}</span>
              <span className={`text-3xl font-bold font-mono tracking-tighter relative z-10 ${color}`}>{val}</span>
              <span className={`text-xs font-bold flex items-center gap-1 mt-auto relative z-10 ${trendColor}`}>
                <TrendingUp size={12} /> {growth}
              </span>
            </>
          );
          return interactive ? (
            <button
              key={key}
              type="button"
              onClick={() => setExpandedKpi(prev => prev === key ? null : key)}
              aria-expanded={isExpanded}
              aria-controls="kpi-detail-panel"
              className={`${baseCls} ${interactiveCls} ${expandedCls}`}
            >
              {Inner}
            </button>
          ) : (
            <div key={key} className={baseCls}>{Inner}</div>
          );
        })}
      </div>

      {/* Painel de drill-down dos KPIs (só para perfis autorizados) */}
      <AnimatePresence initial={false}>
        {expandedKpi && canExpandKpis && (
          <motion.div
            ref={detailPanelRef}
            id="kpi-detail-panel"
            key={expandedKpi}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <KpiDetailPanel
              kind={expandedKpi}
              contasReceber={filteredCR}
              contasPagar={filteredCP}
              pedidos={filteredPed}
              produtos={produtos}
              onClose={() => setExpandedKpi(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Faturamento por Filial (Holding) */}
      <div className="neu-flat p-6 rounded-3xl border border-white/5 flex flex-col gap-4 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-gray-200 tracking-wide flex items-center gap-2">
            <Building2 size={14} className="text-accent" /> Faturamento por Filial
          </h3>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
            {filteredVendas.length} venda(s) no período
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sempre mostrar as 4 unidades + 'Não atribuído' se houver vendas órfãs */}
          {[...FILIAIS_HOLDING, 'Não atribuído'].map(filial => {
            const agg = faturamentoPorFilial[filial] ?? { total: 0, count: 0 };
            if (filial === 'Não atribuído' && agg.count === 0) return null;
            const colorCls = filialTextClass[filial] ?? 'text-gray-400';
            return (
              <div key={filial} className="neu-pressed p-4 rounded-2xl border border-white/5 flex flex-col gap-1.5">
                <span className={`text-[10px] font-black uppercase tracking-widest ${colorCls}`}>{filial}</span>
                <span className="text-xl font-black font-mono tabular-nums text-gray-100">
                  {agg.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
                <span className="text-[10px] text-gray-500">{agg.count} venda(s)</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 neu-flat p-6 rounded-3xl border border-white/5 flex flex-col">
          <h3 className="text-sm font-bold text-gray-200 tracking-wide mb-6">Receitas vs Despesas</h3>
          <div className="w-full h-[300px] md:h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val / 1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-md)', borderRadius: '12px' }} labelStyle={{ color: 'var(--color-text-muted)', fontSize: '11px' }} itemStyle={{ color: 'var(--color-text-primary)', fontSize: '12px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }} />
                <Bar dataKey="receita" fill="#10B981" name="Receita" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="despesa" fill="#ef4444" name="Despesa" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Line type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={3} name="Saldo Líquido" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="neu-flat p-6 rounded-3xl border border-white/5 flex flex-col gap-6">
          <h3 className="text-sm font-bold text-gray-200 tracking-wide">Movimentações Recentes</h3>
          <div className="flex flex-col gap-4 overflow-y-auto main-scrollbar pr-2 max-h-[340px]">
            {isLoading ? <LoadingSpinner /> : movimentos.length === 0 ? <EmptyState /> : movimentos.map((mov: any, i: number) => (
              <div key={i} className="neu-pressed p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mov.bg} ${mov.color}`}>
                    <mov.icon size={14} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-gray-300">{mov.title}</span>
                    <span className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">{mov.doc}</span>
                  </div>
                </div>
                <span className={`text-xs font-mono font-bold ${mov.color}`}>{mov.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Painel de drill-down dos KPIs
// ──────────────────────────────────────────────────────────────────────
type KpiKind = 'receita' | 'despesa' | 'ordens' | 'estoque';

const KPI_TITLE: Record<KpiKind, string> = {
  receita: 'Lançamentos — Receita Total',
  despesa: 'Lançamentos — Despesas Operacionais',
  ordens:  'Lançamentos — Ordens de Compra',
  estoque: 'Produtos em Estoque Crítico',
};

const KPI_HINT: Record<KpiKind, string> = {
  receita: 'Contas a receber registradas no período selecionado.',
  despesa: 'Contas a pagar registradas no período selecionado.',
  ordens:  'Pedidos de compra criados no período selecionado.',
  estoque: 'Produtos cujo saldo está no/abaixo do estoque mínimo (default 10).',
};

function KpiDetailPanel({
  kind, contasReceber, contasPagar, pedidos, produtos, onClose,
}: {
  kind: KpiKind;
  contasReceber: any[];
  contasPagar: any[];
  pedidos: any[];
  produtos: any[];
  onClose: () => void;
}) {
  const rows = (() => {
    if (kind === 'receita') {
      return contasReceber.map(c => ({
        id: c.id,
        primary:   c.descricao ?? '—',
        secondary: c.cliente ?? '',
        value:     parseFloat(c.valor) || 0,
        date:      c.vencimento ?? c.created_at,
        status:    c.status ?? '—',
      }));
    }
    if (kind === 'despesa') {
      return contasPagar.map(c => ({
        id: c.id,
        primary:   c.descricao ?? '—',
        secondary: c.fornecedor ?? '',
        value:     parseFloat(c.valor) || 0,
        date:      c.vencimento ?? c.created_at,
        status:    c.status ?? '—',
      }));
    }
    if (kind === 'ordens') {
      return pedidos.map(p => ({
        id: p.id,
        primary:   p.item_descricao ?? (p.id?.slice(0, 8).toUpperCase() ?? '—'),
        secondary: p.fornecedor ?? '',
        value:     parseFloat(p.valor_total) || 0,
        date:      p.created_at,
        status:    p.status ?? '—',
      }));
    }
    // estoque crítico
    return produtos
      .filter(p => {
        const minimo = Number(p.estoque_minimo ?? 0) || 10;
        return (p.estoque ?? 0) <= minimo;
      })
      .map(p => ({
        id: p.id,
        primary:   p.nome ?? '—',
        secondary: p.codigo ?? '',
        value:     null,
        date:      null,
        status:    `${p.estoque ?? 0} / mín ${Number(p.estoque_minimo ?? 0) || 10}`,
      }));
  })();

  return (
    <div className="neu-flat p-5 sm:p-6 rounded-3xl border border-accent/30 flex flex-col gap-4 mt-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-accent tracking-wide">{KPI_TITLE[kind]}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">{KPI_HINT[kind]} ({rows.length} {rows.length === 1 ? 'registro' : 'registros'})</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-white shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Nenhum lançamento no período (ou RLS bloqueou para o seu perfil)" />
      ) : (
        <>
          {/* Mobile (<md): lista de cards verticais — evita scroll horizontal */}
          <div className="md:hidden flex flex-col gap-2 max-h-[420px] overflow-y-auto main-scrollbar -mx-2 px-2">
            {rows.map(r => (
              <div key={r.id} className="neu-pressed rounded-2xl p-3 border border-white/5 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-200 truncate flex-1 min-w-0">{r.primary}</p>
                  <span className="text-sm font-mono text-gray-100 font-bold shrink-0 tabular-nums">
                    {r.value !== null ? BRL(r.value) : r.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0">{r.secondary || '—'}</span>
                  {r.date && (
                    <span className="text-[10px] text-gray-600 font-mono shrink-0">
                      {new Date(r.date).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>
                {kind !== 'estoque' && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">{r.status}</span>
                )}
              </div>
            ))}
          </div>

          {/* Desktop (md+): tabela original */}
          <div className="hidden md:block overflow-x-auto max-h-[420px] overflow-y-auto main-scrollbar -mx-2 px-2">
            <table className="w-full min-w-[600px]">
              <thead className="text-[10px] uppercase tracking-widest text-gray-500 sticky top-0 bg-[var(--color-bg-base)]">
                <tr className="border-b border-white/5">
                  <th className="text-left py-2 px-2 font-bold">Descrição</th>
                  <th className="text-left py-2 px-2 font-bold">{kind === 'receita' ? 'Cliente' : kind === 'despesa' || kind === 'ordens' ? 'Fornecedor' : 'Código'}</th>
                  <th className="text-right py-2 px-2 font-bold">{kind === 'estoque' ? 'Estoque' : 'Valor'}</th>
                  <th className="text-left py-2 px-2 font-bold">{kind === 'estoque' ? '' : 'Data'}</th>
                  <th className="text-left py-2 px-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 px-2 text-gray-200 font-semibold truncate max-w-[280px]">{r.primary}</td>
                    <td className="py-2 px-2 text-gray-400 truncate max-w-[200px]">{r.secondary || '—'}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-100">
                      {r.value !== null ? BRL(r.value) : r.status}
                    </td>
                    <td className="py-2 px-2 text-gray-500 font-mono text-[11px]">
                      {r.date ? new Date(r.date).toLocaleDateString('pt-BR') : ''}
                    </td>
                    <td className="py-2 px-2">
                      {kind === 'estoque' ? '' : (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{r.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
