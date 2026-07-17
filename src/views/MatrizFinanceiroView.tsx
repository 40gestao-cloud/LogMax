import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { DollarSign, RotateCcw } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';
import { FilialsComparativo, OP_FILIAIS, FilialOp } from '../components/FilialsComparativo';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

export function MatrizFinanceiroView() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data: vendas,     isLoading: lV } = useFetchData('/api/vendasview');
  const { data: devolucoes, isLoading: lD } = useFetchData('/api/devolucoesview');

  const isLoading = lV || lD;

  const cutoff = useMemo(() => periodStart(period), [period]);

  const vPeriodo = useMemo(
    () => vendas.filter((v: any) => new Date(v.created_at) >= cutoff && v.status !== 'Cancelada'),
    [vendas, cutoff],
  );

  const vendasTotal = useMemo(() => sumByFilial(vPeriodo, 'total_final'), [vPeriodo]);
  const vendasCount = useMemo(() => countByFilial(vPeriodo), [vPeriodo]);
  const ticketMedio = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = vendasCount[f] > 0 ? vendasTotal[f] / vendasCount[f] : 0;
    return out as Record<FilialOp, number>;
  }, [vendasTotal, vendasCount]);

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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Financeiro — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Faturamento e receita líquida no período — <span className="font-mono text-accent">{PERIOD_LABELS[period]}</span></p>
          <div className="mt-2"><CompeticaoBadge /></div>
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

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="flex flex-col gap-6">
          <FilialsComparativo
            title="Faturamento / Vendas"
            icon={DollarSign}
            metrics={[
              { label: 'Receita de vendas', values: vendasTotal, fmt: BRL, highlight: 'max' },
              { label: 'Nº de vendas',      values: vendasCount, highlight: 'max' },
              { label: 'Ticket médio',      values: ticketMedio, fmt: BRL, highlight: 'max' },
            ]}
          />
          <FilialsComparativo
            title="Receita Líquida"
            icon={RotateCcw}
            metrics={[
              { label: 'Devoluções (R$)',   values: devTotal, fmt: BRL, highlight: 'min' },
              { label: 'Nº de devoluções',  values: devCount, highlight: 'min' },
              { label: 'Taxa de devolução', values: taxaDevolucao, fmt: v => `${v.toFixed(1)}%`, highlight: 'min' },
              { label: 'Receita líquida',   values: receitaLiquida, fmt: BRL, highlight: 'max' },
            ]}
          />
        </div>
      )}
    </motion.div>
  );
}
