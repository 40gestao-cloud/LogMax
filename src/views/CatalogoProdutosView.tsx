import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Package, Tag, Barcode, Building2, Boxes, AlertCircle, TrendingUp, Lock } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import {
  LoadingSpinner,
  EmptyState,
  FilialBadge,
  ProdutoThumb,
  Pagination,
} from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatBRL } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';
import { hasSetor } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

const calcMargem = (venda: number, custo: number): number | null => {
  if (!custo || !venda) return null;
  return ((venda - custo) / custo) * 100;
};

// Catálogo é vitrine read-only para todos os setores. CRUD continua em
// Empresa → Produtos (ProdutosView). Bloco financeiro (custo + margem) é
// gated por admin/CEO/financeiro — demais setores só veem preço de venda.
export const CatalogoProdutosView = ({ profile }: { showToast: any; profile: UserProfile }) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('todas');
  const [selecionado, setSelecionado] = useState<any | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro, categoriaFiltro]);

  const { data, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/produtosview',
    filialFiltro === 'todas' ? undefined : { filial: filialFiltro },
    false,
    { page, searchTerm: debouncedSearch, searchColumns: ['nome', 'codigo', 'categoria', 'ean', 'fornecedor'] }
  );

  const podeVerCusto =
    profile.role === 'admin' || profile.role === 'ceo' || hasSetor(profile, 'financeiro');

  // Catálogo = só itens vendáveis ativos. Patrimônio (tipo='patrimonio') é gestão
  // contábil, não pertence ao catálogo público.
  const produtosVisiveis = useMemo(
    () => data.filter((p: any) =>
      (p.status === 'Ativo' || !p.status) &&
      p.tipo !== 'patrimonio' &&
      (categoriaFiltro === 'todas' || p.categoria === categoriaFiltro)
    ),
    [data, categoriaFiltro]
  );

  const categorias = useMemo(() => {
    const set = new Set<string>();
    data.forEach((p: any) => { if (p.categoria) set.add(p.categoria); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [data]);

  const estoqueBadge = (p: any) => {
    const est = Number(p.estoque ?? 0);
    const min = Number(p.estoque_minimo ?? 0);
    if (est <= 0) return { label: 'Esgotado', cls: 'text-red-500', bg: 'bg-red-500/10' };
    if (min > 0 && est <= min) return { label: 'Estoque baixo', cls: 'text-yellow-500', bg: 'bg-yellow-500/10' };
    return { label: 'Em estoque', cls: 'text-emerald-400', bg: 'bg-emerald-500/10' };
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Catálogo de Produtos</h2>
          <p className="text-sm text-gray-400 mt-1">Vitrine consultiva — toque num produto para ver imagem, ficha e preço.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center shrink-0">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nome, código, categoria, EAN..."
            className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={filialFiltro}
          onChange={e => setFilialFiltro(e.target.value)}
          className="neu-input py-2.5 px-3 rounded-xl text-sm"
          aria-label="Filtrar por unidade"
        >
          <option value="todas">Todas as unidades</option>
          {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select
          value={categoriaFiltro}
          onChange={e => setCategoriaFiltro(e.target.value)}
          className="neu-input py-2.5 px-3 rounded-xl text-sm"
          aria-label="Filtrar por categoria"
        >
          <option value="todas">Todas as categorias</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Grid de cards */}
      {isLoading ? (
        <LoadingSpinner />
      ) : produtosVisiveis.length === 0 ? (
        <EmptyState message="Nenhum produto encontrado com os filtros atuais." />
      ) : (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4 flex-1 min-h-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 overflow-y-auto main-scrollbar pr-1 pb-2">
            {produtosVisiveis.map((p: any) => {
              const badge = estoqueBadge(p);
              return (
                <motion.button
                  key={p.id}
                  onClick={() => setSelecionado(p)}
                  whileTap={{ scale: 0.97 }}
                  className="neu-button rounded-2xl p-3 flex flex-col gap-2 text-left transition-all border border-transparent hover:border-accent/30"
                >
                  <div className="flex justify-center">
                    <ProdutoThumb url={p.imagem_url} size="md" alt={p.nome} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    {p.filial && <FilialBadge filial={p.filial} />}
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">
                      {p.codigo || '—'}
                    </span>
                    <span className="text-sm font-bold text-gray-200 leading-tight line-clamp-2">
                      {p.nome}
                    </span>
                  </div>
                  <div className="flex items-end justify-between mt-auto pt-1">
                    <span className="text-base font-black text-accent tabular-nums">
                      R$ {formatBRL(Number(p.preco ?? 0))}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge.bg} ${badge.cls} uppercase tracking-wider`}>
                      {badge.label}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}

      {/* Modal de detalhes */}
      <AnimatePresence>
        {selecionado && (
          <motion.div
            key="catalogo-modal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => setSelecionado(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="neu-flat rounded-3xl w-full max-w-2xl p-6 flex flex-col gap-5 border border-white/5 relative max-h-[90vh] overflow-y-auto main-scrollbar"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setSelecionado(null)}
                className="absolute top-4 right-4 w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={14} />
              </button>

              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="shrink-0 mx-auto sm:mx-0">
                  <ProdutoThumb url={selecionado.imagem_url} size="lg" alt={selecionado.nome} />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {selecionado.filial && <FilialBadge filial={selecionado.filial} />}
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    {selecionado.codigo || '—'}
                  </span>
                  <h3 className="text-xl font-bold text-gray-100 leading-tight">{selecionado.nome}</h3>
                  {selecionado.categoria && (
                    <span className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Tag size={11} /> {selecionado.categoria}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Preço de venda</span>
                  <span className="text-lg font-black text-accent tabular-nums">
                    R$ {formatBRL(Number(selecionado.preco ?? 0))}
                  </span>
                </div>
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Estoque</span>
                  <span className="text-lg font-black text-gray-200 tabular-nums flex items-center gap-1.5">
                    <Boxes size={14} className="text-gray-500" />
                    {Number(selecionado.estoque ?? 0)}
                  </span>
                  {Number(selecionado.estoque_minimo ?? 0) > 0 && (
                    <span className="text-[10px] text-gray-500">mín. {selecionado.estoque_minimo}</span>
                  )}
                </div>
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">EAN</span>
                  <span className="text-sm font-mono text-gray-300 flex items-center gap-1.5 truncate">
                    <Barcode size={12} className="text-gray-500 shrink-0" />
                    {selecionado.ean || '—'}
                  </span>
                </div>
                {selecionado.fornecedor && (
                  <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Fornecedor</span>
                    <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5 truncate">
                      <Building2 size={12} className="text-gray-500 shrink-0" />
                      {selecionado.fornecedor}
                    </span>
                  </div>
                )}
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status</span>
                  <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5">
                    <Package size={12} className="text-gray-500" />
                    {selecionado.status ?? 'Ativo'}
                  </span>
                </div>
              </div>

              {/* Bloco sensível: custo + margem só para admin/CEO/financeiro */}
              {podeVerCusto && (
                <div className="rounded-xl p-4 flex flex-col gap-3 border" style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
                }}>
                  <div className="flex items-center gap-2">
                    <Lock size={11} className="text-accent" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Visão Financeira</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Preço de custo</span>
                      <span className="text-base font-bold text-gray-200 tabular-nums">
                        R$ {formatBRL(Number(selecionado.preco_custo ?? 0))}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Margem</span>
                      {(() => {
                        const m = calcMargem(Number(selecionado.preco ?? 0), Number(selecionado.preco_custo ?? 0));
                        if (m === null) return <span className="text-base font-bold text-gray-600">—</span>;
                        const cls = m >= 30 ? 'text-emerald-400' : m >= 10 ? 'text-yellow-400' : 'text-red-400';
                        return (
                          <span className={`text-base font-bold tabular-nums flex items-center gap-1 ${cls}`}>
                            <TrendingUp size={13} />
                            {m.toFixed(1)}%
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {!podeVerCusto && (
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <AlertCircle size={11} />
                  <span>Informações de custo e margem ficam disponíveis para Financeiro, admin e CEO.</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
