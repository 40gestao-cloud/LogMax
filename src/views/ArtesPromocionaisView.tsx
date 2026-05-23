import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, ExternalLink, MessageSquare, Send, Lock, ChevronDown } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const SETOR_LABEL: Record<string, string> = {
  all:        'CEO/Admin',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'RH',
  marketing:  'Marketing',
  ti:         'TI',
  compras:    'Compras',
  estoque:    'Estoque',
};

type Arte = {
  id: string;
  promocao_id: string;
  nome_produto: string;
  descricao_promocao: string | null;
  preco_promocional: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  arte_url: string;
  publicada_em: string;
  nome_publicador: string | null;
};

type Feedback = {
  id: string;
  arte_id: string;
  user_id: string;
  setor: string;
  role: string;
  nome_user: string | null;
  estrelas: number;
  comentario: string | null;
  created_at: string;
};

const StarRow: React.FC<{ value: number; onChange?: (v: number) => void; size?: number }> = ({ value, onChange, size = 22 }) => (
  <div className="flex items-center gap-1">
    {[1, 2, 3, 4, 5].map(n => {
      const filled = n <= value;
      const interactive = !!onChange;
      return (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          disabled={!interactive}
          aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
          className={`transition-transform ${interactive ? 'hover:scale-110 cursor-pointer' : 'cursor-default'}`}
        >
          <Star
            size={size}
            className={filled ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'}
          />
        </button>
      );
    })}
  </div>
);

export const ArtesPromocionaisView = ({ showToast, profile }: any) => {
  const { data: artes, isLoading, error: artesError } = useFetchData<Arte>('/api/marketingartesview', undefined, true);
  const { data: feedbacks, setData: setFeedbacks } = useFetchData<Feedback>('/api/marketingartefeedbackview', undefined, true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, { estrelas: number; comentario: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const canGiveFeedback = profile?.role === 'gerente' || profile?.role === 'admin' || profile?.role === 'ceo';

  const myFeedbackByArte = useMemo(() => {
    const m: Record<string, Feedback> = {};
    for (const f of feedbacks ?? []) {
      if (f.user_id === profile?.id) m[f.arte_id] = f;
    }
    return m;
  }, [feedbacks, profile?.id]);

  const feedbacksByArte = useMemo(() => {
    const m: Record<string, Feedback[]> = {};
    for (const f of feedbacks ?? []) {
      (m[f.arte_id] ??= []).push(f);
    }
    return m;
  }, [feedbacks]);

  const handleSubmit = async (arte: Arte) => {
    if (!supabase || !profile?.id) return;
    const d = draft[arte.id] ?? { estrelas: myFeedbackByArte[arte.id]?.estrelas ?? 0, comentario: myFeedbackByArte[arte.id]?.comentario ?? '' };
    if (!d.estrelas) {
      showToast('Escolha uma nota de 1 a 5 estrelas.', 'error');
      return;
    }
    setSaving(arte.id);
    try {
      const { error } = await supabase.rpc('dar_feedback_arte', {
        p_arte_id:    arte.id,
        p_estrelas:   d.estrelas,
        p_comentario: d.comentario?.trim() ? d.comentario.trim() : null,
      });
      if (error) throw error;

      // Atualização otimista: substitui ou insere o feedback do usuário no
      // array local pra refletir imediatamente — o realtime confirma depois.
      const existing = myFeedbackByArte[arte.id];
      setFeedbacks((prev: any[]) => {
        const others = (prev ?? []).filter((f: Feedback) => !(f.arte_id === arte.id && f.user_id === profile.id));
        const updated: Feedback = {
          id:          existing?.id ?? `tmp-${arte.id}-${profile.id}`,
          arte_id:     arte.id,
          user_id:     profile.id,
          setor:       profile.setor,
          role:        profile.role,
          nome_user:   profile.nome ?? null,
          estrelas:    d.estrelas,
          comentario:  d.comentario?.trim() || null,
          created_at:  existing?.created_at ?? new Date().toISOString(),
        };
        return [updated, ...others];
      });
      setDraft(prev => ({ ...prev, [arte.id]: d }));
      showToast(existing ? 'Feedback atualizado!' : 'Feedback enviado!', 'success');
    } catch (err: any) {
      console.error('[dar_feedback_arte]', err);
      showToast(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(null);
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Artes Promocionais</h2>
        <p className="text-sm text-gray-400 mt-1">
          Artes publicadas pelo Marketing para as promoções aprovadas.{' '}
          {canGiveFeedback
            ? 'Você pode dar feedback (1-5 estrelas + comentário opcional).'
            : 'Apenas gerentes, admin e CEO podem dar feedback.'}
        </p>
      </div>

      {artesError || artes.length === 0 ? (
        <div className="neu-flat rounded-3xl p-10 border border-white/5">
          <EmptyState
            error={artesError}
            message="Nenhuma arte publicada ainda. Quando o Marketing publicar, ela aparece aqui."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {artes.map((arte) => {
            const fbList = feedbacksByArte[arte.id] ?? [];
            const avg = fbList.length ? fbList.reduce((s, f) => s + f.estrelas, 0) / fbList.length : 0;
            const mine = myFeedbackByArte[arte.id];
            const local = draft[arte.id] ?? { estrelas: mine?.estrelas ?? 0, comentario: mine?.comentario ?? '' };
            const isExpanded = expanded[arte.id];

            return (
              <motion.div
                key={arte.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-100 truncate">{arte.nome_produto}</p>
                    {arte.descricao_promocao && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{arte.descricao_promocao}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                      {arte.preco_promocional != null && (
                        <span className="font-mono text-accent">
                          R$ {Number(arte.preco_promocional).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      {arte.data_inicio && (
                        <span>· {arte.data_inicio}{arte.data_fim ? ` → ${arte.data_fim}` : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <Star size={12} className={avg ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'} />
                      <span className="text-xs font-bold text-yellow-400">{avg ? avg.toFixed(1) : '—'}</span>
                    </div>
                    <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">
                      {fbList.length} {fbList.length === 1 ? 'voto' : 'votos'}
                    </span>
                  </div>
                </div>

                <a
                  href={arte.arte_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 neu-button-accent rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest"
                >
                  <ExternalLink size={12} /> Abrir Arte
                </a>

                {arte.nome_publicador && (
                  <p className="text-[10px] text-gray-500 -mt-1">
                    Publicada por {arte.nome_publicador} · {new Date(arte.publicada_em).toLocaleDateString('pt-BR')}
                  </p>
                )}

                {/* Feedback do usuário */}
                {canGiveFeedback ? (
                  <div className="neu-pressed rounded-2xl p-3 flex flex-col gap-2 mt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        {mine ? 'Sua avaliação' : 'Avalie esta arte'}
                      </span>
                      <StarRow
                        value={local.estrelas}
                        onChange={(v) => setDraft(prev => ({ ...prev, [arte.id]: { ...local, estrelas: v } }))}
                        size={20}
                      />
                    </div>
                    <textarea
                      value={local.comentario}
                      onChange={e => setDraft(prev => ({ ...prev, [arte.id]: { ...local, comentario: e.target.value } }))}
                      placeholder="Comentário (opcional): destaque pontos fortes, sugira ajustes…"
                      rows={2}
                      maxLength={500}
                      className="neu-input rounded-xl px-3 py-2 text-xs resize-none"
                    />
                    <div className="flex items-center justify-between gap-2">
                      {mine && (
                        <span className="text-[10px] text-gray-500">
                          Última avaliação em {new Date(mine.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                      <NeuButtonAccent
                        variant=""
                        onClick={() => handleSubmit(arte)}
                        disabled={saving === arte.id || !local.estrelas}
                      >
                        {saving === arte.id
                          ? 'Enviando…'
                          : (<><Send size={10} /> {mine ? 'Atualizar' : 'Enviar feedback'}</>)}
                      </NeuButtonAccent>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-1">
                    <Lock size={10} /> Apenas gerente, admin ou CEO podem avaliar.
                  </div>
                )}

                {/* Toggle: feedback de outros setores */}
                {fbList.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpanded(prev => ({ ...prev, [arte.id]: !prev[arte.id] }))}
                      className="flex items-center justify-between gap-2 mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent"
                    >
                      <span className="flex items-center gap-1.5">
                        <MessageSquare size={10} /> Feedback dos setores ({fbList.length})
                      </span>
                      <ChevronDown size={10} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden flex flex-col gap-2"
                        >
                          {fbList.map(f => (
                            <div key={f.id} className="rounded-xl p-2.5 border border-white/5 bg-white/5">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-accent shrink-0">
                                    {SETOR_LABEL[f.setor] ?? f.setor}
                                  </span>
                                  <span className="text-[10px] text-gray-500 truncate">{f.nome_user ?? '—'}</span>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {[1, 2, 3, 4, 5].map(n => (
                                    <Star key={n} size={10}
                                      className={n <= f.estrelas ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'} />
                                  ))}
                                </div>
                              </div>
                              {f.comentario && (
                                <p className="text-[11px] text-gray-300 whitespace-pre-wrap break-words">{f.comentario}</p>
                              )}
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
