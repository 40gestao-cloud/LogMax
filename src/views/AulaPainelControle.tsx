// Painel de controle da atividade — quem, na turma, realizou cada tarefa.
//
// A pergunta que esta tela responde é a que sobrava depois de «Ciente»: ler o
// enunciado não é fazer a tarefa. O painel de «Atividades publicadas» conta
// quem ABRIU; este conta quem FEZ.
//
// Quem marca é o professor, e só ele (migr. 405). O aluno tem, na tela dele,
// uma marcação pessoal que fica no próprio aparelho e não é entrega — as duas
// coisas são diferentes de propósito, e misturá-las transformaria anotação de
// aluno em registro de aula.
//
// A régua de alcance é a MESMA do banco (`atividade_aula_alcanca_perfil`),
// reusada aqui pelo helper `atividadeAlcanca` — a matriz não pode mostrar uma
// coluna para aluno que a RPC recusa marcar.
//
// O desenho é uma matriz aluno × tarefa porque é assim que a pergunta chega na
// aula: "todo mundo passou da etapa 3?" olha uma coluna; "o Joel está onde?"
// olha uma linha. Uma lista por aluno responderia só a segunda.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, Check, RefreshCw, ChevronDown, Users, Clock, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';
import { atividadeAlcanca } from '../hooks/useAulaAtividades';
import { normalizarRoteiro } from '../lib/aulaAtividade';
import type { UserProfile } from '../hooks/useUserProfile';

type Publicada = {
  id: string;
  titulo: string;
  fluxo_nome: string;
  filiais: string[];
  publico: string;
  expira_em: string;
  created_at: string;
  roteiro: any;
};
type Realizada = { atividade_id: string; user_id: string; tarefa_idx: number; marcado_em: string };
type Aluno = { id: string; nome: string; filial: string | null; role: string };

interface Props {
  showToast: (msg: string, type?: string) => void;
  /** Muda a cada publicação no modal — traz a atividade nova sem recarregar. */
  recarregarEm?: number;
}

export const AulaPainelControle: React.FC<Props> = ({ showToast, recarregarEm }) => {
  const [atividades, setAtividades] = useState<Publicada[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [realizadas, setRealizadas] = useState<Realizada[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  // Cliques em voo, por célula. Sem isto, o professor clica duas vezes na
  // mesma célula enquanto a rede pensa e a segunda chamada desfaz a primeira.
  const [salvando, setSalvando] = useState<Set<string>>(new Set());

  const carregar = useCallback(async (silencioso = false) => {
    if (!supabase) { setLoading(false); return; }
    if (!silencioso) setLoading(true);

    const [{ data: ativs }, { data: pessoas }] = await Promise.all([
      supabase
        .from('aula_atividades')
        .select('id,titulo,fluxo_nome,filiais,publico,expira_em,created_at,roteiro')
        .eq('ativo', true)
        .order('created_at', { ascending: false }),
      // Mesma régua do painel de acompanhamento: desligado não é mais aluno da
      // turma e não pode inflar o denominador.
      supabase
        .from('user_profiles')
        .select('id,nome,filial,role')
        .in('role', ['gerente', 'colaborador'])
        .is('desligado_em', null)
        .order('nome'),
    ]);

    const lista = (ativs ?? []) as Publicada[];
    setAtividades(lista);
    setAlunos((pessoas ?? []) as Aluno[]);

    if (lista.length > 0) {
      const { data: feitas } = await supabase
        .from('aula_tarefas_realizadas')
        .select('atividade_id,user_id,tarefa_idx,marcado_em')
        .in('atividade_id', lista.map(a => a.id));
      setRealizadas((feitas ?? []) as Realizada[]);
    } else {
      setRealizadas([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar, recarregarEm]);

  // O professor marca no celular andando pela sala e o painel projetado
  // acompanha. Silencioso: trocar a matriz pelo spinner a cada clique faria a
  // tela piscar na parede.
  useEffect(() => {
    return assinarRealtime({
      nome: 'aula-painel-controle',
      alvos: ['aula_tarefas_realizadas'],
      aoMudar: () => { carregar(true); },
    });
  }, [carregar]);

  // A mais recente é a aula de agora; escolher à mão toda vez seria um clique
  // que o professor repete em toda aula.
  const atividade = useMemo(
    () => atividades.find(a => a.id === selecionada) ?? atividades[0] ?? null,
    [atividades, selecionada],
  );

  const tarefas = useMemo(
    () => (atividade ? normalizarRoteiro(atividade.roteiro).tarefas : []),
    [atividade],
  );

  const alvo = useMemo(
    () => (atividade
      ? alunos.filter(d => atividadeAlcanca(atividade, d as unknown as UserProfile))
      : []),
    [atividade, alunos],
  );

  // Set de "atividade|aluno|tarefa" — a matriz consulta isto uma vez por
  // célula, e varrer o array a cada uma seria O(alunos × tarefas × marcações).
  const feitasSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of realizadas) s.add(`${r.atividade_id}|${r.user_id}|${r.tarefa_idx}`);
    return s;
  }, [realizadas]);

  const marcar = async (alunoId: string, idx: number, feito: boolean) => {
    if (!supabase || !atividade) return;
    const chave = `${alunoId}|${idx}`;
    if (salvando.has(chave)) return;
    setSalvando(prev => new Set(prev).add(chave));

    // Otimista: numa sala com trinta alunos o professor clica em sequência, e
    // esperar o round-trip a cada célula trava a mão dele. O erro devolve o
    // estado e avisa — silenciar deixaria a projeção mentindo.
    setRealizadas(prev => feito
      ? [...prev, { atividade_id: atividade.id, user_id: alunoId, tarefa_idx: idx, marcado_em: new Date().toISOString() }]
      : prev.filter(r => !(r.atividade_id === atividade.id && r.user_id === alunoId && r.tarefa_idx === idx)));

    const { error } = await supabase.rpc('marcar_tarefa_aula', {
      p_atividade_id: atividade.id,
      p_user_id: alunoId,
      p_tarefa_idx: idx,
      p_feito: feito,
    });

    if (error) {
      showToast(error.message || 'Não foi possível marcar a tarefa.', 'error');
      await carregar(true);
    }
    setSalvando(prev => { const s = new Set(prev); s.delete(chave); return s; });
  };

  /** Marca (ou desmarca) a linha inteira de um aluno. */
  const marcarLinha = async (alunoId: string, feito: boolean) => {
    for (let i = 0; i < tarefas.length; i++) {
      const jaEsta = feitasSet.has(`${atividade!.id}|${alunoId}|${i}`);
      if (jaEsta !== feito) await marcar(alunoId, i, feito);
    }
  };

  const porAluno = (alunoId: string) =>
    tarefas.reduce((n, _t, i) => n + (feitasSet.has(`${atividade!.id}|${alunoId}|${i}`) ? 1 : 0), 0);

  const porTarefa = (idx: number) =>
    alvo.reduce((n, a) => n + (feitasSet.has(`${atividade!.id}|${a.id}|${idx}`) ? 1 : 0), 0);

  const expirado = atividade ? new Date(atividade.expira_em).getTime() <= Date.now() : false;

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Painel de controle</h3>
          </div>
          <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
            Quem realizou cada tarefa da atividade. Você marca — o aluno vê o que
            foi marcado para ele e não mexe nisso. Não vira nota nem entra no placar
            da competição.
          </p>
        </div>
        <button type="button" onClick={() => carregar()} disabled={loading}
          title="Recarregar — use se o realtime cair no meio da aula"
          className="shrink-0 neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><LoadingSpinner /></div>
      ) : !atividade ? (
        <EmptyState message="Nenhuma atividade publicada. Monte uma no fluxo e envie para a turma — o controle aparece aqui." />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <select
                value={atividade.id}
                onChange={e => setSelecionada(e.target.value)}
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full appearance-none pr-9"
              >
                {atividades.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.titulo}
                    {new Date(a.expira_em).getTime() <= Date.now() ? ' (expirada)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full flex items-center gap-1 shrink-0 ${
              expirado
                ? 'bg-gray-500/20 text-gray-300 ring-1 ring-gray-500/30'
                : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'}`}>
              <Clock size={9} /> {expirado ? 'Expirada' : 'Vigente'}
            </span>
            <span className="text-[10px] text-gray-500 flex items-center gap-1.5 shrink-0">
              <Users size={11} /> {alvo.length} aluno{alvo.length === 1 ? '' : 's'}
            </span>
          </div>

          {alvo.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">
              Nenhum aluno se encaixa no alvo desta atividade — confira filial e público.
              Não há o que controlar.
            </p>
          ) : tarefas.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">Esta atividade não tem tarefas.</p>
          ) : (
            // A matriz é larga por natureza (uma coluna por tarefa) e rola
            // dentro do próprio card: sem isto ela empurra a página inteira
            // para o lado e a sidebar sai de vista.
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-base text-[10px] font-black uppercase tracking-widest text-gray-500 pb-2 pr-3 align-bottom">
                      Aluno
                    </th>
                    {tarefas.map((t, i) => (
                      <th key={i} className="pb-2 px-1 align-bottom" title={t.titulo}>
                        <div className="flex flex-col items-center gap-1 w-14">
                          <span className="text-[9px] text-gray-600 font-bold truncate max-w-[3.5rem]">
                            {porTarefa(i)}/{alvo.length}
                          </span>
                          <span className="w-6 h-6 rounded-full border border-accent/40 text-accent text-[10px] font-black flex items-center justify-center">
                            {i + 1}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="pb-2 pl-2 align-bottom text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {alvo.map(aluno => {
                    const n = porAluno(aluno.id);
                    const completo = n === tarefas.length;
                    return (
                      <tr key={aluno.id} className="group">
                        <td className="sticky left-0 z-10 bg-base py-1 pr-3 max-w-[12rem]">
                          <button type="button"
                            onClick={() => void marcarLinha(aluno.id, !completo)}
                            title={completo ? 'Desmarcar todas deste aluno' : 'Marcar todas deste aluno'}
                            className="text-left w-full">
                            <span className={`block text-[11px] font-bold truncate ${
                              completo ? 'text-accent' : 'text-gray-300'}`}>
                              {aluno.nome}
                            </span>
                            <span className="block text-[9px] text-gray-600 truncate">
                              {aluno.filial ?? '—'} · {aluno.role}
                            </span>
                          </button>
                        </td>
                        {tarefas.map((_t, i) => {
                          const feito = feitasSet.has(`${atividade.id}|${aluno.id}|${i}`);
                          const emVoo = salvando.has(`${aluno.id}|${i}`);
                          return (
                            <td key={i} className="py-1 px-1">
                              <button
                                type="button"
                                onClick={() => void marcar(aluno.id, i, !feito)}
                                disabled={emVoo}
                                aria-pressed={feito}
                                aria-label={`${aluno.nome} — tarefa ${i + 1}`}
                                className={`w-14 h-8 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-50 ${
                                  feito
                                    ? 'bg-accent/20 border-accent/40 text-accent'
                                    : 'border-white/10 text-gray-700 hover:border-white/30 hover:text-gray-500'}`}
                              >
                                {feito ? <Check size={14} /> : <span className="w-2 h-2 rounded-full bg-current" />}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-1 pl-2 text-right">
                          <span className={`text-[11px] font-black ${completo ? 'text-accent' : 'text-gray-500'}`}>
                            {n}/{tarefas.length}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Legenda das tarefas: a matriz mostra o número, e o número sozinho
              não diz o que é a etapa 4. */}
          {tarefas.length > 0 && alvo.length > 0 && (
            <div className="flex flex-col gap-1 pt-1 border-t border-white/5">
              {tarefas.map((t, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="text-[10px] font-black text-accent/70 w-4 shrink-0">{i + 1}.</span>
                  <span className="text-[11px] text-gray-400 min-w-0">{t.titulo}</span>
                  {t.papel && <span className="text-[10px] text-gray-600 truncate">— {t.papel}</span>}
                </div>
              ))}
              <p className="text-[10px] text-gray-600 mt-1 flex items-start gap-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                Clicar no nome do aluno marca ou desmarca a linha inteira dele.
                A atividade foi enviada em {formatDataHoraBR(atividade.created_at)}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
