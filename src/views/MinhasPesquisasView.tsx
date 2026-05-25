import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Lock, ClipboardList, CheckCircle2, X } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { allSetores } from '../lib/rbac';

const LS_PREFIX = 'logmax:pesquisa-respondida:';

// Avalia elegibilidade do usuário para uma pesquisa, considerando role+setor.
// Mantém a mesma semântica da RPC responder_pesquisa: AND com NULL=wildcard,
// e setor='all' (admin/CEO) é wildcard de setor.
function isEligible(pesquisa: any, profile: any): boolean {
  if (!profile) return false;
  const roles = pesquisa.alvo_roles as string[] | null;
  const setores = pesquisa.alvo_setores as string[] | null;
  if (roles && roles.length > 0 && !roles.includes(profile.role)) return false;
  if (setores && setores.length > 0 && profile.setor !== 'all') {
    // Match se algum setor do usuário (primário ou extra) estiver no alvo.
    if (!allSetores(profile).some(s => setores.includes(s))) return false;
  }
  return true;
}

export const MinhasPesquisasView = ({ showToast, profile }: any) => {
  const ativasFilter = useMemo(() => ({ status: 'Ativa' }), []);
  const { data: pesquisas, isLoading } = useFetchData<any>('/api/pesquisasview', ativasFilter);

  // Para pesquisas não-anônimas: respostas do usuário corrente
  const minhasRespostasFilter = useMemo(() => (profile?.id ? { respondente_id: profile.id } : null), [profile?.id]);
  const { data: minhasRespostas } = useFetchData<any>(
    '/api/pesquisarespostasview',
    minhasRespostasFilter ?? undefined,
  );

  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const respondidasIds = new Set([
    ...minhasRespostas.map((r: any) => r.pesquisa_id),
    ...Array.from(doneIds),
  ]);

  // Adiciona localStorage marks para anônimas
  if (typeof window !== 'undefined') {
    pesquisas.forEach((p: any) => {
      if (p.anonima && localStorage.getItem(`${LS_PREFIX}${p.id}`)) {
        respondidasIds.add(p.id);
      }
    });
  }

  const elegives = pesquisas
    .filter((p: any) => isEligible(p, profile))
    .filter((p: any) => !respondidasIds.has(p.id));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Minhas Pesquisas</h2>
        <p className="text-sm text-gray-400 mt-1">Pesquisas ativas onde sua opinião é esperada.</p>
      </div>

      {elegives.length === 0 ? (
        <EmptyState message="Você está em dia. Nenhuma pesquisa pendente." />
      ) : (
        <div className="flex flex-col gap-3 shrink-0">
          <AnimatePresence>
            {elegives.map((p: any) => (
              <PesquisaResponderCard
                key={p.id}
                pesquisa={p}
                aberta={respondendo === p.id}
                onAbrir={() => setRespondendo(p.id)}
                onCancelar={() => setRespondendo(null)}
                onConcluido={() => {
                  setDoneIds(prev => new Set([...Array.from(prev), p.id]));
                  setRespondendo(null);
                }}
                showToast={showToast}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
};

function PesquisaResponderCard({ pesquisa, aberta, onAbrir, onCancelar, onConcluido, showToast }: any) {
  const filter = useMemo(() => ({ pesquisa_id: pesquisa.id }), [pesquisa.id]);
  const { data: perguntas, isLoading } = useFetchData<any>('/api/pesquisaperguntasview', filter);
  const [respostas, setRespostas] = useState<Record<string, any>>({});
  const [enviando, setEnviando] = useState(false);

  const sorted = useMemo(() => [...perguntas].sort((a: any, b: any) => a.ordem - b.ordem), [perguntas]);

  useEffect(() => {
    if (!aberta) setRespostas({});
  }, [aberta]);

  const handleEnviar = async () => {
    if (!supabase) return;
    // Valida obrigatórias
    for (const q of sorted) {
      if (!q.obrigatoria) continue;
      const val = respostas[q.id];
      const vazio = q.tipo === 'escala' ? !val : !val || !String(val).trim();
      if (vazio) {
        showToast(`Responda: ${q.enunciado}`, 'error');
        return;
      }
    }
    setEnviando(true);
    try {
      const p_itens = sorted.map((q: any) => ({
        pergunta_id:  q.id,
        valor_escala: q.tipo === 'escala' ? (respostas[q.id] ?? null) : null,
        valor_texto:  q.tipo === 'texto'  ? (respostas[q.id] ?? null) : null,
      }));
      const { error } = await supabase.rpc('responder_pesquisa', {
        p_pesquisa_id: pesquisa.id,
        p_itens,
      });
      if (error) {
        const msg = error.message?.includes('unq_resp') || error.message?.includes('duplicate')
          ? 'Você já respondeu esta pesquisa.'
          : error.message ?? 'Erro ao enviar resposta.';
        showToast(msg, 'error');
        return;
      }
      if (pesquisa.anonima) {
        try { localStorage.setItem(`${LS_PREFIX}${pesquisa.id}`, '1'); } catch {}
      }
      showToast('Resposta enviada. Obrigado!', 'success');
      onConcluido();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao enviar.', 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={14} className="text-accent shrink-0" />
            <p className="text-sm font-bold text-gray-200 truncate">{pesquisa.titulo}</p>
            {pesquisa.anonima && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500">
                <Lock size={9} />Anônima
              </span>
            )}
          </div>
          {pesquisa.descricao && <p className="text-xs text-gray-500 mt-0.5 truncate">{pesquisa.descricao}</p>}
          {pesquisa.data_fim && (
            <p className="text-[10px] font-mono text-gray-600 mt-1">Até: {pesquisa.data_fim}</p>
          )}
        </div>
        {!aberta && (
          <NeuButtonAccent variant="" onClick={onAbrir}>Responder</NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {aberta && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 pt-3 overflow-hidden">
            {isLoading ? <LoadingSpinner /> : (
              <div className="flex flex-col gap-4">
                {sorted.map((q: any, idx: number) => (
                  <div key={q.id} className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-300">
                      {idx + 1}. {q.enunciado}
                      {q.obrigatoria && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {q.tipo === 'escala' ? (
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(n => {
                          const active = respostas[q.id] === n;
                          return (
                            <button key={n} type="button"
                              onClick={() => setRespostas(r => ({ ...r, [q.id]: n }))}
                              className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${active ? 'bg-accent/10 text-accent border-accent/30' : 'neu-button text-gray-500 border-transparent'}`}>
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea
                        value={respostas[q.id] ?? ''}
                        onChange={e => setRespostas(r => ({ ...r, [q.id]: e.target.value }))}
                        rows={2}
                        className="neu-input rounded-xl px-3 py-2 text-sm resize-none"
                        placeholder="Sua resposta..."
                      />
                    )}
                  </div>
                ))}

                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={onCancelar}
                    className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-white">
                    Cancelar
                  </button>
                  <NeuButtonAccent variant="" onClick={handleEnviar} disabled={enviando}>
                    {enviando ? <>Enviando...</> : <><Send size={12} />Enviar</>}
                  </NeuButtonAccent>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
