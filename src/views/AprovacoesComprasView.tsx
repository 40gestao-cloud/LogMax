import React, { useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ClipboardList, ThumbsDown, ThumbsUp, Loader2 } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, UrgenciaBadge } from '../components/ui';
import { supabase } from '../lib/supabase';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import type { AprovacaoCompras, Requisicao } from '../types/domain';

type ShowToast = (msg: string, type: string, persist?: boolean) => void;

type EnrichedAp = AprovacaoCompras & { req: Requisicao };

const AprovacoesComprasViewInner = ({ showToast, profile, filial }: { showToast: ShowToast; profile: UserProfile; filial: FilialOp }) => {
  const { data: aprovacoes, setData: setAprovacoes, isLoading: loadingAp } = useFetchData<AprovacaoCompras>('/api/minhasaprovacoesview', { status: 'Pendente', filial }, true);
  const { data: requisicoes, isLoading: loadingReq } = useFetchData<Requisicao>('/api/requisicoesview', { filial }, true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});

  const isLoading = loadingAp || loadingReq;

  const enriched: EnrichedAp[] = aprovacoes
    .map(ap => ({ ...ap, req: requisicoes.find(r => r.id === ap.requisicao_id) }))
    .filter((ap): ap is EnrichedAp => ap.req !== undefined);

  // Autoridade (migr. 282): quem decide é o gerente da filial ou a Matriz —
  // e nunca quem abriu a requisição. Compras executa a compra, não a aprova.
  const isMatriz = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const podeDecidir = (ap: EnrichedAp): boolean => {
    if (isMatriz) return true;
    if (ap.req.criado_por && ap.req.criado_por === profile.id) return false;
    return profile.role === 'gerente';
  };

  // Decisão da requisição: uma RPC, uma transação (migr. 282).
  //
  // Eram dois `UPDATE` soltos (aprovação, depois requisição) com rollback
  // best-effort no `catch` — o P6 do gabarito. E a cascata do Negado cancelava
  // cotação por cotação, num laço, sem transação nenhuma. Agora aprovação,
  // requisição e cascata caem juntas ou não caem.
  //
  // A autoridade também mudou: quem decide é o gerente da filial (ou a
  // Matriz), nunca quem abriu a requisição. O banco recusa o resto.
  const decidir = async (ap: EnrichedAp, decisao: 'Aprovado' | 'Negado') => {
    if (decisao === 'Negado' && !(obs[ap.id] ?? '').trim()) {
      showToast("Informe a justificativa para negar.", 'error', true);
      return;
    }
    if (!supabase) return;
    setProcessing(ap.id);
    try {
      const { data, error } = await supabase.rpc('decidir_requisicao_compra', {
        p_aprovacao_id: ap.id,
        p_decisao:      decisao,
        p_observacao:   obs[ap.id] ?? '',
      });
      if (error) {
        showToast(error.message, 'error', true);
        return;
      }
      const canceladas = Number((data as any)?.cotacoes_canceladas ?? 0);
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      showToast(
        decisao === 'Aprovado'
          ? 'Requisição aprovada!'
          : canceladas > 0
            ? `Requisição negada (${canceladas} cotação(ões) cancelada(s)).`
            : 'Requisição negada.',
        decisao === 'Aprovado' ? 'success' : 'info', true,
      );
    } catch (err: any) {
      showToast(`Erro ao decidir: ${err?.message ?? err}`, 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleAprovar = (ap: EnrichedAp) => decidir(ap, 'Aprovado');
  const handleNegar   = (ap: EnrichedAp) => decidir(ap, 'Negado');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Requisições de compra aguardando sua decisão.</p>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? (
        <EmptyState message="Nenhuma aprovação pendente" />
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto main-scrollbar pr-2 pb-6">
          {enriched.map(ap => {
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
                            { label: 'Data Criação', val: req.data ?? '—' },
                          ].map(({ label, val }) => (
                            <div key={label} className="neu-pressed p-3 rounded-xl">
                              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">{label}</span>
                              <span className="text-xs text-gray-200 font-semibold">{val}</span>
                            </div>
                          ))}
                        </div>
                        {!podeDecidir(ap) ? (
                          <div className="neu-pressed p-3 rounded-xl text-xs text-gray-400">
                            {ap.req.criado_por === profile.id
                              ? 'Você abriu esta requisição — quem decide é o gerente da filial.'
                              : 'Requisição de compra é decidida pelo gerente da filial (ou pela Matriz).'}
                          </div>
                        ) : (
                        <>
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
                        </>
                        )}
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

export const AprovacoesComprasView = ({ showToast, profile }: { showToast: ShowToast; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <AprovacoesComprasViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
