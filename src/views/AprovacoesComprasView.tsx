import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ClipboardList, ThumbsDown, ThumbsUp, Loader2 } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, UrgenciaBadge } from '../components/ui';
import { supabase } from '../lib/supabase';

export const AprovacoesComprasView = ({ showToast }: any) => {
  const { data: aprovacoes, setData: setAprovacoes, isLoading: loadingAp } = useFetchData<any>('/api/minhasaprovacoesview', { status: 'Pendente' }, true);
  const { data: requisicoes, isLoading: loadingReq } = useFetchData<any>('/api/requisicoesview', undefined, true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});

  const isLoading = loadingAp || loadingReq;

  const enriched = aprovacoes
    .map((ap: any) => ({ ...ap, req: requisicoes.find((r: any) => r.id === ap.requisicao_id) }))
    .filter((ap: any) => ap.req);

  const handleAprovar = async (ap: any) => {
    setProcessing(ap.id);
    let aprovUpdated = false;
    try {
      await dbUpdate('/api/minhasaprovacoesview', ap.id, { status: 'Aprovado', observacao: obs[ap.id] ?? '' });
      aprovUpdated = true;
      await dbUpdate('/api/requisicoesview', ap.requisicao_id, { status: 'Aprovado' });
      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição aprovada!", 'success', true);
    } catch {
      // Rollback best-effort: se a aprovação foi marcada mas a requisição falhou,
      // reverte a aprovação para evitar estado inconsistente.
      if (aprovUpdated) {
        try { await dbUpdate('/api/minhasaprovacoesview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
      }
      showToast("Erro ao aprovar — rollback aplicado. Tente novamente.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleNegar = async (ap: any) => {
    if (!(obs[ap.id] ?? '').trim()) {
      showToast("Informe a justificativa para negar.", 'error', true);
      return;
    }
    setProcessing(ap.id);
    let aprovUpdated = false;
    try {
      await dbUpdate('/api/minhasaprovacoesview', ap.id, { status: 'Negado', observacao: obs[ap.id] });
      aprovUpdated = true;
      await dbUpdate('/api/requisicoesview', ap.requisicao_id, { status: 'Negado' });

      // Cascata (#14): cancela cotações pendentes desta requisição que ficariam órfãs.
      if (supabase) {
        const { data: cotsAtivas } = await supabase
          .from('cotacoes')
          .select('id')
          .eq('requisicao_id', ap.requisicao_id)
          .eq('status', 'Em Cotação');
        for (const c of (cotsAtivas ?? [])) {
          try { await dbUpdate('/api/cotacoesview', c.id, { status: 'Cancelado' }); } catch {}
        }
      }

      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição negada (cotações pendentes canceladas).", 'info', true);
    } catch {
      if (aprovUpdated) {
        try { await dbUpdate('/api/minhasaprovacoesview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
      }
      showToast("Erro ao negar — rollback aplicado. Tente novamente.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Minhas Aprovações</h2>
        <p className="text-sm text-gray-400 mt-1">Requisições de compra aguardando sua decisão.</p>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? (
        <EmptyState message="Nenhuma aprovação pendente" />
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto main-scrollbar pr-2 pb-6">
          {enriched.map((ap: any) => {
            const req = ap.req;
            const isExpanded = expanded === ap.id;
            const isProcessing = processing === ap.id;
            return (
              <motion.div key={ap.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl border border-white/5">
                <button
                  onClick={() => setExpanded(isExpanded ? null : ap.id)}
                  className="w-full p-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 neu-circle flex items-center justify-center bg-accent/5 shrink-0">
                      <ClipboardList size={18} className="text-accent" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-gray-200">{req.item}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Solicitante: {req.solicitante} · Qtd: {req.qtd} · {req.data}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <UrgenciaBadge urgencia={req.urgencia ?? 'Normal'} />
                    <ChevronDown size={16} className={`text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="px-5 pb-5 flex flex-col gap-4 border-t border-white/5 pt-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Centro de Custo', val: req.centro_custo || '—' },
                            { label: 'Urgência', val: req.urgencia ?? 'Normal' },
                            { label: 'Quantidade', val: String(req.qtd) },
                            { label: 'Data Criação', val: req.data },
                          ].map(({ label, val }) => (
                            <div key={label} className="neu-pressed p-3 rounded-xl">
                              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">{label}</span>
                              <span className="text-xs text-gray-200 font-semibold">{val}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            Observação <span className="text-red-500/70">(obrigatória para negar)</span>
                          </label>
                          <textarea
                            className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-20"
                            placeholder="Justificativa da decisão..."
                            value={obs[ap.id] ?? ''}
                            onChange={e => setObs(prev => ({ ...prev, [ap.id]: e.target.value }))}
                          />
                        </div>
                        <div className="flex gap-3 justify-end">
                          <button
                            onClick={() => handleNegar(ap)}
                            disabled={isProcessing}
                            className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-red-500 hover:border-red-500/20 border border-transparent transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ThumbsDown size={14} />}
                            Negar
                          </button>
                          <button
                            onClick={() => handleAprovar(ap)}
                            disabled={isProcessing}
                            className="neu-button-accent py-2 px-6 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin text-[#0A0A0A]" /> : <ThumbsUp size={14} />}
                            Aprovar
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
