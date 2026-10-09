import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, ExternalLink, Link2, FileCheck2, Search } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { usePrompt } from '../contexts/PromptContext';
import { EmptyState, LoadingSpinner, SecaoFormulario, CardContador } from '../components/ui';
import { CABECALHO_TABELA } from '../components/MenuMais';
import { supabase } from '../lib/supabase';

// Migr. 691. A fila lia `marketing_tarefas.status_link`, que nenhuma tela
// gravava desde 22/07 (a TarefasMarketingView foi apagada) — estava órfã. O
// conteúdo nasce no Calendário Editorial; o Marketing envia o post para
// aprovação e quem decide é o Head de Comunicação da unidade (sem Head, a
// gerência). Quem produziu o post não o aprova — a RPC recusa.

const dominio = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

const dataHora = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
};

export const AprovacoesConteudoMarketingView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  const prompt = usePrompt();
  const filter = filialAtiva
    ? { status: 'Em aprovação', filial: filialAtiva }
    : { status: 'Em aprovação' };
  const { data: posts, setData, isLoading } = useFetchData<any>('/api/marketingcalendarioview', filter, true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const decidir = async (p: any, decisao: 'Aprovado' | 'Reprovado') => {
    if (processing || !supabase) return;
    const obs = await prompt(decisao === 'Aprovado'
      ? { message: `Aprovar "${p.titulo}"? Ele fica Agendado para ${dataHora(p.data_post)}. Se quiser, deixe um comentário.`,
          placeholder: 'Comentário (opcional)', confirmLabel: 'Aprovar', maxLength: 500 }
      : { message: `Reprovar "${p.titulo}"? O post volta para Rascunho e o Marketing lê o motivo para refazer.`,
          placeholder: 'Motivo da reprovação (obrigatório)', confirmLabel: 'Reprovar', maxLength: 500 });
    if (obs === null) return;
    if (decisao === 'Reprovado' && !obs.trim()) { showToast('Informe o motivo da reprovação.', 'error', true); return; }
    setProcessing(p.id);
    try {
      const { error } = await supabase.rpc('decidir_conteudo', { p_post_id: p.id, p_decisao: decisao, p_obs: obs.trim() || null });
      if (error) throw error;
      setData((prev: any[]) => prev.filter(item => item.id !== p.id));
      showToast(decisao === 'Aprovado' ? 'Conteúdo aprovado — o post está Agendado.' : 'Conteúdo reprovado — voltou para Rascunho.',
        decisao === 'Aprovado' ? 'success' : 'info', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível registrar a decisão.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const lista = posts ?? [];
  const agora = Date.now();
  const urgentes = lista.filter((p: any) => p.data_post && new Date(p.data_post).getTime() - agora < 48 * 3600 * 1000).length;
  const semArte = lista.filter((p: any) => !p.link_arte).length;
  const q = busca.trim().toLowerCase();
  const vistas = [...lista]
    .filter((p: any) => !q || `${p.titulo ?? ''} ${p.conteudo ?? ''} ${p.canal ?? ''} ${p.nome_criador ?? ''}`.toLowerCase().includes(q))
    .sort((a: any, b: any) => String(a.data_post ?? '').localeCompare(String(b.data_post ?? '')));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
            <FileCheck2 size={26} /> Aprovações de Conteúdo
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Posts que o Marketing enviou do Calendário. Decide o Head de Comunicação da unidade — sem Head, a gerência.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="neu-input w-full py-2.5 pl-9 pr-3 rounded-xl text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <CardContador label="Aguardando decisão" value={lista.length} tom="amarelo" />
        <CardContador label="Saem em até 48h" value={urgentes} tom="vermelho" />
        <CardContador label="Sem link da arte" value={semArte} tom="neutro" />
      </div>

      {isLoading && lista.length === 0 ? <LoadingSpinner /> : lista.length === 0 ? (
        <EmptyState message="Nenhum post aguardando aprovação" />
      ) : (
        <SecaoFormulario titulo="Fila de aprovação" icon={FileCheck2} cor="amarelo"
          extra={`${vistas.length} post${vistas.length === 1 ? '' : 's'}`}>
          {vistas.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Nada bate com “{busca}”.</p>
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse">
                <thead>
                  <tr className={CABECALHO_TABELA}>
                    <th className="text-center">Post</th>
                    <th className="text-center w-36">Canal</th>
                    <th className="text-center w-32">Publicação</th>
                    <th className="text-center w-44 hidden md:table-cell">Enviado por</th>
                    <th className="text-center w-44">Arte</th>
                    <th className="text-center w-px">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {vistas.map((p: any) => {
                    const ocupado = processing === p.id;
                    return (
                      <tr key={p.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                        <td className="py-3 px-3 min-w-[14rem]">
                          <span className="block text-sm font-semibold text-gray-100 leading-snug line-clamp-2 break-words">{p.titulo}</span>
                          {p.conteudo && (
                            <span className="block text-[11px] text-gray-500 mt-0.5 line-clamp-3 whitespace-pre-line" title={p.conteudo}>{p.conteudo}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300">{p.canal}</td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 tabular-nums whitespace-nowrap">{dataHora(p.data_post)}</td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 hidden md:table-cell">{p.nome_criador ?? p.nome_responsavel ?? '—'}</td>
                        <td className="py-3 px-3 text-center">
                          {p.link_arte ? (
                            <a href={p.link_arte} target="_blank" rel="noopener noreferrer" title={p.link_arte}
                              className="inline-flex items-center gap-1.5 max-w-[11rem] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent border border-accent/30 hover:bg-accent/10">
                              <Link2 size={12} className="shrink-0" />
                              <span className="truncate">{dominio(p.link_arte)}</span>
                              <ExternalLink size={11} className="shrink-0" />
                            </a>
                          ) : <span className="text-xs text-gray-600">—</span>}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                            <button onClick={() => decidir(p, 'Aprovado')} disabled={!!processing}
                              title="Aprovar — o post fica Agendado" aria-label="Aprovar o post" className="action-btn-verde">
                              {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => decidir(p, 'Reprovado')} disabled={!!processing}
                              title="Reprovar — pede o motivo e volta para Rascunho" aria-label="Reprovar o post" className="action-btn-vermelho">
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
