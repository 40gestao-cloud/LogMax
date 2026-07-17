import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Package, AlertTriangle } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';
import { FilialsComparativo, OP_FILIAIS, FilialOp } from '../components/FilialsComparativo';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

export function MatrizLogisticaView() {
  const { data: produtos, isLoading } = useFetchData('/api/saldosestoqueview');

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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Logística — Comparativo entre Unidades</h2>
        <p className="text-sm text-gray-400 mt-1">Estoque de produtos por unidade.</p>
        <div className="mt-2"><CompeticaoBadge /></div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="flex flex-col gap-6">
          <FilialsComparativo
            title="Estoque de Produtos"
            icon={Package}
            metrics={[
              { label: 'Total de produtos', values: totalProdutos, highlight: 'max' },
              { label: 'Valor em estoque',  values: valorEstoque, fmt: BRL, highlight: 'max' },
            ]}
          />
          <FilialsComparativo
            title="Estoque Crítico"
            icon={AlertTriangle}
            metrics={[
              { label: 'Produtos abaixo do mínimo', values: estoqueCritico, highlight: 'min' },
              { label: '% do catálogo em alerta',   values: taxaCritico, fmt: v => `${v}%`, highlight: 'min' },
            ]}
          />
        </div>
      )}
    </motion.div>
  );
}
