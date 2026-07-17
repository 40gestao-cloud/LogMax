import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Clock } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';
import { FilialsComparativo, OP_FILIAIS, FilialOp } from '../components/FilialsComparativo';

type Period = '7d' | '30d' | '3m';
const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '3m': '3 meses' };

function periodStart(p: Period): Date {
  const now = new Date();
  if (p === '7d')  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  if (p === '30d') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  return new Date(now.getFullYear(), now.getMonth() - 2, 1);
}

export function MatrizRHView() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data: funcionarios, isLoading: lFn } = useFetchData('/api/funcionariosview');
  const { data: frequencias,  isLoading: lFr } = useFetchData('/api/frequenciatrabalhoview');

  const isLoading = lFn || lFr;

  const cutoff = useMemo(() => periodStart(period), [period]);

  const fnFilialMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of funcionarios) m[f.id] = f.filial;
    return m;
  }, [funcionarios]);

  const freqPeriodo = useMemo(() =>
    frequencias.filter((r: any) => new Date(r.data ?? r.created_at) >= cutoff),
    [frequencias, cutoff],
  );

  const presencasPeriodo = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const r of freqPeriodo) {
      const fil = fnFilialMap[r.funcionario_id];
      if (fil && out[fil] !== undefined && r.status === 'Presente') out[fil]++;
    }
    return out as Record<FilialOp, number>;
  }, [freqPeriodo, fnFilialMap]);

  const faltasPeriodo = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const r of freqPeriodo) {
      const fil = fnFilialMap[r.funcionario_id];
      if (fil && out[fil] !== undefined && r.status === 'Falta') out[fil]++;
    }
    return out as Record<FilialOp, number>;
  }, [freqPeriodo, fnFilialMap]);

  const taxaPresenca = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) {
      const total = presencasPeriodo[f] + faltasPeriodo[f];
      out[f] = total > 0 ? Math.round((presencasPeriodo[f] / total) * 100) : 0;
    }
    return out as Record<FilialOp, number>;
  }, [presencasPeriodo, faltasPeriodo]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">RH — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Performance de presença no período — <span className="font-mono text-accent">{PERIOD_LABELS[period]}</span></p>
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
        <FilialsComparativo
          title={`Frequência — ${PERIOD_LABELS[period]}`}
          icon={Clock}
          metrics={[
            { label: 'Presenças registradas', values: presencasPeriodo, highlight: 'max' },
            { label: 'Faltas registradas',    values: faltasPeriodo,    highlight: 'min' },
            { label: 'Taxa de presença %',    values: taxaPresenca,     highlight: 'max', fmt: v => `${v}%` },
          ]}
        />
      )}
    </motion.div>
  );
}
