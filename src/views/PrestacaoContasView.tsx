import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Gavel, Plus, Send, TriangleAlert, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, StatusBadge, FilialBadge } from '../components/ui';
import { isConselheiro, isConselho } from '../lib/rbac';
import { FILIAIS_OP } from './AvaliacoesView';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

// Prestação de contas — quem executa volta para explicar (migração 379).
// Par do Orçamento (378): lá o Conselho dá a verba, aqui cobra o que foi
// feito com ela.
//
// A tela tem duas faces:
//   • Unidade   → monta a prestação do período e submete.
//   • Conselho  → dá parecer (aprovar / ressalvar / reprovar) e encerra.
//
// O parecer é SELADO: enquanto está em deliberação, a RLS só devolve o
// parecer do próprio conselheiro. Por isso a lista de pareceres aqui vem
// vazia (ou com uma linha só) antes do encerramento — não é bug, é a
// mesma régua do voto da competição.

type Status = 'rascunho' | 'submetida' | 'aprovada' | 'aprovada_com_ressalva' | 'reprovada';
type Voto   = 'aprovar' | 'ressalvar' | 'reprovar';

type Prestacao = {
  id: string;
  filial: string;
  titulo: string;
  periodo_inicio: string;
  periodo_fim: string;
  resultado: string | null;
  destaques: string | null;
  riscos: string | null;
  status: Status;
  conclusao: string | null;
  autor_id: string | null;
};

type Parecer = {
  id: string;
  conselheiro_id: string;
  voto: Voto;
  ressalva: string | null;
  prazo_acao: string | null;
};

const STATUS_TOM: Record<Status, string> = {
  rascunho:              'Pendente',
  submetida:             'Em Andamento',
  aprovada:              'Aprovado',
  aprovada_com_ressalva: 'Aprovado',
  reprovada:             'Negado',
};

const STATUS_LABEL: Record<Status, string> = {
  rascunho:              'Rascunho',
  submetida:             'Em deliberação',
  aprovada:              'Aprovada',
  aprovada_com_ressalva: 'Aprovada com ressalva',
  reprovada:             'Reprovada',
};

const VOTO_LABEL: Record<Voto, string> = {
  aprovar:   'Aprovar',
  ressalvar: 'Aprovar com ressalva',
  reprovar:  'Reprovar',
};

const brDate = (d: string) => d.split('-').reverse().join('/');

export function PrestacaoContasView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Dois testes de propósito (migr. 386): `conselho` é VISIBILIDADE — enxergar
  // as prestações das 4 unidades, e o CEO precisa disso para submeter a dele.
  // `podeDeliberar` é o ATO, e aí o CEO sai: ele presta contas, não as julga.
  // Quem barra de verdade é a RPC.
  const conselho = isConselheiro(profile) || profile?.role === 'admin' || profile?.role === 'ceo';
  const podeDeliberar = isConselho(profile);
  // Conselho enxerga tudo, inclusive a Matriz — que é justamente de quem o
  // CEO presta contas. A unidade enxerga só a própria.
  //
  // Mas quem escolheu uma unidade no seletor está operando aquela unidade,
  // mesmo sendo do Conselho: papel é o que se PODE ver, filial da sessão é o
  // que se está vendo agora. `filialAtiva = null` é o modo Matriz.
  const { filialAtiva } = useFilial();
  const filiaisVisiveis = useMemo(
    () => (filialAtiva
      ? [filialAtiva]
      : conselho ? [...FILIAIS_OP, 'Matriz'] : profile?.filial ? [profile.filial] : []),
    [filialAtiva, conselho, profile?.filial],
  );

  const [lista, setLista]       = useState<Prestacao[]>([]);
  const [pareceres, setPareceres] = useState<Record<string, Parecer[]>>({});
  const [loading, setLoading]   = useState(true);
  const [aberto, setAberto]     = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [form, setForm] = useState<Partial<Prestacao>>({});
  const [voto, setVoto]         = useState<Voto>('aprovar');
  const [ressalva, setRessalva] = useState('');
  const [prazo, setPrazo]       = useState('');
  const [conclusao, setConclusao] = useState('');

  const carregar = useCallback(async () => {
    if (!supabase || filiaisVisiveis.length === 0) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('prestacoes_contas')
      .select('id, filial, titulo, periodo_inicio, periodo_fim, resultado, destaques, riscos, status, conclusao, autor_id')
      .eq('ativo', true)
      .in('filial', filiaisVisiveis)
      .order('periodo_inicio', { ascending: false });
    setLista((data ?? []) as Prestacao[]);
    setLoading(false);
  }, [filiaisVisiveis]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel('prestacoes-contas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prestacoes_contas' }, () => carregar())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [carregar]);

  const carregarPareceres = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('prestacao_pareceres')
      .select('id, conselheiro_id, voto, ressalva, prazo_acao')
      .eq('prestacao_id', id);
    setPareceres(p => ({ ...p, [id]: (data ?? []) as Parecer[] }));
  }, []);

  const alternar = async (p: Prestacao) => {
    if (aberto === p.id) { setAberto(null); return; }
    setAberto(p.id);
    setForm(p);
    setVoto('aprovar'); setRessalva(''); setPrazo(''); setConclusao('');
    await carregarPareceres(p.id);
  };

  const criar = async (filial: string) => {
    if (!supabase) return;
    setSalvando(true);
    const ano = new Date().getFullYear();
    const { error } = await supabase.from('prestacoes_contas').insert({
      filial,
      titulo: `Prestação de contas ${ano}`,
      periodo_inicio: `${ano}-01-01`,
      periodo_fim: `${ano}-12-31`,
      status: 'rascunho',
      autor_id: profile?.id ?? null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro ao criar: ${error.message}`, 'error'); return; }
    showToast('Rascunho criado. Preencha o resultado do período.', 'success');
    carregar();
  };

  const salvarRascunho = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.from('prestacoes_contas').update({
      titulo:    form.titulo,
      resultado: form.resultado ?? null,
      destaques: form.destaques ?? null,
      riscos:    form.riscos ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setSalvando(false);
    if (error) { showToast(`Erro ao salvar: ${error.message}`, 'error'); return; }
    showToast('Rascunho salvo.', 'success');
    carregar();
  };

  const submeter = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('submeter_prestacao', { p_prestacao_id: id });
    setSalvando(false);
    if (error) { showToast(`Erro ao submeter: ${error.message}`, 'error'); return; }
    showToast('Prestação enviada ao Conselho.', 'success');
    carregar();
  };

  const darParecer = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('dar_parecer_prestacao', {
      p_prestacao_id: id,
      p_voto: voto,
      p_ressalva: ressalva || null,
      p_prazo_acao: prazo || null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro no parecer: ${error.message}`, 'error'); return; }
    showToast('Parecer registrado.', 'success');
    carregarPareceres(id);
  };

  const encerrar = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('encerrar_prestacao', {
      p_prestacao_id: id,
      p_conclusao: conclusao || null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro ao encerrar: ${error.message}`, 'error'); return; }
    const d = data as any;
    showToast(
      `Deliberação encerrada: ${STATUS_LABEL[d?.status as Status] ?? d?.status}. ` +
      `${d?.tarefas_geradas ?? 0} tarefa(s) de plano de ação criada(s).`,
      'success',
    );
    carregar();
    carregarPareceres(id);
  };

  if (loading) return <LoadingSpinner />;

  if (filiaisVisiveis.length === 0) {
    return <EmptyState message="Seu perfil não está vinculado a uma unidade." />;
  }

  const anoAtual = new Date().getFullYear();
  const semPrestacao = filiaisVisiveis.filter(
    f => !lista.some(p => p.filial === f && p.periodo_inicio.startsWith(String(anoAtual))),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Prestação de Contas</h1>
        <p className="text-sm text-gray-400 mt-1">
          {conselho
            ? 'Dê seu parecer e encerre a deliberação. Cada ressalva vira tarefa com prazo.'
            : 'Apresente o resultado do período ao Conselho. Ressalvas voltam como tarefa com prazo.'}
        </p>
      </div>

      {semPrestacao.length > 0 && (
        <div className="neu-card p-4 space-y-2">
          <div className="text-sm font-medium text-gray-300">Sem prestação neste ano</div>
          <div className="flex flex-wrap gap-2">
            {semPrestacao.map(f => (
              <button key={f} disabled={salvando} onClick={() => criar(f)}
                className="neu-button px-3 py-2 rounded-xl text-sm text-gray-100 flex items-center gap-2 disabled:opacity-50">
                <Plus size={14} /> Criar para {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState message="Nenhuma prestação de contas ainda." />
      ) : (
        <div className="space-y-3">
          {lista.map(p => {
            const editavel   = p.status === 'rascunho';
            const deliberar  = podeDeliberar && p.status === 'submetida' && p.autor_id !== profile?.id;
            const meus       = pareceres[p.id] ?? [];
            const encerrada  = ['aprovada','aprovada_com_ressalva','reprovada'].includes(p.status);

            return (
              <div key={p.id} className="neu-card overflow-hidden">
                <button onClick={() => alternar(p)} className="w-full p-4 flex items-center gap-3 text-left">
                  {aberto === p.id ? <ChevronDown size={16} className="text-accent shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />}
                  <FilialBadge filial={p.filial} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">{p.titulo}</div>
                    <div className="text-xs text-gray-500">{brDate(p.periodo_inicio)} — {brDate(p.periodo_fim)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline text-xs text-gray-500">{STATUS_LABEL[p.status]}</span>
                    <StatusBadge status={STATUS_TOM[p.status]} />
                  </div>
                </button>

                {aberto === p.id && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
                    {editavel ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Título</label>
                          <input value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Resultado do período <span className="text-red-400">*</span></label>
                          <textarea rows={3} value={form.resultado ?? ''} onChange={e => setForm(f => ({ ...f, resultado: e.target.value }))}
                            placeholder="O que aconteceu: receita, custo, entregas, o que saiu do plano."
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Destaques</label>
                            <textarea rows={2} value={form.destaques ?? ''} onChange={e => setForm(f => ({ ...f, destaques: e.target.value }))}
                              className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Riscos</label>
                            <textarea rows={2} value={form.riscos ?? ''} onChange={e => setForm(f => ({ ...f, riscos: e.target.value }))}
                              className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => salvarRascunho(p.id)} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-gray-100 disabled:opacity-50">
                            Salvar rascunho
                          </button>
                          <button onClick={() => submeter(p.id)} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                            <Send size={14} /> Submeter ao Conselho
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 text-sm">
                        <Campo titulo="Resultado do período" texto={p.resultado} />
                        <Campo titulo="Destaques" texto={p.destaques} />
                        <Campo titulo="Riscos" texto={p.riscos} />
                        {p.conclusao && <Campo titulo="Conclusão do Conselho" texto={p.conclusao} />}
                      </div>
                    )}

                    {/* Pareceres — selados até o encerramento */}
                    {(p.status === 'submetida' || encerrada) && (
                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wider font-bold text-gray-500">
                          Pareceres {!encerrada && <span className="normal-case font-normal">(selados até o encerramento)</span>}
                        </div>
                        {meus.length === 0 ? (
                          <div className="text-xs text-gray-500">Nenhum parecer visível para você ainda.</div>
                        ) : meus.map(pa => (
                          <div key={pa.id} className="bg-black/20 rounded-xl p-3 text-sm">
                            <div className="flex items-center gap-2">
                              {pa.voto === 'reprovar'  && <X size={14} className="text-red-400" />}
                              {pa.voto === 'ressalvar' && <TriangleAlert size={14} className="text-yellow-400" />}
                              {pa.voto === 'aprovar'   && <Check size={14} className="text-green-400" />}
                              <span className="text-gray-200">{VOTO_LABEL[pa.voto]}</span>
                              {pa.prazo_acao && <span className="text-xs text-gray-500">· prazo {brDate(pa.prazo_acao)}</span>}
                            </div>
                            {pa.ressalva && <div className="text-gray-400 text-xs mt-1">{pa.ressalva}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Por que não há painel de parecer aqui. Sem esta linha o
                        CEO só vê um botão que sumiu (migr. 386). */}
                    {conselho && p.status === 'submetida' && !deliberar && (
                      <div className="text-xs text-yellow-400/80">
                        {p.autor_id === profile?.id
                          ? 'Você submeteu esta prestação — não pode dar parecer sobre ela.'
                          : 'Parecer é do Conselho. O CEO presta contas; quem as julga é outro corpo.'}
                      </div>
                    )}

                    {deliberar && (
                      <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Parecer</label>
                            <select value={voto} onChange={e => setVoto(e.target.value as Voto)}
                              className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                              <option value="aprovar">Aprovar</option>
                              <option value="ressalvar">Aprovar com ressalva</option>
                              <option value="reprovar">Reprovar</option>
                            </select>
                          </div>
                          {voto === 'ressalvar' && (
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Prazo da ação <span className="text-red-400">*</span></label>
                              <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)}
                                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                            </div>
                          )}
                        </div>
                        {voto === 'ressalvar' && (
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Ressalva <span className="text-red-400">*</span></label>
                            <textarea rows={2} value={ressalva} onChange={e => setRessalva(e.target.value)}
                              placeholder="O que precisa ser corrigido. Vira tarefa com este texto."
                              className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 items-end">
                          <button onClick={() => darParecer(p.id)} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                            <Gavel size={14} /> Registrar parecer
                          </button>
                        </div>
                        <div className="pt-2 border-t border-white/5 space-y-2">
                          <label className="text-xs text-gray-500 block">Conclusão do Conselho (opcional)</label>
                          <textarea rows={2} value={conclusao} onChange={e => setConclusao(e.target.value)}
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                          <button onClick={() => encerrar(p.id)} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-gray-100 font-medium disabled:opacity-50">
                            Encerrar deliberação
                          </button>
                          <p className="text-xs text-gray-500">
                            A consolidação usa a regra mais severa presente: um voto de reprovar reprova.
                            Cada ressalva vira tarefa com prazo.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Campo({ titulo, texto }: { titulo: string; texto: string | null }) {
  if (!texto) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-1">{titulo}</div>
      <div className="text-gray-300 whitespace-pre-wrap">{texto}</div>
    </div>
  );
}
