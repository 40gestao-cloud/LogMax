import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, X as XIcon, Target, MessageSquare, Award, Settings } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

const statusCls = (s: string) => {
  if (s === 'Aprovada')  return 'bg-green-900/30 text-green-400';
  if (s === 'Rejeitada') return 'bg-red-950/50 text-red-500';
  if (s === 'Concluida') return 'bg-blue-900/30 text-blue-400';
  return 'bg-yellow-900/30 text-yellow-400'; // Pendente
};

const statusLabel = (s: string) => s === 'Concluida' ? 'Aguardando' : s;

type Profile = {
  id: string;
  nome: string | null;
  email: string | null;
  role?: string;
  setor?: string;
  setores_extras?: string[];
  filial?: string | null;
};

const EMPTY_FORM = { colaborador_id: '', descricao: '', valor: '', data_inicio: '', data_fim: '' };

export const MetasView = ({ showToast, profile }: any) => {
  const { data: metas, setData, isLoading } = useFetchData<any>('/api/maxbankmetasview');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [rejectMetaId, setRejectMetaId] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [busyMetaId, setBusyMetaId] = useState<string | null>(null);

  const [threshold, setThreshold] = useState<number>(2500);
  const [showThresholdEdit, setShowThresholdEdit] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [{ data: profs }, { data: cfg }] = await Promise.all([
        supabase.from('user_profiles')
          .select('id, nome, email, role, setor, setores_extras, filial')
          .order('nome', { ascending: true }),
        supabase.from('maxbank_config').select('meta_folga_threshold').eq('id', 1).maybeSingle(),
      ]);
      if (profs) setProfiles(profs as Profile[]);
      if (cfg?.meta_folga_threshold != null) setThreshold(Number(cfg.meta_folga_threshold));
      setLoadingProfiles(false);
    })();
  }, []);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'ceo';
  const isGerente = profile?.role === 'gerente';
  const isRH = hasSetor(profile, 'rh');
  const podeCriar = isAdmin || isGerente || isRH;

  // Colaboradores elegíveis pro select de "Atribuir a":
  // - admin/CEO/RH: todos (exceto admins)
  // - gerente: do(s) próprio(s) setor(es)
  const colaboradoresElegiveis = useMemo(() => {
    if (!podeCriar) return [];
    const setoresGerente = profile?.role === 'gerente'
      ? [profile.setor, ...(profile.setores_extras ?? [])].filter(Boolean)
      : null;
    return profiles
      .filter(p => p.id !== profile?.id)
      .filter(p => {
        if (isAdmin || isRH) return true;
        if (!setoresGerente) return false;
        const userSetores = [p.setor, ...(p.setores_extras ?? [])].filter(Boolean);
        return userSetores.some(s => setoresGerente.includes(s as any));
      });
  }, [profiles, profile, podeCriar, isAdmin, isRH]);

  const enriched = useMemo(() => metas.map((m: any) => ({
    ...m,
    colaborador: profiles.find(p => p.id === m.colaborador_id),
    criadora:    profiles.find(p => p.id === m.criada_por),
  })), [metas, profiles]);

  const pendentes  = metas.filter((m: any) => m.status === 'Pendente').length;
  const aguardando = metas.filter((m: any) => m.status === 'Concluida').length;
  const aprovadas  = metas.filter((m: any) => m.status === 'Aprovada').length;
  const totalBonus = metas
    .filter((m: any) => m.status === 'Aprovada')
    .reduce((acc: number, m: any) => acc + Number(m.valor || 0), 0);

  const closeForm = () => { setShowForm(false); setForm(EMPTY_FORM); };

  const handleCriar = async () => {
    if (!supabase) return;
    if (!form.colaborador_id || !form.descricao.trim() || !form.valor || !form.data_inicio || !form.data_fim) {
      showToast('Preencha todos os campos.', 'error');
      return;
    }
    const valor = parseBRL(form.valor);
    if (valor <= 0) { showToast('Valor deve ser positivo.', 'error'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('criar_meta_maxbank', {
        p_colaborador_id: form.colaborador_id,
        p_descricao:      form.descricao.trim(),
        p_valor:          valor,
        p_data_inicio:    form.data_inicio,
        p_data_fim:       form.data_fim,
      });
      if (error) throw error;
      // Refetch — a nova linha pode ainda não estar no cache local.
      const { data: nova } = await supabase
        .from('maxbank_metas').select('*').eq('id', data).single();
      if (nova) setData((prev: any[]) => [nova, ...prev]);
      showToast('Meta criada.', 'success');
      closeForm();
    } catch (err: any) {
      console.error('[Metas] erro ao criar:', err);
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSaving(false);
  };

  const handleConcluir = async (id: string) => {
    if (!supabase) return;
    setBusyMetaId(id);
    try {
      const { error } = await supabase.rpc('concluir_meta_maxbank', { p_meta_id: id });
      if (error) throw error;
      setData((prev: any[]) => prev.map(m => m.id === id
        ? { ...m, status: 'Concluida', concluida_em: new Date().toISOString() }
        : m));
      showToast('Marcada como concluída — aguarde aprovação.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyMetaId(null);
  };

  const handleAprovar = async (id: string) => {
    if (!supabase) return;
    setBusyMetaId(id);
    try {
      const { data, error } = await supabase.rpc('aprovar_meta_maxbank', { p_meta_id: id });
      if (error) throw error;
      const result = data as { folgas_geradas?: number } | null;
      setData((prev: any[]) => prev.map(m => m.id === id
        ? { ...m, status: 'Aprovada', aprovada_em: new Date().toISOString(), aprovada_por: profile?.id }
        : m));
      const folgas = Number(result?.folgas_geradas ?? 0);
      if (folgas > 0) {
        showToast(`Meta aprovada — bonificação creditada e ${folgas} folga(s) conquistada(s)!`, 'success');
      } else {
        showToast('Meta aprovada — bonificação creditada na carteira.', 'success');
      }
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyMetaId(null);
  };

  const handleRejeitar = async () => {
    if (!supabase || !rejectMetaId) return;
    if (!rejectFeedback.trim()) { showToast('Informe o motivo da rejeição.', 'error'); return; }
    setBusyMetaId(rejectMetaId);
    try {
      const { error } = await supabase.rpc('rejeitar_meta_maxbank', {
        p_meta_id:  rejectMetaId,
        p_feedback: rejectFeedback.trim(),
      });
      if (error) throw error;
      setData((prev: any[]) => prev.map(m => m.id === rejectMetaId
        ? { ...m, status: 'Rejeitada', feedback_aprovacao: rejectFeedback.trim(), aprovada_em: new Date().toISOString() }
        : m));
      showToast('Meta rejeitada.', 'success');
      setRejectMetaId(null);
      setRejectFeedback('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyMetaId(null);
  };

  const handleSaveThreshold = async () => {
    if (!supabase) return;
    const v = parseBRL(thresholdDraft);
    if (v <= 0) { showToast('Valor deve ser positivo.', 'error'); return; }
    setSavingThreshold(true);
    try {
      const { error } = await supabase.rpc('set_maxbank_threshold', { p_valor: v });
      if (error) throw error;
      setThreshold(v);
      setShowThresholdEdit(false);
      showToast('Limite da folga atualizado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingThreshold(false);
  };

  const podeAprovar = (m: any) => {
    if (!profile) return false;
    if (isAdmin || isRH) return true;
    if (!isGerente) return false;
    const userSetores = [profile.setor, ...(profile.setores_extras ?? [])].filter(Boolean);
    return userSetores.includes(m.setor);
  };

  if (isLoading || loadingProfiles) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Metas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Atribua metas com bonificação. A cada <span className="text-accent font-bold">{fmtBRL(threshold)}</span> acumulados em bonificações, o colaborador conquista uma folga.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => { setThresholdDraft(formatBRL(threshold)); setShowThresholdEdit(true); }}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-accent transition-colors px-3 py-2 neu-button rounded-xl">
            <Settings size={12} />Ajustar limite
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Em aberto', value: pendentes, warn: false },
          { label: 'Aguardando aprovação', value: aguardando, warn: aguardando > 0 },
          { label: 'Aprovadas', value: aprovadas, warn: false },
          { label: 'Total bonificado', value: fmtBRL(totalBonus), warn: false, isText: true },
        ].map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`${k.isText ? 'text-xl' : 'text-2xl'} font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {podeCriar && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={() => showForm ? closeForm() : setShowForm(true)}>
            <Plus size={14} />{showForm ? 'Cancelar' : 'Nova Meta'}
          </NeuButtonAccent>
        </div>
      )}

      <AnimatePresence>
        {showForm && podeCriar && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <h3 className="text-sm font-bold text-gray-300 mb-5">Nova Meta</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Colaborador *</label>
                <select value={form.colaborador_id}
                  onChange={e => setForm(p => ({ ...p, colaborador_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {colaboradoresElegiveis.map(p => (
                    <option key={p.id} value={p.id}>{p.nome ?? p.email}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição *</label>
                <input value={form.descricao}
                  onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Ex.: Fechar 5 vendas acima de R$ 10k"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valor (R$) *</label>
                <input type="text" inputMode="numeric" value={form.valor}
                  onChange={e => setForm(p => ({ ...p, valor: formatBRL(e.target.value) }))}
                  placeholder="0,00"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início *</label>
                <input type="date" value={form.data_inicio}
                  onChange={e => setForm(p => ({ ...p, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim *</label>
                <input type="date" value={form.data_fim}
                  onChange={e => setForm(p => ({ ...p, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleCriar} disabled={saving}>
                {saving ? 'Salvando...' : 'Criar Meta'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {enriched.length === 0 ? (
          <EmptyState message={podeCriar ? 'Nenhuma meta cadastrada. Crie a primeira.' : 'Você ainda não tem metas atribuídas.'} />
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Colaborador</th>
                <th className="pb-4 font-bold px-4">Descrição</th>
                <th className="pb-4 font-bold px-4 text-right">Valor</th>
                <th className="pb-4 font-bold px-4 text-center">Período</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4" />
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((m: any) => {
                    const sou_alvo = m.colaborador_id === profile?.id;
                    const aprovavel = podeAprovar(m);
                    return (
                      <motion.tr key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          <div className="flex items-center gap-2">
                            <Target size={13} className="text-accent shrink-0" />
                            {m.colaborador?.nome ?? m.colaborador?.email ?? '—'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-300 max-w-md">
                          <div className="truncate" title={m.descricao}>{m.descricao}</div>
                          {m.status === 'Rejeitada' && m.feedback_aprovacao && (
                            <div className="text-[10px] text-red-400 mt-1 flex items-start gap-1">
                              <MessageSquare size={10} className="mt-0.5 shrink-0" />
                              <span>{m.feedback_aprovacao}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-gray-200">{fmtBRL(Number(m.valor || 0))}</td>
                        <td className="py-3 px-4 text-[10px] font-mono text-center text-gray-400">
                          {m.data_inicio} → {m.data_fim}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(m.status)}`}>
                            {statusLabel(m.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1.5 justify-end items-center">
                            {m.status === 'Pendente' && sou_alvo && (
                              <button onClick={() => handleConcluir(m.id)}
                                disabled={busyMetaId === m.id}
                                className="text-[10px] text-blue-400 hover:underline transition-colors font-bold disabled:opacity-50">
                                Concluir
                              </button>
                            )}
                            {m.status === 'Concluida' && aprovavel && (
                              <>
                                <button onClick={() => handleAprovar(m.id)}
                                  disabled={busyMetaId === m.id}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                  title="Aprovar e creditar bonificação">
                                  <Check size={13} />
                                </button>
                                <button onClick={() => { setRejectMetaId(m.id); setRejectFeedback(''); }}
                                  disabled={busyMetaId === m.id}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                  title="Rejeitar">
                                  <XIcon size={13} />
                                </button>
                              </>
                            )}
                            {m.status === 'Aprovada' && (
                              <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold">
                                <Award size={11} />Creditado
                              </span>
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

      <AnimatePresence>
        {showThresholdEdit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowThresholdEdit(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-md w-full">
              <h3 className="text-base font-bold text-gray-200 mb-2">Limite para folga conquistada</h3>
              <p className="text-xs text-gray-400 mb-4">
                Quando o colaborador acumula este valor em bonificações aprovadas, ganha uma folga automática.
                Folgas já conquistadas anteriormente consumiram o limite vigente na época — alteração só afeta o próximo ciclo.
              </p>
              <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valor (R$)</label>
              <input type="text" inputMode="numeric" value={thresholdDraft}
                onChange={e => setThresholdDraft(formatBRL(e.target.value))}
                placeholder="2.500,00"
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1 mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowThresholdEdit(false)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={handleSaveThreshold} disabled={savingThreshold}>
                  {savingThreshold ? 'Salvando...' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
        {rejectMetaId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setRejectMetaId(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-md w-full">
              <h3 className="text-base font-bold text-gray-200 mb-2">Rejeitar meta</h3>
              <p className="text-xs text-gray-400 mb-4">Explique o motivo — o colaborador verá esse feedback.</p>
              <textarea value={rejectFeedback}
                onChange={e => setRejectFeedback(e.target.value)}
                rows={4} placeholder="Ex.: Resultado não comprovado nas vendas."
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRejectMetaId(null)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={handleRejeitar} disabled={busyMetaId === rejectMetaId}>
                  {busyMetaId === rejectMetaId ? 'Enviando...' : 'Rejeitar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
