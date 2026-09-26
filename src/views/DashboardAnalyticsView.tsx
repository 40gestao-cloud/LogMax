import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Banknote, CreditCard, FileDown, Sheet, X } from 'lucide-react';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
  CartesianGrid,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, EmptyState, CardContador, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';

type Period = '7d' | '30d' | 'year';
type KpiKey = 'receita' | 'despesa' | 'ordens' | 'estoque';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PERIODOS: { id: Period; label: string }[] = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'year', label: 'Ano' },
];

// "R$ 1,5 mil" em vez de "R$1.5k".
const eixoBRL = (v: number) =>
  Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v}`;

const sum = (arr: any[], key: string) =>
  arr.reduce((s: number, r: any) => s + (parseFloat(r[key]) || 0), 0);

export const DashboardAnalyticsView = ({ profile }: { profile?: UserProfile | null }) => {
  // Escopo: colaborador/gerente scoped só vê KPIs da própria unidade.
  // Admin/CEO em Matriz (filialAtiva=null) mantêm consolidado das 3 unidades
  // — o card "Faturamento por Filial" continua fazendo sentido só nesse modo.
  const { filialAtiva } = useFilial();
  const filialFilter = filialAtiva ? { filial: filialAtiva } : undefined;
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview', filialFilter);
  const { data: contasPagar,   isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview', filialFilter);
  const { data: pedidos,       isLoading: loadingPed } = useFetchData<any>('/api/pedidosview', filialFilter);
  const { data: produtos,      isLoading: loadingProd } = useFetchData<any>('/api/produtosview', filialFilter);
  const { data: vendas,        isLoading: loadingVendas } = useFetchData<any>('/api/vendasview', filialFilter);
  const isLoading = loadingCR || loadingCP || loadingPed || loadingProd || loadingVendas;

  // Drill-down dos KPIs liberado para: Admin, CEO, qualquer Gerente (regra
  // canônica "gerente vê/faz tudo da própria filial"). RLS continua sendo a
  // defesa real — gerentes só veem os registros do próprio escopo.
  const canExpandKpis = !!profile && (
    profile.role === 'admin' || isConselheiro(profile) ||
    profile.role === 'ceo' ||
    profile.role === 'gerente'
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

  // Comparativo Matriz — só renderizado quando filialAtiva=null (visão
  // consolidada da holding). Agrega receita/despesa/vendas/pedidos por
  // unidade operacional (Matriz não vende, fica fora).
  const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
  const comparativoUnidades = useMemo(() => {
    const bucket: Record<string, {
      receita: number; despesa: number; saldo: number;
      vendasCount: number; vendasTotal: number; pedidos: number;
    }> = {};
    for (const f of OP_FILIAIS) bucket[f] = {
      receita: 0, despesa: 0, saldo: 0, vendasCount: 0, vendasTotal: 0, pedidos: 0,
    };
    for (const r of filteredCR) if (bucket[r.filial]) bucket[r.filial].receita += Number(r.valor) || 0;
    for (const r of filteredCP) if (bucket[r.filial]) bucket[r.filial].despesa += Number(r.valor) || 0;
    for (const p of filteredPed) if (bucket[p.filial]) bucket[p.filial].pedidos += 1;
    for (const v of filteredVendas) {
      if (bucket[v.filial]) {
        bucket[v.filial].vendasCount += 1;
        bucket[v.filial].vendasTotal += Number(v.total_final) || 0;
      }
    }
    for (const f of OP_FILIAIS) bucket[f].saldo = bucket[f].receita - bucket[f].despesa;
    return bucket;
  }, [filteredCR, filteredCP, filteredPed, filteredVendas]);

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

  const saldoPeriodo = sum(filteredCR, 'valor') - sum(filteredCP, 'valor');
  const estoqueCriticoN = Number(estoqueCritico);

  // As três fontes num fluxo só, da mais recente para a mais antiga.
  const movimentos = [
    ...filteredPed.map((p: any) => ({
      id: `p-${p.id}`, tipo: 'Pedido de compra', icon: ShoppingCart, cor: 'text-blue-400', bg: 'bg-blue-500/10',
      desc: p.item_descricao ?? p.fornecedor ?? '—', valor: parseFloat(p.valor_total) || 0, quando: p.created_at, sinal: -1,
    })),
    ...filteredCR.map((c: any) => ({
      id: `r-${c.id}`, tipo: 'A receber', icon: Banknote, cor: 'text-emerald-400', bg: 'bg-emerald-500/10',
      desc: c.descricao ?? c.cliente ?? '—', valor: parseFloat(c.valor) || 0, quando: c.created_at, sinal: 1,
    })),
    ...filteredCP.map((c: any) => ({
      id: `c-${c.id}`, tipo: 'A pagar', icon: CreditCard, cor: 'text-red-400', bg: 'bg-red-500/10',
      desc: c.descricao ?? c.fornecedor ?? '—', valor: parseFloat(c.valor) || 0, quando: c.created_at, sinal: -1,
    })),
  ]
    .sort((a, b) => String(b.quando ?? '').localeCompare(String(a.quando ?? '')))
    .slice(0, 8);

  const periodLabel = period === '7d' ? '7dias' : period === '30d' ? '30dias' : 'ano';

  const buildExportData = () => {
    const cols = ['Indicador / Período', 'Valor / Receita (R$)', 'Despesas (R$)', 'Saldo (R$)'];
    const rows: any[][] = [
      ['— RESUMO —',       '',                              '',  ''],
      ['Receita Total',    receitaTotal,                    '',  ''],
      ['Despesas',         despesasTotal,                   '',  ''],
      ['Saldo',            BRL(saldoPeriodo),               '',  ''],
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

  const alternar = (k: KpiKey) => canExpandKpis ? () => setExpandedKpi(prev => prev === k ? null : k) : undefined;
  const vendasOrfas = faturamentoPorFilial['Não atribuído']?.count ?? 0;
  const totalUnidades = OP_FILIAIS.reduce((acc, f) => {
    const a = comparativoUnidades[f];
    return {
      vendasCount: acc.vendasCount + a.vendasCount, vendasTotal: acc.vendasTotal + a.vendasTotal,
      receita: acc.receita + a.receita, despesa: acc.despesa + a.despesa, saldo: acc.saldo + a.saldo, pedidos: acc.pedidos + a.pedidos,
    };
  }, { vendasCount: 0, vendasTotal: 0, receita: 0, despesa: 0, saldo: 0, pedidos: 0 });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
          Dashboard{filialAtiva ? ` — ${filialAtiva}` : ''}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 neu-pressed rounded-xl p-1 border border-white/5" role="radiogroup" aria-label="Período">
            {PERIODOS.map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  period === p.id ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={handleExportPDF} title="Exportar PDF" className="btn-solido btn-solido--vermelho"><FileDown size={15} /> PDF</button>
          <button onClick={handleExportExcel} title="Exportar Excel" className="btn-solido btn-solido--verde"><Sheet size={15} /> Excel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 shrink-0 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
        <CardContador label="Receita" value={receitaTotal} tom="verde"
          sub={`${filteredCR.length} lançamento(s)`} onClick={alternar('receita')} ativo={expandedKpi === 'receita'} />
        <CardContador label="Despesas" value={despesasTotal} tom="vermelho"
          sub={`${filteredCP.length} lançamento(s)`} onClick={alternar('despesa')} ativo={expandedKpi === 'despesa'} />
        <CardContador label="Saldo" value={BRL(saldoPeriodo)} tom={saldoPeriodo < 0 ? 'vermelho' : 'azul'}
          sub="Receita − despesas" />
        <CardContador label="Pedidos de compra" value={filteredPed.length} tom="neutro"
          sub={ordensNovas > 0 ? `${ordensNovas} hoje` : 'Nenhum hoje'} onClick={alternar('ordens')} ativo={expandedKpi === 'ordens'} />
        <CardContador label="Estoque crítico" value={estoqueCriticoN} tom="laranja"
          sub="No mínimo ou abaixo" onClick={alternar('estoque')} ativo={expandedKpi === 'estoque'} />
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 neu-flat p-5 rounded-2xl border border-white/5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-gray-200">Receitas x despesas</h3>
          <div className="w-full h-[280px] md:h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={eixoBRL} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-md)', borderRadius: '12px' }}
                  labelStyle={{ color: 'var(--color-text-muted)', fontSize: '11px' }} itemStyle={{ fontSize: '12px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#9ca3af' }} />
                <Bar dataKey="receita" fill="#10B981" name="Receita" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="despesa" fill="#ef4444" name="Despesa" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Line type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={2.5} name="Saldo" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="neu-flat p-5 rounded-2xl border border-white/5 flex flex-col gap-3 min-h-0">
          <h3 className="text-sm font-bold text-gray-200">Movimentações recentes</h3>
          <div className="flex flex-col divide-y divide-white/5 overflow-y-auto main-scrollbar pr-1 max-h-[340px]">
            {isLoading ? <LoadingSpinner /> : movimentos.length === 0 ? <EmptyState message="Nada no período." /> : movimentos.map(mov => (
              <div key={mov.id} className="flex items-center gap-3 py-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${mov.bg} ${mov.cor}`}>
                  <mov.icon size={14} />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold text-gray-200 truncate" title={mov.desc}>{mov.desc}</span>
                  <span className="text-[10px] text-gray-500">
                    {mov.tipo} · {mov.quando ? new Date(mov.quando).toLocaleDateString('pt-BR') : '—'}
                  </span>
                </div>
                <span className={`text-xs font-bold tabular-nums shrink-0 ${mov.cor}`}>{BRL(mov.valor)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Só na visão consolidada: numa unidade, o RLS já recortou as outras. */}
      {filialAtiva === null && (
        <section className="neu-flat p-5 rounded-2xl border border-white/5 flex flex-col gap-4 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-gray-200">Unidades</h3>
            {vendasOrfas > 0 && (
              <span className="text-[11px] text-amber-400">{vendasOrfas} venda(s) sem unidade ficaram fora</span>
            )}
          </div>
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left min-w-[640px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest">
                  <th className="py-2.5 px-3 font-bold">Unidade</th>
                  <th className="py-2.5 px-3 font-bold text-center">Vendas</th>
                  <th className="py-2.5 px-3 font-bold text-center">Vendido</th>
                  <th className="py-2.5 px-3 font-bold text-center">Receita</th>
                  <th className="py-2.5 px-3 font-bold text-center">Despesa</th>
                  <th className="py-2.5 px-3 font-bold text-center">Saldo</th>
                  <th className="py-2.5 px-3 font-bold text-center">Pedidos</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {OP_FILIAIS.map(filial => {
                  const a = comparativoUnidades[filial];
                  return (
                    <tr key={filial}>
                      <td className={`py-3 px-3 font-bold ${filialTextClass[filial] ?? 'text-gray-300'}`}>{filial}</td>
                      <td className="py-3 px-3 tabular-nums text-gray-300">{a.vendasCount}</td>
                      <td className="py-3 px-3 tabular-nums text-gray-100 font-semibold">{BRL(a.vendasTotal)}</td>
                      <td className="py-3 px-3 tabular-nums text-emerald-400">{BRL(a.receita)}</td>
                      <td className="py-3 px-3 tabular-nums text-red-400">{BRL(a.despesa)}</td>
                      <td className={`py-3 px-3 tabular-nums font-bold ${a.saldo >= 0 ? 'text-blue-400' : 'text-red-500'}`}>{BRL(a.saldo)}</td>
                      <td className="py-3 px-3 tabular-nums text-gray-300">{a.pedidos}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm font-bold">
                  <td className="pt-3 px-3 text-gray-400 uppercase text-[10px] tracking-widest">Total</td>
                  <td className="pt-3 px-3 tabular-nums text-gray-200">{totalUnidades.vendasCount}</td>
                  <td className="pt-3 px-3 tabular-nums text-gray-100">{BRL(totalUnidades.vendasTotal)}</td>
                  <td className="pt-3 px-3 tabular-nums text-emerald-400">{BRL(totalUnidades.receita)}</td>
                  <td className="pt-3 px-3 tabular-nums text-red-400">{BRL(totalUnidades.despesa)}</td>
                  <td className={`pt-3 px-3 tabular-nums ${totalUnidades.saldo >= 0 ? 'text-blue-400' : 'text-red-500'}`}>{BRL(totalUnidades.saldo)}</td>
                  <td className="pt-3 px-3 tabular-nums text-gray-200">{totalUnidades.pedidos}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </motion.div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Painel de drill-down dos KPIs
// ──────────────────────────────────────────────────────────────────────
type KpiKind = 'receita' | 'despesa' | 'ordens' | 'estoque';

const KPI_TITLE: Record<KpiKind, string> = {
  receita: 'Receita',
  despesa: 'Despesas',
  ordens:  'Pedidos de compra',
  estoque: 'Estoque crítico',
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
    <div className="neu-flat p-5 rounded-2xl border border-white/5 flex flex-col gap-4 mt-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-200">
          {KPI_TITLE[kind]} <span className="text-gray-500 font-semibold">· {rows.length} {rows.length === 1 ? 'registro' : 'registros'}</span>
        </h3>
        <button
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="shrink-0 modal-close-btn"
        >
          <X size={16} />
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Nada no período." />
      ) : (
        <>
          {/* Mobile (<md): lista de cards verticais — evita scroll horizontal */}
          <div className="md:hidden flex flex-col gap-2 max-h-[420px] overflow-y-auto main-scrollbar -mx-2 px-2">
            {rows.map(r => (
              <div key={r.id} className="neu-pressed rounded-2xl p-3 border border-accent/20 flex flex-col gap-1.5">
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
            <table className="tabela w-full min-w-[600px]">
              <thead className="text-[10px] uppercase tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2.5 px-3 font-bold">Descrição</th>
                  <th className="py-2.5 px-3 font-bold">{kind === 'receita' ? 'Cliente' : kind === 'despesa' || kind === 'ordens' ? 'Fornecedor' : 'Código'}</th>
                  <th className="py-2.5 px-3 font-bold">{kind === 'estoque' ? 'Saldo / mínimo' : 'Valor'}</th>
                  {kind !== 'estoque' && <th className="py-2.5 px-3 font-bold">Data</th>}
                  {kind !== 'estoque' && <th className="py-2.5 px-3 font-bold">Situação</th>}
                </tr>
              </thead>
              <tbody className="text-xs">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3 text-gray-200 font-semibold truncate max-w-[280px]">{r.primary}</td>
                    <td className="py-2.5 px-3 text-gray-400 truncate max-w-[200px]">{r.secondary || '—'}</td>
                    <td className="py-2.5 px-3 tabular-nums text-gray-100">
                      {r.value !== null ? BRL(r.value) : r.status}
                    </td>
                    {kind !== 'estoque' && (
                      <td className="py-2.5 px-3 text-gray-400 tabular-nums">
                        {r.date ? new Date(r.date).toLocaleDateString('pt-BR') : '—'}
                      </td>
                    )}
                    {kind !== 'estoque' && (
                      <td className="py-2.5 px-3"><StatusBadge status={r.status} /></td>
                    )}
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
