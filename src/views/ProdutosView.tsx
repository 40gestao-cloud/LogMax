import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet, Tag, TrendingUp, AlertTriangle, Barcode, Check, AlertCircle } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge, FilialBadge, Pagination } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToPDF, exportToExcel, formatBRL, parseBRL } from '../lib/viewUtils';
import { normalizeEan13, drawEan13ToCanvas, downloadEan13LabelPdf } from '../lib/barcode';
import { FILIAIS_HOLDING, FILIAL_DEFAULT } from '../lib/filiais';

const EMPTY_EXTRAS = {
  categoria:      '',
  preco_custo:    '',
  estoque:        '',
  estoque_minimo: '',
  ean:            '',
  fornecedor:     '',
  filial:         FILIAL_DEFAULT as string,
};

const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

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
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/produtosview',
    filialFiltro === 'todas' ? undefined : { filial: filialFiltro },
    false,
    { page, searchTerm: debouncedSearch, searchColumns: ['nome', 'codigo', 'categoria', 'ean', 'fornecedor'] }
  );
  const [isSaving, setIsSaving]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState<any | null>(null);
  const [form, setForm]   = useState({ codigo: '', nome: '', preco: '' });
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Pesquisa agora é server-side; já não há filtro client-side.
  const filtered = data;

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
    setForm({
      codigo: item.codigo ?? '',
      nome:   item.nome   ?? '',
      preco:  item.preco != null && item.preco !== '' ? formatBRL(Number(item.preco)) : '',
    });
    setExtras({
      categoria:      item.categoria      ?? '',
      preco_custo:    item.preco_custo != null && item.preco_custo !== '' ? formatBRL(Number(item.preco_custo)) : '',
      estoque:        item.estoque        !== undefined ? String(item.estoque)        : '',
      estoque_minimo: item.estoque_minimo !== undefined ? String(item.estoque_minimo) : '',
      ean:            item.ean            ?? '',
      fornecedor:     item.fornecedor     ?? '',
      filial:         item.filial         ?? FILIAL_DEFAULT,
    });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ codigo: '', nome: '', preco: '' });
    setExtras({ ...EMPTY_EXTRAS });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast(editItem ? 'Atualizando produto...' : 'Salvando produto...', 'info', false);
    try {
      const payload = {
        ...form,
        preco:          parseBRL(form.preco),
        categoria:      extras.categoria,
        preco_custo:    extras.preco_custo !== '' ? parseBRL(extras.preco_custo) : null,
        estoque:        extras.estoque        !== '' ? parseInt(extras.estoque, 10)        : 0,
        estoque_minimo: extras.estoque_minimo !== '' ? parseInt(extras.estoque_minimo, 10) : 0,
        ean:            extras.ean,
        fornecedor:     extras.fornecedor,
        filial:         extras.filial || FILIAL_DEFAULT,
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
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Produtos] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
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
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Produtos] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  // Margem calculada ao vivo no formulário (parseBRL desempacota a máscara)
  const margemAoVivo = calcMargem(parseBRL(form.preco), parseBRL(extras.preco_custo));
  const isFormOpen = showForm || !!editItem;

  // EAN-13 — preview ao vivo
  const eanNorm = normalizeEan13(extras.ean);
  const eanPreviewRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!isFormOpen) return;
    const canvas = eanPreviewRef.current;
    if (!canvas) return;
    if (eanNorm.valid) {
      try { drawEan13ToCanvas(canvas, eanNorm.value, { moduleWidth: 2, barHeight: 56 }); }
      catch { /* ignora — pattern inválido */ }
    } else {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [isFormOpen, eanNorm.value, eanNorm.valid]);

  const downloadLabelFor = async (item: { ean?: string; nome?: string; codigo?: string; preco?: any }) => {
    try {
      await downloadEan13LabelPdf({
        ean: item.ean ?? '',
        nome: item.nome,
        codigo: item.codigo,
        preco: item.preco != null ? parseNum(item.preco) : null,
        filename: `etiqueta-${item.codigo || normalizeEan13(item.ean).value}`,
      });
      showToast('Etiqueta gerada!', 'success', true);
    } catch (err: any) {
      showToast(err?.message || 'EAN-13 inválido para gerar etiqueta.', 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Catálogo de Produtos</h2>
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
          <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
            <option value="todas">Todas filiais</option>
            {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
                      placeholder="Ex: 7891234567890 (12 ou 13 dígitos)" inputMode="numeric" />
                  </FormField>
                  <FormField label="Fornecedor">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.fornecedor} onChange={e => setExtras(x => ({ ...x, fornecedor: e.target.value }))}
                      placeholder="Ex: Distribuidora ABC" />
                  </FormField>
                  <FormField label="Filial / Unidade *">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.filial} onChange={e => setExtras(x => ({ ...x, filial: e.target.value }))}>
                      {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </FormField>
                </div>
              </div>

              {/* Etiqueta EAN-13 */}
              {extras.ean.replace(/\D/g, '').length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                    <Barcode size={12} /> Etiqueta EAN-13
                  </p>
                  <div className="neu-pressed rounded-2xl p-4 border border-white/5 flex flex-col sm:flex-row items-center gap-4">
                    <div className="bg-white p-3 rounded-lg flex items-center justify-center min-h-[88px]">
                      {eanNorm.valid ? (
                        <canvas ref={eanPreviewRef} />
                      ) : (
                        <span className="text-[11px] text-gray-500 font-mono px-6 text-center">
                          Informe 12 ou 13 dígitos para visualizar
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2 w-full">
                      {eanNorm.valid ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-xs">
                          <Check size={14} />
                          <span className="font-bold">EAN-13 válido:</span>
                          <span className="font-mono">{eanNorm.value}</span>
                          {eanNorm.autoCompleted && (
                            <span className="text-[10px] text-gray-500">(dígito verificador calculado)</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-yellow-400 text-xs">
                          <AlertCircle size={14} />
                          <span>
                            {eanNorm.digits.length === 13
                              ? 'Dígito verificador inválido — confira os números.'
                              : `Faltam ${Math.max(0, 12 - eanNorm.digits.length)} dígito(s) para validar.`}
                          </span>
                        </div>
                      )}
                      <p className="text-[11px] text-gray-500">
                        Imprima em adesivo 80×50 mm. O código é escaneável por qualquer leitor de código de barras compatível com EAN-13.
                      </p>
                      <div className="flex justify-start">
                        <NeuButtonAccent
                          onClick={() => downloadLabelFor({ ean: extras.ean, nome: form.nome, codigo: form.codigo, preco: parseBRL(form.preco) })}
                          disabled={!eanNorm.valid || !form.nome.trim()}
                        >
                          <FileDown size={14} /> Baixar etiqueta PDF
                        </NeuButtonAccent>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Preços */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Preços</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Preço de Custo (R$)">
                    <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                      value={extras.preco_custo} onChange={e => setExtras(x => ({ ...x, preco_custo: formatBRL(e.target.value) }))}
                      placeholder="0,00" />
                  </FormField>
                  <FormField label="Preço de Venda (R$) *" error={errors.preco}>
                    <input type="text" inputMode="numeric" className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${errors.preco ? 'border border-red-500/40' : ''}`}
                      value={form.preco} onChange={e => { setForm(f => ({ ...f, preco: formatBRL(e.target.value) })); clearError('preco'); }}
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
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse md:min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Código</th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Categoria</th>
                  <th className="pb-4 font-bold px-4 text-center hidden md:table-cell">Filial</th>
                  <th className="pb-4 font-bold px-4 text-right hidden md:table-cell">P. Custo</th>
                  <th className="pb-4 font-bold px-4 text-right">P. Venda</th>
                  <th className="pb-4 font-bold px-4 text-right hidden md:table-cell">Margem</th>
                  <th className="pb-4 font-bold px-4 text-center">Estoque</th>
                  <th className="pb-4 font-bold px-4 text-center hidden sm:table-cell">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((item: any) => {
                    const estAtual = parseNum(item.estoque);
                    const estMin   = parseNum(item.estoque_minimo);
                    const baixoEstoque = estMin > 0 && estAtual <= estMin;
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell">{item.codigo}</td>
                        <td className="py-4 px-4">
                          <span className="sm:hidden text-[10px] font-mono text-gray-500 block">{item.codigo}</span>
                          <p className="text-sm font-semibold text-gray-200">{item.nome}</p>
                          {item.fornecedor && <p className="text-[10px] text-gray-600 mt-0.5">{item.fornecedor}</p>}
                        </td>
                        <td className="py-4 px-4 hidden lg:table-cell">
                          {item.categoria
                            ? <span className="text-[10px] uppercase neu-pressed px-2 py-0.5 rounded text-gray-400 tracking-widest font-bold">{item.categoria}</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-4 px-4 text-center hidden md:table-cell"><FilialBadge filial={item.filial} /></td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 text-right hidden md:table-cell">
                          {item.preco_custo != null ? fmtBRL(parseNum(item.preco_custo)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-200 text-right">
                          {item.preco != null ? fmtBRL(parseNum(item.preco)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs text-right hidden md:table-cell">
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
                        <td className="py-4 px-4 text-center hidden sm:table-cell"><StatusBadge status={item.status} /></td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {normalizeEan13(item.ean).valid && (
                              <button onClick={() => downloadLabelFor(item)}
                                title="Baixar etiqueta EAN-13 em PDF"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                                <Barcode size={12} />
                              </button>
                            )}
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
