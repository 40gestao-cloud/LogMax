import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Info } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FilialBadge } from './ui';

// Ordem fixa para agrupar registros na visão consolidada de Matriz.
const FILIAL_ORDER: Record<string, number> = { SuperMax: 1, MaxLook: 2, TechMax: 3, Matriz: 4 };

export type ColunaConsolidada = {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
  className?: string;
};

// Listagem read-only para modo Matriz — consolida registros das 3 filiais
// numa tabela única com badge de filial. Usada como fallback nas views que
// exigem uma filial ativa para operar (Produtos, Serviços, Tarefas).
export function MatrizConsolidado({
  titulo,
  descricao,
  endpoint,
  extraFilter,
  colunas,
  ordenarPor,
}: {
  titulo: string;
  descricao?: string;
  endpoint: string;
  extraFilter?: Record<string, any>;
  colunas: ColunaConsolidada[];
  ordenarPor?: (a: any, b: any) => number;
}) {
  const { data, isLoading } = useFetchData<any>(endpoint, extraFilter);

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const ra = FILIAL_ORDER[a.filial] ?? 99;
      const rb = FILIAL_ORDER[b.filial] ?? 99;
      if (ra !== rb) return ra - rb;
      if (ordenarPor) return ordenarPor(a, b);
      return 0;
    });
    return sorted;
  }, [data, ordenarPor]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-100">{titulo} — Consolidado</h1>
          {descricao && <p className="text-sm text-gray-500 mt-1">{descricao}</p>}
        </div>
      </div>

      <div className="flex items-start gap-2 neu-flat border border-yellow-500/20 rounded-xl px-3 py-2 text-xs text-gray-400 bg-yellow-500/5">
        <Info size={14} className="text-yellow-400 shrink-0 mt-0.5" />
        <span>Modo Matriz é somente leitura. Para criar, editar ou remover, escolha uma filial no seletor do topbar.</span>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <EmptyState message="Nenhum registro encontrado nas 3 filiais." />
      ) : (
        <div className="neu-flat border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] border-b border-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Filial</th>
                  {colunas.map(c => (
                    <th key={c.key} className={`text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 ${c.className ?? ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id ?? i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5"><FilialBadge filial={row.filial} /></td>
                    {colunas.map(c => (
                      <td key={c.key} className={`px-4 py-2.5 text-gray-300 ${c.className ?? ''}`}>
                        {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-white/5 text-[10px] text-gray-500">
            {rows.length} registro{rows.length !== 1 ? 's' : ''} no total
          </div>
        </div>
      )}
    </motion.div>
  );
}
