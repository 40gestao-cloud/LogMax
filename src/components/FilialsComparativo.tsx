import React from 'react';
import { LoadingSpinner } from './ui';

export const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_STYLE: Record<FilialOp, { text: string; border: string; header: string; ring: string }> = {
  SuperMax: { text: 'text-sky-400',    border: 'border-sky-500/60',    header: 'bg-sky-500/10',    ring: 'ring-sky-500/40'    },
  MaxLook:  { text: 'text-amber-300',  border: 'border-amber-400/60',  header: 'bg-amber-400/10',  ring: 'ring-amber-400/40'  },
  TechMax:  { text: 'text-orange-400', border: 'border-orange-500/60', header: 'bg-orange-500/10', ring: 'ring-orange-500/40' },
};

export type Metric = {
  label: string;
  values: Record<FilialOp, number>;
  fmt?: (v: number) => string;
  highlight?: 'max' | 'min' | 'none';
};

function bestValue(m: Metric): number | null {
  if (m.highlight === 'none' || !m.highlight) return null;
  const nums = OP_FILIAIS.map(f => m.values[f]);
  return m.highlight === 'max' ? Math.max(...nums) : Math.min(...nums);
}

function FilialCard({ filial, metrics, subtitle }: { filial: FilialOp; metrics: Metric[]; subtitle?: string }) {
  const style = FILIAL_STYLE[filial];
  return (
    <div className={`neu-flat rounded-2xl border-2 ${style.border} overflow-hidden flex flex-col`}>
      <div className={`${style.header} px-4 py-2.5 border-b ${style.border}`}>
        <span className={`text-xs font-black uppercase tracking-widest ${style.text}`}>{filial}</span>
        {subtitle && <span className="text-[9px] text-gray-500 ml-2">{subtitle}</span>}
      </div>
      <div className="p-4 flex flex-col gap-3.5">
        {metrics.map(m => {
          const v = m.values[filial];
          const best = bestValue(m);
          const isBest = best !== null && v === best && best > 0;
          const fmt = m.fmt ?? ((x: number) => String(x));
          return (
            <div key={m.label} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{m.label}</span>
              <span className={`text-xl font-black font-mono tabular-nums ${isBest ? 'text-emerald-400' : 'text-gray-100'}`}>
                {fmt(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FilialsComparativo({ title, icon: Icon, metrics, subtitle, isLoading }: {
  title: string;
  icon: any;
  metrics: Metric[];
  subtitle?: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <Icon size={14} className="text-accent shrink-0" />
        <h3 className="text-sm font-bold text-gray-200 tracking-wide">{title}</h3>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {OP_FILIAIS.map(f => <FilialCard key={f} filial={f} metrics={metrics} subtitle={subtitle} />)}
        </div>
      )}
    </div>
  );
}
