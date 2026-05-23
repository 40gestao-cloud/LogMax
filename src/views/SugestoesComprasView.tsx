import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, ShoppingCart, AlertTriangle, X, Save } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, NeuButtonAccent } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

export const SugestoesComprasView = ({ showToast }: any) => {
  const { data: produtos, isLoading } = useFetchData<any>('/api/produtosview');
  const [search, setSearch] = useState('');
  const [filtroMode, setFiltroMode] = useState<'todos' | 'zerados'>('todos');
  const [requestingItem, setRequestingItem] = useState<any | null>(null);
  const [urgencia, setUrgencia] = useState('Normal');
  const [solicitante, setSolicitante] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const ativos = produtos.filter((p: any) => p.status === 'Ativo');
  const limiteMin = (p: any) => Number(p.estoque_minimo ?? 0) || 10;
  const criticos = ativos.filter((p: any) => p.estoque === 0);
  const baixos = ativos.filter((p: any) => p.estoque > 0 && p.estoque <= limiteMin(p));

  const sugestoes = ativos
    .filter((p: any) => p.estoque <= limiteMin(p))
    .filter((p: any) => filtroMode === 'zerados' ? p.estoque === 0 : true)
    .filter((p: any) => [p.codigo, p.nome, p.categoria].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())))
    .map((p: any) => {
      const qtd_sugerida = Math.max((limiteMin(p) * 2) - p.estoque, limiteMin(p));
      const valor_est = qtd_sugerida * Number(p.preco || 0);
      return { ...p, qtd_sugerida, valor_est };
    });

  const valorTotalEst = sugestoes.reduce((acc: number, p: any) => acc + p.valor_est, 0);

  const situacao = (estoque: number) =>
    estoque === 0 ? { label: 'Crítico', cls: 'bg-red-950/50 text-red-500' }
    : { label: 'Baixo', cls: 'bg-yellow-900/30 text-yellow-400' };

  const handleSolicitar = async () => {
    if (!requestingItem) return;
    setIsSaving(true);
    showToast("Criando requisição...", 'info', false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await dbInsert('/api/requisicoesview', {
        item: requestingItem.nome,
        qtd: requestingItem.qtd_sugerida,
        urgencia,
        solicitante,
        status: 'Pendente',
        data: today,
      });
      showToast("Requisição criada!", 'success', true);
      setRequestingItem(null);
      setSolicitante('');
      setUrgencia('Normal');
    } catch {
      showToast("Erro ao criar requisição.", 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const exportCols = ['Código', 'Produto', 'Estoque Atual', 'Unidade', 'Situação', 'Qtd Sugerida', 'Valor Est.'];
  const exportRows = () => sugestoes.map((p: any) => [
    p.codigo ?? '', p.nome ?? '', String(p.estoque ?? 0), p.unidade ?? '',
    situacao(p.estoque).label,
    String(p.qtd_sugerida),
    `R$ ${p.valor_est.toFixed(2)}`,
  ]);

  const kpis = [
    { label: 'Estoque Crítico', value: criticos.length, sub: 'produtos zerados', warn: criticos.length > 0 },
    { label: 'Estoque Baixo', value: baixos.length, sub: 'menos de 10 unid.', warn: baixos.length > 0 },
    { label: 'Valor Estimado de Recompra', value: `R$ ${valorTotalEst.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'para reabastecimento', warn: false },
    { label: 'Produtos Monitorados', value: ativos.length, sub: 'ativos no catálogo', warn: false },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Sugestões de Compras</h2>
        <p className="text-sm text-gray-400 mt-1">Produtos com estoque crítico ou baixo que precisam de reabastecimento.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-red-500' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-2">
          <button onClick={() => setFiltroMode('todos')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filtroMode === 'todos' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            Críticos e Baixos
          </button>
          <button onClick={() => setFiltroMode('zerados')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filtroMode === 'zerados' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            <AlertTriangle size={14} />Somente Zerados
          </button>
        </div>
        <div className="flex gap-3 items-center">
          {sugestoes.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={() => exportToPDF('Sugestões de Compras', exportCols, exportRows(), 'logmax-sugestoes')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Sugestões', exportCols, exportRows(), 'logmax-sugestoes')} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Modal de solicitação */}
      <AnimatePresence>
        {requestingItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-accent/20 flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-200">Criar Requisição — <span className="text-accent">{requestingItem.nome}</span></h3>
                <button onClick={() => setRequestingItem(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  {/* Qtd Sugerida é texto fixo read-only, sem input — span em vez de label */}
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Qtd Sugerida</span>
                  <div className="neu-input py-2 px-3 rounded-xl text-sm text-accent font-mono font-bold">{requestingItem.qtd_sugerida} {requestingItem.unidade}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sug-urgencia" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Urgência</label>
                  <select id="sug-urgencia" className="neu-input py-2 px-3 rounded-xl text-sm" value={urgencia} onChange={e => setUrgencia(e.target.value)}>
                    {['Normal', 'Alta', 'Urgente'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sug-solicitante" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Solicitante</label>
                  <input id="sug-solicitante" className="neu-input py-2 px-3 rounded-xl text-sm" placeholder="Seu nome..." value={solicitante} onChange={e => setSolicitante(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setRequestingItem(null)} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSolicitar} isLoading={isSaving}><Save size={14} /> Criar Requisição</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto h-full main-scrollbar">
          {isLoading ? <LoadingSpinner /> : sugestoes.length === 0 ? (
            <EmptyState message={filtroMode === 'zerados' ? 'Nenhum produto com estoque zerado.' : 'Nenhum produto com estoque crítico ou baixo.'} />
          ) : (
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Código</th>
                <th className="pb-4 font-bold px-4">Produto</th>
                <th className="pb-4 font-bold px-4 text-right">Estoque Atual</th>
                <th className="pb-4 font-bold px-4">Unidade</th>
                <th className="pb-4 font-bold px-4 text-center">Situação</th>
                <th className="pb-4 font-bold px-4 text-right">Qtd Sugerida</th>
                <th className="pb-4 font-bold px-4 text-right">Valor Est.</th>
                <th className="pb-4 font-bold px-4 text-right">Ação</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {sugestoes.map((p: any) => {
                    const sit = situacao(p.estoque);
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.codigo ?? '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome ?? '—'}</td>
                        <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${p.estoque === 0 ? 'text-red-500' : 'text-yellow-400'}`}>{p.estoque}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.unidade ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sit.cls}`}>{sit.label}</span></td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{p.qtd_sugerida}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {p.valor_est.toFixed(2)}</td>
                        <td className="py-3 px-4 text-right">
                          <button onClick={() => setRequestingItem(p)}
                            className="flex items-center gap-1.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity neu-button px-3 py-1.5 rounded-lg text-xs text-accent font-semibold hover:border-accent/20 border border-transparent">
                            <ShoppingCart size={12} /> Solicitar
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </motion.div>
  );
};
