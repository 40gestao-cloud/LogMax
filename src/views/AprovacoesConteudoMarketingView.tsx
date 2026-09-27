import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, ExternalLink, Link2, FileCheck2, Search } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { usePrompt } from '../contexts/PromptContext';
import { EmptyState, LoadingSpinner, SecaoFormulario, CardContador } from '../components/ui';
import { CABECALHO_TABELA } from '../components/MenuMais';

// Etiqueta sólida por prioridade — mesma leitura de cor das outras filas.
const PRIO_COR: Record<string, string> = {
  'Alta':  'bg-red-600 text-white',
  'Média': 'bg-amber-500 text-black',
  'Baixa': 'bg-zinc-600 text-white',
};
const PRIO_ORDEM: Record<string, number> = { 'Alta': 0, 'Média': 1, 'Baixa': 2 };

const dominio = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export const AprovacoesConteudoMarketingView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  const prompt = usePrompt();
  const filter = filialAtiva
    ? { status_link: 'Aguardando Aprovação', filial: filialAtiva }
    : { status_link: 'Aguardando Aprovação' };
  const { data: tarefas, setData, isLoading } = useFetchData<any>('/api/marketingtarefasview', filter, true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const handleAprovar = async (t: any) => {
    if (processing) return;
    const obs = await prompt({
      message: `Aprovar "${t.titulo}"? Se quiser, deixe um comentário para o Marketing.`,
      placeholder: 'Comentário (opcional)', confirmLabel: 'Aprovar', maxLength: 500,
    });
    if (obs === null) return;
    setProcessing(t.id);
    try {
      await dbUpdate('/api/marketingtarefasview', t.id, {
        status_link: 'Aprovado',
        obs_link:    obs.trim(),
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
    const motivo = await prompt({
      message: `Reprovar "${t.titulo}"? O Marketing lê o motivo para refazer.`,
      placeholder: 'Motivo da reprovação (obrigatório)', confirmLabel: 'Reprovar', maxLength: 500,
    });
    if (motivo === null) return;
    if (!motivo.trim()) { showToast('Informe o motivo da reprovação.', 'error', true); return; }
    setProcessing(t.id);
    try {
      await dbUpdate('/api/marketingtarefasview', t.id, {
        status_link: 'Reprovado',
        obs_link:    motivo.trim(),
      });
      setData((prev: any[]) => prev.filter(item => item.id !== t.id));
      showToast('Conteúdo reprovado. Marketing será notificado.', 'info', true);
    } catch {
      showToast('Erro ao reprovar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const contar = (p: string) => tarefas.filter((t: any) => t.prioridade === p).length;
  const q = busca.trim().toLowerCase();
  const vistas = [...tarefas]
    .filter((t: any) => !q || `${t.titulo ?? ''} ${t.descricao ?? ''} ${t.nome_criador ?? ''}`.toLowerCase().includes(q))
    .sort((a: any, b: any) => (PRIO_ORDEM[a.prioridade] ?? 9) - (PRIO_ORDEM[b.prioridade] ?? 9));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <FileCheck2 size={26} /> Aprovações de Conteúdo
        </h2>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="neu-input w-full py-2.5 pl-9 pr-3 rounded-xl text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Aguardando decisão" value={tarefas.length} tom="amarelo" />
        <CardContador label="Prioridade alta" value={contar('Alta')} tom="vermelho" />
        <CardContador label="Prioridade média" value={contar('Média')} tom="laranja" />
        <CardContador label="Prioridade baixa" value={contar('Baixa')} tom="neutro" />
      </div>

      {isLoading && tarefas.length === 0 ? <LoadingSpinner /> : tarefas.length === 0 ? (
        <EmptyState message="Nenhum conteúdo aguardando aprovação" />
      ) : (
        <SecaoFormulario titulo="Fila de aprovação" icon={FileCheck2} cor="amarelo"
          extra={`${vistas.length} conteúdo${vistas.length === 1 ? '' : 's'}`}>
          {vistas.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Nada bate com “{busca}”.</p>
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse">
                <thead>
                  <tr className={CABECALHO_TABELA}>
                    <th className="text-center">Conteúdo</th>
                    <th className="text-center w-28">Prioridade</th>
                    <th className="text-center w-44 hidden md:table-cell">Enviado por</th>
                    <th className="text-center w-48">Link</th>
                    <th className="text-center w-px">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {vistas.map((t: any) => {
                    const ocupado = processing === t.id;
                    return (
                      <tr key={t.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                        <td className="py-3 px-3 min-w-[14rem]">
                          <span className="block text-sm font-semibold text-gray-100 leading-snug line-clamp-2 break-words">{t.titulo}</span>
                          {t.descricao && (
                            <span className="block text-[11px] text-gray-500 mt-0.5 line-clamp-2" title={t.descricao}>{t.descricao}</span>
                          )}
                          {t.nome_criador && <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">por {t.nome_criador}</span>}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${PRIO_COR[t.prioridade] ?? 'bg-zinc-600 text-white'}`}>
                            {t.prioridade ?? '—'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 hidden md:table-cell">{t.nome_criador ?? '—'}</td>
                        <td className="py-3 px-3 text-center">
                          {t.link_propaganda ? (
                            <a href={t.link_propaganda} target="_blank" rel="noopener noreferrer" title={t.link_propaganda}
                              className="inline-flex items-center gap-1.5 max-w-[11rem] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent border border-accent/30 hover:bg-accent/10">
                              <Link2 size={12} className="shrink-0" />
                              <span className="truncate">{dominio(t.link_propaganda)}</span>
                              <ExternalLink size={11} className="shrink-0" />
                            </a>
                          ) : <span className="text-xs text-gray-600">—</span>}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                            <button onClick={() => handleAprovar(t)} disabled={!!processing}
                              title="Aprovar o conteúdo" aria-label="Aprovar o conteúdo" className="action-btn-verde">
                              {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => handleReprovar(t)} disabled={!!processing}
                              title="Reprovar — pede o motivo" aria-label="Reprovar o conteúdo" className="action-btn-vermelho">
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SecaoFormulario>
      )}
    </motion.div>
  );
};
