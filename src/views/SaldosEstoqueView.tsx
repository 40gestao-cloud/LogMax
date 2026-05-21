import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge } from '../components/ui';
import { useAIContext } from '../contexts/AIAssistantContext';

export const SaldosEstoqueView = () => {
  const { data, isLoading } = useFetchData<any>('/api/saldosestoqueview');
  const [search, setSearch] = useState('');

  const filtered = data.filter((p: any) =>
    [p.nome, p.codigo, p.categoria].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  // Injeção de contexto pro MaxAI — saldos consolidados + produtos críticos.
  const aiSnapshot = useMemo(() => {
    const itens = filtered.map((p: any) => ({
      codigo:    p.codigo,
      produto:   p.nome,
      categoria: p.categoria,
      saldo:     Number(p.estoque ?? p.qtd ?? 0),
      unidade:   p.unidade,
      preco:     p.preco,
    }));
    return {
      label: 'Saldos de Estoque',
      data: {
        total_produtos:   itens.length,
        sem_estoque:      itens.filter(i => i.saldo === 0).length,
        valor_inventario: Number(itens.reduce((s, i) => s + i.saldo * (Number(i.preco) || 0), 0).toFixed(2)),
        produtos: itens.slice(0, 60), // cap pra caber no orçamento do MaxAI
      },
    };
  }, [filtered.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useAIContext(aiSnapshot);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Saldos de Estoque</h2>
          <p className="text-sm text-gray-400 mt-1">Posição atual de estoque por produto.</p>
        </div>
        <div className="relative w-full sm:w-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse min-w-[500px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Código</th>
                <th className="pb-4 font-bold px-4">Produto</th>
                <th className="pb-4 font-bold px-4">Categoria</th>
                <th className="pb-4 font-bold px-4 text-right">Saldo</th>
                <th className="pb-4 font-bold px-4">Unidade</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtered.map((item: any) => {
                      const saldo = Number(item.estoque ?? item.qtd ?? 0);
                      const semEstoque = saldo === 0;
                      return (
                        <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.codigo || '—'}</td>
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.nome}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{item.categoria || '—'}</td>
                          <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${semEstoque ? 'text-red-500' : 'text-green-400'}`}>{saldo}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{item.unidade || '—'}</td>
                          <td className="py-3 px-4 text-center">
                            {semEstoque
                              ? <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-950/50 text-red-500">Sem Estoque</span>
                              : <StatusBadge status={item.status} />}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
