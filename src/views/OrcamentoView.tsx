import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, FilialBadge, LoadingSpinner, StatusBadge } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { isConselheiro, isConselho } from '../lib/rbac';
import { FILIAIS_OP } from './AvaliacoesView';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

// Orçamento do período — a filial propõe, o Conselho delibera, o gasto responde.
// Item #G1 do backlog de governança (migração 378).
//
// A tela tem duas faces na mesma rota, decididas pelo papel de quem abre:
//   • Filial  → monta rubricas, edita enquanto é rascunho, submete.
//   • Conselho → abre o submetido, corta linha a linha e delibera.
// Quem é Conselho enxerga todas as filiais; os demais, só a própria — a
// mesma régua do banco (auth_pode_filial), repetida aqui só para a UI não
// oferecer o que a RLS vai negar.
//
// O confronto orçado × realizado vem da RPC `orcamento_execucao`, que soma
// contas_pagar por centro de custo dentro do período. Conta sem rubrica não
// entra — por isso a coluna centro_custo_id nasceu junto, na 378.

type Status = 'rascunho' | 'submetido' | 'aprovado' | 'devolvido' | 'reprovado';

type Orcamento = {
  id: string;
  filial: string;
  nome: string;
  periodo_inicio: string;
  periodo_fim: string;
  status: Status;
  observacao: string | null;
  parecer: string | null;
  proposto_por: string | null;
  submetido_em: string | null;
  deliberado_em: string | null;
};

type Execucao = {
  item_id: string;
  centro_custo_id: string;
  centro_codigo: string;
  centro_nome: string;
  valor_proposto: number;
  valor_aprovado: number | null;
  realizado: number;
  saldo: number;
  consumo_pct: number | null;
};

type CentroCusto = { id: string; codigo: string; nome: string };

const STATUS_TOM: Record<Status, string> = {
  rascunho:  'Pendente',
  submetido: 'Pendente',
  aprovado:  'Aprovado',
  devolvido: 'Pendente',
  reprovado: 'Negado',
};

const STATUS_LABEL: Record<Status, string> = {
  rascunho:  'Rascunho',
  submetido: 'Em deliberação',
  aprovado:  'Aprovado',
  devolvido: 'Devolvido para ajuste',
  reprovado: 'Reprovado',
};

export function OrcamentoView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Dois testes diferentes de propósito (migr. 386): `conselho` é VISIBILIDADE
  // — quem enxerga as propostas das 4 unidades, e o CEO precisa enxergar para
  // propor. `podeDeliberar` é o ATO, e aí o CEO fica de fora: quem pede a verba
  // não é quem a concede. Quem barra de verdade é a RPC.
  const conselho = isConselheiro(profile) || profile?.role === 'admin' || profile?.role === 'ceo';
  const podeDeliberar = isConselho(profile);

  // O papel diz o que a pessoa PODE ver; a filial da sessão diz o que ela está
  // vendo AGORA. Quem escolheu SuperMax no seletor está operando a SuperMax —
  // mesmo sendo admin —, e não pode propor orçamento em nome da MaxLook por
  // engano. `filialAtiva = null` é o modo Matriz: aí sim o Conselho enxerga as
  // três para deliberar.
  const { filialAtiva } = useFilial();
  const filiaisVisiveis = useMemo(
    () => (filialAtiva
      ? [filialAtiva]
      : conselho ? [...FILIAIS_OP] : profile?.filial ? [profile.filial] : []),
    [filialAtiva, conselho, profile?.filial],
  );

  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [centros, setCentros]       = useState<CentroCusto[]>([]);
  const [loading, setLoading]       = useState(true);
  const [aberto, setAberto]         = useState<string | null>(null);
  const [execucao, setExecucao]     = useState<Record<string, Execucao[]>>({});
  const [salvando, setSalvando]     = useState(false);

  // Rascunho do corte do Conselho: item_id → valor digitado (string BRL).
  const [corte, setCorte]     = useState<Record<string, string>>({});
  const [parecer, setParecer] = useState('');

  // Nova rubrica
  const [novoCentro, setNovoCentro] = useState('');
  const [novoValor, setNovoValor]   = useState('');

  const carregar = useCallback(async () => {
    if (!supabase || filiaisVisiveis.length === 0) { setLoading(false); return; }
    setLoading(true);
    const [{ data: orcs }, { data: ccs }] = await Promise.all([
      supabase.from('orcamentos_periodo')
        .select('id, filial, nome, periodo_inicio, periodo_fim, status, observacao, parecer, proposto_por, submetido_em, deliberado_em')
        .eq('ativo', true)
        .in('filial', filiaisVisiveis)
        .order('periodo_inicio', { ascending: false }),
      supabase.from('centros_custo')
        .select('id, codigo, nome')
        .eq('ativo', true)
        .order('codigo'),
    ]);
    setOrcamentos((orcs ?? []) as Orcamento[]);
    setCentros((ccs ?? []) as CentroCusto[]);
    setLoading(false);
  }, [filiaisVisiveis]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: a filial vê a decisão do Conselho sem recarregar (a 378 põe
  // orcamentos_periodo na publicação).
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel('orcamentos-periodo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orcamentos_periodo' }, () => carregar())
      .subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, [carregar]);

  const carregarExecucao = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('orcamento_execucao', { p_orcamento_id: id });
    if (error) { showToast(`Erro ao carregar rubricas: ${error.message}`, 'error'); return; }
    const linhas = (data ?? []) as Execucao[];
    setExecucao(prev => ({ ...prev, [id]: linhas }));
    setCorte(Object.fromEntries(
      linhas.map(l => [l.item_id, formatBRL(l.valor_aprovado ?? l.valor_proposto)]),
    ));
  }, [showToast]);

  const alternar = async (id: string) => {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    setParecer('');
    if (!execucao[id]) await carregarExecucao(id);
  };

  const criarOrcamento = async (filial: string) => {
    if (!supabase) return;
    setSalvando(true);
    const ano = new Date().getFullYear();
    const { error } = await supabase.from('orcamentos_periodo').insert({
      filial,
      nome: `Orçamento ${ano}`,
      periodo_inicio: `${ano}-01-01`,
      periodo_fim: `${ano}-12-31`,
      status: 'rascunho',
      proposto_por: profile?.id ?? null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro ao criar: ${error.message}`, 'error'); return; }
    showToast('Rascunho criado. Adicione as rubricas.', 'success');
    carregar();
  };

  const adicionarRubrica = async (orcamentoId: string) => {
    if (!supabase) return;
    const valor = parseBRL(novoValor);
    if (!novoCentro) { showToast('Escolha o centro de custo.', 'error'); return; }
    if (valor <= 0)  { showToast('Informe o valor proposto.', 'error'); return; }
    setSalvando(true);
    const { error } = await supabase.from('orcamento_itens').insert({
      orcamento_id: orcamentoId,
      centro_custo_id: novoCentro,
      valor_proposto: valor,
    });
    setSalvando(false);
    if (error) {
      // UNIQUE (orcamento_id, centro_custo_id) — a mesma rubrica duas vezes
      // seria dois tetos para o mesmo bolso.
      const msg = error.code === '23505'
        ? 'Essa rubrica já está no orçamento.'
        : error.message;
      showToast(`Erro: ${msg}`, 'error');
      return;
    }
    setNovoCentro(''); setNovoValor('');
    carregarExecucao(orcamentoId);
  };

  const removerRubrica = async (orcamentoId: string, itemId: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('orcamento_itens').delete().eq('id', itemId);
    if (error) { showToast(`Erro ao remover: ${error.message}`, 'error'); return; }
    carregarExecucao(orcamentoId);
  };

  const submeter = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('submeter_orcamento', { p_orcamento_id: id });
    setSalvando(false);
    if (error) { showToast(`Erro ao submeter: ${error.message}`, 'error'); return; }
    showToast('Orçamento enviado ao Conselho.', 'success');
    carregar();
  };

  const deliberar = async (id: string, decisao: 'aprovado' | 'devolvido' | 'reprovado') => {
    if (!supabase) return;
    const linhas = execucao[id] ?? [];
    // Só manda valor na aprovação: devolver e reprovar zeram o teto no banco.
    const itens = decisao === 'aprovado'
      ? linhas.map(l => ({ item_id: l.item_id, valor_aprovado: parseBRL(corte[l.item_id] ?? '') }))
      : [];
    setSalvando(true);
    const { error } = await supabase.rpc('deliberar_orcamento', {
      p_orcamento_id: id,
      p_decisao: decisao,
      p_parecer: parecer || null,
      p_itens: itens,
    });
    setSalvando(false);
    if (error) { showToast(`Erro na deliberação: ${error.message}`, 'error'); return; }
    showToast(
      decisao === 'aprovado'  ? 'Orçamento aprovado.'
      : decisao === 'devolvido' ? 'Devolvido para ajuste da filial.'
      : 'Orçamento reprovado.',
      'success',
    );
    setAberto(null);
    carregar();
    carregarExecucao(id);
  };

  if (loading) return <LoadingSpinner />;

  if (filiaisVisiveis.length === 0) {
    return <EmptyState message="Seu perfil não está vinculado a uma filial operacional." />;
  }

  const semOrcamento = filiaisVisiveis.filter(f => !orcamentos.some(o => o.filial === f));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Orçamento</h1>
        <p className="text-sm text-gray-400 mt-1">
          {conselho
            ? 'A filial propõe por centro de custo. O Conselho corta linha a linha e delibera.'
            : 'Monte a proposta por centro de custo e submeta ao Conselho. Antes da aprovação, o teto é zero.'}
        </p>
      </div>

      {semOrcamento.length > 0 && (
        <div className="neu-card p-4 space-y-2">
          <div className="text-sm font-medium text-gray-300">Ainda sem orçamento neste ano</div>
          <div className="flex flex-wrap gap-2">
            {semOrcamento.map(f => (
              <button key={f} disabled={salvando} onClick={() => criarOrcamento(f)}
                className="neu-button px-3 py-2 rounded-xl text-sm text-gray-100 flex items-center gap-2 disabled:opacity-50">
                <Plus size={14} /> Criar para {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {orcamentos.length === 0 ? (
        <EmptyState message="Nenhum orçamento ainda. Crie o rascunho da sua filial para começar." />
      ) : (
        <div className="space-y-3">
          {orcamentos.map(o => {
            const linhas    = execucao[o.id] ?? [];
            const editavel  = (o.status === 'rascunho' || o.status === 'devolvido');
            // Nem o proponente delibera sobre a própria proposta — o guard
            // vale inclusive para conselheiro (a RPC repete a regra).
            const deliberar_ = podeDeliberar && o.status === 'submetido'
              && o.proposto_por !== profile?.id;
            const totalProp = linhas.reduce((s, l) => s + Number(l.valor_proposto), 0);
            const totalApr  = linhas.reduce((s, l) => s + Number(l.valor_aprovado ?? 0), 0);
            const totalReal = linhas.reduce((s, l) => s + Number(l.realizado), 0);

            return (
              <div key={o.id} className="neu-card overflow-hidden">
                <button onClick={() => alternar(o.id)} className="w-full p-4 flex items-center gap-3 text-left">
                  {aberto === o.id ? <ChevronDown size={16} className="text-accent shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />}
                  <FilialBadge filial={o.filial} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">{o.nome}</div>
                    <div className="text-xs text-gray-500">
                      {o.periodo_inicio.split('-').reverse().join('/')} — {o.periodo_fim.split('-').reverse().join('/')}
                    </div>
                  </div>
                  {/* StatusBadge só aceita os tokens que ele sabe colorir; o
                      texto de negócio ("Devolvido para ajuste") vai ao lado. */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline text-xs text-gray-500">{STATUS_LABEL[o.status]}</span>
                    <StatusBadge status={STATUS_TOM[o.status]} />
                  </div>
                </button>

                {aberto === o.id && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
                    {o.parecer && (
                      <div className="text-xs bg-black/20 rounded-xl p-3">
                        <div className="text-gray-500 uppercase tracking-wider font-bold mb-1">Parecer do Conselho</div>
                        <div className="text-gray-300">{o.parecer}</div>
                      </div>
                    )}

                    {linhas.length === 0 ? (
                      <div className="text-sm text-gray-500">Nenhuma rubrica ainda.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wider text-gray-500 text-left">
                              <th className="py-2 pr-3">Centro de custo</th>
                              <th className="py-2 px-3 text-right">Proposto</th>
                              <th className="py-2 px-3 text-right">{deliberar_ ? 'Aprovar' : 'Aprovado'}</th>
                              <th className="py-2 px-3 text-right">Realizado</th>
                              <th className="py-2 px-3 text-right">Saldo</th>
                              {editavel && <th className="py-2 pl-3" />}
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map(l => {
                              const estourou = Number(l.saldo) < 0;
                              return (
                                <tr key={l.item_id} className="border-t border-white/5">
                                  <td className="py-2 pr-3">
                                    <div className="text-gray-200">{l.centro_nome}</div>
                                    <div className="text-xs text-gray-500">{l.centro_codigo}</div>
                                  </td>
                                  <td className="py-2 px-3 text-right tabular-nums text-gray-400">
                                    {formatBRL(l.valor_proposto)}
                                  </td>
                                  <td className="py-2 px-3 text-right tabular-nums">
                                    {deliberar_ ? (
                                      <input
                                        type="text" inputMode="numeric"
                                        value={corte[l.item_id] ?? ''}
                                        onKeyDown={handleMoneyKeyDown}
                                        onChange={e => setCorte(p => ({ ...p, [l.item_id]: formatBRL(e.target.value) }))}
                                        className="neu-input w-28 px-2 py-1 rounded-lg text-right text-sm"
                                      />
                                    ) : (
                                      <span className={l.valor_aprovado == null ? 'text-gray-600' : 'text-gray-100'}>
                                        {l.valor_aprovado == null ? '—' : formatBRL(l.valor_aprovado)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right tabular-nums text-gray-300">
                                    {formatBRL(l.realizado)}
                                    {l.consumo_pct != null && (
                                      <span className={`ml-2 text-xs ${estourou ? 'text-red-400' : 'text-gray-500'}`}>
                                        {l.consumo_pct}%
                                      </span>
                                    )}
                                  </td>
                                  <td className={`py-2 px-3 text-right tabular-nums ${estourou ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                                    {formatBRL(l.saldo)}
                                  </td>
                                  {editavel && (
                                    <td className="py-2 pl-3 text-right">
                                      <button onClick={() => removerRubrica(o.id, l.item_id)}
                                        className="text-gray-500 hover:text-red-400 p-1" title="Remover rubrica">
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-white/10 font-bold text-gray-100">
                              <td className="py-2 pr-3">Total</td>
                              <td className="py-2 px-3 text-right tabular-nums">{formatBRL(totalProp)}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{formatBRL(totalApr)}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{formatBRL(totalReal)}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{formatBRL(totalApr - totalReal)}</td>
                              {editavel && <td />}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {editavel && (
                      <div className="flex flex-wrap items-end gap-2 pt-2">
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-xs text-gray-500 block mb-1">Centro de custo</label>
                          <select value={novoCentro} onChange={e => setNovoCentro(e.target.value)}
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                            <option value="">Selecione…</option>
                            {centros
                              .filter(c => !linhas.some(l => l.centro_custo_id === c.id))
                              .map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
                          </select>
                        </div>
                        <div className="w-36">
                          <label className="text-xs text-gray-500 block mb-1">Valor proposto</label>
                          <input type="text" inputMode="numeric" value={novoValor}
                            onKeyDown={handleMoneyKeyDown}
                            onChange={e => setNovoValor(formatBRL(e.target.value))}
                            placeholder="0,00"
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm text-right" />
                        </div>
                        <button onClick={() => adicionarRubrica(o.id)} disabled={salvando}
                          className="neu-button px-3 py-2 rounded-xl text-sm text-gray-100 flex items-center gap-2 disabled:opacity-50">
                          <Plus size={14} /> Adicionar
                        </button>
                        <div className="flex-1" />
                        <button onClick={() => submeter(o.id)} disabled={salvando || linhas.length === 0}
                          className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                          <Send size={14} /> Submeter ao Conselho
                        </button>
                      </div>
                    )}

                    {/* Por que não há painel de deliberação aqui. Sem esta
                        linha o CEO só vê um botão que sumiu (migr. 386). */}
                    {conselho && o.status === 'submetido' && !deliberar_ && (
                      <div className="text-xs text-yellow-400/80 pt-2">
                        {o.proposto_por === profile?.id
                          ? 'Você propôs este orçamento — não pode deliberar sobre ele.'
                          : 'Deliberação é do Conselho. O CEO propõe e executa; quem concede a verba é outro corpo.'}
                      </div>
                    )}

                    {deliberar_ && (
                      <div className="space-y-3 pt-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Parecer (opcional)</label>
                          <textarea value={parecer} onChange={e => setParecer(e.target.value)} rows={2}
                            placeholder="Justifique cortes e condições."
                            className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => deliberar(o.id, 'aprovado')} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-green-400 font-medium flex items-center gap-2 disabled:opacity-50">
                            <Check size={14} /> Aprovar
                          </button>
                          <button onClick={() => deliberar(o.id, 'devolvido')} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-yellow-400 font-medium flex items-center gap-2 disabled:opacity-50">
                            <Undo2 size={14} /> Devolver para ajuste
                          </button>
                          <button onClick={() => deliberar(o.id, 'reprovado')} disabled={salvando}
                            className="neu-button px-4 py-2 rounded-xl text-sm text-red-400 font-medium flex items-center gap-2 disabled:opacity-50">
                            <X size={14} /> Reprovar
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">
                          Aprovar exige valor em todas as rubricas — zero é corte, campo vazio é omissão.
                        </p>
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
