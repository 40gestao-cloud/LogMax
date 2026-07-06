import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Package, Truck, Wrench, AlertTriangle } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FILIAL_COLOR: Record<FilialOp, { text: string }> = {
  SuperMax: { text: 'text-sky-400' },
  MaxLook:  { text: 'text-amber-300' },
  TechMax:  { text: 'text-orange-400' },
};

function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}
function sumByFilial(arr: any[], key: string): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial] += Number(r[key]) || 0;
  return out as Record<FilialOp, number>;
}

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

export function MatrizLogisticaView() {
  const { data: produtos,     isLoading: lP  } = useFetchData('/api/saldosestoqueview');
  const { data: fornecedores, isLoading: lF  } = useFetchData('/api/crmview-fornecedores');
  const { data: servicos,     isLoading: lS  } = useFetchData('/api/servicosview');

  const isLoading = lP || lF || lS;

  // ── Estoque ──────────────────────────────────────────────────────────────
  const totalProdutos = useMemo(() => countByFilial(produtos), [produtos]);

  const estoqueCritico = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const p of produtos) {
      const fil = p.filial;
      if (out[fil] === undefined) continue;
      const min = Number(p.estoque_minimo ?? 0) || 10;
      if ((Number(p.estoque) ?? 0) <= min) out[fil]++;
    }
    return out as Record<FilialOp, number>;
  }, [produtos]);

  const valorEstoque = useMemo(() =>
    sumByFilial(
      produtos.map((p: any) => ({ ...p, valor_total: (Number(p.estoque) || 0) * (Number(p.custo) || 0) })),
      'valor_total',
    ),
  [produtos]);

  const taxaCritico = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS)
      out[f] = totalProdutos[f] > 0 ? Math.round((estoqueCritico[f] / totalProdutos[f]) * 100) : 0;
    return out as Record<FilialOp, number>;
  }, [estoqueCritico, totalProdutos]);

  // ── Fornecedores ─────────────────────────────────────────────────────────
  const fornTotal  = useMemo(() => countByFilial(fornecedores), [fornecedores]);
  const fornAtivos = useMemo(() => countByFilial(fornecedores.filter((f: any) => f.ativo !== false)), [fornecedores]);

  // ── Serviços ─────────────────────────────────────────────────────────────
  const servTotal  = useMemo(() => countByFilial(servicos), [servicos]);
  const servAtivos = useMemo(() => countByFilial(servicos.filter((s: any) => s.ativo !== false)), [servicos]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Logística — Comparativo entre Unidades</h2>
        <p className="text-sm text-gray-400 mt-1">Estoque, fornecedores e serviços por unidade.</p>
      </div>

      <FilialHeaders />

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Estoque */}
          <SectionCard title="Estoque de Produtos" icon={Package}>
            <KpiRow label="Total de produtos" values={totalProdutos} />
            <KpiRow label="Valor em estoque" values={valorEstoque} fmt={BRL} />
          </SectionCard>

          {/* Estoque crítico */}
          <SectionCard title="Estoque Crítico" icon={AlertTriangle}>
            <KpiRow label="Produtos abaixo do mínimo" values={estoqueCritico} highlight="min" />
            <KpiRow label="% do catálogo em alerta" values={taxaCritico} fmt={v => `${v}%`} highlight="min" />
          </SectionCard>

          {/* Fornecedores */}
          <SectionCard title="Fornecedores" icon={Truck}>
            <KpiRow label="Total cadastrado" values={fornTotal} />
            <KpiRow label="Ativos" values={fornAtivos} />
          </SectionCard>

          {/* Serviços */}
          <SectionCard title="Serviços" icon={Wrench}>
            <KpiRow label="Total cadastrado" values={servTotal} />
            <KpiRow label="Ativos" values={servAtivos} />
          </SectionCard>

        </div>
      )}
    </motion.div>
  );
}
