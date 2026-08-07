import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Calculator, Coins, Plus, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, StatusBadge, FilialBadge } from '../components/ui';
import { formatBRL } from '../lib/viewUtils';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

// Remuneração variável (migração 382) — o placar da competição vira dinheiro
// na carteira de bonificações do MaxBank.
//
// fator = (peso_placar × nota_placar + peso_metas × atingimento) / 10000
// bônus = salário_base × percentual_salario% × fator
//
// Apurar e pagar são atos separados de propósito: apuração é conta, pagamento
// é dinheiro. O Conselho confere a conta antes de mandar creditar.
//
// Colaborador enxerga só o próprio item (RLS); o Conselho enxerga todos.

type Politica = {
  id: string; nome: string; vigencia_inicio: string; vigencia_fim: string | null;
  peso_placar: number; peso_metas: number; percentual_salario: number; nota_minima: number;
};

type Apuracao = {
  id: string; competicao_id: string; politica_id: string;
  status: 'calculada' | 'paga'; total: number; apurado_em: string; pago_em: string | null;
};

type Item = {
  id: string; apuracao_id: string; colaborador_id: string; filial: string;
  salario_base: number; nota_placar: number; atingimento: number;
  fator: number; valor_bonus: number; motivo_zero: string | null;
};

type Competicao = { id: string; nome: string; status: string; data_inicio: string; data_fim: string };

export function RemuneracaoVariavelView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const conselho = isConselheiro(profile) || profile?.role === 'admin' || profile?.role === 'ceo';

  const [politicas, setPoliticas]   = useState<Politica[]>([]);
  const [apuracoes, setApuracoes]   = useState<Apuracao[]>([]);
  const [competicoes, setComp]      = useState<Competicao[]>([]);
  const [itens, setItens]           = useState<Record<string, Item[]>>({});
  const [loading, setLoading]       = useState(true);
  const [salvando, setSalvando]     = useState(false);
  const [aberta, setAberta]         = useState<string | null>(null);

  const [novaPolitica, setNovaPolitica] = useState(false);
  const [pol, setPol] = useState({
    nome: '', vigencia_inicio: new Date().toISOString().slice(0, 10),
    peso_placar: 70, peso_metas: 30, percentual_salario: 10, nota_minima: 60,
  });

  const [compSel, setCompSel] = useState('');
  const [polSel, setPolSel]   = useState('');

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [{ data: pols }, { data: aps }, { data: comps }] = await Promise.all([
      supabase.from('politicas_remuneracao')
        .select('id, nome, vigencia_inicio, vigencia_fim, peso_placar, peso_metas, percentual_salario, nota_minima')
        .eq('ativo', true).order('vigencia_inicio', { ascending: false }),
      supabase.from('apuracoes_bonus')
        .select('id, competicao_id, politica_id, status, total, apurado_em, pago_em')
        .eq('ativo', true).order('apurado_em', { ascending: false }),
      supabase.from('competicoes_matriz')
        .select('id, nome, status, data_inicio, data_fim')
        .eq('ativo', true).order('data_inicio', { ascending: false }),
    ]);
    setPoliticas((pols ?? []) as Politica[]);
    setApuracoes((aps ?? []) as Apuracao[]);
    setComp((comps ?? []) as Competicao[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarItens = useCallback(async (apuracaoId: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('apuracao_bonus_itens')
      .select('id, apuracao_id, colaborador_id, filial, salario_base, nota_placar, atingimento, fator, valor_bonus, motivo_zero')
      .eq('apuracao_id', apuracaoId)
      .order('valor_bonus', { ascending: false });
    setItens(p => ({ ...p, [apuracaoId]: (data ?? []) as Item[] }));
  }, []);

  const alternar = async (id: string) => {
    if (aberta === id) { setAberta(null); return; }
    setAberta(id);
    if (!itens[id]) await carregarItens(id);
  };

  const criarPolitica = async () => {
    if (!supabase) return;
    if (pol.peso_placar + pol.peso_metas !== 100) {
      showToast('Os pesos precisam somar 100.', 'error'); return;
    }
    setSalvando(true);
    const { error } = await supabase.from('politicas_remuneracao').insert({
      ...pol, criado_por: profile?.id ?? null, criado_por_nome: profile?.nome ?? null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    showToast('Política registrada.', 'success');
    setNovaPolitica(false);
    carregar();
  };

  const apurar = async () => {
    if (!supabase) return;
    if (!compSel || !polSel) { showToast('Escolha competição e política.', 'error'); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc('apurar_bonus', {
      p_competicao_id: compSel, p_politica_id: polSel,
    });
    setSalvando(false);
    if (error) { showToast(`Erro na apuração: ${error.message}`, 'error'); return; }
    const d = data as any;
    showToast(`Apuração concluída: ${d?.pessoas ?? 0} pessoa(s), total R$ ${formatBRL(Number(d?.total ?? 0))}.`, 'success');
    carregar();
  };

  const pagar = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('pagar_bonus', { p_apuracao_id: id });
    setSalvando(false);
    if (error) { showToast(`Erro no pagamento: ${error.message}`, 'error'); return; }
    const d = data as any;
    showToast(`${d?.creditos ?? 0} carteira(s) creditada(s).`, 'success');
    carregar();
  };

  if (loading) return <LoadingSpinner />;

  const nomeComp = (id: string) => competicoes.find(c => c.id === id)?.nome ?? '—';
  const nomePol  = (id: string) => politicas.find(p => p.id === id)?.nome ?? '—';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Remuneração Variável</h1>
        <p className="text-sm text-gray-400 mt-1">
          O placar da competição e o atingimento das metas viram crédito na carteira de
          bonificações. A régua é pública — bônus com critério secreto não motiva ninguém.
        </p>
      </div>

      {/* ── Políticas ── */}
      <div className="neu-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-300">Políticas aprovadas</div>
          {conselho && (
            <button onClick={() => setNovaPolitica(v => !v)}
              className="neu-button px-3 py-1.5 rounded-xl text-xs text-gray-100 flex items-center gap-2">
              <Plus size={13} /> Nova política
            </button>
          )}
        </div>

        {novaPolitica && (
          <div className="grid sm:grid-cols-3 gap-3 bg-black/20 rounded-xl p-3">
            <Campo rotulo="Nome">
              <input value={pol.nome} onChange={e => setPol(p => ({ ...p, nome: e.target.value }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </Campo>
            <Campo rotulo="Vigência a partir de">
              <input type="date" value={pol.vigencia_inicio}
                onChange={e => setPol(p => ({ ...p, vigencia_inicio: e.target.value }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </Campo>
            <Campo rotulo="Bônus (% do salário)">
              <input type="number" min={0} max={100} value={pol.percentual_salario}
                onChange={e => setPol(p => ({ ...p, percentual_salario: Number(e.target.value) }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </Campo>
            <Campo rotulo="Peso do placar (%)">
              <input type="number" min={0} max={100} value={pol.peso_placar}
                onChange={e => setPol(p => ({ ...p, peso_placar: Number(e.target.value), peso_metas: 100 - Number(e.target.value) }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </Campo>
            <Campo rotulo="Peso das metas (%)">
              <input type="number" value={pol.peso_metas} readOnly
                className="neu-input w-full px-3 py-2 rounded-xl text-sm opacity-60" />
            </Campo>
            <Campo rotulo="Gatilho — placar mínimo">
              <input type="number" min={0} max={100} value={pol.nota_minima}
                onChange={e => setPol(p => ({ ...p, nota_minima: Number(e.target.value) }))}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </Campo>
            <div className="sm:col-span-3">
              <button onClick={criarPolitica} disabled={salvando || !pol.nome}
                className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                Registrar política
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Abaixo do gatilho, a filial inteira fica sem bônus — bônus é coletivo,
                é o que o diferencia de comissão.
              </p>
            </div>
          </div>
        )}

        {politicas.length === 0 ? (
          <div className="text-xs text-gray-500">Nenhuma política aprovada ainda.</div>
        ) : politicas.map(p => (
          <div key={p.id} className="bg-black/20 rounded-xl p-3 text-sm">
            <div className="text-gray-200">{p.nome}</div>
            <div className="text-xs text-gray-500">
              Desde {p.vigencia_inicio.split('-').reverse().join('/')} ·
              {' '}placar {p.peso_placar}% / metas {p.peso_metas}% ·
              {' '}teto {p.percentual_salario}% do salário · gatilho {p.nota_minima}
            </div>
          </div>
        ))}
      </div>

      {/* ── Apurar ── */}
      {conselho && (
        <div className="neu-card p-4 space-y-3">
          <div className="text-sm font-medium text-gray-300">Apurar competição</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Campo rotulo="Competição">
              <select value={compSel} onChange={e => setCompSel(e.target.value)}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                <option value="">Selecione…</option>
                {competicoes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.status})</option>)}
              </select>
            </Campo>
            <Campo rotulo="Política">
              <select value={polSel} onChange={e => setPolSel(e.target.value)}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                <option value="">Selecione…</option>
                {politicas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <div className="flex items-end">
              <button onClick={apurar} disabled={salvando}
                className="neu-button w-full px-3 py-2 rounded-xl text-sm text-accent font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                <Calculator size={14} /> Apurar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apurações ── */}
      {apuracoes.length === 0 ? (
        <EmptyState message="Nenhuma apuração ainda." />
      ) : (
        <div className="space-y-3">
          {apuracoes.map(a => {
            const linhas = itens[a.id] ?? [];
            return (
              <div key={a.id} className="neu-card overflow-hidden">
                <button onClick={() => alternar(a.id)} className="w-full p-4 flex items-center gap-3 text-left">
                  <Coins size={16} className="text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">{nomeComp(a.competicao_id)}</div>
                    <div className="text-xs text-gray-500">
                      {nomePol(a.politica_id)} · total R$ {formatBRL(Number(a.total))}
                    </div>
                  </div>
                  <StatusBadge status={a.status === 'paga' ? 'Pago' : 'Pendente'} />
                </button>

                {aberta === a.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-4">
                    {linhas.length === 0 ? (
                      <div className="text-xs text-gray-500">
                        Nenhum item visível para você. Cada pessoa enxerga só o próprio bônus.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wider text-gray-500 text-left">
                              <th className="py-2 pr-3">Unidade</th>
                              <th className="py-2 px-3 text-right">Salário</th>
                              <th className="py-2 px-3 text-right">Placar</th>
                              <th className="py-2 px-3 text-right">Metas</th>
                              <th className="py-2 px-3 text-right">Bônus</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linhas.map(l => (
                              <tr key={l.id} className="border-t border-white/5">
                                <td className="py-2 pr-3"><FilialBadge filial={l.filial} /></td>
                                <td className="py-2 px-3 text-right tabular-nums text-gray-400">{formatBRL(Number(l.salario_base))}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-gray-300">{Number(l.nota_placar).toFixed(1)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-gray-300">{Number(l.atingimento).toFixed(0)}%</td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {Number(l.valor_bonus) > 0
                                    ? <span className="text-green-400 font-medium">{formatBRL(Number(l.valor_bonus))}</span>
                                    : <span className="text-gray-600" title={l.motivo_zero ?? ''}>0,00</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {linhas.some(l => Number(l.valor_bonus) === 0 && l.motivo_zero) && (
                          <p className="text-xs text-gray-500 mt-2">
                            Bônus zerado: {linhas.find(l => l.motivo_zero)?.motivo_zero}
                          </p>
                        )}
                      </div>
                    )}

                    {conselho && a.status === 'calculada' && (
                      <button onClick={() => pagar(a.id)} disabled={salvando}
                        className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium flex items-center gap-2 disabled:opacity-50">
                        <Wallet size={14} /> Creditar nas carteiras
                      </button>
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

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{rotulo}</label>
      {children}
    </div>
  );
}
