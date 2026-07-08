import React, { useState, useEffect } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Check, Landmark, X, FileDown, Sheet, ArrowLeft } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, FilialBadge, Pagination } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown, exportToExcel } from '../lib/viewUtils';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { FILIAL_DEFAULT } from '../lib/filiais';
import { supabase } from '../lib/supabase';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { calcularJuros, fetchJurosConfig, type JurosConfig } from '../lib/juros';
import { useConfirm } from '../contexts/ConfirmContext';

const ContasPagarViewInner = ({ showToast, filial, onTrocarFilial }: { showToast: any; filial: FilialOp; onTrocarFilial: () => void }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [periodoFiltro, setPeriodoFiltro] = useState<'' | 'hoje' | 'semana' | 'mes'>('');
  const [isExporting, setIsExporting] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, periodoFiltro]);

  // Realtime: pedidos aprovados / folhas processadas geram contas a pagar — actualiza-se sozinha (#21).
  const periodoRange = (() => {
    const hoje = new Date();
    const hojeStr = hoje.toISOString().slice(0, 10);
    if (periodoFiltro === 'hoje') return { inicio: hojeStr, fim: hojeStr };
    if (periodoFiltro === 'semana') {
      const day = hoje.getDay();
      const monday = new Date(hoje);
      monday.setDate(hoje.getDate() - (day === 0 ? 6 : day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { inicio: monday.toISOString().slice(0, 10), fim: sunday.toISOString().slice(0, 10) };
    }
    if (periodoFiltro === 'mes') {
      const first = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const last = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      return { inicio: first.toISOString().slice(0, 10), fim: last.toISOString().slice(0, 10) };
    }
    return null;
  })();

  const extraFilter = { filial };
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/contaspagarview', extraFilter, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['descricao', 'status'] }
  );
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const { data: bancos, setData: setBancos } = useFetchData<any>('/api/caixabancosview');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({ valor: '', vencimento: '', fornecedor_id: '', filial: filial as string });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  // Diálogo inline de pagamento: pede o banco de débito antes de confirmar.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBankId, setPayBankId] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const bancosAtivos = bancos.filter((b: any) => b.status === 'Ativo' || !b.status);

  const [jurosCfg, setJurosCfg] = useState<JurosConfig | null>(null);
  useEffect(() => { fetchJurosConfig().then(setJurosCfg); }, []);

  // Total agregado server-side via RPC (com juros/multa pra vencidas). RPC evita
  // o teto implícito de ~1000 linhas do PostgREST que subestimava o total silenciosamente.
  const [totalPendente, setTotalPendente] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.rpc('total_pendente_contas_pagar', { p_filial: filial })
      .then(({ data: total, error }) => {
        if (cancelled) return;
        if (error) { console.warn('[ContasPagar] total_pendente_contas_pagar:', error.message); return; }
        setTotalPendente(Number(total ?? 0));
      });
    return () => { cancelled = true; };
  }, [data, filial]);

  const enriched = data.map((c: any) => ({
    ...c,
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
    juros: calcularJuros(c.valor, c.vencimento, c.status, jurosCfg),
  }));

  const filtered = enriched.filter((c: any) => {
    if (periodoRange) {
      if (!c.vencimento) return false;
      if (c.vencimento < periodoRange.inicio || c.vencimento > periodoRange.fim) return false;
    }
    return [c.descricao, c.status, c.forn?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()));
  });

  const exportCols = ['Descrição', 'Fornecedor', 'Valor (R$)', 'Vencimento', 'Status'];
  const buildExportRows = (rows: any[]) => rows.map((c: any) => [
    c.descricao ?? '—',
    c.forn?.nome ?? '—',
    c.juros.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    c.vencimento ?? '—',
    c.status ?? '—',
  ]);

  const fetchAllForExport = async (): Promise<any[]> => {
    if (!supabase) return [];
    let q = supabase.from('contas_pagar').select('*').eq('ativo', true).eq('filial', filial).order('vencimento', { ascending: true });
    if (periodoRange) q = (q as any).gte('vencimento', periodoRange.inicio).lte('vencimento', periodoRange.fim);
    const { data: rows, error: err } = await q;
    if (err) throw new Error(err.message);
    return (rows ?? []).map((c: any) => ({
      ...c,
      forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
      juros: calcularJuros(c.valor, c.vencimento, c.status, jurosCfg),
    }));
  };

  const periodoLabel = periodoFiltro === 'hoje' ? ' — Hoje' : periodoFiltro === 'semana' ? ' — Esta Semana' : periodoFiltro === 'mes' ? ' — Este Mês' : '';
  const exportSlug = [filial.toLowerCase().replace(/\s/g, '-'), periodoFiltro || null].filter(Boolean).join('-');

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const allData = await fetchAllForExport();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF();
      const titulo = `Contas a Pagar — ${filial}${periodoLabel}`;

      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, 210, 32, 'F');
      doc.setTextColor(16, 185, 129);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('LogMax', 14, 14);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text('Relatório Financeiro', 14, 21);
      doc.setFontSize(11);
      doc.setTextColor(220, 220, 220);
      doc.text(titulo, 14, 29);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} · ${allData.length} registros`, 210 - 14, 29, { align: 'right' });

      autoTable(doc, {
        startY: 38,
        head: [exportCols],
        body: buildExportRows(allData),
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: [60, 60, 60], fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 245] },
      });

      doc.save(`logmax-contas-pagar-${exportSlug}.pdf`);
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar PDF.', 'error', true);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const allData = await fetchAllForExport();
      await exportToExcel('Contas a Pagar', exportCols, buildExportRows(allData), `logmax-contas-pagar-${exportSlug}`);
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar Excel.', 'error', true);
    } finally {
      setIsExporting(false);
    }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ descricao: item.descricao ?? '' });
    setExtras({ valor: item.valor != null && item.valor !== '' ? formatBRL(Number(item.valor)) : '', vencimento: item.vencimento ?? '', fornecedor_id: item.fornecedor_id ?? '', filial });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ descricao: '' });
    setExtras({ valor: '', vencimento: '', fornecedor_id: '', filial });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const filialTarget = extras.filial || FILIAL_DEFAULT;
    const payload = {
      descricao: form.descricao,
      valor: parseBRL(extras.valor),
      vencimento: extras.vencimento || null,
      fornecedor_id: extras.fornecedor_id || null,
      filial: filialTarget,
    };
    try {
      // Verificar saldo de capital antes de criar nova despesa
      if (!editItem && filialTarget !== 'Matriz' && supabase) {
        const { data: saldoData } = await supabase.rpc('calcular_saldo_capital', { p_filial: filialTarget });
        if (saldoData?.[0]?.bloqueado) {
          showToast(`Capital de ${filialTarget} esgotado. Solicite empréstimo ou aporte antes de lançar novas despesas.`, 'error', true);
          setIsSaving(false);
          return;
        }
      }
      if (editItem) {
        const updated = await dbUpdate('/api/contaspagarview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/contaspagarview', { ...payload, status: 'Pendente' });
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload, status: 'Pendente' }, ...prev]);
        showToast('Conta a Pagar criada!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[ContasPagar] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const openPay = (id: string) => {
    setPayingId(id);
    setPayBankId('');
  };

  const closePay = () => {
    setPayingId(null);
    setPayBankId('');
  };

  const handleConfirmarPagamento = async (conta: any) => {
    if (!payBankId) { showToast('Selecione a conta bancária de débito.', 'error', true); return; }
    const banco = bancos.find((b: any) => b.id === payBankId);
    if (!banco) { showToast('Conta bancária não encontrada.', 'error', true); return; }
    const breakdown = calcularJuros(conta.valor, conta.vencimento, conta.status, jurosCfg);
    const valor = breakdown.total;  // valor atualizado com juros + multa se vencido
    if (!(valor > 0)) { showToast('Valor da conta inválido.', 'error', true); return; }
    setPaySaving(true);
    try {
      const updated = await dbUpdate('/api/contaspagarview', conta.id, { status: 'Pago', banco_id: payBankId });
      setData((prev: any[]) => prev.map(d => d.id === conta.id ? (updated ?? { ...d, status: 'Pago' }) : d));

      if (supabase) {
        // Why: o array `bancos` vem de useFetchData sem realtime; sem refrescar
        // o estado local após cada baixa, a próxima conta paga lê o `saldo`
        // antigo e a 2ª gravação sobrescreve a 1ª (só o último pagamento vinga).
        const novoSaldo = Number(banco.saldo ?? 0) - valor;
        const { data: updatedBanco, error } = await supabase
          .from('caixa_bancos')
          .update({ saldo: novoSaldo })
          .eq('id', payBankId)
          .select()
          .single();
        if (error || !updatedBanco) {
          showToast(`Conta paga, mas falhou ao atualizar o saldo de "${banco.banco ?? banco.conta}". Ajuste manualmente.`, 'error', false);
          closePay();
          return;
        }
        setBancos((prev: any[]) => prev.map((b: any) => b.id === payBankId ? updatedBanco : b));
      }

      const msgJuros = breakdown.vencido && (breakdown.juros + breakdown.multa) > 0
        ? ` (inclui R$ ${(breakdown.juros + breakdown.multa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de juros/multa)`
        : '';
      showToast(
        `Pagamento de R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${msgJuros} debitado de ${banco.banco ?? banco.conta}.`,
        'success', true,
      );
      closePay();
    } catch {
      showToast('Erro ao registar pagamento.', 'error', true);
    } finally {
      setPaySaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Excluir esta conta?')) return;
    try {
      await dbDelete('/api/contaspagarview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Conta excluída.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[ContasPagar] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Contas a Pagar — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Total pendente: <span className="text-accent font-bold">R$ {totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          <button onClick={onTrocarFilial}
            className="neu-button py-2.5 px-4 rounded-xl text-sm text-gray-400 hover:text-accent flex items-center gap-1.5">
            <ArrowLeft size={14} /> Trocar unidade
          </button>
          <div className="flex gap-1">
            {(['', 'hoje', 'semana', 'mes'] as const).map(p => (
              <button key={p || 'todos'} onClick={() => setPeriodoFiltro(p)}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors ${periodoFiltro === p ? 'bg-accent/20 text-accent border border-accent/30' : 'neu-button text-gray-500 hover:text-gray-300'}`}>
                {p === '' ? 'Todos' : p === 'hoje' ? 'Hoje' : p === 'semana' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar conta..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={handleExportPDF} disabled={isExporting} title="Exportar PDF — todas as contas" className="neu-button py-2.5 px-3 rounded-xl text-sm flex items-center gap-1.5 text-gray-300 disabled:opacity-50"><FileDown size={15} /> {isExporting ? '…' : 'PDF'}</button>
          <button onClick={handleExportExcel} disabled={isExporting} title="Exportar Excel — todas as contas" className="neu-button py-2.5 px-3 rounded-xl text-sm flex items-center gap-1.5 text-gray-300 disabled:opacity-50"><Sheet size={15} /> {isExporting ? '…' : 'Excel'}</button>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta a Pagar'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Descrição *" error={errors.descricao}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao} onChange={e => { setForm(f => ({ ...f, descricao: e.target.value })); clearError('descricao'); }}
                    placeholder="Ex: Fornecimento de material" />
                </FormField>
                <FormField label="Valor (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                    value={extras.valor} onChange={e => setExtras(x => ({ ...x, valor: formatBRL(e.target.value) }))} onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                </FormField>
                <FormField label="Vencimento">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.vencimento} onChange={e => setExtras(x => ({ ...x, vencimento: e.target.value }))} />
                </FormField>
                <FormField label="Fornecedor">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.fornecedor_id} onChange={e => setExtras(x => ({ ...x, fornecedor_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {groupCadastrosParaSelect(fornecedores).map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState message="Nenhuma conta a pagar" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Vencimento</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <React.Fragment key={item.id}>
                      <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          {item.descricao}
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">{item.forn?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          <div>R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                          {item.juros.vencido && (item.juros.juros + item.juros.multa) > 0 && (
                            <div className="text-[10px] text-red-400 mt-0.5" title={`${item.juros.dias_atraso} dia(s) de atraso · multa R$ ${item.juros.multa.toFixed(2)} + juros R$ ${item.juros.juros.toFixed(2)}`}>
                              + R$ {(item.juros.juros + item.juros.multa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} mora
                            </div>
                          )}
                          {item.juros.vencido && (item.juros.juros + item.juros.multa) > 0 && (
                            <div className="text-[10px] text-accent font-bold mt-0.5">
                              = R$ {item.juros.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 font-mono hidden sm:table-cell">
                          {item.vencimento || '—'}
                          {item.juros.vencido && item.juros.dias_atraso > 0 && (
                            <div className="text-[10px] text-red-400 mt-0.5">{item.juros.dias_atraso}d atraso</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                            {item.status === 'Pendente' && (
                              <button onClick={() => openPay(item.id)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"><Check size={11} /> Pagar</button>
                            )}
                            <button onClick={() => openEdit(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {payingId === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[220px]">
                                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Landmark size={11} /> Conta bancária de débito *</label>
                                  <select className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={payBankId} onChange={e => setPayBankId(e.target.value)}>
                                    <option value="">Selecione...</option>
                                    {bancosAtivos.map((b: any) => (
                                      <option key={b.id} value={b.id}>
                                        {(b.banco ?? b.conta ?? '—')} — saldo R$ {Number(b.saldo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </option>
                                    ))}
                                  </select>
                                  {bancosAtivos.length === 0 && (
                                    <span className="text-[10px] text-yellow-400 mt-1">Nenhum banco activo. Cadastre em Financeiro → Caixa / Bancos.</span>
                                  )}
                                </div>
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmarPagamento(item)} disabled={paySaving || !payBankId}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {paySaving ? 'Pagando...' : <><Check size={12} /> Confirmar pagamento</>}
                                  </button>
                                  <button onClick={closePay} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center gap-1"><X size={11} /> Cancelar</button>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
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

export const ContasPagarView = ({ showToast }: any) => {
  const { filialAtiva: filial } = useFilial();
  return <ContasPagarViewInner showToast={showToast} filial={filial} onTrocarFilial={() => {}} />;
};
