import { isConselheiro } from '../lib/rbac';
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, X as XIcon, Target, FileDown, Play, Pause, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { MenuMais, ItemMenu } from '../components/MenuMais';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { setorLabel } from '../lib/setores';
import { LoadingSpinner, EmptyState, NeuButtonAccent, CardContador, type TomContador, corDoStatus } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { GOLD, GOLD_DARK, BLACK } from '../lib/pdfPalette';

const CHIP_META = 'inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest whitespace-nowrap';
const statusCls = (s: string) => `${CHIP_META} ${corDoStatus(s)}`;

const metaResultCls   = (m: any) => `${CHIP_META} ${corDoStatus(m.pool_distribuido ? 'Concluído' : 'Negado')}`;
const metaResultLabel = (m: any) => m.pool_distribuido ? '✓ Alcançada' : '✗ Não alcançada';

const SETORES = ['vendas', 'logistica', 'financeiro', 'rh', 'marketing', 'ti', 'all'] as const;

const SETOR_OPCAO_LABEL: Record<string, string> = { all: 'Geral (todos)' };
const labelSetorOpcao = (s: string) => SETOR_OPCAO_LABEL[s] ?? setorLabel(s);

const EMPTY_META = {
  titulo: '',
  descricao: '',
  setor: '',
  nota: '',
  data_inicio: '',
  hora_inicio: '',
  data_fim: '',
  hora_fim: '',
};

export const MetasView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const { data: metas, setData: setMetas, isLoading: loadingMetas } =
    useFetchData<any>('/api/metasestrategicasview');

  const isAdmin   = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);
  const isGerente = profile?.role === 'gerente';

  const [showFormMeta, setShowFormMeta] = useState(false);
  const formMetaRef = useRef<HTMLDivElement>(null);
  const [formMeta, setFormMeta] = useState(EMPTY_META);
  const [savingMeta, setSavingMeta] = useState(false);
  const [editMetaId, setEditMetaId] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailMeta, setDetailMeta] = useState<any | null>(null);

  const podeCriarMeta = isAdmin;

  const handleCriarMeta = async () => {
    if (!supabase) return;
    if (!formMeta.titulo.trim() || !formMeta.data_inicio || !formMeta.data_fim) {
      showToast('Preencha título e período.', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      const { data: id, error } = await supabase.rpc('criar_meta_estrategica', {
        p_titulo:                        formMeta.titulo.trim(),
        p_descricao:                     formMeta.descricao.trim(),
        p_setor:                         formMeta.setor || null,
        p_bonificacao_equipe:            0,
        p_limite_bonificacao_individual: 0,
        p_data_inicio:                   formMeta.data_inicio,
        p_data_fim:                      formMeta.data_fim,
        p_hora_inicio:                   formMeta.hora_inicio || null,
        p_hora_fim:                      formMeta.hora_fim || null,
      });
      if (error) throw error;
      const notaVal = formMeta.nota ? parseFloat(formMeta.nota) : null;
      if (notaVal !== null) {
        await supabase.from('metas_estrategicas').update({ nota: notaVal }).eq('id', id);
      }
      const { data: nova } = await supabase.from('metas_estrategicas').select('*').eq('id', id).single();
      if (nova) setMetas((prev: any[]) => [nova, ...prev]);
      showToast('Meta estratégica criada.', 'success');
      setShowFormMeta(false);
      setFormMeta(EMPTY_META);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingMeta(false);
  };

  const handleConcluirMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Concluir esta meta? Esta ação não pode ser desfeita.')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('concluir_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Encerrada', pool_distribuido: true, concluida_em: new Date().toISOString() } : m));
      showToast('Meta concluída.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handleNaoAlcancadaMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Marcar esta meta como não alcançada?')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('cancelar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Encerrada', pool_distribuido: false } : m));
      showToast('Meta marcada como não alcançada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const abrirEdicaoMeta = (m: any) => {
    setEditMetaId(m.id);
    setFormMeta({
      titulo:      m.titulo ?? '',
      descricao:   m.descricao ?? '',
      setor:       m.setor ?? '',
      nota:        m.nota != null ? String(m.nota) : '',
      data_inicio: m.data_inicio ?? '',
      hora_inicio: m.hora_inicio ?? '',
      data_fim:    m.data_fim ?? '',
      hora_fim:    m.hora_fim ?? '',
    });
    setShowFormMeta(true);
    requestAnimationFrame(() => formMetaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const fecharFormMeta = () => {
    setShowFormMeta(false);
    setEditMetaId(null);
    setFormMeta(EMPTY_META);
  };

  const handleEditarMeta = async () => {
    if (!supabase || !editMetaId) return;
    if (!formMeta.titulo.trim() || !formMeta.data_inicio || !formMeta.data_fim) {
      showToast('Preencha título e período.', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      const { error } = await supabase.rpc('editar_meta_estrategica', {
        p_meta_id:                       editMetaId,
        p_titulo:                        formMeta.titulo.trim(),
        p_descricao:                     formMeta.descricao.trim(),
        p_setor:                         formMeta.setor || null,
        p_bonificacao_equipe:            0,
        p_limite_bonificacao_individual: 0,
        p_data_inicio:                   formMeta.data_inicio,
        p_data_fim:                      formMeta.data_fim,
        p_hora_inicio:                   formMeta.hora_inicio || null,
        p_hora_fim:                      formMeta.hora_fim || null,
      });
      if (error) throw error;
      const notaVal = formMeta.nota ? parseFloat(formMeta.nota) : null;
      await supabase.from('metas_estrategicas').update({ nota: notaVal }).eq('id', editMetaId);
      setMetas((prev: any[]) => prev.map(m => m.id === editMetaId ? {
        ...m,
        titulo:      formMeta.titulo.trim(),
        descricao:   formMeta.descricao.trim(),
        setor:       formMeta.setor || null,
        nota:        notaVal,
        hora_inicio: formMeta.hora_inicio || null,
        hora_fim:    formMeta.hora_fim || null,
        data_inicio: formMeta.data_inicio,
        data_fim:    formMeta.data_fim,
      } : m));
      showToast('Meta atualizada.', 'success');
      fecharFormMeta();
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingMeta(false);
  };

  const handleApagarMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Apagar esta meta? Esta ação não pode ser desfeita.')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('apagar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.filter(m => m.id !== id));
      showToast('Meta apagada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handlePublicarMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('publicar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Em Produção' } : m));
      showToast('Meta publicada — gerentes já conseguem visualizar.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handlePausarMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('pausar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Pausada' } : m));
      showToast('Meta pausada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handleReabrirMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('reabrir_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Em Produção', concluida_em: null } : m));
      showToast('Meta reaberta — está Em Produção novamente.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const gerarPdfMeta = async (m: any) => {
    if (!await confirm({ message: `Baixar PDF da meta "${m.titulo || m.descricao}"?`, confirmLabel: 'Baixar', danger: false })) return;
    const { jsPDF } = await import('jspdf');
    const { applyPlugin } = await import('jspdf-autotable');
    applyPlugin(jsPDF);
    // Este PDF é em pontos, não em milímetros: o `drawPdfHeader` da casa
    // desenharia a faixa fora da página. O que se alinha aqui é a cor —
    // cabeçalho de tabela preto sobre dourado, como nos demais.
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    doc.setFontSize(11).setFont('helvetica', 'normal').setTextColor(...GOLD_DARK);
    doc.text('LogMax · Meta Estratégica', 40, 40);
    doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0);
    const titleLines = doc.splitTextToSize(m.titulo || m.descricao || '', 515);
    doc.text(titleLines, 40, 56);

    let afterTitle = 56 + titleLines.length * 20 + 6;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(100);
    doc.text(`Status: ${m.status}`, 40, afterTitle);
    afterTitle += 18;
    doc.setTextColor(0);

    let afterDesc = afterTitle;
    if (m.descricao && m.titulo) {
      doc.setFontSize(10).setFont('helvetica', 'bold');
      doc.text('Descrição', 40, afterDesc);
      afterDesc += 14;
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const descLines = doc.splitTextToSize(m.descricao ?? '', 515);
      doc.text(descLines, 40, afterDesc);
      afterDesc += descLines.length * 14 + 12;
    }

    (doc as any).autoTable({
      startY: afterDesc,
      head: [['Campo', 'Valor']],
      body: [
        ['Setor alvo', m.setor ? labelSetorOpcao(m.setor) : 'Todos os setores'],
        ['Período', `${m.data_inicio} → ${m.data_fim}`],
        ...(m.nota != null ? [['Nota', String(m.nota)]] : []),
        ...(m.status === 'Encerrada' ? [['Resultado', m.pool_distribuido ? 'Alcançada' : 'Não alcançada']] : []),
      ],
      headStyles: { fillColor: BLACK, textColor: GOLD, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 200, fontStyle: 'bold' } },
      margin: { left: 40, right: 40 },
    });

    doc.save(`meta-estrategica-${m.id?.slice(0, 8) ?? 'doc'}.pdf`);
  };

  if (loadingMetas) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  const kpisMetas = [
    { tom: 'azul' as TomContador, label: 'Em Produção',    value: metas.filter((m: any) => m.status === 'Em Produção').length },
    { tom: 'verde' as TomContador, label: 'Alcançadas',     value: metas.filter((m: any) => m.status === 'Encerrada' && m.pool_distribuido).length },
    { tom: 'vermelho' as TomContador, label: 'Não alcançadas', value: metas.filter((m: any) => m.status === 'Encerrada' && !m.pool_distribuido).length },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      {/* Título */}
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Metas</h2>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 shrink-0 grid-cols-1 sm:grid-cols-3">
        {kpisMetas.map((k: any) => (
          <CardContador key={k.label} label={k.label} value={k.value} sub={k.sub} tom={k.tom} />
        ))}
      </div>

      {/* Botão criar */}
      {podeCriarMeta && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={() => { if (showFormMeta) fecharFormMeta(); else { setEditMetaId(null); setFormMeta(EMPTY_META); setShowFormMeta(true); requestAnimationFrame(() => formMetaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); } }}>
            <Plus size={14} />{showFormMeta ? 'Cancelar' : 'Nova Meta Estratégica'}
          </NeuButtonAccent>
        </div>
      )}

      {/* Form Meta Estratégica */}
      <AnimatePresence>
        {showFormMeta && podeCriarMeta && (
          <motion.div ref={formMetaRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 scroll-mt-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editMetaId ? 'Editar Meta Estratégica' : 'Nova Meta Estratégica'}</h3>
              {!editMetaId && (
                <span className="text-[10px] bg-gray-700/50 text-gray-400 px-2.5 py-1 rounded-lg border border-white/5">
                  Salva como Rascunho — publique quando quiser enviar aos gerentes
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input value={formMeta.titulo}
                  onChange={e => setFormMeta(p => ({ ...p, titulo: e.target.value }))}
                  placeholder="Ex.: Aumentar vendas Q3"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nota (pontuação)</label>
                <input type="number" step="0.1" min="0" value={formMeta.nota}
                  onChange={e => setFormMeta(p => ({ ...p, nota: e.target.value }))}
                  placeholder="Ex.: 10"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <textarea value={formMeta.descricao}
                  onChange={e => setFormMeta(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Detalhes, critérios, contexto..."
                  rows={3}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor alvo</label>
                <select value={formMeta.setor}
                  onChange={e => setFormMeta(p => ({ ...p, setor: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Todos os setores</option>
                  {SETORES.map(s => <option key={s} value={s}>{labelSetorOpcao(s)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de início *</label>
                <input type="date" value={formMeta.data_inicio}
                  onChange={e => setFormMeta(p => ({ ...p, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de início</label>
                <input type="time" value={formMeta.hora_inicio}
                  onChange={e => setFormMeta(p => ({ ...p, hora_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de fim *</label>
                <input type="date" value={formMeta.data_fim}
                  onChange={e => setFormMeta(p => ({ ...p, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de fim</label>
                <input type="time" value={formMeta.hora_fim}
                  onChange={e => setFormMeta(p => ({ ...p, hora_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={editMetaId ? handleEditarMeta : handleCriarMeta} disabled={savingMeta}>
                {savingMeta ? 'Salvando...' : (editMetaId ? 'Salvar Alterações' : 'Salvar Rascunho')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista — Metas Estratégicas */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {metas.length === 0 ? (
          <EmptyState message={podeCriarMeta ? 'Nenhuma meta estratégica criada. Comece pela primeira.' : 'Nenhuma meta ativa pro seu setor.'} />
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[820px]">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Descrição</th>
                <th className="pb-4 font-bold px-4">Setor</th>
                <th className="pb-4 font-bold px-4 text-center">Nota</th>
                <th className="pb-4 font-bold px-4 text-center">Período</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4">Ações</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {metas.map((m: any) => (
                    <motion.tr key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      onClick={() => setDetailMeta(m)}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                        <div className="flex items-center gap-2">
                          <Target size={13} className="text-accent shrink-0" />
                          <span className="truncate" title="Clique para ver detalhes">{m.titulo || m.descricao}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-300">{m.setor ? labelSetorOpcao(m.setor) : <span className="text-gray-500 italic">Todos</span>}</td>
                      <td className="py-3 px-4 text-center">
                        {m.nota != null
                          ? <span className="text-sm font-bold text-accent">{m.nota}</span>
                          : <span className="text-gray-600 text-xs">—</span>
                        }
                      </td>
                      <td className="py-3 px-4 text-[10px] font-mono text-center text-gray-400">{m.data_inicio} → {m.data_fim}</td>
                      <td className="py-3 px-4 text-center">
                        {m.status === 'Encerrada'
                          ? <span className={metaResultCls(m)}>{metaResultLabel(m)}</span>
                          : <span className={statusCls(m.status)}>{m.status}</span>
                        }
                      </td>
                      <td className="py-3 px-4">
                        {/* Editar à vista; o resto da vida da meta (publicar,
                            concluir, pausar, reabrir, apagar, PDF) vai no "⋯",
                            cada ação com o nome dela — eram até 8 ícones coloridos. */}
                        <div className="flex gap-1.5 justify-center items-center" onClick={e => e.stopPropagation()}>
                          {isAdmin && (m.status === 'Rascunho' || m.status === 'Em Produção') && (
                            <button onClick={() => abrirEdicaoMeta(m)} disabled={busyId === m.id}
                              className="action-btn-edit" title="Editar meta">
                              <Pencil size={12} />
                            </button>
                          )}
                          {(isAdmin || isGerente) && (
                            <MenuMais>
                              {fechar => (
                                <>
                                  <ItemMenu onClick={() => { fechar(); gerarPdfMeta(m); }} cor="text-gray-200 hover:bg-white/5" icon={FileDown}>
                                    Baixar PDF
                                  </ItemMenu>
                                  {isAdmin && (m.status === 'Rascunho' || m.status === 'Pausada') && (
                                    <ItemMenu onClick={() => { fechar(); handlePublicarMeta(m.id); }} disabled={busyId === m.id}
                                      cor="text-emerald-400 hover:bg-emerald-500/10" icon={Play}>
                                      {m.status === 'Rascunho' ? 'Publicar para os gerentes' : 'Retomar'}
                                    </ItemMenu>
                                  )}
                                  {isAdmin && m.status === 'Em Produção' && (
                                    <>
                                      <ItemMenu onClick={() => { fechar(); handleConcluirMeta(m.id); }} disabled={busyId === m.id}
                                        cor="text-emerald-400 hover:bg-emerald-500/10" icon={Check}>
                                        Marcar como alcançada
                                      </ItemMenu>
                                      <ItemMenu onClick={() => { fechar(); handleNaoAlcancadaMeta(m.id); }} disabled={busyId === m.id}
                                        cor="text-red-400 hover:bg-red-500/10" icon={XIcon}>
                                        Marcar como não alcançada
                                      </ItemMenu>
                                      <ItemMenu onClick={() => { fechar(); handlePausarMeta(m.id); }} disabled={busyId === m.id}
                                        cor="text-purple-300 hover:bg-purple-500/10" icon={Pause}>
                                        Pausar
                                      </ItemMenu>
                                    </>
                                  )}
                                  {isAdmin && m.status === 'Encerrada' && (
                                    <ItemMenu onClick={() => { fechar(); handleReabrirMeta(m.id); }} disabled={busyId === m.id}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={RefreshCw}>
                                      Reabrir meta
                                    </ItemMenu>
                                  )}
                                  {isAdmin && m.status !== 'Encerrada' && (
                                    <ItemMenu onClick={() => { fechar(); handleApagarMeta(m.id); }} disabled={busyId === m.id}
                                      cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                      Apagar meta
                                    </ItemMenu>
                                  )}
                                </>
                              )}
                            </MenuMais>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal detalhe */}
      <AnimatePresence>
        {detailMeta && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setDetailMeta(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-lg w-full max-h-[85vh] overflow-y-auto main-scrollbar">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Target size={16} className="text-accent shrink-0" />
                  <h3 className="text-base font-bold text-gray-200">Meta Estratégica</h3>
                </div>
                {detailMeta.status === 'Encerrada'
                  ? <span className={`shrink-0 ${metaResultCls(detailMeta)}`}>{metaResultLabel(detailMeta)}</span>
                  : <span className={`shrink-0 ${statusCls(detailMeta.status)}`}>{detailMeta.status}</span>
                }
              </div>
              <div className="mb-3">
                <p className="text-lg font-bold text-gray-100 leading-snug">{detailMeta.titulo || detailMeta.descricao}</p>
              </div>
              {detailMeta.descricao && detailMeta.titulo && (
                <div className="mb-5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Descrição</p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">{detailMeta.descricao}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Setor alvo</p>
                  <p className="text-sm text-gray-200">{detailMeta.setor ? labelSetorOpcao(detailMeta.setor) : <span className="text-gray-500 italic">Todos</span>}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Período</p>
                  <p className="text-sm font-mono text-gray-200">{detailMeta.data_inicio}{detailMeta.hora_inicio ? ` ${detailMeta.hora_inicio}` : ''} → {detailMeta.data_fim}{detailMeta.hora_fim ? ` ${detailMeta.hora_fim}` : ''}</p>
                </div>
                {detailMeta.nota != null && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Nota</p>
                    <p className="text-xl font-black text-accent">{detailMeta.nota}</p>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center">
                {(isAdmin || isGerente) && (
                  <button onClick={() => gerarPdfMeta(detailMeta)}
                    className="btn-solido btn-solido--vermelho">
                    <FileDown size={13} />PDF
                  </button>
                )}
                <button onClick={() => setDetailMeta(null)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors ml-auto">Fechar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
