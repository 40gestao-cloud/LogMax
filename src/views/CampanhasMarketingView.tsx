import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Edit3, TrendingUp, TrendingDown, Target, Calendar, DollarSign } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { hasSetor } from '../lib/rbac';
import { FILIAIS_HOLDING } from '../lib/filiais';

const STATUS_STYLE: Record<string, string> = {
  'Rascunho':   'bg-gray-500/10  text-gray-400  border-gray-500/20',
  'Ativa':      'bg-accent/10    text-accent    border-accent/20',
  'Concluída':  'bg-blue-500/10  text-blue-400  border-blue-500/20',
  'Cancelada':  'bg-red-500/10   text-red-500   border-red-500/20',
};
const STATUS_OPTIONS = ['Rascunho', 'Ativa', 'Concluída', 'Cancelada'] as const;

const EMPTY_FORM = {
  nome: '',
  descricao: '',
  objetivo: '',
  filial: '',
  data_inicio: '',
  data_fim: '',
  orcamento: '',
  status: 'Rascunho' as typeof STATUS_OPTIONS[number],
};

type Campanha = {
  id: string;
  nome: string;
  descricao: string | null;
  objetivo: string | null;
  filial: string | null;
  data_inicio: string;
  data_fim: string;
  orcamento: number;
  gasto_real: number;
  status: typeof STATUS_OPTIONS[number];
  nome_criador: string | null;
  created_at: string;
};

type RoiRow = {
  id: string;
  receita: number;
  vendas_count: number;
  ticket_medio: number;
  orcamento: number;
  gasto_real: number;
  roi_percent: number | null;
};

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const CampanhasMarketingView = ({ showToast, profile }: any) => {
  const { data: campanhas, setData, isLoading } = useFetchData<Campanha>('/api/marketingcampanhasview');
  const { data: roi } = useFetchData<RoiRow>('/api/campanharoiview');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campanha | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // CRUD de campanhas é privilégio de Marketing + admin/CEO. Financeiro
  // tb pode atualizar (pra lançar `gasto_real`), mas a UI desse fluxo
  // vive na coluna "Gasto real" da tabela — não no botão "+ Nova".
  const canCRUD       = hasSetor(profile, 'marketing');
  const canEditarGasto = canCRUD || hasSetor(profile, 'financeiro');

  const roiMap = useMemo(() => {
    const m: Record<string, RoiRow> = {};
    for (const r of roi ?? []) m[r.id] = r;
    return m;
  }, [roi]);

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setShowForm(false); };

  const openEdit = (c: Campanha) => {
    setEditing(c);
    setForm({
      nome:        c.nome,
      descricao:   c.descricao ?? '',
      objetivo:    c.objetivo ?? '',
      filial:      c.filial ?? '',
      data_inicio: c.data_inicio,
      data_fim:    c.data_fim,
      orcamento:   c.orcamento ? formatBRL(c.orcamento) : '',
      status:      c.status,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim())     { showToast('Informe o nome da campanha.', 'error'); return; }
    if (!form.data_inicio)     { showToast('Informe o início.', 'error'); return; }
    if (!form.data_fim)        { showToast('Informe o fim.', 'error'); return; }
    if (form.data_fim < form.data_inicio) { showToast('Fim não pode ser anterior ao início.', 'error'); return; }

    setSaving(true);
    try {
      const payload: any = {
        nome:        form.nome.trim(),
        descricao:   form.descricao.trim() || null,
        objetivo:    form.objetivo.trim() || null,
        filial:      form.filial || null,
        data_inicio: form.data_inicio,
        data_fim:    form.data_fim,
        orcamento:   parseBRL(form.orcamento || '0'),
        status:      form.status,
      };

      if (editing) {
        const updated = await dbUpdate('/api/marketingcampanhasview', editing.id, payload);
        setData((prev: any[]) => prev.map((c: any) => c.id === editing.id ? { ...c, ...updated } : c));
        showToast('Campanha atualizada.', 'success');
      } else {
        payload.nome_criador = profile?.nome ?? '';
        payload.criado_por   = profile?.id ?? null;
        const created = await dbInsert('/api/marketingcampanhasview', payload);
        setData((prev: any[]) => [created, ...prev]);
        showToast('Campanha criada.', 'success');
      }
      resetForm();
    } catch (err: any) {
      console.error('[Campanhas] salvar:', err);
      showToast(`Erro ao salvar: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const handleAjustarGasto = async (c: Campanha) => {
    const atual = formatBRL(c.gasto_real);
    const novo = prompt(`Gasto real da campanha "${c.nome}" (atual: R$ ${atual}):`, atual);
    if (novo == null) return;
    const valor = parseBRL(novo);
    if (Number.isNaN(valor) || valor < 0) { showToast('Valor inválido.', 'error'); return; }
    try {
      const updated = await dbUpdate('/api/marketingcampanhasview', c.id, { gasto_real: valor } as any);
      setData((prev: any[]) => prev.map((x: any) => x.id === c.id ? { ...x, ...updated } : x));
      showToast('Gasto atualizado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const handleDelete = async (c: Campanha) => {
    if (!confirm(`Inativar a campanha "${c.nome}"?`)) return;
    try {
      await dbDelete('/api/marketingcampanhasview', c.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== c.id));
      showToast('Campanha inativada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const ativas = campanhas.filter((c: any) => c.status === 'Ativa').length;
  const orcamentoTotal = campanhas.reduce((s: number, c: any) => s + Number(c.orcamento || 0), 0);
  const gastoTotal     = campanhas.reduce((s: number, c: any) => s + Number(c.gasto_real || 0), 0);
  const receitaTotal   = (roi ?? []).reduce((s: number, r: RoiRow) => s + Number(r.receita || 0), 0);

  const kpis = [
    { label: 'Total de Campanhas',  value: String(campanhas.length) },
    { label: 'Ativas',              value: String(ativas) },
    { label: 'Orçamento × Gasto',   value: `${fmtBRL(gastoTotal)} / ${fmtBRL(orcamentoTotal)}` },
    { label: 'Receita Atribuída',   value: fmtBRL(receitaTotal) },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Campanhas</h2>
        <p className="text-sm text-gray-400 mt-1">
          Planeje campanhas com orçamento e período, acompanhe ROI cruzando vendas no período e cupons usados.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className="text-lg sm:text-xl font-black text-gray-100 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end shrink-0">
        {canCRUD && (
          <NeuButtonAccent variant="" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={14} />Nova Campanha
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Campanha' : 'Nova Campanha'}</h3>
              <button onClick={resetForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label htmlFor="camp-nome" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome *</label>
                <input id="camp-nome" type="text" value={form.nome}
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Verão 2026" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="camp-status" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                <select id="camp-status" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="camp-inicio" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início *</label>
                <input id="camp-inicio" type="date" value={form.data_inicio}
                  onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="camp-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim *</label>
                <input id="camp-fim" type="date" value={form.data_fim}
                  onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="camp-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial-alvo</label>
                <select id="camp-filial" value={form.filial}
                  onChange={e => setForm(f => ({ ...f, filial: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Todas (holding)</option>
                  {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="camp-orcamento" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Orçamento (R$)</label>
                <input id="camp-orcamento" type="text" inputMode="numeric" value={form.orcamento}
                  onChange={e => setForm(f => ({ ...f, orcamento: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="0,00" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="camp-objetivo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Objetivo</label>
                <input id="camp-objetivo" type="text" value={form.objetivo}
                  onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: aumentar ticket médio em 15%" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="camp-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <textarea id="camp-descricao" value={form.descricao} rows={2}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                  placeholder="Detalhes pra equipe (canais, peças, calendário, etc.)" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetForm} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : (editing ? 'Salvar' : 'Criar Campanha')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {campanhas.length === 0 ? <EmptyState message="Nenhuma campanha criada ainda" /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4">Filial</th>
                  <th className="pb-4 font-bold px-4">Período</th>
                  <th className="pb-4 font-bold px-4 text-right">Orçamento</th>
                  <th className="pb-4 font-bold px-4 text-right">Gasto Real</th>
                  <th className="pb-4 font-bold px-4 text-right">Receita</th>
                  <th className="pb-4 font-bold px-4 text-right">Vendas</th>
                  <th className="pb-4 font-bold px-4 text-right">ROI</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {campanhas.map((c: any) => {
                    const r = roiMap[c.id];
                    const receita = Number(r?.receita ?? 0);
                    const vendas  = Number(r?.vendas_count ?? 0);
                    const roiPct  = r?.roi_percent ?? null;
                    const roiPositivo = roiPct != null && roiPct > 0;
                    const roiNegativo = roiPct != null && roiPct < 0;
                    return (
                      <motion.tr key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4">
                          <p className="text-sm font-semibold text-gray-200 max-w-[220px] truncate" title={c.nome}>{c.nome}</p>
                          {c.objetivo && <p className="text-[10px] text-gray-500 max-w-[220px] truncate" title={c.objetivo}><Target size={9} className="inline mr-1" />{c.objetivo}</p>}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">{c.filial ?? 'Holding'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">
                          <Calendar size={9} className="inline mr-1" />
                          {c.data_inicio} → {c.data_fim}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">{fmtBRL(c.orcamento)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-right tabular-nums">
                          <button
                            disabled={!canEditarGasto}
                            onClick={() => canEditarGasto && handleAjustarGasto(c)}
                            className={canEditarGasto ? 'text-gray-100 hover:text-accent transition-colors' : 'text-gray-300 cursor-default'}
                            title={canEditarGasto ? 'Clique pra ajustar' : 'Apenas marketing/financeiro'}
                          >
                            {fmtBRL(c.gasto_real)}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-accent text-right font-bold tabular-nums">{fmtBRL(receita)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">{vendas}</td>
                        <td className="py-3 px-4 text-xs font-mono text-right tabular-nums">
                          {roiPct == null ? (
                            <span className="text-gray-600">—</span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 font-bold ${
                              roiPositivo ? 'text-accent' : roiNegativo ? 'text-red-400' : 'text-gray-300'
                            }`}>
                              {roiPositivo && <TrendingUp size={11} />}
                              {roiNegativo && <TrendingDown size={11} />}
                              {roiPct > 0 ? '+' : ''}{roiPct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[c.status]}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canCRUD && (
                              <>
                                <button onClick={() => openEdit(c)} title="Editar" className="action-btn-edit">
                                  <Edit3 size={12} />
                                </button>
                                <button onClick={() => handleDelete(c)} title="Inativar" className="action-btn-delete">
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="neu-flat rounded-2xl p-4 border border-white/5 shrink-0">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2 flex items-center gap-2">
          <DollarSign size={11} />Como o ROI é calculado
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          <strong className="text-gray-300">Receita</strong> soma todas as vendas concluídas que tocam a campanha — vendas no período + filial-alvo (Holding agrega todas as filiais) <strong>ou</strong> qualquer venda que tenha usado um cupom vinculado à campanha.
          {' '}<strong className="text-gray-300">ROI %</strong> = (Receita − Gasto Real) ÷ Gasto Real × 100. Sem gasto lançado, ROI fica em branco.
        </p>
      </div>
    </motion.div>
  );
};
