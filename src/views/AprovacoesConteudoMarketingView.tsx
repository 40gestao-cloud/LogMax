import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, ExternalLink, Link2 } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { EmptyState } from '../components/ui';

const PRIO_STYLE: Record<string, string> = {
  'Alta':  'text-red-500',
  'Média': 'text-yellow-400',
  'Baixa': 'text-gray-500',
};

export const AprovacoesConteudoMarketingView = ({ showToast }: any) => {
  const { data: tarefas, setData } = useFetchData<any>('/api/marketingtarefasview', { status_link: 'Aguardando Aprovação' });
  const [obs, setObs]             = useState<Record<string, string>>({});
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const handleAprovar = async (t: any) => {
    if (processing) return;
    setProcessing(t.id);
    try {
      await dbUpdate('/api/marketingtarefasview', t.id, {
        status_link: 'Aprovado',
        obs_link:    obs[t.id] ?? '',
      });
      setData((prev: any[]) => prev.filter(item => item.id !== t.id));
      showToast('Conteúdo aprovado!', 'success', true);
    } catch {
      showToast('Erro ao aprovar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleReprovar = async (t: any) => {
    if (processing) return;
    if (!obs[t.id]?.trim()) { showToast('Informe o motivo da reprovação.', 'error', true); return; }
    setProcessing(t.id);
    try {
      await dbUpdate('/api/marketingtarefasview', t.id, {
        status_link: 'Reprovado',
        obs_link:    obs[t.id],
      });
      setData((prev: any[]) => prev.filter(item => item.id !== t.id));
      showToast('Conteúdo reprovado. Marketing será notificado.', 'info', true);
    } catch {
      showToast('Erro ao reprovar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Aprovações de Conteúdo</h2>
        <p className="text-sm text-gray-400 mt-1">Revise e aprove ou reprove os links de propaganda enviados pelo time de Marketing.</p>
      </div>

      {tarefas.length === 0 ? (
        <EmptyState message="Nenhum conteúdo aguardando aprovação" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto main-scrollbar pb-6">
          {tarefas.map((t: any) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">

              {/* Cabeçalho da tarefa */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-black uppercase tracking-wide ${PRIO_STYLE[t.prioridade] ?? 'text-gray-500'}`}>
                    {t.prioridade}
                  </span>
                  <span className="text-[10px] text-gray-600">· {t.status}</span>
                </div>
                <p className="text-sm font-bold text-gray-200">{t.titulo}</p>
                {t.descricao && <p className="text-xs text-gray-500 mt-0.5">{t.descricao}</p>}
                {t.nome_criador && <p className="text-[10px] text-gray-600 mt-1">Enviado por: {t.nome_criador}</p>}
              </div>

              {/* Link de propaganda */}
              <div className="neu-pressed rounded-xl p-3 flex items-start gap-2">
                <Link2 size={14} className="text-accent shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1">Link de Propaganda</p>
                  <a href={t.link_propaganda} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline break-all flex items-center gap-1">
                    {t.link_propaganda}
                    <ExternalLink size={10} className="shrink-0" />
                  </a>
                </div>
              </div>

              {/* Campo de observação (expandível) */}
              {expanded === t.id && (
                <textarea
                  className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                  placeholder="Motivo da reprovação (obrigatório para reprovar)..."
                  value={obs[t.id] ?? ''}
                  onChange={e => setObs(o => ({ ...o, [t.id]: e.target.value }))}
                />
              )}

              {/* Botões de ação */}
              <div className="flex gap-2 justify-end items-center">
                {expanded !== t.id && (
                  <button onClick={() => setExpanded(t.id)} disabled={!!processing}
                    className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">
                    Adicionar obs.
                  </button>
                )}
                <button onClick={() => handleReprovar(t)} disabled={processing === t.id}
                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-500 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                  {processing === t.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Reprovar
                </button>
                <button onClick={() => handleAprovar(t)} disabled={processing === t.id}
                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                  {processing === t.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Aprovar
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
