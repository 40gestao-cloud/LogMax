import React, { useState, useEffect, useMemo } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, Pagination } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';

// Sentinel pra opção "Outro (digitar)" — usado quando o item solicitado
// não existe no catálogo (compra eventual, serviço, item novo).
const ITEM_OUTRO = '__outro__';

// Rótulos legíveis dos atributos JSONB (produtos.atributos). Mantido
// duplicado com CatalogoProdutosView pra não criar dependência cruzada.
const ATRIBUTO_LABEL: Record<string, string> = {
  tamanho: 'Tamanho', cor: 'Cor', genero: 'Gênero', colecao: 'Coleção', material: 'Material',
  modelo: 'Modelo', memoria: 'Memória', tela: 'Tela', bateria: 'Bateria', camera: 'Câmera',
  garantia_dias: 'Garantia (dias)', requer_imei: 'Requer IMEI/Serial',
};
const formatAtributoValor = (v: any): string =>
  typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);

// Preview compacto de marca + ficha técnica do produto escolhido. Mostrado
// abaixo do select pra o solicitante confirmar que pegou o item certo
// (tamanho/cor no MaxLook, memória/tela no TechMax etc.) sem precisar sair
// da tela de requisição.
const ProdutoResumo = ({ produto }: { produto: any }) => {
  if (!produto) return null;
  const atr = (produto.atributos && typeof produto.atributos === 'object') ? produto.atributos : {};
  const atrEntries = Object.entries(atr).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!produto.marca && atrEntries.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg px-3 py-2 border border-white/5 bg-white/[0.02] flex flex-wrap gap-x-3 gap-y-1">
      {produto.marca && (
        <span className="text-[10px] text-gray-400">
          <span className="text-gray-500 font-bold uppercase tracking-widest">Marca:</span>{' '}
          <span className="text-gray-200 font-bold">{produto.marca}</span>
        </span>
      )}
      {atrEntries.map(([k, v]) => (
        <span key={k} className="text-[10px] text-gray-400">
          <span className="text-gray-500 font-bold uppercase tracking-widest">{ATRIBUTO_LABEL[k] ?? k.replace(/_/g, ' ')}:</span>{' '}
          <span className="text-gray-200 font-bold">{formatAtributoValor(v)}</span>
        </span>
      ))}
    </div>
  );
};

const RequisicoesViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/requisicoesview', { filial }, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['item', 'solicitante', 'urgencia', 'centro_custo', 'status'] }
  );
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });
  const produtosOrdenados = useMemo(
    () => [...produtos]
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [produtos]
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  // produtoSel = id do produto escolhido no dropdown, ITEM_OUTRO ou '' (nenhum).
  // form.item = texto final que vai pra BD (nome do produto ou texto livre).
  // Usado só no modo edição (1 requisição já existente) — criação nova usa
  // o editor em lote (batchItens) logo abaixo, mesmo para 1 item só.
  const [produtoSel, setProdutoSel] = useState<string>('');
  const [form, setForm] = useState({ item: '', solicitante: '' });
  const [extras, setExtras] = useState({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Criação em lote: N linhas de {produto/item, qtd} compartilhando
  // solicitante/urgência/centro de custo. Cada requisição continua sendo 1
  // linha independente (Cotações/Pedidos seguem 1:1) — o lote só agiliza a
  // etapa de solicitação quando vários itens vão pro mesmo fornecedor.
  const linhaVazia = () => ({ produtoSel: '', item: '', qtd: '1' });
  const [batchItens, setBatchItens] = useState<{ produtoSel: string; item: string; qtd: string }[]>([linhaVazia()]);
  const [batchForm, setBatchForm] = useState({ solicitante: '' });
  const [batchExtras, setBatchExtras] = useState({ urgencia: 'Normal', centro_custo: '' });
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({});

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ item: item.item ?? '', solicitante: item.solicitante ?? '' });
    setExtras({ qtd: String(item.qtd ?? 1), urgencia: item.urgencia ?? 'Normal', centro_custo: item.centro_custo ?? '' });
    // Pré-seleciona o produto se o item gravado bater com algum do catálogo;
    // senão cai em "Outro" pra preservar o texto histórico.
    const match = produtosOrdenados.find((p: any) => p.nome === item.item);
    setProdutoSel(match ? match.id : (item.item ? ITEM_OUTRO : ''));
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setProdutoSel('');
    setForm({ item: '', solicitante: '' });
    setExtras({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
    setErrors({});
  };

  const closeBatchForm = () => {
    setShowForm(false);
    setBatchItens([linhaVazia()]);
    setBatchForm({ solicitante: '' });
    setBatchExtras({ urgencia: 'Normal', centro_custo: '' });
    setBatchErrors({});
  };

  const addBatchRow = () => setBatchItens(rows => [...rows, linhaVazia()]);
  const removeBatchRow = (idx: number) => setBatchItens(rows => rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx));
  const updateBatchRow = (idx: number, patch: Partial<{ produtoSel: string; item: string; qtd: string }>) =>
    setBatchItens(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const handleBatchProdutoChange = (idx: number, value: string) => {
    setBatchErrors(e => { const { [`item_${idx}`]: _omit, ...rest } = e; return rest; });
    if (value === ITEM_OUTRO || value === '') {
      updateBatchRow(idx, { produtoSel: value, item: '' });
    } else {
      const p = produtosOrdenados.find((pr: any) => pr.id === value);
      updateBatchRow(idx, { produtoSel: value, item: p?.nome ?? '' });
    }
  };

  const validateBatch = (): boolean => {
    const errs: Record<string, string> = {};
    if (!batchForm.solicitante.trim()) errs.solicitante = 'Obrigatório';
    batchItens.forEach((r, i) => { if (!r.item.trim()) errs[`item_${i}`] = 'Obrigatório'; });
    setBatchErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveBatch = async () => {
    if (!validateBatch()) return;
    setIsSaving(true);
    showToast(batchItens.length > 1 ? 'Criando requisições em lote...' : 'Criando requisição...', 'info', false);
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const payloadItens = batchItens.map(r => ({ item: r.item.trim(), qtd: parseInt(r.qtd, 10) || 1 }));
      const { data: saved, error: rpcErr } = await supabase.rpc('criar_requisicoes_compra_lote', {
        p_itens:        payloadItens,
        p_solicitante:  batchForm.solicitante,
        p_urgencia:     batchExtras.urgencia,
        p_centro_custo: batchExtras.centro_custo,
        p_filial:       filial,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const rows: any[] = Array.isArray(saved) ? saved : [];
      if (rows.length) setData((prev: any[]) => [...rows, ...prev]);
      showToast(
        rows.length > 1 ? `${rows.length} requisições criadas e enviadas para aprovação!` : 'Requisição criada e enviada para aprovação!',
        'success', true
      );
      closeBatchForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleProdutoChange = (value: string) => {
    setProdutoSel(value);
    clearError('item');
    if (value === ITEM_OUTRO) {
      setForm(f => ({ ...f, item: '' }));
    } else if (value === '') {
      setForm(f => ({ ...f, item: '' }));
    } else {
      const p = produtosOrdenados.find((pr: any) => pr.id === value);
      setForm(f => ({ ...f, item: p?.nome ?? '' }));
    }
  };

  // Só edição de requisição já existente — criação nova usa handleSaveBatch
  // (RPC em lote), mesmo quando é 1 item só.
  const handleSave = async () => {
    if (!validate() || !editItem) return;
    setIsSaving(true);
    showToast("Atualizando...", 'info', false);
    try {
      const payload = {
        item: form.item,
        solicitante: form.solicitante,
        qtd: parseInt(extras.qtd) || 1,
        urgencia: extras.urgencia,
        centro_custo: extras.centro_custo,
      };
      const updated = await dbUpdate('/api/requisicoesview', editItem.id, payload);
      setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
      showToast("Requisição atualizada!", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Excluir esta requisição?')) return;
    try {
      // Soft delete não cascateia (FK ON DELETE só age em hard delete). Excluir
      // uma requisição com cotação/pedido vivo deixava esses registros órfãos,
      // exibindo "—" no lugar do item. Recusamos e mandamos cancelar antes.
      if (supabase) {
        const [{ data: cots }, { data: peds }] = await Promise.all([
          supabase.from('cotacoes').select('id').eq('requisicao_id', id).eq('ativo', true)
            .in('status', ['Aguardando Financeiro', 'Aprovado']).limit(1),
          supabase.from('pedidos').select('id').eq('requisicao_id', id).eq('ativo', true).limit(1),
        ]);
        if ((peds ?? []).length > 0) {
          showToast('Esta requisição já virou pedido. Inative o pedido antes de excluí-la.', 'error', true);
          return;
        }
        if ((cots ?? []).length > 0) {
          showToast('Existe cotação ativa para esta requisição. Cancele a cotação antes de excluí-la.', 'error', true);
          return;
        }
      }

      await dbDelete('/api/requisicoesview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast("Requisição excluída.", 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Requisicoes] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Solicite itens para compra. Requisições aprovadas seguem para cotação.</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar requisição..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeBatchForm(); setShowForm(v => !v); }}>
            <Plus size={16} /> Nova
          </NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">
                {editItem ? 'Editar Requisição' : batchItens.length > 1 ? `Nova Requisição em Lote (${batchItens.length} itens)` : 'Nova Requisição'}
              </h3>

              {editItem ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Item solicitado *" error={errors.item}>
                      <select
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.item ? 'border border-red-500/40' : ''}`}
                        value={produtoSel}
                        onChange={e => handleProdutoChange(e.target.value)}
                      >
                        <option value="">Selecione um produto...</option>
                        {produtosOrdenados.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}{p.marca ? ` — ${p.marca}` : ''}{p.codigo ? ` (${p.codigo})` : ''}
                          </option>
                        ))}
                        <option value={ITEM_OUTRO}>Outro (digitar manualmente)</option>
                      </select>
                      {produtoSel === ITEM_OUTRO && (
                        <input
                          className={`neu-input py-2 px-3 rounded-xl text-sm mt-2 ${errors.item ? 'border border-red-500/40' : ''}`}
                          value={form.item}
                          onChange={e => { setForm(f => ({ ...f, item: e.target.value })); clearError('item'); }}
                          placeholder="Descreva o item solicitado"
                          autoFocus
                        />
                      )}
                      {produtoSel && produtoSel !== ITEM_OUTRO && (
                        <ProdutoResumo produto={produtosOrdenados.find((p: any) => p.id === produtoSel)} />
                      )}
                    </FormField>
                    <FormField label="Solicitante *" error={errors.solicitante}>
                      <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.solicitante ? 'border border-red-500/40' : ''}`}
                        value={form.solicitante} onChange={e => { setForm(f => ({ ...f, solicitante: e.target.value })); clearError('solicitante'); }}
                        placeholder="Nome do solicitante" />
                    </FormField>
                    <FormField label="Quantidade">
                      <input type="number" min="1" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.qtd} onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} />
                    </FormField>
                    <FormField label="Urgência">
                      <select className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.urgencia} onChange={e => setExtras(x => ({ ...x, urgencia: e.target.value }))}>
                        <option>Normal</option>
                        <option>Alta</option>
                        <option>Urgente</option>
                      </select>
                    </FormField>
                    <FormField label="Centro de Custo">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.centro_custo} onChange={e => setExtras(x => ({ ...x, centro_custo: e.target.value }))}
                        placeholder="Ex: TI, Marketing" />
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                      <Save size={14} /> Atualizar
                    </NeuButtonAccent>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Solicitante *" error={batchErrors.solicitante}>
                      <input className={`neu-input py-2 px-3 rounded-xl text-sm ${batchErrors.solicitante ? 'border border-red-500/40' : ''}`}
                        value={batchForm.solicitante}
                        onChange={e => { setBatchForm({ solicitante: e.target.value }); setBatchErrors(be => ({ ...be, solicitante: '' })); }}
                        placeholder="Nome do solicitante" />
                    </FormField>
                    <FormField label="Urgência">
                      <select className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={batchExtras.urgencia} onChange={e => setBatchExtras(x => ({ ...x, urgencia: e.target.value }))}>
                        <option>Normal</option>
                        <option>Alta</option>
                        <option>Urgente</option>
                      </select>
                    </FormField>
                    <FormField label="Centro de Custo">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={batchExtras.centro_custo} onChange={e => setBatchExtras(x => ({ ...x, centro_custo: e.target.value }))}
                        placeholder="Ex: TI, Marketing" />
                    </FormField>
                  </div>

                  <div className="flex flex-col gap-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Itens da requisição</p>
                    {batchItens.map((row, idx) => {
                      const produtoEscolhido = row.produtoSel && row.produtoSel !== ITEM_OUTRO
                        ? produtosOrdenados.find((p: any) => p.id === row.produtoSel)
                        : null;
                      return (
                        <div key={idx} className="neu-pressed rounded-xl p-3 border border-white/5 grid grid-cols-1 sm:grid-cols-[1fr_110px_auto] gap-3 sm:items-start">
                          <FormField label={`Item ${idx + 1} *`} error={batchErrors[`item_${idx}`]}>
                            <select
                              className={`neu-input py-2 px-3 rounded-xl text-sm w-full ${batchErrors[`item_${idx}`] ? 'border border-red-500/40' : ''}`}
                              value={row.produtoSel}
                              onChange={e => handleBatchProdutoChange(idx, e.target.value)}
                            >
                              <option value="">Selecione um produto...</option>
                              {produtosOrdenados.map((p: any) => (
                                <option key={p.id} value={p.id}>
                                  {p.nome}{p.codigo ? ` (${p.codigo})` : ''}
                                </option>
                              ))}
                              <option value={ITEM_OUTRO}>Outro (digitar manualmente)</option>
                            </select>
                            {row.produtoSel === ITEM_OUTRO && (
                              <input
                                className={`neu-input py-2 px-3 rounded-xl text-sm mt-2 w-full ${batchErrors[`item_${idx}`] ? 'border border-red-500/40' : ''}`}
                                value={row.item}
                                onChange={e => { updateBatchRow(idx, { item: e.target.value }); setBatchErrors(be => ({ ...be, [`item_${idx}`]: '' })); }}
                                placeholder="Descreva o item solicitado"
                                autoFocus
                              />
                            )}
                            {produtoEscolhido?.fornecedor && (
                              <p className="text-[10px] text-gray-600 mt-1">Fornecedor habitual: {produtoEscolhido.fornecedor}</p>
                            )}
                            <ProdutoResumo produto={produtoEscolhido} />
                          </FormField>
                          <FormField label="Qtd">
                            <input type="number" min="1" className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                              value={row.qtd} onChange={e => updateBatchRow(idx, { qtd: e.target.value })} />
                          </FormField>
                          <button
                            type="button"
                            onClick={() => removeBatchRow(idx)}
                            disabled={batchItens.length <= 1}
                            title="Remover item"
                            className="w-9 h-9 sm:mt-6 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={addBatchRow}
                      className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-1.5 self-start"
                    >
                      <Plus size={13} /> Adicionar item
                    </button>
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button onClick={closeBatchForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSaveBatch} isLoading={isSaving}>
                      <Save size={14} /> {batchItens.length > 1 ? `Enviar ${batchItens.length} para Aprovação` : 'Enviar para Aprovação'}
                    </NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : data.length === 0 ? <EmptyState message="Nenhuma requisição encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Item</th>
                  <th className="pb-4 font-bold px-4 text-center">Qtd</th>
                  <th className="pb-4 font-bold px-4 text-center">Urgência</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Centro de Custo</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Solicitante</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Data</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200 max-w-[9rem] sm:max-w-[200px]">
                        <span className="block truncate">{item.item}</span>
                        <span className="md:hidden block text-[10px] text-gray-500 mt-0.5 truncate">{item.solicitante}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400 text-center font-mono">{item.qtd}</td>
                      <td className="py-3 px-4 text-center"><UrgenciaBadge urgencia={item.urgencia ?? 'Normal'} /></td>
                      <td className="py-3 px-4 text-xs text-gray-400 hidden lg:table-cell">{item.centro_custo || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.solicitante}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono hidden sm:table-cell">{item.data}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                          {item.status === 'Pendente' && (
                            <button onClick={() => openEdit(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                          )}
                          <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
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

export const RequisicoesView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <RequisicoesViewInner showToast={showToast} filial={filialAtiva} />;
};
