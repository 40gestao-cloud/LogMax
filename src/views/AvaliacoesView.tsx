import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Star, CheckCircle2, Lock, ClipboardList, Award, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, StatusBadge } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';

// ----------------------------------------------------------------------
// Critérios hardcoded (Etapa 1). Etapa 2 pode tornar configurável.
// ----------------------------------------------------------------------

const CRITERIOS = {
  tecnica: ['Domínio técnico', 'Produtividade', 'Qualidade do trabalho'],
  comportamental: ['Iniciativa', 'Colaboração', 'Pontualidade'],
  socioemocional: ['Inteligência emocional', 'Comunicação', 'Resiliência'],
} as const;

const CATEGORIA_LABEL: Record<string, string> = {
  tecnica: 'Técnicas',
  comportamental: 'Comportamentais',
  socioemocional: 'Socioemocionais',
};

type Categoria = keyof typeof CRITERIOS;
type Ciclo = { id: string; nome: string; data_inicio: string; data_fim: string; status: string; feedback_anonimo: boolean };
type Avaliacao = {
  id: string;
  ciclo_id: string;
  avaliador_id: string;
  avaliado_id: string;
  tipo: string;
  observacao: string | null;
  created_at: string;
};
type Criterio = { id: string; avaliacao_id: string; categoria: string; criterio: string; nota: number };

const fmtData = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

// ----------------------------------------------------------------------
// Modal de Avaliação
// ----------------------------------------------------------------------

function ModalAvaliacao({
  ciclo, avaliado, tipo, onClose, onSaved, showToast,
}: {
  ciclo: Ciclo;
  avaliado: UserProfile;
  tipo: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador';
  onClose: () => void;
  onSaved: () => void;
  showToast: any;
}) {
  // Notas por categoria/critério (default 3 = neutro)
  const [notas, setNotas] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    (Object.keys(CRITERIOS) as Categoria[]).forEach(cat => {
      CRITERIOS[cat].forEach(c => { init[`${cat}::${c}`] = 3; });
    });
    return init;
  });
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const p_criterios = (Object.keys(CRITERIOS) as Categoria[]).flatMap(cat =>
        CRITERIOS[cat].map(c => ({ categoria: cat, criterio: c, nota: notas[`${cat}::${c}`] }))
      );
      const { error } = await supabase.rpc('criar_avaliacao', {
        p_ciclo_id: ciclo.id,
        p_avaliado_id: avaliado.id,
        p_tipo: tipo,
        p_observacao: observacao || null,
        p_criterios,
      });
      if (error) throw error;
      showToast?.('Avaliação registrada com sucesso.', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.message?.includes('unq_avaliacao')
        ? 'Você já avaliou esta pessoa neste ciclo.'
        : err?.message ?? 'Erro ao salvar avaliação.';
      showToast?.(msg, 'error');
    } finally {
      setSaving(false);
    }
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
            <h3 className="text-lg font-bold text-accent">Avaliação de Desempenho</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-bold text-gray-300">{avaliado.nome}</span> · Ciclo {ciclo.nome}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          {(Object.keys(CRITERIOS) as Categoria[]).map(cat => (
            <div key={cat}>
              <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                {CATEGORIA_LABEL[cat]}
              </h4>
              <div className="flex flex-col gap-3">
                {CRITERIOS[cat].map(c => {
                  const key = `${cat}::${c}`;
                  const nota = notas[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-300 flex-1">{c}</span>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            onClick={() => setNotas(prev => ({ ...prev, [key]: n }))}
                            className="w-9 h-9 rounded-xl font-bold text-sm transition-all"
                            style={
                              n === nota
                                ? { background: 'var(--color-accent)', color: 'var(--color-accent-text)' }
                                : { background: 'var(--color-bg-base)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.05)' }
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
              Observação (opcional)
            </label>
            <textarea
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={3}
              placeholder="Comentários sobre o desempenho avaliado..."
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
            <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
              <CheckCircle2 size={14} /> Salvar Avaliação
            </NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------
// Modal: novo ciclo
// ----------------------------------------------------------------------

function ModalNovoCiclo({ onClose, onSaved, showToast }: { onClose: () => void; onSaved: () => void; showToast: any }) {
  const [form, setForm] = useState({ nome: '', data_inicio: '', data_fim: '', feedback_anonimo: true });
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!form.nome || !form.data_inicio || !form.data_fim) {
      showToast?.('Preencha nome e período.', 'error'); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('ciclos_avaliacao').insert(form);
      if (error) throw error;
      showToast?.('Ciclo criado!', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao criar ciclo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }}
        className="neu-flat rounded-3xl p-6 max-w-md w-full border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-accent">Novo Ciclo de Avaliação</h3>
          <button onClick={onClose} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome</label>
            <input
              type="text"
              value={form.nome}
              onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
              placeholder="Ex: 2026 Q1"
              className="neu-input rounded-xl px-3 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início</label>
              <input
                type="date"
                value={form.data_inicio}
                onChange={e => setForm(p => ({ ...p, data_inicio: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim</label>
              <input
                type="date"
                value={form.data_fim}
                onChange={e => setForm(p => ({ ...p, data_fim: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.feedback_anonimo}
              onChange={e => setForm(p => ({ ...p, feedback_anonimo: e.target.checked }))}
              className="w-4 h-4 accent-emerald-500"
            />
            <span className="text-xs text-gray-300">Feedback de colaboradores é anônimo</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/5 mt-2">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 neu-button hover:text-white">
              Cancelar
            </button>
            <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
              <CheckCircle2 size={14} /> Criar
            </NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------
// Card de detalhe de avaliação recebida
// ----------------------------------------------------------------------

const CardRecebida: React.FC<{ avaliacao: Avaliacao; criterios: Criterio[]; avaliadorNome: string }> = ({ avaliacao, criterios, avaliadorNome }) => {
  const [expanded, setExpanded] = useState(false);
  const mediaTotal = useMemo(() => {
    if (criterios.length === 0) return 0;
    return criterios.reduce((s, c) => s + c.nota, 0) / criterios.length;
  }, [criterios]);

  const mediaPorCat = useMemo(() => {
    const acc: Record<string, { soma: number; count: number }> = {};
    criterios.forEach(c => {
      if (!acc[c.categoria]) acc[c.categoria] = { soma: 0, count: 0 };
      acc[c.categoria].soma += c.nota;
      acc[c.categoria].count += 1;
    });
    return Object.entries(acc).map(([cat, { soma, count }]) => ({
      categoria: cat,
      media: soma / count,
    }));
  }, [criterios]);

  return (
    <div className="neu-flat rounded-2xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-gray-500">de</p>
          <p className="text-sm font-bold text-gray-200">{avaliadorNome}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Média</p>
          <p className="text-2xl font-black text-accent">{mediaTotal.toFixed(1)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {mediaPorCat.map(m => (
          <div key={m.categoria} className="text-center p-2 rounded-lg neu-pressed">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">{CATEGORIA_LABEL[m.categoria]}</p>
            <p className="text-base font-black text-gray-200 mt-0.5">{m.media.toFixed(1)}</p>
          </div>
        ))}
      </div>

      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-[11px] text-gray-500 hover:text-accent flex items-center justify-center gap-1 py-1 transition-colors"
      >
        <Eye size={11} /> {expanded ? 'Ocultar detalhes' : 'Ver notas por critério'}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-2 border-t border-white/5 flex flex-col gap-1.5">
              {criterios.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{c.criterio}</span>
                  <span className="font-bold text-gray-200">{c.nota}/5</span>
                </div>
              ))}
              {avaliacao.observacao && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Observação</p>
                  <p className="text-xs text-gray-300 italic">"{avaliacao.observacao}"</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ----------------------------------------------------------------------
// View principal
// ----------------------------------------------------------------------

export const AvaliacoesView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNovoCiclo, setShowNovoCiclo] = useState(false);
  const [avaliando, setAvaliando] = useState<{ ciclo: Ciclo; avaliado: UserProfile; tipo: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador' } | null>(null);

  const isAdminOuCEO = profile.role === 'admin' || profile.role === 'ceo';
  const isGerente   = profile.role === 'gerente';

  const reload = async () => {
    if (!supabase) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [{ data: c }, { data: u }, { data: a }, { data: cr }] = await Promise.all([
        supabase.from('ciclos_avaliacao').select('*').order('created_at', { ascending: false }),
        supabase.from('user_profiles').select('*'),
        supabase.from('avaliacoes').select('*'),
        supabase.from('criterios_avaliacao').select('*'),
      ]);
      setCiclos(c ?? []);
      setUsers(u ?? []);
      setAvaliacoes(a ?? []);
      setCriterios(cr ?? []);
    } catch {
      showToast?.('Erro ao carregar avaliações.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const fecharCiclo = async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('ciclos_avaliacao').update({ status: 'Fechado' }).eq('id', id);
      if (error) throw error;
      showToast?.('Ciclo fechado.', 'success');
      reload();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao fechar.', 'error');
    }
  };

  // Ciclo aberto atual (assumimos no máximo 1)
  const cicloAberto = ciclos.find(c => c.status === 'Aberto') ?? null;

  // Quem o usuário logado deve avaliar no ciclo aberto?
  const pendentes = useMemo(() => {
    if (!cicloAberto) return [];
    const minhasFeitas = avaliacoes
      .filter(a => a.ciclo_id === cicloAberto.id && a.avaliador_id === profile.id)
      .map(a => `${a.avaliado_id}::${a.tipo}`);

    let alvos: { user: UserProfile; tipo: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador' }[] = [];
    if (isAdminOuCEO) {
      alvos = users
        .filter(u => u.role === 'gerente' && u.id !== profile.id)
        .map(user => ({ user, tipo: 'ceo_gerente' as const }));
    } else if (isGerente) {
      alvos = users
        .filter(u => u.role === 'colaborador' && u.setor === profile.setor)
        .map(user => ({ user, tipo: 'gerente_colaborador' as const }));
    } else {
      // colaborador: feedback reverso para gerentes do setor + CEO
      const gerentesSetor = users.filter(u => u.role === 'gerente' && u.setor === profile.setor);
      const ceos = users.filter(u => u.role === 'ceo');
      alvos = [...gerentesSetor, ...ceos].map(user => ({ user, tipo: 'feedback_colaborador' as const }));
    }

    return alvos.filter(({ user, tipo }) => !minhasFeitas.includes(`${user.id}::${tipo}`));
  }, [cicloAberto, avaliacoes, users, profile.id, profile.setor, isAdminOuCEO, isGerente]);

  // Avaliações recebidas pelo usuário (para a seção C)
  const recebidas = useMemo(() => {
    return avaliacoes
      .filter(a => a.avaliado_id === profile.id)
      .map(av => {
        const ciclo = ciclos.find(c => c.id === av.ciclo_id);
        const isAnonimo = av.tipo === 'feedback_colaborador' && (ciclo?.feedback_anonimo ?? true);
        const avaliador = users.find(u => u.id === av.avaliador_id);
        return {
          avaliacao: av,
          criterios: criterios.filter(c => c.avaliacao_id === av.id),
          avaliadorNome: isAnonimo ? 'Anônimo' : (avaliador?.nome ?? '—'),
          cicloNome: ciclo?.nome ?? '—',
        };
      })
      .sort((a, b) => b.avaliacao.created_at.localeCompare(a.avaliacao.created_at));
  }, [avaliacoes, criterios, users, ciclos, profile.id]);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Avaliações de Desempenho</h2>
        <p className="text-sm text-gray-400 mt-1">
          {isAdminOuCEO && 'Gerencie ciclos e avalie gerentes. '}
          {isGerente && 'Avalie os colaboradores do seu setor. '}
          {profile.role === 'colaborador' && 'Dê feedback sobre seu gerente e CEO. '}
          Veja avaliações que você recebeu.
        </p>
      </div>

      {/* ── A. CICLOS (admin/CEO) ── */}
      {isAdminOuCEO && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Ciclos de Avaliação</h3>
            </div>
            <NeuButtonAccent onClick={() => setShowNovoCiclo(true)}>
              <Plus size={14} /> Novo Ciclo
            </NeuButtonAccent>
          </div>

          {ciclos.length === 0 ? (
            <EmptyState message="Nenhum ciclo criado. Abra o primeiro para começar." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-4">Nome</th>
                    <th className="pb-3 font-bold px-4">Início</th>
                    <th className="pb-3 font-bold px-4">Fim</th>
                    <th className="pb-3 font-bold px-4 text-center">Status</th>
                    <th className="pb-3 font-bold px-4 text-center">Anônimo</th>
                    <th className="pb-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {ciclos.map(c => (
                    <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{c.nome}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(c.data_inicio)}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(c.data_fim)}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={c.status} /></td>
                      <td className="py-3 px-4 text-center text-xs text-gray-400">{c.feedback_anonimo ? 'Sim' : 'Não'}</td>
                      <td className="py-3 px-4 text-right">
                        {c.status === 'Aberto' && (
                          <button
                            onClick={() => fecharCiclo(c.id)}
                            className="text-[10px] text-gray-500 hover:text-red-400 font-bold uppercase tracking-widest flex items-center gap-1 ml-auto"
                          >
                            <Lock size={11} /> Fechar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── B. A FAZER ── */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Star size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-300">Avaliações a Fazer</h3>
            {pendentes.length > 0 && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                {pendentes.length}
              </span>
            )}
          </div>
          {cicloAberto && (
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Ciclo: {cicloAberto.nome}
            </span>
          )}
        </div>

        {!cicloAberto ? (
          <EmptyState message="Nenhum ciclo aberto no momento." />
        ) : pendentes.length === 0 ? (
          <EmptyState message="Você concluiu todas as suas avaliações deste ciclo. 🎉" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendentes.map(({ user, tipo }) => (
              <button
                key={`${user.id}::${tipo}`}
                onClick={() => setAvaliando({ ciclo: cicloAberto, avaliado: user, tipo })}
                className="neu-button rounded-2xl p-4 flex flex-col gap-1 text-left transition-all hover:border-accent"
                style={{ border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {user.role} · {user.setor}
                </span>
                <span className="text-sm font-bold text-gray-200">{user.nome}</span>
                <span className="text-[10px] text-accent flex items-center gap-1 mt-1">
                  <Star size={10} /> Avaliar agora
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── C. RECEBIDAS ── */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <div className="flex items-center gap-2 mb-5">
          <Award size={16} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Avaliações Recebidas</h3>
        </div>

        {recebidas.length === 0 ? (
          <EmptyState message="Nenhuma avaliação recebida ainda." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recebidas.map(r => (
              <CardRecebida
                key={r.avaliacao.id}
                avaliacao={r.avaliacao}
                criterios={r.criterios}
                avaliadorNome={`${r.avaliadorNome} · ${r.cicloNome}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modais */}
      <AnimatePresence>
        {showNovoCiclo && (
          <ModalNovoCiclo
            onClose={() => setShowNovoCiclo(false)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
        {avaliando && (
          <ModalAvaliacao
            ciclo={avaliando.ciclo}
            avaliado={avaliando.avaliado}
            tipo={avaliando.tipo}
            onClose={() => setAvaliando(null)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
