// Modo Aula → o outro lado do «enviar»: o que a Matriz publicou e onde caiu.
//
// Publicar sem acompanhar deixava o professor sem resposta para a pergunta que
// ele faz logo depois de clicar em Enviar: chegou? em qual filial? quem já
// abriu? O aluno vê o enunciado (AulaAtividadeView) e o admin não via nada —
// o hook `useAulaAtividades` desliga justamente para admin/CEO.
//
// A régua de alcance é a MESMA do banco (`atividade_aula_alcanca`, migr. 403),
// reusada aqui pelo helper `atividadeAlcanca` do hook. Duplicar a conta em SQL
// daria uma view que mente no dia em que a política mudar.
//
// A quebra por filial vem primeiro porque é o recorte da pergunta: a turma é
// dividida em SuperMax/MaxLook/TechMax, e "18 de 33" não diz se a MaxLook
// inteira ficou de fora.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Clock, Check, Users, AlertCircle, Trash2, RefreshCw, Sparkles, ChevronDown,
  Download, FileText,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatDataHoraBR } from '../lib/dates';
import { atividadeAlcanca } from '../hooks/useAulaAtividades';
import { exportAtividadePDF } from '../lib/aulaAtividadePdf';
import { nomeArquivoAtividade, normalizarRoteiro, type Atividade } from '../lib/aulaAtividade';
import { AtividadeApoioBloco } from '../components/AtividadeApoioBloco';
import type { UserProfile } from '../hooks/useUserProfile';

const PUBLICO_LABEL: Record<string, string> = {
  todos: 'Gerentes e colaboradores',
  gerentes: 'Somente gerentes',
  colaboradores: 'Somente colaboradores',
};

type Publicada = {
  id: string;
  titulo: string;
  fluxo_id: string;
  fluxo_nome: string;
  objetivo: string | null;
  filiais: string[];
  publico: string;
  expira_em: string;
  nome_criador: string | null;
  created_at: string;
  gerado_por_ia: boolean;
  roteiro: any;
};
type Ciencia = { atividade_id: string; user_id: string; nome_snapshot: string | null; filial: string | null; ciente_em: string };
type Destinatario = { id: string; nome: string; filial: string | null; role: string };

interface Props {
  showToast: (msg: string, type?: string) => void;
  /** Quem está conduzindo — vai no cabeçalho do PDF. */
  profile: UserProfile;
  /** Muda a cada publicação no modal — força recarga sem realtime. */
  recarregarEm?: number;
}

/** O que está no banco de volta na forma que o gerador de PDF e a tela do aluno usam. */
const comoAtividade = (a: Publicada): Atividade => ({
  titulo: a.titulo,
  fluxoId: a.fluxo_id,
  fluxoNome: a.fluxo_nome,
  objetivo: a.objetivo ?? null,
  roteiro: normalizarRoteiro(a.roteiro),
  criador: a.nome_criador ?? null,
  expiraEm: a.expira_em,
  geradoPorIa: a.gerado_por_ia,
});

export const AulaAtividadesPublicadas: React.FC<Props> = ({ showToast, profile, recarregarEm }) => {
  const [atividades, setAtividades] = useState<Publicada[]>([]);
  const [ciencias, setCiencias] = useState<Ciencia[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [loading, setLoading] = useState(true);
  // Duas aberturas independentes: o enunciado (o que foi enviado) e a lista de
  // nomes (quem abriu). Na aula elas são consultadas em momentos diferentes.
  const [enunciadoAberto, setEnunciadoAberto] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  // Expirada continua existindo (o professor às vezes reabre a da aula
  // passada), mas fora do caminho: este painel é ferramenta de agora, e depois
  // de um mês de aulas a lista de ontem é o que separa ele do que interessa.
  const [mostrarExpiradas, setMostrarExpiradas] = useState(false);
  const confirmar = useConfirm();

  // `silencioso` para as recargas do realtime: trocar a lista pelo spinner a
  // cada aluno que clica em Ciente faria a tela piscar no meio da aula.
  const carregar = useCallback(async (silencioso = false) => {
    if (!supabase) { setLoading(false); return; }
    if (!silencioso) setLoading(true);

    const [{ data: ativs }, { data: pessoas }] = await Promise.all([
      supabase
        .from('aula_atividades')
        .select('id,titulo,fluxo_id,fluxo_nome,objetivo,filiais,publico,expira_em,nome_criador,created_at,gerado_por_ia,roteiro')
        .eq('ativo', true)
        .order('created_at', { ascending: false }),
      // `desligado_em` fora: o perfil desligado (migr. 306) não é mais aluno da
      // turma — as próprias funções de RBAC ignoram a linha, então ele nunca vai
      // abrir a atividade. Contá-lo deixava um pendente eterno na lista e um
      // «ok/total» por filial que não fechava em verde nem com a turma inteira
      // ciente.
      supabase
        .from('user_profiles')
        .select('id,nome,filial,role')
        .in('role', ['gerente', 'colaborador'])
        .is('desligado_em', null),
    ]);

    const lista = (ativs ?? []) as Publicada[];
    setAtividades(lista);
    setDestinatarios((pessoas ?? []) as Destinatario[]);

    if (lista.length > 0) {
      const { data: cs } = await supabase
        .from('aula_atividades_ciencia')
        .select('atividade_id,user_id,nome_snapshot,filial,ciente_em')
        .in('atividade_id', lista.map(a => a.id));
      setCiencias((cs ?? []) as Ciencia[]);
    } else {
      setCiencias([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar, recarregarEm]);

  // A contagem se move sozinha enquanto a turma abre o enunciado (migr. 404).
  // O botão «Atualizar» fica: realtime cai, e numa aula projetada é melhor ter
  // como forçar do que ficar olhando para um número parado sem saber se é a
  // turma que não abriu ou o canal que morreu.
  useEffect(() => {
    return assinarRealtime({
      nome: 'aula-atividades-acompanhamento',
      alvos: ['aula_atividades_ciencia', 'aula_atividades'],
      aoMudar: () => { carregar(true); },
    });
  }, [carregar]);

  // O PDF é remontado do `roteiro` jsonb, igual ao do aluno — o professor baixa
  // exatamente o documento que a turma tem na mão, não uma versão do que ele
  // digitou antes de enviar.
  const baixarPdf = async (a: Publicada) => {
    setBaixandoId(a.id);
    try {
      const doc = comoAtividade(a);
      await exportAtividadePDF(doc, nomeArquivoAtividade(doc), 'download', profile, showToast as any);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível gerar o PDF.', 'error');
    } finally {
      setBaixandoId(null);
    }
  };

  const remover = async (a: Publicada) => {
    if (!await confirmar({
      message: `Remover a atividade "${a.titulo}"?\n\nEla some da tela da turma na hora. Quem já baixou o PDF continua com ele.`,
      confirmLabel: 'Remover',
      danger: true,
    })) return;
    const { error } = await supabase!.rpc('remover_atividade_aula', { p_atividade_id: a.id });
    if (error) return showToast(error.message || 'Falha ao remover a atividade.', 'error');
    showToast('Atividade removida.', 'success');
    carregar();
  };

  const linhas = useMemo(() => atividades.map(a => {
    const alvo = destinatarios.filter(d => atividadeAlcanca(a, d as unknown as UserProfile));
    const confirmaram = ciencias.filter(c => c.atividade_id === a.id);
    const idsOk = new Set(confirmaram.map(c => c.user_id));
    const pendentes = alvo.filter(d => !idsOk.has(d.id));

    // Por filial: é o recorte que responde "chegou na MaxLook?". A filial vem
    // do perfil atual do aluno, não do snapshot da ciência — se ele mudou de
    // loja no meio da aula, o que interessa é onde ele está agora.
    const porFilial = Array.from(new Set(alvo.map(d => d.filial ?? '—'))).sort().map(filial => {
      const doAlvo = alvo.filter(d => (d.filial ?? '—') === filial);
      return {
        filial,
        total: doAlvo.length,
        ok: doAlvo.filter(d => idsOk.has(d.id)).length,
      };
    });

    return {
      atividade: a,
      alvo,
      confirmaram,
      pendentes,
      porFilial,
      expirado: new Date(a.expira_em).getTime() <= Date.now(),
      nTarefas: Array.isArray(a.roteiro?.tarefas) ? a.roteiro.tarefas.length : 0,
    };
  }), [atividades, ciencias, destinatarios]);

  // Uma lista só, filtrada — não duas listas: o card é o mesmo e duplicá-lo
  // faria as duas divergirem na primeira mudança. Com as expiradas à mostra
  // elas voltam intercaladas por data, que é a ordem em que as aulas
  // aconteceram.
  const expiradas = linhas.filter(l => l.expirado);
  const visiveis = mostrarExpiradas ? linhas : linhas.filter(l => !l.expirado);

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Atividades publicadas</h3>
          </div>
          <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
            O que a turma está vendo agora, por filial, e quem já abriu o enunciado.
            A contagem se move sozinha durante a aula. «Ciente» é confirmação de
            leitura — não é entrega da tarefa.
          </p>
        </div>
        {/* Seta explícita: `onClick={carregar}` passaria o evento como
            `silencioso` e o clique não mostraria mais o spinner. */}
        <button type="button" onClick={() => carregar()} disabled={loading}
          title="Recarregar — use se o realtime cair no meio da aula"
          className="shrink-0 neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><LoadingSpinner /></div>
      ) : visiveis.length === 0 ? (
        <EmptyState message={
          expiradas.length > 0
            ? `Nenhuma atividade vigente. ${expiradas.length} já expirou — abra abaixo para revê-las.`
            : 'Nenhuma atividade publicada. Use o ícone de prancheta no fluxo acima para montar e enviar a primeira.'
        } />
      ) : (
        <div className="flex flex-col gap-3">
          {visiveis.map(({ atividade: a, alvo, confirmaram, pendentes, porFilial, expirado, nTarefas }) => {
            const aberta = expandida === a.id;
            return (
              <div key={a.id}
                className={`rounded-2xl border p-4 flex flex-col gap-3 ${expirado ? 'border-white/5 opacity-90' : 'border-accent/25'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        expirado
                          ? 'bg-gray-500/20 text-gray-300 ring-1 ring-gray-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                      }`}>
                        <Clock size={9} /> {expirado ? 'Expirada' : 'Vigente'}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                        {PUBLICO_LABEL[a.publico] ?? a.publico}
                      </span>
                      {a.filiais.length === 0
                        ? <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">· Todas as filiais</span>
                        : a.filiais.map(f => <FilialBadge key={f} filial={f} />)}
                      {a.gerado_por_ia && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-accent border border-accent/30 rounded-full px-1.5 py-0.5 flex items-center gap-1">
                          <Sparkles size={9} /> MaxAI
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-black text-gray-100">{a.titulo}</h4>
                    <p className="text-[10px] text-gray-500">
                      {a.fluxo_nome} · {nTarefas} tarefa{nTarefas === 1 ? '' : 's'} · por {a.nome_criador ?? '—'} ·
                      {' '}válida até {formatDataHoraBR(a.expira_em)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setEnunciadoAberto(enunciadoAberto === a.id ? null : a.id)}
                      title="Ver o enunciado exatamente como a turma está vendo"
                      className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5">
                      <FileText size={12} /> Enunciado
                      <ChevronDown size={11} className={`transition-transform ${enunciadoAberto === a.id ? 'rotate-180 text-accent' : ''}`} />
                    </button>
                    <button type="button" onClick={() => baixarPdf(a)} disabled={baixandoId === a.id}
                      title="Baixar o mesmo PDF que o aluno baixa"
                      className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
                      <Download size={12} /> {baixandoId === a.id ? '…' : 'PDF'}
                    </button>
                    <button type="button" onClick={() => remover(a)}
                      className="btn-shimmer btn-shimmer--glass-red" title="Remover atividade">
                      <Trash2 size={11} /> Remover
                    </button>
                  </div>
                </div>

                {enunciadoAberto === a.id && (() => {
                  const doc = comoAtividade(a);
                  return (
                    <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-3 flex flex-col gap-3">
                      {doc.objetivo && (
                        <p className="text-[11px] text-gray-400 leading-relaxed border-l-2 border-accent/40 pl-3">
                          {doc.objetivo}
                        </p>
                      )}
                      {doc.roteiro.prerequisitos.length > 0 && (
                        <div>
                          <h5 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
                            Antes de começar
                          </h5>
                          <ul className="flex flex-col gap-1">
                            {doc.roteiro.prerequisitos.map((p, i) => (
                              <li key={i} className="text-[11px] text-gray-400">
                                {p.label} <span className="text-gray-600">— {p.onde}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Mesmo trilho numerado da tela do aluno: o professor
                          confere o que projetou sem traduzir de um layout para outro. */}
                      <div className="flex flex-col gap-0">
                        {doc.roteiro.tarefas.map((t, i) => {
                          const ultima = i === doc.roteiro.tarefas.length - 1;
                          return (
                            <div key={i} className="flex gap-3">
                              <div className="flex flex-col items-center shrink-0 pt-1">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black border border-accent/50 text-accent">
                                  {i + 1}
                                </div>
                                {!ultima && <div className="w-px flex-1 my-1 bg-accent/25" />}
                              </div>
                              <div className={`min-w-0 flex-1 ${ultima ? 'pb-0' : 'pb-3'}`}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] font-bold text-gray-200">{t.titulo}</span>
                                  {t.opcional && (
                                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-600 border border-white/10 rounded-full px-1.5 py-0.5">
                                      Opcional
                                    </span>
                                  )}
                                </div>
                                {t.papel && <div className="text-[10px] text-accent/80 mt-0.5">{t.papel}</div>}
                                {t.enunciado && (
                                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed whitespace-pre-line">
                                    {t.enunciado}
                                  </p>
                                )}
                                {t.entregavel && (
                                  <p className="text-[10px] text-gray-500 mt-1">
                                    <span className="text-gray-400 font-bold">Entregar:</span> {t.entregavel}
                                  </p>
                                )}
                                {t.criterio && (
                                  <p className="text-[10px] text-gray-500 mt-0.5 italic">Avaliação: {t.criterio}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {doc.roteiro.apoio && (
                        <div className="mt-3">
                          <AtividadeApoioBloco apoio={doc.roteiro.apoio} />
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                    <Users size={11} className="text-gray-500" />
                    <span className="text-gray-400">{confirmaram.length} de {alvo.length} abriram</span>
                  </div>

                  {porFilial.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {porFilial.map(f => (
                        <span key={f.filial}
                          className={`text-[11px] px-2 py-1 rounded-lg border flex items-center gap-1.5 ${
                            f.ok === f.total
                              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                              : f.ok === 0
                                ? 'bg-white/5 border-white/10 text-gray-400'
                                : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                          }`}>
                          {f.filial} <span className="font-black">{f.ok}/{f.total}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {alvo.length === 0 && (
                    <span className="text-[11px] text-gray-500 italic">
                      Nenhum aluno se encaixa neste alvo — confira filial e público. Ninguém recebeu.
                    </span>
                  )}

                  {alvo.length > 0 && (
                    <button type="button" onClick={() => setExpandida(aberta ? null : a.id)}
                      className="self-start text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent flex items-center gap-1">
                      <ChevronDown size={11} className={`transition-transform ${aberta ? 'rotate-180 text-accent' : ''}`} />
                      {aberta ? 'Ocultar nomes' : 'Ver nome a nome'}
                    </button>
                  )}

                  {aberta && (
                    <div className="flex flex-col gap-2">
                      {confirmaram.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {confirmaram.map(c => (
                            <span key={c.user_id}
                              className="text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-200 flex items-center gap-1.5">
                              <Check size={10} /> {c.nome_snapshot ?? '—'}
                              <span className="text-gray-500">{formatDataHoraBR(c.ciente_em)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {pendentes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {pendentes.map(p => (
                            <span key={p.id}
                              className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-400 flex items-center gap-1.5">
                              <AlertCircle size={10} className="text-amber-400" /> {p.nome}
                              <span className="text-gray-600">{p.filial ?? '—'}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && expiradas.length > 0 && (
        <button type="button" onClick={() => setMostrarExpiradas(v => !v)}
          className="self-start text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent flex items-center gap-1.5">
          <ChevronDown size={11} className={`transition-transform ${mostrarExpiradas ? 'rotate-180 text-accent' : ''}`} />
          {mostrarExpiradas
            ? 'Ocultar as expiradas'
            : `Ver ${expiradas.length} expirada${expiradas.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
};
