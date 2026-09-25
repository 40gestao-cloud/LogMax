import { useRolarAteFormulario } from '../hooks/useRolarAteFormulario';
import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useEffect } from 'react';
import type { FilialSelectorValue } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Check, Landmark, X, FileDown, Sheet, CreditCard } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, FilialBadge, Pagination } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown, exportToExcel, drawPdfHeader } from '../lib/viewUtils';
import { GOLD, BLACK, GRAY_INK, GOLD_TINT } from '../lib/pdfPalette';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { FILIAL_DEFAULT, bancoDaUnidade } from '../lib/filiais';
import { supabase } from '../lib/supabase';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { calcularJuros, fetchJurosConfig, type JurosConfig } from '../lib/juros';
import { periodoRangeBR } from '../lib/dates';
import { useConfirm } from '../contexts/ConfirmContext';

// Quanto ainda se cobra deste título. Conta com baixa parcial (migr. 422) já
// teve parte do principal recebida; o `valor` da linha continua sendo o do
// documento, que não encolhe porque o cliente pagou metade.
const saldoEmAberto = (c: any): number =>
  c?.status === 'Parcial'
    ? Math.max(Number(c.valor ?? 0) - Number(c.valor_pago ?? 0), 0)
    : Number(c?.valor ?? 0);

// Status em que ainda cabe receber. 'Parcial' é o que a migr. 422 acrescentou.
const RECEBIVEL = new Set(['Aberto', 'Atrasado', 'Parcial']);

// `filial` inclui 'Matriz': o rateio administrativo (migr. 323) gera uma conta
// a receber da holding contra cada unidade, e ela precisa de onde ser cobrada.
const ContasReceberViewInner = ({ showToast, filial }: { showToast: any; filial: FilialSelectorValue }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [periodoFiltro, setPeriodoFiltro] = useState<'' | 'hoje' | 'semana' | 'mes'>('');
  const [isExporting, setIsExporting] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, periodoFiltro]);

  // Realtime: vendas Fiado de outros caixas geram contas a receber — esta view actualiza-se sozinha (#21).
  // Fuso do Acre (UTC-5). Com `new Date().toISOString()` o dia virava às 19h
  // locais e o filtro "Hoje" mostrava o vencimento de amanhã.
  const periodoRange = periodoRangeBR(periodoFiltro);

  // Recorte de período resolvido no SERVIDOR — filtrar as 50 linhas da página
  // fazia a lista discordar do total agregado exibido no topo.
  const extraFilter = periodoRange
    ? { filial, vencimento: { gte: periodoRange.inicio, lte: periodoRange.fim } }
    : { filial };
  const { data, setData, isLoading, totalCount, reload, error } = useFetchData<any>(
    '/api/contasreceberview', extraFilter, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['descricao', 'status'] }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview', { filial });
  // A conta bancária é da unidade (`caixa_bancos.filial`). Sem o filtro, a
  // lista de bancos da TechMax oferecia a conta do SuperMax — e quem enxerga
  // mais de uma filial (admin, CEO, conselheiro) passava pela RLS.
  const { data: bancos, setData: setBancos } = useFetchData<any>('/api/caixabancosview', filial ? { filial } : undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({ valor: '', vencimento: '', cliente_id: '', filial: filial as string });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  // Diálogo inline de recebimento: pede o banco de crédito antes de confirmar.
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [recBankId, setRecBankId] = useState('');
  const [recSaving, setRecSaving] = useState(false);
  // Valor da baixa. Nasce preenchido com o total devido — quitar continua sendo
  // dois cliques —, mas agora é editável, que é o ponto desta tela.
  const [recValor, setRecValor] = useState('');

  // Mesma régua da ContasPagarView: o crédito entra no caixa da unidade dona
  // da conta. A migr. 325 recusa a combinação errada no banco de dados.
  const bancosAtivos = bancos.filter(
    (b: any) => (b.status === 'Ativo' || !b.status) && bancoDaUnidade(b, filial),
  );

  // Política de juros/multa do Financeiro. Definida em Financeiro → Configurações.
  const [jurosCfg, setJurosCfg] = useState<JurosConfig | null>(null);
  useEffect(() => {
    fetchJurosConfig().then(setJurosCfg);
  }, []);

  // Total agregado server-side (independente da página). Soma valor original.
  const [totalAberto, setTotalAberto] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    // 'Aberto' é o vocabulário real desta tabela: é o DEFAULT da coluna, é o
    // que `criar_venda_pdv` grava (fiado, cartão, parcelas) e é o que o insert
    // desta tela usa. A correção anterior trocou para 'Pendente' — vocabulário
    // de contas_pagar — e o card seguiu em R$ 0,00 por outro motivo. O recorte
    // por filial, esse sim, faltava mesmo.
    // 'Parcial' entra junto (migr. 422): conta que recebeu metade continua
    // sendo dinheiro a receber, e some do card se o filtro só olhar 'Aberto'.
    supabase.from('contas_receber').select('valor, valor_pago, vencimento, status')
      .in('status', ['Aberto', 'Parcial']).eq('ativo', true).eq('filial', filial)
      .then(({ data: rows }) => {
        if (cancelled) return;
        // Soma valor atualizado (com juros/multa pra vencidas) — total real esperado a receber.
        const total = (rows ?? []).reduce((s: number, c: any) => {
          const b = calcularJuros(saldoEmAberto(c), c.vencimento, c.status, jurosCfg);
          return s + b.total;
        }, 0);
        setTotalAberto(total);
      });
    return () => { cancelled = true; };
  }, [data, jurosCfg, filial]);

  const enriched = data.map((c: any) => ({
    ...c,
    cliente: clientes.find((cl: any) => cl.id === c.cliente_id),
    // Juros correm sobre o SALDO, não sobre o valor cheio (migr. 422). Em
    // 'Parcial' o `valor_pago` é só principal — a baixa parcial não carrega
    // encargos —, então a subtração fecha com o que o banco calcula.
    juros: calcularJuros(saldoEmAberto(c), c.vencimento, c.status, jurosCfg),
    recebido: c.status === 'Parcial' ? Number(c.valor_pago ?? 0) : 0,
  }));

  // Período e busca já vêm filtrados do servidor. O filtro que existia aqui
  // repetia o trabalho sobre a página atual e incluía `cliente?.nome`, que o
  // servidor já havia descartado — buscar por cliente devolvia lista vazia.
  const filtered = enriched;

  const exportCols = ['Empresa', 'Descrição', 'Cliente', 'Valor (R$)', 'Vencimento', 'Status'];
  const buildExportRows = (rows: any[]) => rows.map((c: any) => [
    c.filial ?? '—',
    c.descricao ?? '—',
    c.cliente?.nome ?? '—',
    c.juros.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    c.vencimento ?? '—',
    c.status ?? '—',
  ]);

  const fetchAllForExport = async (): Promise<any[]> => {
    if (!supabase) return [];
    let q = supabase.from('contas_receber').select('*').eq('ativo', true).eq('filial', filial).order('vencimento', { ascending: true });
    if (periodoRange) q = (q as any).gte('vencimento', periodoRange.inicio).lte('vencimento', periodoRange.fim);
    const { data: rows, error: err } = await q;
    if (err) throw new Error(err.message);
    return (rows ?? []).map((c: any) => ({
      ...c,
      cliente: clientes.find((cl: any) => cl.id === c.cliente_id),
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
      const titulo = `Contas a Receber — ${filial}${periodoLabel}`;

      // Padrão dos relatórios da casa: faixa preta, filete dourado
      // e LogMax em dourado (`drawPdfHeader`, em viewUtils).
      drawPdfHeader(doc, 'Relatório Financeiro', titulo, `Gerado em: ${new Date().toLocaleString('pt-BR')} · ${allData.length} registros`);

      autoTable(doc, {
        startY: 40,
        head: [exportCols],
        body: buildExportRows(allData),
        theme: 'grid',
        headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: GRAY_INK, fontSize: 8 },
        alternateRowStyles: { fillColor: GOLD_TINT },
      });

      doc.save(`logmax-contas-receber-${exportSlug}.pdf`);
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
      await exportToExcel('Contas a Receber', exportCols, buildExportRows(allData), `logmax-contas-receber-${exportSlug}`);
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar Excel.', 'error', true);
    } finally {
      setIsExporting(false);
    }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ descricao: item.descricao ?? '' });
    setExtras({ valor: item.valor != null && item.valor !== '' ? formatBRL(Number(item.valor)) : '', vencimento: item.vencimento ?? '', cliente_id: item.cliente_id ?? '', filial });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ descricao: '' });
    setExtras({ valor: '', vencimento: '', cliente_id: '', filial });
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    const payload = {
      descricao: form.descricao,
      valor: parseBRL(extras.valor),
      vencimento: extras.vencimento || null,
      cliente_id: extras.cliente_id || null,
      filial: extras.filial || FILIAL_DEFAULT,
    };
    try {
      if (editItem) {
        const updated = await dbUpdate('/api/contasreceberview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/contasreceberview', { ...payload, status: 'Aberto' });
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload, status: 'Aberto' }, ...prev]);
        showToast('Conta a Receber criada!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[ContasReceber] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const openReceber = (conta: any) => {
    setReceivingId(conta.id);
    setRecBankId('');
    setRecValor(formatBRL(Number(conta.juros?.total ?? conta.valor ?? 0)));
  };

  const closeReceber = () => {
    setReceivingId(null);
    setRecBankId('');
    setRecValor('');
  };

  const handleConfirmarRecebimento = async (conta: any) => {
    if (!recBankId) { showToast('Selecione a conta bancária de crédito.', 'error', true); return; }
    const banco = bancos.find((b: any) => b.id === recBankId);
    if (!banco) { showToast('Conta bancária não encontrada.', 'error', true); return; }
    const valorInformado = parseBRL(recValor);
    if (!(valorInformado > 0)) { showToast('Informe o valor recebido.', 'error', true); return; }
    if (!supabase) return;
    setRecSaving(true);
    try {
      // Juros/multa continuam calculados pelo BANCO (migr. 267); a diferença é
      // que agora o valor recebido vai junto e pode ser menor que o devido —
      // a RPC decide se quita ou deixa a conta em 'Parcial' (migr. 422).
      const { data: baixa, error } = await supabase.rpc('baixar_conta_receber', {
        p_conta_id: conta.id,
        p_banco_id: recBankId,
        p_valor:    valorInformado,
      });

      // Turma com a migr. 422 ainda pendente: a RPC não existe. Em vez de
      // deixar o caixa sem botão, cai no caminho antigo quando o valor é o
      // total — que é exatamente o que ele sabia fazer. Baixa parcial aí não
      // tem como acontecer, e dizer isso é melhor que um erro de PostgREST.
      if (error && /baixar_conta_receber/i.test(error.message ?? '')) {
        const quitandoTudo = valorInformado >= Number(conta.juros?.total ?? 0) - 0.005;
        if (!quitandoTudo) {
          throw new Error('Baixa parcial ainda não está disponível nesta turma (migração 422 pendente). Receba o valor total ou peça ao professor para aplicar a migração.');
        }
        const { data: legado, error: erroLegado } = await supabase.rpc('registrar_pagamento_conta', {
          p_tipo: 'receber', p_conta_id: conta.id, p_banco_id: recBankId,
        });
        if (erroLegado) throw new Error(erroLegado.message);
        const total = Number((legado as any)?.total ?? 0);
        setData((prev: any[]) => prev.map(d => d.id === conta.id
          ? { ...d, status: 'Pago', banco_id: recBankId, valor_pago: total }
          : d));
        setBancos((prev: any[]) => prev.map((b: any) => b.id === recBankId
          ? { ...b, saldo: Number(b.saldo ?? 0) + total } : b));
        showToast(`Recebimento de R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} creditado em ${banco.banco ?? banco.conta}. Conta quitada.`, 'success', true);
        closeReceber();
        return;
      }
      if (error) throw new Error(error.message);

      const quitada  = !!(baixa as any)?.quitada;
      const entrou   = Number((baixa as any)?.recebido_agora ?? 0);
      const total    = Number((baixa as any)?.recebido_total ?? entrou);
      const juros    = Number((baixa as any)?.juros ?? 0);
      const multa    = Number((baixa as any)?.multa ?? 0);
      const restante = Number((baixa as any)?.saldo_restante ?? 0);

      setData((prev: any[]) => prev.map(d => d.id === conta.id
        ? {
            ...d,
            status:     quitada ? 'Pago' : 'Parcial',
            banco_id:   recBankId,
            valor_pago: total,
            juros_pago: Number(d.juros_pago ?? 0) + juros,
            multa_pago: Number(d.multa_pago ?? 0) + multa,
          }
        : d));
      // O saldo do banco anda pelo que entrou AGORA — o trigger credita a
      // diferença, não o acumulado.
      setBancos((prev: any[]) => prev.map((b: any) => b.id === recBankId
        ? { ...b, saldo: Number(b.saldo ?? 0) + entrou }
        : b,
      ));

      const msgJuros = (juros + multa) > 0
        ? ` (inclui R$ ${(juros + multa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} de juros/multa)`
        : '';
      showToast(
        quitada
          ? `Recebimento de R$ ${entrou.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${msgJuros} creditado em ${banco.banco ?? banco.conta}. Conta quitada.`
          : `Baixa parcial de R$ ${entrou.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} creditada em ${banco.banco ?? banco.conta}. Restam R$ ${restante.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em aberto.`,
        'success', true,
      );
      closeReceber();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao registrar recebimento.', 'error', true);
    } finally {
      setRecSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Excluir esta conta?')) return;
    try {
      await dbDelete('/api/contasreceberview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Conta excluída.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[ContasReceber] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  const formEdicaoRef = useRolarAteFormulario(isFormOpen, editItem?.id);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Contas a Receber — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Total em aberto: <span className="text-accent font-bold">R$ {totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
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
            <input type="text" placeholder="Buscar por descrição ou status..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={handleExportPDF} disabled={isExporting} title="Exportar PDF — todas as contas" className="btn-solido btn-solido--vermelho"><FileDown size={15} /> {isExporting ? '…' : 'PDF'}</button>
          <button onClick={handleExportExcel} disabled={isExporting} title="Exportar Excel — todas as contas" className="btn-solido btn-solido--verde"><Sheet size={15} /> {isExporting ? '…' : 'Excel'}</button>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div ref={formEdicaoRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta a Receber'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Descrição *" error={errors.descricao}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao} onChange={e => { setForm(f => ({ ...f, descricao: e.target.value })); clearError('descricao'); }}
                    placeholder="Ex: Serviço prestado" />
                </FormField>
                <FormField label="Valor (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                    value={extras.valor} onChange={e => setExtras(x => ({ ...x, valor: formatBRL(e.target.value) }))} onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                </FormField>
                <FormField label="Vencimento">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.vencimento} onChange={e => setExtras(x => ({ ...x, vencimento: e.target.value }))} />
                </FormField>
                <FormField label="Cliente">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.cliente_id} onChange={e => setExtras(x => ({ ...x, cliente_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {groupCadastrosParaSelect(clientes).map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
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

      {isLoading ? <LoadingSpinner /> : (error || filtered.length === 0) ? <EmptyState error={error} message="Nenhuma conta a receber" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Cliente</th>
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
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">{item.cliente?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.cliente?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          <div>R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                          {item.recebido > 0 && (
                            <div className="text-[10px] text-emerald-400 mt-0.5"
                              title="Já recebido em baixas anteriores. O valor acima é o do documento e não muda.">
                              − R$ {item.recebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} recebido
                            </div>
                          )}
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
                          <div className="flex justify-center items-center gap-1.5">
                            {/* Título de cartão não recebe por aqui: quem paga é
                                a adquirente, e ela desconta a taxa. O banco
                                recusa a baixa (migr. 571) — o botão sai da frente
                                em vez de levar o aluno a um erro. */}
                            {RECEBIVEL.has(item.status) && (item.exige_conciliacao ? (
                              <span
                                title="Recebimento de cartão entra por Financeiro → Conciliação da Maquininha, que credita o líquido e lança a taxa como despesa."
                                className="py-1.5 px-3 rounded-lg text-xs font-bold text-cyan-400/80 border border-cyan-400/20 flex items-center gap-1 cursor-help">
                                <CreditCard size={11} /> Via conciliação
                              </span>
                            ) : (
                              <button onClick={() => openReceber(item)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1">
                                <Check size={11} /> {item.status === 'Parcial' ? 'Receber saldo' : 'Receber'}
                              </button>
                            ))}
                            <button onClick={() => openEdit(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                            <MenuMais>
                              {fechar => (
                                <>
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="contas_receber" entidadeId={item.id} titulo={item.descricao} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  <ItemMenu onClick={() => { fechar(); handleDelete(item.id); }}
                                    cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                    Excluir
                                  </ItemMenu>
                                </>
                              )}
                            </MenuMais>
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {receivingId === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
                                {/* A conta da baixa, aberta: documento, o que já
                                    entrou, encargos e quanto se cobra hoje. */}
                                <div className="basis-full flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 -mt-1">
                                  <span>Documento: <strong className="text-gray-200">R$ {Number(item.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                                  {item.recebido > 0 && (
                                    <span>Já recebido: <strong className="text-emerald-300">R$ {item.recebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                                  )}
                                  {(item.juros.juros + item.juros.multa) > 0 && (
                                    <span>Juros + multa: <strong className="text-red-300">R$ {(item.juros.juros + item.juros.multa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                                  )}
                                  <span>Devido hoje: <strong className="text-accent">R$ {Number(item.juros.total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                                </div>
                                <div className="flex flex-col gap-1 sm:w-44">
                                  <label htmlFor={`rec-valor-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Valor recebido *</label>
                                  <input id={`rec-valor-${item.id}`} type="text" inputMode="numeric"
                                    className="neu-input py-2 px-3 rounded-xl text-xs w-full text-right tabular-nums font-bold"
                                    value={recValor}
                                    onChange={e => setRecValor(formatBRL(e.target.value))}
                                    onKeyDown={handleMoneyKeyDown} />
                                  <span className="text-[10px] text-gray-500">
                                    {parseBRL(recValor) > 0 && parseBRL(recValor) < Number(item.juros.total ?? 0) - 0.005
                                      ? `Baixa parcial — restam R$ ${(Number(item.juros.total ?? 0) - parseBRL(recValor)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
                                      : 'Recebe tudo e quita a conta.'}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[220px]">
                                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Landmark size={11} /> Conta bancária de crédito *</label>
                                  <select className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={recBankId} onChange={e => setRecBankId(e.target.value)}>
                                    <option value="">Selecione...</option>
                                    {bancosAtivos.map((b: any) => (
                                      <option key={b.id} value={b.id}>
                                        {(b.banco ?? b.conta ?? '—')} — saldo R$ {Number(b.saldo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </option>
                                    ))}
                                  </select>
                                  {bancosAtivos.length === 0 && (
                                    <span className="text-[10px] text-yellow-400 mt-1">Nenhum caixa/banco ativo em {filial}. Cadastre em Financeiro → Caixa / Bancos.</span>
                                  )}
                                </div>
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmarRecebimento(item)} disabled={recSaving || !recBankId}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {recSaving ? 'Confirmando...' : <><Check size={12} /> Confirmar recebimento</>}
                                  </button>
                                  <button onClick={closeReceber} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center gap-1"><X size={11} /> Cancelar</button>
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

export const ContasReceberView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  // Sem filial ativa é modo Matriz — mesma correção da ContasPagarView: o
  // `null` virava `.eq('filial', null)` e escondia tudo o que é da holding.
  return <ContasReceberViewInner showToast={showToast} filial={filialAtiva ?? 'Matriz'} />;
};
