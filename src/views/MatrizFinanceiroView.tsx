import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { DollarSign, TrendingUp, TrendingDown, ShoppingCart, RotateCcw } from 'lucide-react';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Legend,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FILIAL_COLOR: Record<FilialOp, { text: string; bar: string }> = {
  SuperMax: { text: 'text-sky-400',    bar: '#38bdf8' },
  MaxLook:  { text: 'text-amber-300',  bar: '#fcd34d' },
  TechMax:  { text: 'text-orange-400', bar: '#fb923c' },
};

type Period = '7d' | '30d' | '3m';
const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '3m': '3 meses' };

function periodStart(p: Period): Date {
  const now = new Date();
  if (p === '7d')  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  if (p === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  return new Date(now.getFullYear(), now.getMonth() - 2, 1);
}

function sumByFilial(arr: any[], key: string): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial] += Number(r[key]) || 0;
  return out as Record<FilialOp, number>;
}
function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}

// ── Linha de comparação 3 colunas ─────────────────────────────────────────
function KpiRow({ label, values, fmt = String, highlight = 'max' }: {
  label: string; values: Record<FilialOp, number>;
  fmt?: (v: number) => string; highlight?: 'max' | 'min' | 'none';
}) {
  const nums = OP_FILIAIS.map(f => values[f]);
  const best = highlight === 'max' ? Math.max(...nums) : highlight === 'min' ? Math.min(...nums) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {OP_FILIAIS.map(f => {
          const v = values[f];
          const isBest = best !== null && v === best && best > 0;
          return (
            <div key={f} className={`neu-pressed rounded-xl p-2.5 text-center ${isBest ? 'ring-1 ring-emerald-500/30' : ''}`}>
              <span className={`text-sm font-black font-mono tabular-nums ${isBest ? 'text-emerald-400' : 'text-gray-200'}`}>
                {fmt(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, isLoading }: {
  title: string; icon: any; children: React.ReactNode; isLoading?: boolean;
}) {
  return (
    <div className="neu-flat p-5 rounded-3xl border border-accent/20 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-accent shrink-0" />
        <h3 className="text-sm font-bold text-gray-200 tracking-wide">{title}</h3>
      </div>
      {isLoading ? <LoadingSpinner /> : children}
    </div>
  );
}

function FilialHeaders() {
  return (
    <div className="grid grid-cols-3 gap-2 mb-1">
      {OP_FILIAIS.map(f => (
        <div key={f} className="text-center">
          <span className={`text-[11px] font-black uppercase tracking-widest ${FILIAL_COLOR[f].text}`}>{f}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
export function MatrizFinanceiroView() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data: contasReceber, isLoading: lCR } = useFetchData('/api/contasreceberview');
  const { data: contasPagar,   isLoading: lCP } = useFetchData('/api/contaspagarview');
  const { data: vendas,        isLoading: lV  } = useFetchData('/api/vendasview');
  const { data: pedidos,       isLoading: lP  } = useFetchData('/api/pedidosview');
  const { data: devolucoes,    isLoading: lD  } = useFetchData('/api/devolucoesview');

  const isLoading = lCR || lCP || lV || lP || lD;

  const cutoff = useMemo(() => periodStart(period), [period]);

  const crPeriodo  = useMemo(() => contasReceber.filter((r: any) => new Date(r.created_at) >= cutoff), [contasReceber, cutoff]);
  const cpPeriodo  = useMemo(() => contasPagar.filter((r: any)   => new Date(r.created_at) >= cutoff), [contasPagar,   cutoff]);
  const vPeriodo   = useMemo(() => vendas.filter((v: any)        => new Date(v.created_at) >= cutoff && v.status !== 'Cancelada'), [vendas, cutoff]);
  const pedPeriodo = useMemo(() => pedidos.filter((p: any)       => new Date(p.created_at) >= cutoff), [pedidos, cutoff]);

  // Contas a receber
  const crTotal   = useMemo(() => sumByFilial(crPeriodo, 'valor'), [crPeriodo]);
  const crAberto  = useMemo(() => {
    const ab = crPeriodo.filter((r: any) => r.status !== 'Pago');
    return sumByFilial(ab, 'valor');
  }, [crPeriodo]);
  const crVencido = useMemo(() => {
    const now = new Date();
    const venc = crPeriodo.filter((r: any) => r.status !== 'Pago' && r.vencimento && new Date(r.vencimento) < now);
    return sumByFilial(venc, 'valor');
  }, [crPeriodo]);

  // Contas a pagar
  const cpTotal   = useMemo(() => sumByFilial(cpPeriodo, 'valor'), [cpPeriodo]);
  const cpAberto  = useMemo(() => {
    const ab = cpPeriodo.filter((r: any) => r.status !== 'Pago');
    return sumByFilial(ab, 'valor');
  }, [cpPeriodo]);

  // Saldo líquido por filial
  const saldo = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = crTotal[f] - cpTotal[f];
    return out as Record<FilialOp, number>;
  }, [crTotal, cpTotal]);

  // Vendas
  const vendasTotal  = useMemo(() => sumByFilial(vPeriodo, 'total_final'), [vPeriodo]);
  const vendasCount  = useMemo(() => countByFilial(vPeriodo), [vPeriodo]);
  const ticketMedio  = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = vendasCount[f] > 0 ? vendasTotal[f] / vendasCount[f] : 0;
    return out as Record<FilialOp, number>;
  }, [vendasTotal, vendasCount]);

  // Devoluções — só Concluída conta como estorno efetivo
  const devPeriodo = useMemo(
    () => devolucoes.filter((d: any) => new Date(d.created_at) >= cutoff && d.status === 'Concluída'),
    [devolucoes, cutoff],
  );
  const devTotal = useMemo(() => sumByFilial(devPeriodo, 'valor_devolvido'), [devPeriodo]);
  const devCount = useMemo(() => countByFilial(devPeriodo), [devPeriodo]);
  const receitaLiquida = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = vendasTotal[f] - devTotal[f];
    return out as Record<FilialOp, number>;
  }, [vendasTotal, devTotal]);
  const taxaDevolucao = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = vendasTotal[f] > 0 ? (devTotal[f] / vendasTotal[f]) * 100 : 0;
    return out as Record<FilialOp, number>;
  }, [vendasTotal, devTotal]);

  // Pedidos de compra
  const pedTotal     = useMemo(() => sumByFilial(pedPeriodo, 'valor_total'), [pedPeriodo]);
  const pedCount     = useMemo(() => countByFilial(pedPeriodo), [pedPeriodo]);
  const pedPendentes = useMemo(() => {
    const pend = pedPeriodo.filter((p: any) => p.status === 'Pendente' || p.status === 'Em andamento');
    return countByFilial(pend);
  }, [pedPeriodo]);

  // Gráfico mensal de faturamento — últimos 3 meses
  const chartData = useMemo(() => {
    const meses = Array.from({ length: 3 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (2 - i));
      return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) };
    });
    return meses.map(m => {
      const row: Record<string, any> = { name: m.label };
      for (const f of OP_FILIAIS) {
        row[f] = Math.round(
          vendas
            .filter((v: any) => {
              const d = new Date(v.created_at);
              return v.filial === f && d.getFullYear() === m.year && d.getMonth() === m.month && v.status !== 'Cancelada';
            })
            .reduce((s: number, v: any) => s + (Number(v.total_final) || 0), 0)
        );
      }
      return row;
    });
  }, [vendas]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Financeiro — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Receitas, despesas e faturamento lado a lado.</p>
        </div>
        <select
          value={period} onChange={e => setPeriod(e.target.value as Period)}
          className="neu-input py-2 px-3 rounded-xl text-xs text-gray-300"
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </select>
      </div>

      <FilialHeaders />

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Receita */}
            <SectionCard title="Contas a Receber" icon={TrendingUp}>
              <KpiRow label="Total lançado" values={crTotal} fmt={BRL} />
              <KpiRow label="Em aberto" values={crAberto} fmt={BRL} highlight="min" />
              <KpiRow label="Vencido" values={crVencido} fmt={BRL} highlight="min" />
            </SectionCard>

            {/* Despesa */}
            <SectionCard title="Contas a Pagar" icon={TrendingDown}>
              <KpiRow label="Total lançado" values={cpTotal} fmt={BRL} highlight="min" />
              <KpiRow label="Em aberto" values={cpAberto} fmt={BRL} highlight="min" />
              <KpiRow label="Saldo líquido" values={saldo} fmt={BRL} />
            </SectionCard>

            {/* Vendas */}
            <SectionCard title="Faturamento / Vendas" icon={DollarSign}>
              <KpiRow label="Receita de vendas" values={vendasTotal} fmt={BRL} />
              <KpiRow label="Nº de vendas" values={vendasCount} />
              <KpiRow label="Ticket médio" values={ticketMedio} fmt={BRL} />
            </SectionCard>

            {/* Vendas & Devoluções — comparativo consolidado */}
            <SectionCard title="Vendas & Devoluções" icon={RotateCcw}>
              <KpiRow label="Devoluções (R$)" values={devTotal} fmt={BRL} highlight="min" />
              <KpiRow label="Nº de devoluções" values={devCount} highlight="min" />
              <KpiRow label="Taxa de devolução" values={taxaDevolucao} fmt={v => `${v.toFixed(1)}%`} highlight="min" />
              <KpiRow label="Receita líquida" values={receitaLiquida} fmt={BRL} />
            </SectionCard>

            {/* Compras */}
            <SectionCard title="Pedidos de Compra" icon={ShoppingCart}>
              <KpiRow label="Valor total" values={pedTotal} fmt={BRL} highlight="min" />
              <KpiRow label="Nº de pedidos" values={pedCount} />
              <KpiRow label="Pendentes" values={pedPendentes} fmt={v => String(v)} highlight="min" />
            </SectionCard>

          </div>

          {/* Gráfico de faturamento mensal */}
          <div className="neu-flat p-6 rounded-3xl border border-accent/20">
            <h3 className="text-sm font-bold text-gray-200 mb-5">Faturamento Mensal por Unidade — últimos 3 meses</h3>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-md)', borderRadius: '12px' }}
                    formatter={(v: any) => BRL(Number(v))}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }} />
                  {OP_FILIAIS.map(f => (
                    <Bar key={f} dataKey={f} fill={FILIAL_COLOR[f].bar} radius={[4, 4, 0, 0]} maxBarSize={32} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
