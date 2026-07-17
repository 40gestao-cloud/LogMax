import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Package, Tag, Wrench, Search } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState } from '../components/ui';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];
type FilialFilter = 'Todas' | FilialOp;

const BRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FILIAL_COLOR: Record<FilialOp, string> = {
  SuperMax: 'text-sky-400',
  MaxLook:  'text-amber-300',
  TechMax:  'text-orange-400',
};

type Tab = 'produtos' | 'categorias' | 'servicos';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'produtos',   label: 'Produtos',   icon: Package },
  { id: 'categorias', label: 'Categorias', icon: Tag },
  { id: 'servicos',   label: 'Serviços',   icon: Wrench },
];

function FilialBadge({ filial }: { filial: string }) {
  const color = FILIAL_COLOR[filial as FilialOp] ?? 'text-gray-400';
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{filial || '—'}</span>
  );
}

export function MatrizCadastrosView() {
  const [tab, setTab] = useState<Tab>('produtos');
  const [filial, setFilial] = useState<FilialFilter>('Todas');
  const [busca, setBusca] = useState('');

  const { data: produtos,   isLoading: lP } = useFetchData<any>('/api/produtosview');
  const { data: servicos,   isLoading: lS } = useFetchData<any>('/api/servicosview');
  const { data: categorias, isLoading: lC } = useFetchData<any>('categorias_produto');

  const isLoading = lP || lS || lC;
  const q = busca.trim().toLowerCase();

  const produtosFiltrados = useMemo(() => {
    return produtos.filter((p: any) => {
      if (filial !== 'Todas' && p.filial !== filial) return false;
      if (q && !String(p.nome ?? '').toLowerCase().includes(q) && !String(p.codigo ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [produtos, filial, q]);

  const servicosFiltrados = useMemo(() => {
    return servicos.filter((s: any) => {
      if (filial !== 'Todas' && s.filial !== filial) return false;
      if (q && !String(s.nome ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [servicos, filial, q]);

  const categoriasFiltradas = useMemo(() => {
    if (!q) return categorias;
    return categorias.filter((c: any) => String(c.nome ?? '').toLowerCase().includes(q));
  }, [categorias, q]);

  // Contadores por filial pra header
  const contadores = useMemo(() => {
    const p: Record<string, number> = { Todas: produtos.length, SuperMax: 0, MaxLook: 0, TechMax: 0 };
    const s: Record<string, number> = { Todas: servicos.length, SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const r of produtos) if (p[r.filial] !== undefined) p[r.filial]++;
    for (const r of servicos) if (s[r.filial] !== undefined) s[r.filial]++;
    return { produtos: p, servicos: s };
  }, [produtos, servicos]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Cadastros — Consolidado</h2>
        <p className="text-sm text-gray-400 mt-1">Visão read-only de Produtos, Categorias e Serviços das três unidades.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                active
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'neu-button text-gray-400 hover:text-white'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="neu-flat rounded-2xl p-4 border border-white/5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={14} className="text-gray-500" />
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder={tab === 'produtos' ? 'Buscar por nome ou SKU…' : 'Buscar por nome…'}
            className="neu-input rounded-lg px-3 py-2 text-xs flex-1"
          />
        </div>
        {tab !== 'categorias' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['Todas', ...OP_FILIAIS] as FilialFilter[]).map(f => {
              const active = filial === f;
              const count = tab === 'produtos' ? contadores.produtos[f] : contadores.servicos[f];
              return (
                <button
                  key={f}
                  onClick={() => setFilial(f)}
                  className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg transition-colors ${
                    active
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'neu-button text-gray-400 hover:text-white'
                  }`}
                >
                  {f} <span className="text-gray-500 ml-1">({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="neu-flat rounded-3xl border border-accent/20 overflow-hidden">
          {tab === 'produtos' && (
            produtosFiltrados.length === 0 ? (
              <div className="p-8"><EmptyState message="Nenhum produto encontrado." /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold">SKU</th>
                      <th className="text-left px-4 py-3 font-bold">Nome</th>
                      <th className="text-left px-4 py-3 font-bold">Filial</th>
                      <th className="text-right px-4 py-3 font-bold">Preço</th>
                      <th className="text-right px-4 py-3 font-bold">Estoque</th>
                      <th className="text-right px-4 py-3 font-bold">Mínimo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosFiltrados.map((p: any) => {
                      const min = Number(p.estoque_minimo ?? 0) || 10;
                      const critico = (Number(p.estoque) ?? 0) <= min;
                      return (
                        <tr key={p.id} className="border-t border-white/5 hover:bg-white/5">
                          <td className="px-4 py-2.5 font-mono text-gray-400">{p.codigo ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-200">{p.nome}</td>
                          <td className="px-4 py-2.5"><FilialBadge filial={p.filial} /></td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{BRL(p.preco)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${critico ? 'text-red-400' : 'text-gray-200'}`}>
                            {Number(p.estoque ?? 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{min}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-4 py-2.5 text-[10px] text-gray-500 border-t border-white/5">
                  {produtosFiltrados.length} produto(s) exibido(s).
                </p>
              </div>
            )
          )}

          {tab === 'categorias' && (
            categoriasFiltradas.length === 0 ? (
              <div className="p-8"><EmptyState message="Nenhuma categoria encontrada." /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold">Nome</th>
                      <th className="text-left px-4 py-3 font-bold">Descrição</th>
                      <th className="text-right px-4 py-3 font-bold">Produtos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoriasFiltradas.map((c: any) => {
                      const qtd = produtos.filter((p: any) => p.categoria_id === c.id).length;
                      return (
                        <tr key={c.id} className="border-t border-white/5 hover:bg-white/5">
                          <td className="px-4 py-2.5 text-gray-200 font-medium">{c.nome}</td>
                          <td className="px-4 py-2.5 text-gray-400">{c.descricao ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{qtd}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-4 py-2.5 text-[10px] text-gray-500 border-t border-white/5">
                  {categoriasFiltradas.length} categoria(s) exibida(s) · catálogo global (sem filial).
                </p>
              </div>
            )
          )}

          {tab === 'servicos' && (
            servicosFiltrados.length === 0 ? (
              <div className="p-8"><EmptyState message="Nenhum serviço encontrado." /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold">Nome</th>
                      <th className="text-left px-4 py-3 font-bold">Filial</th>
                      <th className="text-right px-4 py-3 font-bold">Preço</th>
                      <th className="text-left px-4 py-3 font-bold">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servicosFiltrados.map((s: any) => (
                      <tr key={s.id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2.5 text-gray-200 font-medium">{s.nome}</td>
                        <td className="px-4 py-2.5"><FilialBadge filial={s.filial} /></td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{BRL(s.preco)}</td>
                        <td className="px-4 py-2.5 text-gray-400">{s.descricao ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-2.5 text-[10px] text-gray-500 border-t border-white/5">
                  {servicosFiltrados.length} serviço(s) exibido(s).
                </p>
              </div>
            )
          )}
        </div>
      )}
    </motion.div>
  );
}
