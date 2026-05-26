import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, Package, MapPin, User as UserIcon, Tag } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, FilialBadge, StatusBadge, Pagination, ProdutoThumb } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { exportToPDF, exportToExcel, formatBRL } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

const fmtData = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });
};

const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

// Controle de Patrimônio (Financeiro). Lê produtos com tipo='patrimonio' via
// /api/patrimonioview (mapeado para a tabela `produtos`). Filtro `tipo` é
// passado ao useFetchData pra evitar trazer estoque/venda à toa.
export const PatrimonioView = ({ showToast: _showToast }: any) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro]);

  const baseFilter = useMemo(() => {
    const f: Record<string, any> = { tipo: 'patrimonio' };
    if (filialFiltro !== 'todas') f.filial = filialFiltro;
    return f;
  }, [filialFiltro]);

  const { data, isLoading, totalCount, reload, error } = useFetchData<any>(
    '/api/patrimonioview',
    baseFilter,
    false,
    {
      page,
      searchTerm: debouncedSearch,
      searchColumns: ['nome', 'codigo', 'patrimonio_numero', 'patrimonio_responsavel', 'patrimonio_localizacao'],
    }
  );

  // KPIs simples — quantidade total e valor de aquisição (preco_custo).
  const totalValor = useMemo(
    () => data.reduce((s, p: any) => s + parseNum(p.preco_custo), 0),
    [data]
  );

  const exportCols = ['Tag', 'Código', 'Nome', 'Responsável', 'Localização', 'Filial', 'Valor', 'Aquisição', 'Status'];
  const exportRows = () => data.map((p: any) => [
    p.patrimonio_numero ?? '—',
    p.codigo ?? '',
    p.nome ?? '',
    p.patrimonio_responsavel ?? '—',
    p.patrimonio_localizacao ?? '—',
    p.filial ?? '—',
    p.preco_custo != null ? fmtBRL(parseNum(p.preco_custo)) : '—',
    fmtData(p.created_at),
    p.status ?? 'Ativo',
  ]);
  const handleExportPDF = () => exportToPDF('Controle de Patrimônio', exportCols, exportRows(), 'logmax-patrimonio');
  const handleExportExcel = () => exportToExcel('Patrimônio', exportCols, exportRows(), 'logmax-patrimonio');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Patrimônio</h2>
          <p className="text-sm text-gray-400 mt-1">
            Bens classificados como patrimônio no cadastro de produtos (Compras). Cadastro novo é feito em <span className="font-bold text-gray-300">Empresa → Produtos</span> marcando o tipo.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar tag, nome, responsável..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-64"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
            <option value="todas">Todas filiais</option>
            {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1.5">
            <Package size={11} /> Itens
          </p>
          <p className="text-2xl font-black text-gray-100">{totalCount ?? data.length}</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1.5">
            <Tag size={11} /> Valor de Aquisição (página)
          </p>
          <p className="text-2xl font-black text-accent">{fmtBRL(totalValor)}</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1.5">
            <MapPin size={11} /> Filial filtrada
          </p>
          <p className="text-base font-bold text-gray-200">{filialFiltro === 'todas' ? 'Todas' : filialFiltro}</p>
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? <LoadingSpinner /> : (error || data.length === 0) ? <EmptyState error={error} message="Nenhum item de patrimônio cadastrado." /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse md:min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4 w-14">Foto</th>
                  <th className="pb-4 font-bold px-4">Tag</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Código</th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Responsável</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Localização</th>
                  <th className="pb-4 font-bold px-4 text-center hidden md:table-cell">Filial</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Aquisição</th>
                  <th className="pb-4 font-bold px-4 text-center hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.map((p: any) => (
                    <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4">
                        <ProdutoThumb url={p.imagem_url} size="xs" alt={p.nome} />
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-accent font-bold">{p.patrimonio_numero ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell">{p.codigo}</td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-300 hidden md:table-cell">
                        {p.patrimonio_responsavel
                          ? <span className="flex items-center gap-1.5"><UserIcon size={11} className="text-gray-500" />{p.patrimonio_responsavel}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-300 hidden lg:table-cell">
                        {p.patrimonio_localizacao
                          ? <span className="flex items-center gap-1.5"><MapPin size={11} className="text-gray-500" />{p.patrimonio_localizacao}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center hidden md:table-cell"><FilialBadge filial={p.filial} /></td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right tabular-nums">
                        {p.preco_custo != null ? fmtBRL(parseNum(p.preco_custo)) : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 hidden lg:table-cell">{fmtData(p.created_at)}</td>
                      <td className="py-3 px-4 text-center hidden sm:table-cell"><StatusBadge status={p.status ?? 'Ativo'} /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
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
    </motion.div>
  );
};
