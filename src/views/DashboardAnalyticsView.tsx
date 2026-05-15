import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { ShoppingCart, Package, Banknote, CreditCard, TrendingUp, TrendingDown, ShieldAlert, FileDown, Sheet } from 'lucide-react';
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

type Period = '7d' | '30d' | 'year';

const sum = (arr: any[], key: string) =>
  arr.reduce((s: number, r: any) => s + (parseFloat(r[key]) || 0), 0);

export const DashboardAnalyticsView = () => {
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview');
  const { data: contasPagar,   isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview');
  const { data: pedidos,       isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const { data: produtos,      isLoading: loadingProd } = useFetchData<any>('/api/produtosview');
  const isLoading = loadingCR || loadingCP || loadingPed || loadingProd;

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

  const receitaTotal = sum(filteredCR, 'valor').toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const despesasTotal = sum(filteredCP, 'valor').toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ordensCount = String(filteredPed.length);
  const ordensNovas = filteredPed.filter((p: any) =>
    new Date(p.created_at).toDateString() === new Date().toDateString()
  ).length;
  const estoqueCritico = String(produtos.filter((p: any) => (p.estoque ?? 0) <= 10).length);

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
      bg: 'bg-red-500/10', color: 'text-red-400', icon: CreditCard,
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
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Dashboard</h2>
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
        {[
          { label: 'Receita Total', val: receitaTotal, growth: `${filteredCR.length} lançamentos`, Icon: Banknote, color: 'text-accent', trendColor: 'text-accent' },
          { label: 'Despesas Operacionais', val: despesasTotal, growth: `${filteredCP.length} lançamentos`, Icon: TrendingDown, color: 'text-gray-100', trendColor: 'text-red-400' },
          { label: 'Ordens de Compra', val: ordensCount, growth: `${ordensNovas} novas hoje`, Icon: Package, color: 'text-gray-100', trendColor: 'text-accent' },
          { label: 'Estoque Crítico', val: estoqueCritico, growth: 'Produtos no estoque de segurança', Icon: ShieldAlert, color: 'text-accent', trendColor: 'text-accent', accent: true },
        ].map(({ label, val, growth, Icon, color, trendColor, accent }) => (
          <div key={label} className={`neu-flat p-6 rounded-3xl border flex flex-col gap-4 relative overflow-hidden ${accent ? 'bg-accent/5 border-accent/20' : 'border-white/5'}`}>
            <div className="absolute top-0 right-0 p-6 opacity-10"><Icon size={48} /></div>
            <span className={`text-[10px] font-bold uppercase tracking-widest relative z-10 ${accent ? 'text-accent' : 'text-gray-500'}`}>{label}</span>
            <span className={`text-3xl font-bold font-mono tracking-tighter relative z-10 ${color}`}>{val}</span>
            <span className={`text-xs font-bold flex items-center gap-1 mt-auto relative z-10 ${trendColor}`}>
              <TrendingUp size={12} /> {growth}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 neu-flat p-6 rounded-3xl border border-white/5 flex flex-col">
          <h3 className="text-sm font-bold text-gray-200 tracking-wide mb-6">Receitas vs Despesas</h3>
          <div className="w-full h-[300px] md:h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val / 1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }} itemStyle={{ color: '#fff', fontSize: '12px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }} />
                <Bar dataKey="receita" fill="#10B981" name="Receita" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="despesa" fill="#ef4444" name="Despesa" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Line type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={3} name="Saldo Líquido" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="neu-flat p-6 rounded-3xl border border-white/5 flex flex-col gap-6 overflow-hidden">
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
