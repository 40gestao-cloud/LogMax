import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Calendar, Sparkles, Loader2, Plus, Award } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_COLOR: Record<FilialOp, string> = {
  SuperMax: 'text-sky-400',
  MaxLook:  'text-amber-300',
  TechMax:  'text-orange-400',
};

const DIMENSOES: { id: 'logistica'|'financeiro'|'rh'|'vendas'|'marketing'; label: string }[] = [
  { id: 'vendas',     label: 'Vendas' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'logistica',  label: 'Logística' },
  { id: 'rh',         label: 'RH' },
  { id: 'marketing',  label: 'Marketing' },
];

type Competicao = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: 'em_andamento'|'aguardando_encerramento'|'encerrada';
  pesos: Record<string, number>;
  vencedora: string | null;
  created_at: string;
};

type Placar = {
  competicao: any;
  kpis: Record<string, Record<string, number>>;
  placar: {
    por_dimensao: Record<string, { peso: number; filiais: Record<string, { valor: number; pontos: number; ponderado: number }> }>;
    total_por_filial: Record<string, number>;
  };
};

type Tab = 'config' | 'placar';
const fmtDataBR = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

const isoToday   = () => new Date().toISOString().slice(0, 10);
const isoIn = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

export function MatrizCompeticaoView({ showToast, profile }: { showToast: any; profile: UserProfile }) {
  const podeGerenciar = profile.role === 'admin' || profile.role === 'ceo';
  const podeAcessar   = podeGerenciar || isConselheiro(profile);

  const [tab, setTab] = useState<Tab>('placar');
  const [competicoes, setCompeticoes] = useState<Competicao[]>([]);
  const [placar, setPlacar] = useState<Placar | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPlacar, setLoadingPlacar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Form da nova competição
  const [form, setForm] = useState({
    nome: '',
    data_inicio: isoToday(),
    data_fim: isoIn(90),
    pesos: { logistica: 20, financeiro: 25, rh: 15, vendas: 25, marketing: 15 },
  });

  const somaPesos = useMemo(() =>
    Object.values(form.pesos).reduce((a, b) => a + Number(b || 0), 0),
    [form.pesos],
  );

  const ativa = useMemo(() => competicoes.find(c => c.status === 'em_andamento') ?? null, [competicoes]);
  const aguardando = useMemo(() => competicoes.filter(c => c.status === 'aguardando_encerramento'), [competicoes]);

  const carregarLista = useCallback(async () => {
    if (!supabase) return;
    setLoadingList(true);
    const { data } = await supabase
      .from('competicoes_matriz')
      .select('id, nome, data_inicio, data_fim, status, pesos, vencedora, created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: false });
    setCompeticoes(data ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => { if (podeAcessar) carregarLista(); }, [podeAcessar, carregarLista]);

  const carregarPlacar = useCallback(async (id: string) => {
    if (!supabase) return;
    setLoadingPlacar(true);
    setPlacar(null);
    const { data, error } = await supabase.rpc('calcular_placar_competicao', { p_competicao_id: id });
    if (error) {
      showToast?.(`Erro ao calcular placar: ${error.message}`, 'error');
    } else {
      setPlacar(data as Placar);
    }
    setLoadingPlacar(false);
  }, [showToast]);

  useEffect(() => {
    const alvo = ativa ?? aguardando[0] ?? null;
    if (alvo) carregarPlacar(alvo.id);
    else setPlacar(null);
  }, [ativa, aguardando, carregarPlacar]);

  const criar = async () => {
    if (!supabase) return;
    if (!form.nome.trim()) return showToast?.('Informe o nome da competição.', 'error');
    if (somaPesos !== 100) return showToast?.(`Soma dos pesos precisa ser 100 (agora: ${somaPesos}).`, 'error');
    setSalvando(true);
    const { error } = await supabase.rpc('criar_competicao', {
      p_nome: form.nome.trim(),
      p_data_inicio: form.data_inicio,
      p_data_fim: form.data_fim,
      p_pesos: form.pesos,
    });
    setSalvando(false);
    if (error) {
      showToast?.(`Erro: ${error.message}`, 'error');
      return;
    }
    showToast?.('Competição criada!', 'success');
    setForm(f => ({ ...f, nome: '' }));
    await carregarLista();
    setTab('placar');
  };

  if (!podeAcessar) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md text-center">
          <Trophy size={28} className="text-gray-500 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Competição visível apenas para Admin, CEO e Conselheiros.</p>
        </div>
      </div>
    );
  }

  // Pódio ordenado por pontuação total
  const podio = useMemo(() => {
    if (!placar) return [];
    const totais = placar.placar?.total_por_filial ?? {};
    return OP_FILIAIS
      .map(f => ({ filial: f, total: Number(totais[f] ?? 0) }))
      .sort((a, b) => b.total - a.total);
  }, [placar]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
            <Trophy size={24} /> Competição entre Filiais
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Ranking 3-2-1 por dimensão × peso configurável = pontuação total por filial.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['placar','config'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
                tab === t ? 'bg-accent/15 text-accent border border-accent/30' : 'neu-button text-gray-400 hover:text-white'
              }`}>
              {t === 'placar' ? 'Placar' : 'Config'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'placar' && (
        <>
          {loadingList || loadingPlacar ? (
            <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
          ) : !placar ? (
            <div className="neu-flat rounded-3xl p-12 border border-white/5">
              <EmptyState message="Nenhuma competição em andamento. Vá em Config pra criar." />
            </div>
          ) : (
            <>
              {/* Cabeçalho da competição + pódio */}
              <div className="neu-flat rounded-3xl p-6 border border-accent/20">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Competição ativa</p>
                    <h3 className="text-lg font-black text-gray-100">{placar.competicao.nome}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                      <Calendar size={11} />
                      {fmtDataBR(placar.competicao.data_inicio)} → {fmtDataBR(placar.competicao.data_fim)}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg ${
                    placar.competicao.status === 'em_andamento'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                  }`}>
                    {placar.competicao.status === 'em_andamento' ? 'Em andamento' : 'Aguardando encerramento'}
                  </span>
                </div>

                {/* Pódio */}
                <div className="grid grid-cols-3 gap-3">
                  {podio.map((p, idx) => (
                    <div key={p.filial}
                      className={`neu-pressed rounded-2xl p-4 text-center ${idx === 0 ? 'ring-1 ring-emerald-500/40' : ''}`}>
                      <div className="flex items-center justify-center gap-1 mb-1">
                        {idx === 0 && <Award size={14} className="text-emerald-400" />}
                        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">
                          {['1º','2º','3º'][idx]}
                        </span>
                      </div>
                      <p className={`text-xs font-black uppercase tracking-wider ${FILIAL_COLOR[p.filial]}`}>{p.filial}</p>
                      <p className={`text-2xl font-black font-mono tabular-nums mt-1 ${idx === 0 ? 'text-emerald-400' : 'text-gray-200'}`}>
                        {p.total.toFixed(2)}
                      </p>
                      <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-0.5">pontos</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabela por dimensão */}
              <div className="neu-flat rounded-3xl p-5 border border-white/5">
                <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                  <Sparkles size={13} className="text-accent" /> Ranking por dimensão
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                      <tr>
                        <th className="text-left pb-3 font-bold">Dimensão</th>
                        <th className="text-right pb-3 font-bold pr-4">Peso</th>
                        {OP_FILIAIS.map(f => (
                          <th key={f} className={`text-right pb-3 font-bold pr-4 ${FILIAL_COLOR[f]}`}>{f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DIMENSOES.map(d => {
                        const dim = placar.placar?.por_dimensao?.[d.id];
                        if (!dim) return null;
                        return (
                          <tr key={d.id} className="border-t border-white/5">
                            <td className="py-3 text-gray-200 font-bold">{d.label}</td>
                            <td className="py-3 text-right text-gray-500 tabular-nums pr-4">{dim.peso}%</td>
                            {OP_FILIAIS.map(f => {
                              const cell = dim.filiais?.[f];
                              const pts = Number(cell?.pontos ?? 0);
                              const isBest = pts === Math.max(...OP_FILIAIS.map(x => Number(dim.filiais?.[x]?.pontos ?? 0)));
                              return (
                                <td key={f} className="py-3 text-right tabular-nums pr-4">
                                  <div className={isBest ? 'text-emerald-400 font-bold' : 'text-gray-300'}>
                                    {pts.toFixed(1)} pts
                                  </div>
                                  <div className="text-[10px] text-gray-500">
                                    {typeof cell?.valor === 'number'
                                      ? cell.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
                                      : '—'}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-500 mt-3">
                  Ranking 3-2-1 por linha × peso da dimensão. Empate divide igual.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'config' && (
        <>
          {podeGerenciar && (
            <div className="neu-flat rounded-3xl p-6 border border-white/5">
              <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                <Plus size={13} className="text-accent" /> Nova competição
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="md:col-span-3">
                  <FormField label="Nome">
                    <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full" placeholder="Ex.: Trimestre Q3 2026" />
                  </FormField>
                </div>
                <FormField label="Início">
                  <input type="date" value={form.data_inicio}
                    onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
                <FormField label="Fim">
                  <input type="date" value={form.data_fim}
                    onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
                <div />
              </div>

              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                Pesos das dimensões · soma atual: <span className={somaPesos === 100 ? 'text-emerald-400' : 'text-red-400'}>{somaPesos}%</span>
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {DIMENSOES.map(d => (
                  <FormField key={d.id} label={`${d.label} (%)`}>
                    <input type="number" min={0} max={100} value={form.pesos[d.id]}
                      onChange={e => setForm(f => ({ ...f, pesos: { ...f.pesos, [d.id]: Number(e.target.value) || 0 } }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full tabular-nums" />
                  </FormField>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-end">
                <NeuButtonAccent onClick={criar} disabled={salvando || somaPesos !== 100 || !form.nome.trim()} variant="">
                  {salvando ? <><Loader2 size={13} className="animate-spin" /> Criando…</> : <><Plus size={13} /> Criar competição</>}
                </NeuButtonAccent>
              </div>
            </div>
          )}

          <div className="neu-flat rounded-3xl p-5 border border-white/5">
            <h3 className="text-sm font-bold text-gray-200 mb-4">Histórico de competições</h3>
            {loadingList ? (
              <LoadingSpinner />
            ) : competicoes.length === 0 ? (
              <EmptyState message="Nenhuma competição criada ainda." />
            ) : (
              <div className="flex flex-col gap-2">
                {competicoes.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-xl border border-white/5 hover:border-accent/30 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-200 truncate">{c.nome}</p>
                      <p className="text-[10px] text-gray-500">
                        {fmtDataBR(c.data_inicio)} → {fmtDataBR(c.data_fim)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.vencedora && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${FILIAL_COLOR[c.vencedora as FilialOp] ?? ''}`}>
                          🏆 {c.vencedora}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg ${
                        c.status === 'em_andamento' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : c.status === 'aguardando_encerramento' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                          : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                      }`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
