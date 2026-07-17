import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Calendar, Sparkles, Loader2, Plus, Award, ThumbsUp, ThumbsDown, MessageCircle, X, Crown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
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

type DimId = 'logistica'|'financeiro'|'rh'|'vendas'|'marketing';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const PCT = (v: number) => `${v.toFixed(1)}%`;

const DIMENSOES: { id: DimId; label: string; hint: string; fmt: (v: number) => string }[] = [
  { id: 'vendas',     label: 'Vendas',     hint: 'faturamento no período',              fmt: BRL },
  { id: 'financeiro', label: 'Financeiro', hint: 'receitas − despesas pagas',           fmt: BRL },
  { id: 'logistica',  label: 'Logística',  hint: '% do catálogo fora do crítico',       fmt: PCT },
  { id: 'rh',         label: 'RH',         hint: 'taxa de presença no período',         fmt: PCT },
  { id: 'marketing',  label: 'Marketing',  hint: 'receita de campanhas ativas',         fmt: BRL },
];

type Competicao = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: 'em_andamento'|'aguardando_encerramento'|'encerrada';
  pesos: Record<string, number>;
  vencedora: string | null;
  analise_ia: string | null;
  placar_snapshot: any | null;
  created_at: string;
};

type Voto = {
  id: string;
  competicao_id: string;
  votante_id: string;
  voto: 'aceita' | 'rejeita';
  filial_escolhida: string | null;
  comentario: string | null;
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

type Tab = 'config' | 'placar' | 'historico';
const fmtDataBR = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

const isoToday   = () => new Date().toISOString().slice(0, 10);
const isoIn = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

export function MatrizCompeticaoView({ showToast, profile }: { showToast: any; profile: UserProfile }) {
  const { session } = useAuth();
  const podeGerenciar = profile.role === 'admin' || profile.role === 'ceo';
  const podeVotar     = podeGerenciar || isConselheiro(profile);
  const podeAcessar   = podeVotar;

  const [tab, setTab] = useState<Tab>('placar');
  const [competicoes, setCompeticoes] = useState<Competicao[]>([]);
  const [placar, setPlacar] = useState<Placar | null>(null);
  const [competicaoAtual, setCompeticaoAtual] = useState<Competicao | null>(null);
  const [votos, setVotos] = useState<Voto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPlacar, setLoadingPlacar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerandoAnalise, setGerandoAnalise] = useState(false);
  const [votando, setVotando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [modalParabens, setModalParabens] = useState<string | null>(null);

  // Voto em elaboração
  const [meuVoto, setMeuVoto] = useState<'aceita' | 'rejeita' | ''>('');
  const [comentario, setComentario] = useState('');
  const [filialSugerida, setFilialSugerida] = useState<FilialOp | ''>('');

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
      .select('id, nome, data_inicio, data_fim, status, pesos, vencedora, analise_ia, placar_snapshot, created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: false });
    setCompeticoes(data ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => { if (podeAcessar) carregarLista(); }, [podeAcessar, carregarLista]);

  const carregarVotos = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('competicao_votos')
      .select('id, competicao_id, votante_id, voto, filial_escolhida, comentario, created_at')
      .eq('competicao_id', id)
      .order('created_at', { ascending: true });
    setVotos(data ?? []);
  }, []);

  const carregarPlacar = useCallback(async (comp: Competicao) => {
    if (!supabase) return;
    setLoadingPlacar(true);
    setPlacar(null);
    setCompeticaoAtual(comp);
    const { data, error } = await supabase.rpc('calcular_placar_competicao', { p_competicao_id: comp.id });
    if (error) {
      showToast?.(`Erro ao calcular placar: ${error.message}`, 'error');
    } else {
      setPlacar(data as Placar);
    }
    await carregarVotos(comp.id);
    setLoadingPlacar(false);
  }, [showToast, carregarVotos]);

  useEffect(() => {
    // Prioridade: em_andamento > aguardando_encerramento > última encerrada
    const alvo = ativa ?? aguardando[0] ?? competicoes.find(c => c.status === 'encerrada') ?? null;
    if (alvo) carregarPlacar(alvo);
    else { setPlacar(null); setCompeticaoAtual(null); }
  }, [ativa, aguardando, competicoes, carregarPlacar]);

  const jaVotei = useMemo(() => votos.some(v => v.votante_id === profile.id), [votos, profile.id]);
  const contagemVotos = useMemo(() => ({
    aceita:  votos.filter(v => v.voto === 'aceita').length,
    rejeita: votos.filter(v => v.voto === 'rejeita').length,
  }), [votos]);

  const gerarAnalise = async () => {
    if (!competicaoAtual || !session?.access_token) return;
    setGerandoAnalise(true);
    try {
      const resp = await fetch('/api/ai-competicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ competicao_id: competicaoAtual.id }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showToast?.(data?.error ?? 'Falha na IA.', 'error');
      } else {
        showToast?.(data.from_cache ? 'Análise recuperada do cache.' : 'Análise gerada!', 'success');
        await carregarLista();
      }
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro de rede.', 'error');
    }
    setGerandoAnalise(false);
  };

  const registrarVoto = async () => {
    if (!competicaoAtual || !supabase || !meuVoto) return;
    if (meuVoto === 'rejeita' && !filialSugerida) {
      return showToast?.('Ao rejeitar, indique qual filial você acha vencedora.', 'error');
    }
    setVotando(true);
    const { error } = await supabase.from('competicao_votos').insert({
      competicao_id: competicaoAtual.id,
      votante_id:    profile.id,
      voto:          meuVoto,
      filial_escolhida: meuVoto === 'rejeita' ? filialSugerida : null,
      comentario:    comentario.trim() || null,
    });
    setVotando(false);
    if (error) return showToast?.(`Erro ao votar: ${error.message}`, 'error');
    showToast?.('Voto registrado.', 'success');
    setMeuVoto(''); setComentario(''); setFilialSugerida('');
    await carregarVotos(competicaoAtual.id);
  };

  const declararVencedora = async (filial: FilialOp) => {
    if (!competicaoAtual || !supabase) return;
    if (!confirm(`Confirma declarar ${filial} como vencedora de "${competicaoAtual.nome}"?`)) return;
    setEncerrando(true);
    const { error } = await supabase.rpc('declarar_vencedora', {
      p_competicao_id: competicaoAtual.id,
      p_vencedora: filial,
    });
    setEncerrando(false);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    setModalParabens(filial);
    await carregarLista();
  };

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
          {(['placar','config','historico'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
                tab === t ? 'bg-accent/15 text-accent border border-accent/30' : 'neu-button text-gray-400 hover:text-white'
              }`}>
              {t === 'placar' ? 'Placar' : t === 'config' ? 'Config' : 'Histórico'}
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
                            <td className="py-3">
                              <div className="text-gray-200 font-bold">{d.label}</div>
                              <div className="text-[10px] text-gray-500">{d.hint}</div>
                            </td>
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
                                    {typeof cell?.valor === 'number' ? d.fmt(cell.valor) : '—'}
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

              {/* Análise IA */}
              {competicaoAtual && competicaoAtual.status !== 'em_andamento' && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <Sparkles size={13} className="text-accent" /> Análise IA
                    </h3>
                    {competicaoAtual.status !== 'encerrada' && (
                      <NeuButtonAccent onClick={gerarAnalise} disabled={gerandoAnalise} variant="">
                        {gerandoAnalise
                          ? <><Loader2 size={12} className="animate-spin" /> Analisando…</>
                          : <><Sparkles size={12} /> {competicaoAtual.analise_ia ? 'Regenerar' : 'Gerar análise'}</>}
                      </NeuButtonAccent>
                    )}
                  </div>
                  {competicaoAtual.analise_ia ? (
                    <div className="text-sm text-gray-200 leading-relaxed">
                      <ReactMarkdown>{competicaoAtual.analise_ia}</ReactMarkdown>
                    </div>
                  ) : (
                    <EmptyState message="Análise ainda não gerada. Clique em Gerar análise pra ouvir a opinião da IA." />
                  )}
                </div>
              )}

              {/* Votação */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && podeVotar && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <MessageCircle size={13} className="text-accent" /> Votação do conselho
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                      <span className="text-emerald-400">Aceita: {contagemVotos.aceita}</span>
                      <span className="text-red-400">Rejeita: {contagemVotos.rejeita}</span>
                    </div>
                  </div>

                  {jaVotei ? (
                    <p className="text-xs text-gray-400 mb-4">
                      Você já registrou seu voto. Aguarde os demais eleitores.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setMeuVoto('aceita')}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                            meuVoto === 'aceita'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                              : 'neu-button text-gray-400 hover:text-white'
                          }`}>
                          <ThumbsUp size={13} /> Aceito o placar
                        </button>
                        <button onClick={() => setMeuVoto('rejeita')}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                            meuVoto === 'rejeita'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/40'
                              : 'neu-button text-gray-400 hover:text-white'
                          }`}>
                          <ThumbsDown size={13} /> Rejeito
                        </button>
                      </div>

                      {meuVoto === 'rejeita' && (
                        <FormField label="Filial que você acha vencedora">
                          <select value={filialSugerida}
                            onChange={e => setFilialSugerida(e.target.value as FilialOp)}
                            className="neu-input rounded-lg px-3 py-2 text-xs w-full">
                            <option value="">Selecione…</option>
                            {OP_FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </FormField>
                      )}

                      {meuVoto && (
                        <>
                          <FormField label="Comentário (opcional)">
                            <textarea value={comentario} onChange={e => setComentario(e.target.value)}
                              className="neu-input rounded-lg px-3 py-2 text-xs w-full" rows={2}
                              placeholder="Justifique seu voto…" />
                          </FormField>
                          <div className="flex justify-end">
                            <NeuButtonAccent onClick={registrarVoto} disabled={votando} variant="">
                              {votando ? <><Loader2 size={12} className="animate-spin" /> Registrando…</> : 'Registrar voto'}
                            </NeuButtonAccent>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {votos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">
                        Votos registrados ({votos.length})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {votos.map(v => (
                          <div key={v.id} className="flex items-start gap-2 text-xs">
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                              v.voto === 'aceita'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}>
                              {v.voto === 'aceita' ? 'Aceita' : `Rejeita → ${v.filial_escolhida}`}
                            </span>
                            <span className="text-gray-400 truncate">{v.comentario ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Declaração de vencedora */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && podeVotar && votos.length > 0 && (
                <div className="neu-flat rounded-3xl p-5 border border-accent/30">
                  <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-2">
                    <Crown size={13} className="text-accent" /> Declarar vencedora
                  </h3>
                  <p className="text-xs text-gray-400 mb-4">
                    Sugestão do placar automático: <span className="text-emerald-400 font-bold">{podio[0]?.filial}</span> ({podio[0]?.total.toFixed(2)} pts).
                    Se maioria rejeitou o placar, escolha manualmente a filial vencedora.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {OP_FILIAIS.map(f => (
                      <button key={f} onClick={() => declararVencedora(f)} disabled={encerrando}
                        className={`neu-button rounded-xl p-3 text-xs font-bold uppercase tracking-widest transition-colors ${FILIAL_COLOR[f]} hover:border-accent`}
                        style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                        {encerrando ? <Loader2 size={12} className="animate-spin inline" /> : `Declarar ${f}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Estado encerrado — mostra vencedora + votos */}
              {competicaoAtual && competicaoAtual.status === 'encerrada' && (
                <div className="neu-flat rounded-3xl p-6 border border-emerald-500/30 text-center">
                  <Crown size={32} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Vencedora declarada</p>
                  <p className={`text-2xl font-black tracking-wider mt-1 ${FILIAL_COLOR[competicaoAtual.vencedora as FilialOp]}`}>
                    🏆 {competicaoAtual.vencedora}
                  </p>
                  {votos.length > 0 && (
                    <p className="text-[10px] text-gray-500 mt-3">
                      {contagemVotos.aceita} aceita · {contagemVotos.rejeita} rejeita
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal de parabenização */}
      <AnimatePresence>
        {modalParabens && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            onClick={() => setModalParabens(null)}
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              className="neu-flat rounded-3xl p-8 sm:p-12 border border-emerald-500/40 max-w-lg w-full text-center relative"
              onClick={e => e.stopPropagation()}
              style={{ background: 'radial-gradient(circle at top, rgba(16,185,129,0.15), transparent 70%)' }}
            >
              <button onClick={() => setModalParabens(null)}
                className="absolute top-4 right-4 text-gray-500 hover:text-white">
                <X size={18} />
              </button>
              <div className="text-7xl mb-3">🏆</div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 mb-2">
                Parabéns
              </p>
              <h2 className={`text-4xl font-black tracking-wider ${FILIAL_COLOR[modalParabens as FilialOp]}`}>
                {modalParabens}
              </h2>
              <p className="text-sm text-gray-300 mt-4">
                venceu a competição <strong>{competicaoAtual?.nome}</strong>!
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Período: {fmtDataBR(competicaoAtual?.data_inicio ?? '')} → {fmtDataBR(competicaoAtual?.data_fim ?? '')}
              </p>
              <div className="mt-6">
                <NeuButtonAccent onClick={() => setModalParabens(null)} variant="">
                  Fechar
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
            <h3 className="text-sm font-bold text-gray-200 mb-4">Todas as competições</h3>
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

      {tab === 'historico' && (
        <>
          {loadingList ? (
            <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
          ) : (() => {
            const encerradas = competicoes.filter(c => c.status === 'encerrada');
            if (encerradas.length === 0) {
              return (
                <div className="neu-flat rounded-3xl p-12 border border-white/5">
                  <EmptyState message="Nenhuma competição encerrada ainda." />
                </div>
              );
            }
            return (
              <div className="flex flex-col gap-4">
                {encerradas.map(c => {
                  const snap = c.placar_snapshot as Placar | null;
                  const totais = snap?.placar?.total_por_filial ?? {};
                  const podioSnap = OP_FILIAIS
                    .map(f => ({ filial: f, total: Number(totais[f] ?? 0) }))
                    .sort((a, b) => b.total - a.total);
                  return (
                    <div key={c.id} className="neu-flat rounded-3xl p-5 border border-white/5">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          <h4 className="text-base font-bold text-gray-100">{c.nome}</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {fmtDataBR(c.data_inicio)} → {fmtDataBR(c.data_fim)}
                          </p>
                        </div>
                        {c.vencedora && (
                          <span className={`text-sm font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 ${FILIAL_COLOR[c.vencedora as FilialOp] ?? ''}`}>
                            🏆 {c.vencedora}
                          </span>
                        )}
                      </div>
                      {snap ? (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {podioSnap.map((p, idx) => (
                            <div key={p.filial}
                              className={`neu-pressed rounded-xl p-3 text-center ${p.filial === c.vencedora ? 'ring-1 ring-emerald-500/40' : ''}`}>
                              <p className={`text-[10px] font-black uppercase tracking-widest ${FILIAL_COLOR[p.filial]}`}>
                                {['1º','2º','3º'][idx]} · {p.filial}
                              </p>
                              <p className={`text-lg font-black font-mono tabular-nums mt-1 ${p.filial === c.vencedora ? 'text-emerald-400' : 'text-gray-200'}`}>
                                {p.total.toFixed(2)} pts
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-500 mb-3">Placar snapshot indisponível.</p>
                      )}
                      {c.analise_ia && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-accent">
                            Análise IA
                          </summary>
                          <div className="mt-3 text-gray-300 leading-relaxed">
                            <ReactMarkdown>{c.analise_ia}</ReactMarkdown>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </motion.div>
  );
}
