import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet, Tag, TrendingUp, AlertTriangle } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, exportToPDF, exportToExcel } from '../lib/viewUtils';

const EMPTY_EXTRAS = {
  categoria:      '',
  preco_custo:    '',
  estoque:        '',
  estoque_minimo: '',
  ean:            '',
  fornecedor:     '',
};

const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const calcMargem = (venda: string | number, custo: string | number): number | null => {
  const v = parseNum(venda);
  const c = parseNum(custo);
  if (!c || !v) return null;
  return ((v - c) / c) * 100;
};

const MargemBadge = ({ venda, custo }: { venda: string | number; custo: string | number }) => {
  const m = calcMargem(venda, custo);
  if (m === null) return <span className="text-gray-600">—</span>;
  const cls = m >= 30 ? 'text-emerald-400' : m >= 10 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-bold tabular-nums ${cls}`}>{m.toFixed(1)}%</span>;
};

export const ProdutosView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/produtosview');
  const [isSaving, setIsSaving]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState<any | null>(null);
  const [search, setSearch]       = useState('');
  const [form, setForm]   = useState({ codigo: '', nome: '', preco: '' });
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search]);

  const filtered = data.filter((item: any) =>
    [item.codigo, item.nome, item.categoria, item.ean, item.fornecedor, item.status]
      .some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const exportCols = ['Código', 'Nome', 'Categoria', 'Fornecedor', 'P. Custo', 'P. Venda', 'Margem', 'Estoque', 'Est. Mín', 'EAN', 'Status'];
  const exportRows = () => filtered.map((d: any) => {
    const m = calcMargem(d.preco, d.preco_custo);
    return [
      d.codigo ?? '', d.nome ?? '', d.categoria ?? '', d.fornecedor ?? '',
      d.preco_custo ? fmtBRL(parseNum(d.preco_custo)) : '',
      d.preco ? fmtBRL(parseNum(d.preco)) : '',
      m !== null ? `${m.toFixed(1)}%` : '',
      String(d.estoque ?? 0), String(d.estoque_minimo ?? 0),
      d.ean ?? '', d.status ?? '',
    ];
  });
  const handleExportPDF   = () => exportToPDF('Catálogo de Produtos', exportCols, exportRows(), 'logmax-produtos');
  const handleExportExcel = () => exportToExcel('Produtos', exportCols, exportRows(), 'logmax-produtos');

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ codigo: item.codigo ?? '', nome: item.nome ?? '', preco: String(item.preco ?? '') });
    setExtras({
      categoria:      item.categoria      ?? '',
      preco_custo:    item.preco_custo !== undefined && item.preco_custo !== null ? String(item.preco_custo) : '',
      estoque:        item.estoque        !== undefined ? String(item.estoque)        : '',
      estoque_minimo: item.estoque_minimo !== undefined ? String(item.estoque_minimo) : '',
      ean:            item.ean            ?? '',
      fornecedor:     item.fornecedor     ?? '',
    });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ codigo: '', nome: '', preco: '' });
    setExtras(EMPTY_EXTRAS);
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? 'Atualizando produto...' : 'Salvando produto...', 'info', false);
    try {
      const payload = {
        ...form,
        preco:          parseNum(form.preco),
        categoria:      extras.categoria,
        preco_custo:    extras.preco_custo !== '' ? parseNum(extras.preco_custo) : null,
        estoque:        extras.estoque        !== '' ? parseInt(extras.estoque, 10)        : 0,
        estoque_minimo: extras.estoque_minimo !== '' ? parseInt(extras.estoque_minimo, 10) : 0,
        ean:            extras.ean,
        fornecedor:     extras.fornecedor,
      };
      if (editItem) {
        const updated = await dbUpdate('/api/produtosview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Produto atualizado!', 'success', true);
      } else {
        const saved = await dbInsert('/api/produtosview', { ...payload, status: 'Ativo' });
        setData([saved ?? { id: Date.now(), ...payload, status: 'Ativo' }, ...data]);
        showToast('Produto criado com sucesso!', 'success', true);
      }
      closeForm();
    } catch {
      showToast('Erro ao salvar.', 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este produto?')) return;
    try {
      await dbDelete('/api/produtosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Produto excluído.', 'success', true);
    } catch {
      showToast('Erro ao excluir.', 'error', true);
    }
  };

  // Margem calculada ao vivo no formulário
  const margemAoVivo = calcMargem(form.preco, extras.preco_custo);
  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Catálogo de Produtos</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie o portfólio de itens do estoque e suas informações.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-5">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Produto' : 'Novo Produto'}</h3>

              {/* Identificação */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Identificação</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Código *" error={errors.codigo}>
                    <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.codigo ? 'border border-red-500/40' : ''}`}
                      value={form.codigo} onChange={e => { setForm(f => ({ ...f, codigo: e.target.value })); clearError('codigo'); }}
                      placeholder="Ex: PRD-001" />
                  </FormField>
                  <FormField label="Nome do produto *" error={errors.nome}>
                    <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                      value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                      placeholder="Ex: Parafuso M6" />
                  </FormField>
                  <FormField label="Categoria">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.categoria} onChange={e => setExtras(x => ({ ...x, categoria: e.target.value }))}
                      placeholder="Ex: Fixadores, Eletrônicos" />
                  </FormField>
                  <FormField label="Cód. Barras EAN">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm font-mono"
                      value={extras.ean} onChange={e => setExtras(x => ({ ...x, ean: e.target.value }))}
                      placeholder="Ex: 7891234567890" />
                  </FormField>
                  <FormField label="Fornecedor">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.fornecedor} onChange={e => setExtras(x => ({ ...x, fornecedor: e.target.value }))}
                      placeholder="Ex: Distribuidora ABC" />
                  </FormField>
                </div>
              </div>

              {/* Preços */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Preços</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Preço de Custo (R$)">
                    <input type="number" min="0" step="0.01" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.preco_custo} onChange={e => setExtras(x => ({ ...x, preco_custo: e.target.value }))}
                      placeholder="0,00" />
                  </FormField>
                  <FormField label="Preço de Venda (R$) *" error={errors.preco}>
                    <input type="number" min="0" step="0.01" className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.preco ? 'border border-red-500/40' : ''}`}
                      value={form.preco} onChange={e => { setForm(f => ({ ...f, preco: e.target.value })); clearError('preco'); }}
                      placeholder="0,00" />
                  </FormField>
                  {/* Margem calculada ao vivo */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Margem de Lucro</label>
                    <div className={`neu-pressed py-2 px-3 rounded-xl text-sm flex items-center gap-2 border border-white/5 ${
                      margemAoVivo === null ? 'text-gray-600' :
                      margemAoVivo >= 30 ? 'text-emerald-400' :
                      margemAoVivo >= 10 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      <TrendingUp size={13} className="shrink-0 opacity-60" />
                      <span className="font-bold tabular-nums">
                        {margemAoVivo !== null ? `${margemAoVivo.toFixed(1)}%` : '—'}
                      </span>
                      {margemAoVivo !== null && margemAoVivo < 10 && (
                        <span className="text-[10px] text-red-400/70 ml-auto">Margem baixa</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Estoque */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Estoque</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-sm">
                  <FormField label="Estoque Atual">
                    <input type="number" min="0" step="1" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.estoque} onChange={e => setExtras(x => ({ ...x, estoque: e.target.value }))}
                      placeholder="0" />
                  </FormField>
                  <FormField label="Estoque Mínimo">
                    <input type="number" min="0" step="1" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.estoque_minimo} onChange={e => setExtras(x => ({ ...x, estoque_minimo: e.target.value }))}
                      placeholder="0" />
                  </FormField>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabela */}
      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6">
          {filtered.length > PAGE_SIZE && (
            <p className="text-xs text-gray-500 mb-4">Mostrando {Math.min(visibleCount, filtered.length)} de {filtered.length} produtos</p>
          )}
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[760px] md:min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Código</th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4">Categoria</th>
                  <th className="pb-4 font-bold px-4 text-right hidden md:table-cell">P. Custo</th>
                  <th className="pb-4 font-bold px-4 text-right">P. Venda</th>
                  <th className="pb-4 font-bold px-4 text-right">Margem</th>
                  <th className="pb-4 font-bold px-4 text-center">Estoque</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.slice(0, visibleCount).map((item: any) => {
                    const estAtual = parseNum(item.estoque);
                    const estMin   = parseNum(item.estoque_minimo);
                    const baixoEstoque = estMin > 0 && estAtual <= estMin;
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-4 px-4 text-xs font-mono text-gray-400">{item.codigo}</td>
                        <td className="py-4 px-4">
                          <p className="text-sm font-semibold text-gray-200">{item.nome}</p>
                          {item.fornecedor && <p className="text-[10px] text-gray-600 mt-0.5">{item.fornecedor}</p>}
                        </td>
                        <td className="py-4 px-4">
                          {item.categoria
                            ? <span className="text-[10px] uppercase neu-pressed px-2 py-0.5 rounded text-gray-400 tracking-widest font-bold">{item.categoria}</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 text-right hidden md:table-cell">
                          {item.preco_custo != null ? fmtBRL(parseNum(item.preco_custo)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-200 text-right">
                          {item.preco != null ? fmtBRL(parseNum(item.preco)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs text-right">
                          <MargemBadge venda={item.preco} custo={item.preco_custo} />
                        </td>
                        <td className="py-4 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {baixoEstoque && <AlertTriangle size={11} className="text-red-500 shrink-0" />}
                            <span className={`text-xs font-bold tabular-nums ${baixoEstoque ? 'text-red-400' : 'text-gray-300'}`}>
                              {item.estoque ?? 0}
                            </span>
                            {estMin > 0 && (
                              <span className="text-[10px] text-gray-600">/ {estMin}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {filtered.length > visibleCount && (
            <div className="flex justify-center pt-4 border-t border-white/5 mt-2">
              <button
                onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                className="neu-button px-6 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors">
                Carregar mais ({filtered.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
