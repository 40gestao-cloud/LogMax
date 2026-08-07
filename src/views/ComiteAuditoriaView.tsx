import { useCallback, useEffect, useState } from 'react';
import { Check, Gavel, MessageSquare, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, StatusBadge, FilialBadge } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';
import { isConselho } from '../lib/rbac';
import { AuditoriaOperacoesView, type Linha as TrilhaLinha } from './AuditoriaOperacoesView';
import type { UserProfile } from '../hooks/useUserProfile';

// Comitê de Auditoria — a trilha passa a ser lida por alguém (migração 380).
//
// Ler a trilha não é fiscalizar: faltava o ato. Aqui o conselheiro escolhe
// uma operação, abre questionamento, a unidade responde e o comitê encerra
// como conforme ou não conforme — e a não conformidade vira tarefa com prazo.
//
// Nenhum dado de operação novo: tudo é fluxo por cima do que já existe.
//
// A tela de Auditoria virou a aba "Trilha" daqui (2026-08-07). Eram dois itens
// de menu para o mesmo trabalho, e o pior lado era o desta tela: a busca daqui
// era um `ilike` limitado a 25 resultados, enquanto a de lá tinha período,
// filtro por documento e por pessoa, paginação e export. Fiscalizar 1.482
// linhas de trilha com 25 resultados por vez não é fiscalizar.

type Status = 'aberta' | 'respondida' | 'encerrada';

type Revisao = {
  id: string;
  operacao_id: string;
  filial: string | null;
  questionamento: string;
  resposta: string | null;
  conclusao: 'conforme' | 'nao_conforme' | null;
  parecer: string | null;
  status: Status;
  aberta_em: string;
  aberta_por: string | null;
};

type Operacao = {
  id: string;
  entidade: string;
  entidade_id: string;
  filial: string | null;
  evento: string;
  detalhe: string | null;
  ator_nome: string | null;
  ator_setor: string | null;
  created_at: string;
};

const STATUS_TOM: Record<Status, string> = {
  aberta:     'Pendente',
  respondida: 'Em Andamento',
  encerrada:  'Aprovado',
};

const STATUS_LABEL: Record<Status, string> = {
  aberta:     'Aguardando resposta',
  respondida: 'Respondida — aguardando parecer',
  encerrada:  'Encerrada',
};

export function ComiteAuditoriaView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Abrir e encerrar questionamento é do Comitê (migr. 387) — sem o CEO,
  // que é justamente quem a auditoria fiscaliza. Responder continua aberto
  // a quem praticou o ato: `responder_revisao_auditoria` não mudou.
  const conselho = isConselho(profile);

  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [operacoes, setOperacoes] = useState<Record<string, Operacao>>({});
  const [aba, setAba]           = useState<'revisoes' | 'trilha'>('revisoes');
  const [loading, setLoading]   = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [novoAlvo, setNovoAlvo]     = useState<Operacao | null>(null);
  const [questionamento, setQuest]  = useState('');
  const [respostas, setRespostas]   = useState<Record<string, string>>({});
  const [pareceres, setPareceres]   = useState<Record<string, string>>({});
  const [prazos, setPrazos]         = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data: revs } = await supabase.from('auditoria_revisoes')
      .select('id, operacao_id, filial, questionamento, resposta, conclusao, parecer, status, aberta_em, aberta_por')
      .order('aberta_em', { ascending: false })
      .limit(100);
    const lista = (revs ?? []) as Revisao[];
    setRevisoes(lista);

    // As operações questionadas, para mostrar o fato ao lado da pergunta.
    const ids = lista.map(r => r.operacao_id);
    if (ids.length > 0) {
      const { data: ops } = await supabase.from('historico_operacoes')
        .select('id, entidade, entidade_id, filial, evento, detalhe, ator_nome, ator_setor, created_at')
        .in('id', ids);
      setOperacoes(Object.fromEntries(((ops ?? []) as Operacao[]).map(o => [o.id, o])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel('auditoria-revisoes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auditoria_revisoes' }, () => carregar())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [carregar]);

  // A trilha vive na aba "Trilha"; questionar de lá traz a linha para cá.
  const questionarDaTrilha = useCallback((l: TrilhaLinha) => {
    setNovoAlvo({
      id: l.id, entidade: l.entidade, entidade_id: l.entidade_id, filial: l.filial,
      evento: l.evento, detalhe: l.detalhe, ator_nome: l.ator_nome,
      ator_setor: l.ator_setor, created_at: l.created_at,
    });
    setAba('revisoes');
  }, []);

  const abrir = async () => {
    if (!supabase || !novoAlvo) return;
    setSalvando(true);
    const { error } = await supabase.rpc('abrir_revisao_auditoria', {
      p_operacao_id: novoAlvo.id,
      p_questionamento: questionamento,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Questionamento aberto e notificado ao setor responsável.', 'success');
    setNovoAlvo(null); setQuest('');
    carregar();
  };

  const responder = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('responder_revisao_auditoria', {
      p_revisao_id: id, p_resposta: respostas[id] ?? '',
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Resposta registrada.', 'success');
    carregar();
  };

  const encerrar = async (id: string, conclusao: 'conforme' | 'nao_conforme') => {
    if (!supabase) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('encerrar_revisao_auditoria', {
      p_revisao_id: id,
      p_conclusao: conclusao,
      p_parecer: pareceres[id] || null,
      p_prazo_acao: conclusao === 'nao_conforme' ? (prazos[id] || null) : null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    const d = data as any;
    showToast(
      conclusao === 'conforme'
        ? 'Revisão encerrada como conforme.'
        : `Não conformidade registrada. ${d?.tarefas_geradas ?? 0} tarefa(s) de correção criada(s).`,
      'success',
    );
    carregar();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Comitê de Auditoria</h1>
        <p className="text-sm text-gray-400 mt-1">
          Questione uma operação da trilha, receba a explicação de quem a praticou e conclua.
          Não conformidade vira tarefa com prazo.
        </p>
      </div>

      {/* Duas abas: o que já está em curso e a trilha de onde sai o próximo
          questionamento. */}
      <div className="flex gap-1.5">
        {([['revisoes', 'Questionamentos'], ['trilha', 'Trilha']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
              aba === id ? 'neu-pressed text-accent' : 'neu-button text-gray-500 hover:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'trilha' && (
        <div className="min-h-[60vh] flex flex-col">
          <AuditoriaOperacoesView
            showToast={showToast}
            embutido
            onQuestionar={conselho ? questionarDaTrilha : undefined}
          />
          {!conselho && (
            <p className="text-xs text-gray-500 mt-3">
              Você navega a trilha; abrir questionamento é do Comitê.
            </p>
          )}
        </div>
      )}

      {aba === 'revisoes' && conselho && !novoAlvo && (
        <div className="neu-card p-4">
          <p className="text-xs text-gray-500">
            Para abrir um questionamento, vá à aba <span className="text-gray-300">Trilha</span>,
            filtre o que quer olhar e clique em <span className="text-gray-300">Questionar</span> na linha.
          </p>
        </div>
      )}

      {aba === 'revisoes' && conselho && (
        <div className="space-y-3">
          {novoAlvo && (
            <div className="neu-card p-4 space-y-3">
              <div className="text-sm font-medium text-gray-300">Abrir questionamento</div>
            <div className="space-y-2 bg-black/20 rounded-xl p-3">
              <div className="text-sm text-gray-200">{novoAlvo.evento} · {novoAlvo.entidade}</div>
              <div className="text-xs text-gray-500">
                {novoAlvo.ator_nome ?? '—'} · {formatDataHoraBR(novoAlvo.created_at)}
                {novoAlvo.detalhe && <> · {novoAlvo.detalhe}</>}
              </div>
              <textarea rows={2} value={questionamento} onChange={e => setQuest(e.target.value)}
                placeholder="O que você quer que a unidade explique."
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
              <div className="flex gap-2">
                <button onClick={abrir} disabled={salvando || !questionamento.trim()}
                  className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                  <ShieldAlert size={14} /> Abrir questionamento
                </button>
                <button onClick={() => { setNovoAlvo(null); setQuest(''); }}
                  className="neu-button px-4 py-2 rounded-xl text-sm text-gray-400">
                  Cancelar
                </button>
              </div>
              </div>
            </div>
          )}
        </div>
      )}

      {aba === 'revisoes' && (revisoes.length === 0 ? (
        <EmptyState message="Nenhuma revisão de auditoria ainda." />
      ) : (
        <div className="space-y-3">
          {revisoes.map(r => {
            const op = operacoes[r.operacao_id];
            const podeResponder = r.status !== 'encerrada' && r.aberta_por !== profile?.id;
            const podeEncerrar  = conselho && r.status !== 'encerrada';

            return (
              <div key={r.id} className="neu-card p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FilialBadge filial={r.filial} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-100">
                      {op ? `${op.evento} · ${op.entidade}` : 'Operação da trilha'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {op?.ator_nome ?? '—'} · {op ? formatDataHoraBR(op.created_at) : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline text-xs text-gray-500">{STATUS_LABEL[r.status]}</span>
                    <StatusBadge status={STATUS_TOM[r.status]} />
                  </div>
                </div>

                <div className="bg-black/20 rounded-xl p-3 space-y-2 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-1">Questionamento</div>
                    <div className="text-gray-300 whitespace-pre-wrap">{r.questionamento}</div>
                  </div>
                  {r.resposta && (
                    <div>
                      <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-1">Resposta da unidade</div>
                      <div className="text-gray-300 whitespace-pre-wrap">{r.resposta}</div>
                    </div>
                  )}
                  {r.status === 'encerrada' && (
                    <div>
                      <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-1">Conclusão</div>
                      <div className={r.conclusao === 'nao_conforme' ? 'text-red-400' : 'text-green-400'}>
                        {r.conclusao === 'nao_conforme' ? 'Não conforme' : 'Conforme'}
                      </div>
                      {r.parecer && <div className="text-gray-400 text-xs mt-1 whitespace-pre-wrap">{r.parecer}</div>}
                    </div>
                  )}
                </div>

                {r.status === 'aberta' && podeResponder && (
                  <div className="space-y-2">
                    <textarea rows={2} value={respostas[r.id] ?? ''}
                      onChange={e => setRespostas(p => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="Explique o que aconteceu nesta operação."
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                    <button onClick={() => responder(r.id)} disabled={salvando}
                      className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                      <MessageSquare size={14} /> Responder
                    </button>
                  </div>
                )}

                {r.status === 'aberta' && !podeResponder && r.aberta_por === profile?.id && (
                  <div className="text-xs text-yellow-400/80">
                    Você abriu este questionamento — a resposta é de quem praticou o ato.
                  </div>
                )}

                {podeEncerrar && (
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <textarea rows={2} value={pareceres[r.id] ?? ''}
                      onChange={e => setPareceres(p => ({ ...p, [r.id]: e.target.value }))}
                      placeholder="Parecer do comitê (vira a descrição da tarefa, se não conforme)."
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                    <div className="flex flex-wrap gap-2 items-end">
                      <button onClick={() => encerrar(r.id, 'conforme')} disabled={salvando}
                        className="neu-button px-4 py-2 rounded-xl text-sm text-green-400 font-medium flex items-center gap-2 disabled:opacity-50">
                        <Check size={14} /> Conforme
                      </button>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Prazo da correção</label>
                        <input type="date" value={prazos[r.id] ?? ''}
                          onChange={e => setPrazos(p => ({ ...p, [r.id]: e.target.value }))}
                          className="neu-input px-3 py-2 rounded-xl text-sm" />
                      </div>
                      <button onClick={() => encerrar(r.id, 'nao_conforme')} disabled={salvando || !prazos[r.id]}
                        className="neu-button px-4 py-2 rounded-xl text-sm text-red-400 font-medium flex items-center gap-2 disabled:opacity-50">
                        <Gavel size={14} /> Não conforme
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Não conformidade exige prazo — laudo sem prazo não corrige nada.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
