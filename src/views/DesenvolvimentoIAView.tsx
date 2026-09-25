import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Cpu, Plus, X, Loader2, ChevronRight, Check, Users, Trash2,
  Calendar, Clock, Pencil, Star,
} from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, CardContador, type TomContador, corDoStatus } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { hasSetor, isConselheiro } from '../lib/rbac';
import { CRITERIOS, CategoriaCriterio } from '../lib/avaliacaoCriterios';
import { CriteriosAvaliacaoForm, notasIniciais } from '../components/CriteriosAvaliacaoForm';
import { useConfirm } from '../contexts/ConfirmContext';

type Auxiliar = { id: string; nome: string; role: string; setor: string };

type AvaliacaoDevIA = { id: string; desenvolvimento_ia_id: string; avaliado_id: string };

type DesenvolvimentoIA = {
  id: string;
  nome: string;
  ferramenta: string;
  descricao?: string | null;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  auxiliares: Auxiliar[];
  criador_id?: string | null;
  nome_criador?: string | null;
  status: 'Agendado' | 'Em Andamento' | 'Concluído' | 'Cancelado';
  created_at: string;
};


const STATUS_ORDER: Record<string, number> = {
  'Em Andamento': 0,
  'Agendado':     1,
  'Concluído':    2,
  'Cancelado':    3,
};

const nextStatus = (s: string): DesenvolvimentoIA['status'] | null =>
  s === 'Agendado' ? 'Em Andamento'
  : s === 'Em Andamento' ? 'Concluído'
  : null;

const EMPTY_FORM = {
  nome:        '',
  ferramenta:  '',
  descricao:   '',
  data:        '',
  hora_inicio: '',
  hora_fim:    '',
  auxiliares:  [] as Auxiliar[],
};

const formatTime = (t: string) => (t ?? '').slice(0, 5);
const formatDate = (d: string) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};

type Props = {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile;
};

export const DesenvolvimentoIAView = ({ showToast, profile }: Props) => {
  const confirm = useConfirm();
  const { data: sessoes, setData, isLoading } =
    useFetchData<DesenvolvimentoIA>('/api/desenvolvimentosiaview', undefined, true);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<string | null>(null);
  const [form, setForm]         = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [people, setPeople]     = useState<Auxiliar[]>([]);
  const [avaliacoesDevIA, setAvaliacoesDevIA] = useState<AvaliacaoDevIA[]>([]);
  const [avaliarAlvo, setAvaliarAlvo] = useState<{ sessao: DesenvolvimentoIA; auxiliar: Auxiliar } | null>(null);

  // Apenas TI (gerente ou staff do setor) e admin/CEO criam treinamentos
  // de IA — gerente de outro setor não deve aparecer com o botão "Novo
  // Treinamento". Backend casa em supabase/migrations/082_20260612d_dev_ia_ti_only_*.sql.
  const canManage =
    profile?.role === 'admin' ||
    profile?.role === 'ceo' || isConselheiro(profile) ||
    hasSetor(profile, 'ti');

  const canAvaliar = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile) || hasSetor(profile, 'ti');

  // Carrega TODOS os usuários (admin/CEO/gerente/colaborador, qualquer
  // setor): usados tanto como auxiliares possíveis no form quanto como
  // pool de "demais colaboradores" avaliáveis nos cards. RPC SECURITY
  // DEFINER expõe só id/nome/role/setor — fura a RLS de user_profiles
  // que bloquearia o TI de ver gente de outro setor.
  useEffect(() => {
    if (!supabase || !(showForm || canAvaliar)) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('listar_pessoas_treinamento_ia');
      if (cancelled) return;
      if (error) {
        console.warn('[DesenvolvimentoIA] erro ao buscar usuários:', error.message);
        return;
      }
      setPeople((data ?? []) as Auxiliar[]);
    })();
    return () => { cancelled = true; };
  }, [showForm, canAvaliar]);

  const reloadAvaliacoesDevIA = async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('avaliacoes')
      .select('id, desenvolvimento_ia_id, avaliado_id')
      .eq('tipo', 'ti_dev_ia');
    if (error) { console.warn('[DesenvolvimentoIA] erro ao buscar avaliações:', error.message); return; }
    setAvaliacoesDevIA((data ?? []) as AvaliacaoDevIA[]);
  };

  useEffect(() => {
    if (!supabase || !canAvaliar) return;
    reloadAvaliacoesDevIA();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAvaliar]);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const kpis = {
    agendados:   sessoes.filter(s => s.status === 'Agendado').length,
    emAndamento: sessoes.filter(s => s.status === 'Em Andamento').length,
    concluidos:  sessoes.filter(s => s.status === 'Concluído').length,
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditId(null);
  };

  const openCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (s: DesenvolvimentoIA) => {
    setEditId(s.id);
    setForm({
      nome:        s.nome,
      ferramenta:  s.ferramenta,
      descricao:   s.descricao ?? '',
      data:        s.data,
      hora_inicio: formatTime(s.hora_inicio),
      hora_fim:    formatTime(s.hora_fim),
      auxiliares:  Array.isArray(s.auxiliares) ? s.auxiliares : [],
    });
    setShowForm(true);
  };

  const toggleAuxiliar = (p: Auxiliar) => {
    setForm(f => {
      const exists = f.auxiliares.some(a => a.id === p.id);
      return {
        ...f,
        auxiliares: exists
          ? f.auxiliares.filter(a => a.id !== p.id)
          : [...f.auxiliares, p],
      };
    });
  };

  const handleSave = async () => {
    if (!form.nome.trim())                   { showToast('Informe o nome do treinamento.', 'error'); return; }
    if (!form.ferramenta.trim())             { showToast('Informe a ferramenta.', 'error'); return; }
    if (!form.data)                          { showToast('Defina a data.', 'error'); return; }
    if (!form.hora_inicio || !form.hora_fim) { showToast('Defina horário de início e fim.', 'error'); return; }
    if (form.hora_fim <= form.hora_inicio)   { showToast('Horário de fim deve ser após o início.', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        nome:        form.nome.trim(),
        ferramenta:  form.ferramenta.trim(),
        descricao:   form.descricao.trim() || null,
        data:        form.data,
        hora_inicio: form.hora_inicio,
        hora_fim:    form.hora_fim,
        auxiliares:  form.auxiliares,
      };

      if (editId) {
        const updated = await dbUpdate<DesenvolvimentoIA>('/api/desenvolvimentosiaview', editId, payload);
        setData(prev => prev.map(s => s.id === editId ? { ...s, ...(updated ?? payload) } : s));
        showToast('Treinamento atualizado.', 'success');
      } else {
        const created = await dbInsert<DesenvolvimentoIA>('/api/desenvolvimentosiaview', {
          ...payload,
          criador_id:   profile.id,
          nome_criador: profile.nome,
          status:       'Agendado',
        });
        if (created) setData(prev => [created, ...prev]);
        showToast('Treinamento agendado.', 'success');
      }
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const handleAdvance = async (s: DesenvolvimentoIA) => {
    const next = nextStatus(s.status);
    if (!next) return;
    setUpdatingId(s.id);
    try {
      const updated = await dbUpdate<DesenvolvimentoIA>('/api/desenvolvimentosiaview', s.id, { status: next });
      setData(prev => prev.map(x => x.id === s.id ? { ...x, ...(updated ?? { status: next }) } : x));
      showToast(`Status: ${next}`, 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setUpdatingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Cancelar este treinamento?')) return;
    try {
      await dbDelete('/api/desenvolvimentosiaview', id);
      setData(prev => prev.filter(s => s.id !== id));
      showToast('Treinamento cancelado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
  };

  // Em andamento primeiro, depois agendados por data crescente, depois
  // concluídos/cancelados (mais recentes primeiro).
  const ordered = [...sessoes].sort((a, b) => {
    const so = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (so !== 0) return so;
    if (a.status === 'Concluído' || a.status === 'Cancelado') {
      return b.data.localeCompare(a.data);
    }
    return a.data.localeCompare(b.data);
  });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl neu-pressed flex items-center justify-center text-accent">
          <Cpu size={20} />
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Desenvolvimento com IA</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
        {[
          { tom: 'azul' as TomContador, label: 'Agendados',     value: kpis.agendados,   color: 'text-blue-400'   },
          { tom: 'amarelo' as TomContador, label: 'Em Andamento',  value: kpis.emAndamento, color: 'text-yellow-400' },
          { tom: 'verde' as TomContador, label: 'Concluídos',    value: kpis.concluidos,  color: 'text-accent'     },
        ].map((k: any) => (
          <CardContador key={k.label} label={k.label} value={k.value} sub={k.sub} tom={k.tom} />
        ))}
      </div>

      {canManage && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={openCreate}>
            <Plus size={14} />Novo Treinamento
          </NeuButtonAccent>
        </div>
      )}

      <div className="flex flex-col gap-3 shrink-0">
        {ordered.length === 0 ? (
          <EmptyState message="Nenhum treinamento agendado" />
        ) : (
          <AnimatePresence>
            {ordered.map(s => {
              const next       = nextStatus(s.status);
              const isUpdating = updatingId === s.id;
              const isCriador  = !!s.criador_id && profile.id === s.criador_id;
              const podeEditar = canManage && (
                isCriador ||
                profile.role === 'admin' ||
                profile.role === 'ceo' ||
                hasSetor(profile, 'ti')
              );

              return (
                <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="neu-flat rounded-2xl p-5 border border-white/5">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${corDoStatus(s.status)}`}>{s.status}</span>
                        <span className="text-[10px] text-gray-600">• {s.ferramenta}</span>
                      </div>
                      <p className="text-sm font-bold text-gray-200">{s.nome}</p>
                      {s.descricao && <p className="text-xs text-gray-500 mt-0.5">{s.descricao}</p>}

                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="flex items-center gap-1 text-[10px] font-mono text-gray-400">
                          <Calendar size={11} />{formatDate(s.data)}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-mono text-gray-400">
                          <Clock size={11} />{formatTime(s.hora_inicio)} → {formatTime(s.hora_fim)}
                        </span>
                        {s.nome_criador && (
                          <span className="text-[10px] text-gray-600">Por: <span className="text-gray-300">{s.nome_criador}</span></span>
                        )}
                      </div>

                      {Array.isArray(s.auxiliares) && s.auxiliares.length > 0 && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          <Users size={11} className="text-gray-500" />
                          {s.auxiliares.map(a => {
                            const jaAvaliado = avaliacoesDevIA.some(
                              av => av.desenvolvimento_ia_id === s.id && av.avaliado_id === a.id
                            );
                            const avaliavel = a.role !== 'admin' && a.id !== s.criador_id;
                            return (
                              <span key={a.id}
                                className="text-[10px] pl-2 pr-1 py-0.5 rounded-full neu-pressed text-gray-300 border border-white/5 flex items-center gap-1">
                                {a.nome}
                                {canAvaliar && avaliavel && a.id !== profile.id && (
                                  jaAvaliado ? (
                                    <span title="Já avaliado" className="text-accent flex items-center"><Star size={10} fill="currentColor" /></span>
                                  ) : (
                                    <button type="button" onClick={() => setAvaliarAlvo({ sessao: s, auxiliar: a })}
                                      title="Avaliar participante"
                                      className="text-gray-500 hover:text-accent transition-colors">
                                      <Star size={10} />
                                    </button>
                                  )
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {canAvaliar && (() => {
                        const auxIds = new Set((Array.isArray(s.auxiliares) ? s.auxiliares : []).map(a => a.id));
                        const demais = people.filter(p =>
                          p.role !== 'admin' && p.id !== s.criador_id && p.id !== profile.id && !auxIds.has(p.id)
                        );
                        if (demais.length === 0) return null;
                        return (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-[9px] text-gray-600 uppercase tracking-widest font-bold">Demais:</span>
                            {demais.map(p => {
                              const jaAvaliado = avaliacoesDevIA.some(
                                av => av.desenvolvimento_ia_id === s.id && av.avaliado_id === p.id
                              );
                              return (
                                <span key={p.id}
                                  className="text-[10px] pl-2 pr-1 py-0.5 rounded-full neu-pressed text-gray-400 border border-white/5 flex items-center gap-1">
                                  {p.nome}
                                  {jaAvaliado ? (
                                    <span title="Já avaliado" className="text-accent flex items-center"><Star size={10} fill="currentColor" /></span>
                                  ) : (
                                    <button type="button" onClick={() => setAvaliarAlvo({ sessao: s, auxiliar: p })}
                                      title="Avaliar participante"
                                      className="text-gray-500 hover:text-accent transition-colors">
                                      <Star size={10} />
                                    </button>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {next && podeEditar && (
                        <button onClick={() => handleAdvance(s)} disabled={isUpdating}
                          className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 transition-all disabled:opacity-40 flex items-center gap-1.5">
                          {isUpdating ? <Loader2 size={12} className="animate-spin" />
                            : <>{s.status === 'Agendado' ? <ChevronRight size={12} /> : <Check size={12} />}{next}</>}
                        </button>
                      )}
                      {podeEditar && s.status !== 'Concluído' && (
                        <button onClick={() => openEdit(s)} title="Editar"
                          className="action-btn-edit">
                          <Pencil size={12} />
                        </button>
                      )}
                      {podeEditar && (
                        <button onClick={() => handleDelete(s.id)} title="Cancelar"
                          className="action-btn-delete">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <FormModal
        show={showForm}
        editing={!!editId}
        onClose={() => !saving && closeForm()}
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={handleSave}
        people={people}
        toggleAuxiliar={toggleAuxiliar}
      />

      {avaliarAlvo && (
        <ModalAvaliarParticipante
          sessao={avaliarAlvo.sessao}
          auxiliar={avaliarAlvo.auxiliar}
          onClose={() => setAvaliarAlvo(null)}
          onSaved={async () => { await reloadAvaliacoesDevIA(); }}
          showToast={showToast}
        />
      )}
    </motion.div>
  );
};

// ──────────────────────────────────────────────
// Modal de avaliação de participante (TI avalia quem fez o treinamento)
// ──────────────────────────────────────────────
function ModalAvaliarParticipante({
  sessao, auxiliar, onClose, onSaved, showToast,
}: {
  sessao: DesenvolvimentoIA;
  auxiliar: Auxiliar;
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (msg: string, type?: string) => void;
}) {
  const [notas, setNotas] = useState<Record<string, number>>(notasIniciais);
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const p_criterios = (Object.keys(CRITERIOS) as CategoriaCriterio[]).flatMap(cat =>
        CRITERIOS[cat].map(c => ({ categoria: cat, criterio: c, nota: notas[`${cat}::${c}`] }))
      );
      const { error } = await supabase.rpc('criar_avaliacao_ti_dev_ia', {
        p_desenvolvimento_ia_id: sessao.id,
        p_avaliado_id: auxiliar.id,
        p_observacao: observacao || null,
        p_criterios,
      });
      if (error) throw error;
      showToast('Avaliação registrada com sucesso.', 'success');
      await onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.message?.includes('unq_avaliacao_dev_ia')
        ? 'Você já avaliou essa pessoa neste treinamento.'
        : err?.message ?? 'Erro ao salvar avaliação.';
      showToast(msg, 'error');
    }
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="neu-flat rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto main-scrollbar border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-accent">Avaliar Participante</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-bold text-gray-300">{auxiliar.nome}</span> · {sessao.nome}
            </p>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          <CriteriosAvaliacaoForm notas={notas} setNotas={setNotas} />

          <div>
            <label htmlFor="dev-ia-avaliacao-observacao" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
              Observação (opcional)
            </label>
            <textarea
              id="dev-ia-avaliacao-observacao"
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={3}
              placeholder="Comentários sobre o desempenho no treinamento..."
              className="neu-input rounded-xl px-3 py-2.5 text-sm w-full resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 neu-button hover:text-white"
            >
              Cancelar
            </button>
            <NeuButtonAccent variant="" onClick={handleSalvar} disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</>
                : <><Star size={14} />Salvar Avaliação</>}
            </NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────
// Modal de criação / edição
// ──────────────────────────────────────────────
type FormModalProps = {
  show: boolean;
  editing: boolean;
  onClose: () => void;
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  saving: boolean;
  onSave: () => void;
  people: Auxiliar[];
  toggleAuxiliar: (p: Auxiliar) => void;
};

function FormModal({ show, editing, onClose, form, setForm, saving, onSave, people, toggleAuxiliar }: FormModalProps) {
  const [search, setSearch] = useState('');

  const selectedIds = useMemo(() => new Set(form.auxiliares.map(a => a.id)), [form.auxiliares]);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(p => p.nome.toLowerCase().includes(q));
  }, [people, search]);

  // Reseta busca quando fecha
  useEffect(() => { if (!show) setSearch(''); }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-8 sm:top-12 sm:left-1/2 sm:-translate-x-1/2 sm:inset-x-auto sm:w-full sm:max-w-2xl z-50 neu-flat rounded-3xl p-6 border border-white/10 max-h-[90vh] flex flex-col"
            style={{ background: 'var(--color-bg-base)' }}
          >
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h3 className="text-base font-bold text-gray-100">
                {editing ? 'Editar Treinamento' : 'Novo Treinamento de IA'}
              </h3>
              <button
                onClick={onClose}
                className="modal-close-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="dev-nome" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome do treinamento *</label>
                  <input id="dev-nome" type="text" value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm"
                    placeholder="Ex: Automação de relatórios com ChatGPT" />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="dev-ferramenta" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Ferramenta de IA / tecnologia *</label>
                  <input id="dev-ferramenta" type="text" value={form.ferramenta}
                    onChange={e => setForm(f => ({ ...f, ferramenta: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm"
                    placeholder="Ex: ChatGPT, Gemini, n8n, Power BI..." />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="dev-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição (opcional)</label>
                  <textarea id="dev-descricao" rows={2} value={form.descricao}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                    placeholder="O que será abordado..." />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dev-data" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data *</label>
                  <input id="dev-data" type="date" value={form.data}
                    onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="dev-hora-inicio" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início *</label>
                    <input id="dev-hora-inicio" type="time" value={form.hora_inicio}
                      onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))}
                      className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="dev-hora-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim *</label>
                    <input id="dev-hora-fim" type="time" value={form.hora_fim}
                      onChange={e => setForm(f => ({ ...f, hora_fim: e.target.value }))}
                      className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    Auxiliares ({form.auxiliares.length})
                  </label>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="neu-input rounded-lg px-2.5 py-1.5 text-xs w-32 sm:w-44" />
                </div>

                {form.auxiliares.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.auxiliares.map(a => (
                      <button key={a.id} type="button" onClick={() => toggleAuxiliar(a)}
                        className="text-[10px] px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 flex items-center gap-1 hover:bg-accent/25 transition-colors">
                        {a.nome}<X size={10} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="neu-pressed rounded-xl border border-white/5 max-h-44 overflow-y-auto custom-scrollbar">
                  {filteredPeople.length === 0 ? (
                    <p className="text-[11px] text-gray-500 text-center py-3">Nenhum colaborador encontrado.</p>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {filteredPeople.map(p => {
                        const selected = selectedIds.has(p.id);
                        return (
                          <li key={p.id}>
                            <button type="button" onClick={() => toggleAuxiliar(p)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors ${selected ? 'text-accent' : 'text-gray-300'}`}>
                              <span className={`w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-accent/20 border-accent/60' : 'border-gray-600'}`}>
                                {selected && <Check size={10} />}
                              </span>
                              <span className="text-xs font-bold flex-1 truncate">{p.nome}</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-500">{p.role}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 shrink-0">
              <button onClick={onClose} disabled={saving}
                className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-200 transition-colors">
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={onSave} disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" />Salvando...</>
                  : <><Plus size={14} />{editing ? 'Salvar Alterações' : 'Agendar'}</>}
              </NeuButtonAccent>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
