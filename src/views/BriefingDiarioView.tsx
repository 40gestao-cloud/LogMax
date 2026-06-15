import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2, Lock, Calendar, CheckCircle2, X, Edit3, History, ListTodo, AlertTriangle, Send, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

const SETOR_LABEL: Record<string, string> = {
  empresa:    'Empresa',
  compras:    'Compras',
  estoque:    'Estoque',
  financeiro: 'Financeiro',
  rh:         'Recursos Humanos',
  vendas:     'Vendas',
};

const SETOR_COLOR: Record<string, string> = {
  empresa:    'bg-purple-500/10  text-purple-400  border-purple-500/20',
  compras:    'bg-amber-500/10   text-amber-400   border-amber-500/20',
  estoque:    'bg-blue-500/10    text-blue-400    border-blue-500/20',
  financeiro: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rh:         'bg-pink-500/10    text-pink-400    border-pink-500/20',
  vendas:     'bg-cyan-500/10    text-cyan-400    border-cyan-500/20',
};

const PRIO_BADGE: Record<string, string> = {
  'Alta':  'bg-red-500/10    text-red-400    border-red-500/20',
  'Média': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Baixa': 'bg-gray-500/10   text-gray-400   border-gray-500/20',
};

type TarefaProposta = {
  _id: string;
  modulo: string;
  titulo: string;
  descricao: string;
  prioridade: 'Alta' | 'Média' | 'Baixa';
  prazo_dias: number;
  contexto_origem: string;
  aprovada: boolean;
  descartada: boolean;
  editada: boolean;
};

type Briefing = {
  id: string;
  data_referencia: string;
  status: 'rascunho_ia' | 'aprovado_parcial' | 'aprovado_total' | 'descartado';
  dados_snapshot: any;
  tarefas_propostas: TarefaProposta[];
  total_propostas: number;
  total_aprovadas: number;
  gerado_por: string | null;
  nome_gerador: string | null;
  aprovado_por: string | null;
  nome_aprovador: string | null;
  modelo_ia: string | null;
  created_at: string;
};

const todayAcre = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Rio_Branco',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

const fmtDataBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const dataMaisDias = (iso: string, dias: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const BriefingDiarioView = ({ showToast, profile }: any) => {
  const { session } = useAuth();
  const podeAcessar = profile?.role === 'admin' || profile?.role === 'ceo';

  const [dataRef, setDataRef]     = useState(todayAcre());
  const [briefing, setBriefing]   = useState<Briefing | null>(null);
  const [tarefas, setTarefas]     = useState<TarefaProposta[]>([]);
  const [loading, setLoading]     = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [erro, setErro]           = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<{ titulo: string; descricao: string; prazo_dias: number }>({ titulo: '', descricao: '', prazo_dias: 3 });

  const [historico, setHistorico] = useState<Briefing[]>([]);
  const [showHistorico, setShowHistorico] = useState(false);

  // Tarefas agrupadas por setor (só não descartadas)
  const porSetor = useMemo(() => {
    const m: Record<string, TarefaProposta[]> = {};
    for (const t of tarefas) {
      if (t.descartada) continue;
      (m[t.modulo] ??= []).push(t);
    }
    return m;
  }, [tarefas]);

  const totalAtivas    = tarefas.filter(t => !t.descartada).length;
  const totalAprovadas = tarefas.filter(t => t.aprovada && !t.descartada).length;
  const isReadonly     = briefing?.status === 'aprovado_total' || briefing?.status === 'aprovado_parcial';

  // Carrega briefing existente do dia (se houver) ao montar.
  useEffect(() => {
    if (!podeAcessar || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('briefings_diarios')
        .select('*')
        .eq('data_referencia', dataRef)
        .eq('ativo', true)
        .neq('status', 'descartado')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setBriefing(data[0]);
        setTarefas(data[0].tarefas_propostas ?? []);
      } else {
        setBriefing(null);
        setTarefas([]);
      }
    })();
  }, [podeAcessar, dataRef]);

  const carregarHistorico = async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('briefings_diarios')
      .select('id, data_referencia, status, total_propostas, total_aprovadas, nome_gerador, nome_aprovador, created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistorico((data ?? []) as Briefing[]);
  };
  useEffect(() => { if (podeAcessar) carregarHistorico(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [podeAcessar]);

  const gerar = async (forcar = false) => {
    if (!session?.access_token) { setErro('Sessão expirada.'); return; }
    setLoading(true);
    setErro(null);

    // Se forçar e existe briefing, descarta antes pra liberar o UNIQUE parcial.
    if (forcar && briefing && supabase) {
      await supabase.from('briefings_diarios')
        .update({ status: 'descartado' })
        .eq('id', briefing.id);
      setBriefing(null);
      setTarefas([]);
    }

    try {
      const resp = await fetch('/api/ai-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ data: dataRef }),
      });
      const data = await resp.json();
      if (!resp.ok) { setErro(data?.error ?? 'Falha na IA.'); setLoading(false); return; }
      setBriefing(data);
      setTarefas(data.tarefas_propostas ?? []);
      if (data.from_cache) showToast?.('Briefing existente recuperado.', 'success');
      else showToast?.(`Briefing gerado com ${(data.tarefas_propostas ?? []).length} tarefas.`, 'success');
      carregarHistorico();
    } catch (err: any) {
      setErro(err?.message ?? 'Erro de rede.');
    }
    setLoading(false);
  };

  const toggleAprovacao = (id: string) => {
    if (isReadonly) return;
    setTarefas(prev => prev.map(t => t._id === id ? { ...t, aprovada: !t.aprovada } : t));
  };

  const aprovarTodas = () => {
    if (isReadonly) return;
    setTarefas(prev => prev.map(t => t.descartada ? t : { ...t, aprovada: true }));
  };

  const descartarTodas = () => {
    if (isReadonly) return;
    setTarefas(prev => prev.map(t => ({ ...t, aprovada: false })));
  };

  const descartar = (id: string) => {
    if (isReadonly) return;
    setTarefas(prev => prev.map(t => t._id === id ? { ...t, descartada: true, aprovada: false } : t));
  };

  const abrirEdicao = (t: TarefaProposta) => {
    if (isReadonly) return;
    setEditandoId(t._id);
    setEditForm({ titulo: t.titulo, descricao: t.descricao, prazo_dias: t.prazo_dias });
  };

  const salvarEdicao = () => {
    if (!editandoId) return;
    if (!editForm.titulo.trim()) { showToast?.('Título não pode ficar vazio.', 'error'); return; }
    setTarefas(prev => prev.map(t => t._id === editandoId
      ? { ...t, titulo: editForm.titulo.trim(), descricao: editForm.descricao.trim(), prazo_dias: Math.max(1, Math.min(14, editForm.prazo_dias)), editada: true }
      : t,
    ));
    setEditandoId(null);
  };

  const aprovarSelecionadas = async () => {
    if (!briefing || !supabase) return;
    const aprovadas = tarefas.filter(t => t.aprovada && !t.descartada);
    if (aprovadas.length === 0) {
      showToast?.('Selecione pelo menos uma tarefa pra aprovar.', 'error');
      return;
    }
    setAprovando(true);
    try {
      // 1. Insere as tarefas aprovadas na tabela `tarefas`.
      const novasTarefas = aprovadas.map(t => ({
        modulo:       t.modulo,
        titulo:       t.titulo,
        descricao:    t.descricao,
        prioridade:   t.prioridade,
        prazo:        dataMaisDias(briefing.data_referencia, t.prazo_dias),
        status:       'Pendente',
        nome_criador: `IA (briefing ${fmtDataBR(briefing.data_referencia)})`,
        criado_por:   profile?.id ?? null,
        origem:       'briefing_ia',
        briefing_id:  briefing.id,
        contexto:     t.contexto_origem || null,
      }));
      const { error: insErr } = await supabase.from('tarefas').insert(novasTarefas);
      if (insErr) throw insErr;

      // 2. Atualiza o briefing com flags + status final.
      const restantes = tarefas.filter(t => !t.descartada && !t.aprovada).length;
      const novoStatus = restantes === 0 ? 'aprovado_total' : 'aprovado_parcial';
      const { data: updBriefing, error: updErr } = await supabase
        .from('briefings_diarios')
        .update({
          tarefas_propostas: tarefas,
          total_aprovadas:   aprovadas.length,
          status:            novoStatus,
          aprovado_por:      profile?.id ?? null,
          nome_aprovador:    profile?.nome ?? null,
        })
        .eq('id', briefing.id)
        .select()
        .single();
      if (updErr) throw updErr;

      // 3. Notifica cada setor uma única vez.
      const setoresAfetados = Array.from(new Set(aprovadas.map(a => a.modulo)));
      for (const s of setoresAfetados) {
        const qtd = aprovadas.filter(a => a.modulo === s).length;
        await supabase.rpc('notificar_setor', {
          p_setor:     s,
          p_tipo:      'briefing_diario',
          p_titulo:    `Nova pauta: ${qtd} tarefa(s) do briefing diário`,
          p_mensagem:  `Confira no submenu Tarefas do módulo ${SETOR_LABEL[s]}.`,
          p_link_view: `${s}-tarefas`,
          p_urgencia:  'Média',
          p_ref_id:    briefing.id,
        });
      }

      setBriefing(updBriefing);
      showToast?.(`${aprovadas.length} tarefa(s) enviadas pros setores.`, 'success');
      carregarHistorico();
    } catch (err: any) {
      console.error('[Briefing] aprovar:', err);
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
    setAprovando(false);
  };

  const descartarBriefing = async () => {
    if (!briefing || !supabase) return;
    if (!confirm('Descartar este briefing? Você poderá gerar outro pro mesmo dia.')) return;
    try {
      await supabase.from('briefings_diarios')
        .update({ status: 'descartado' })
        .eq('id', briefing.id);
      setBriefing(null);
      setTarefas([]);
      showToast?.('Briefing descartado.', 'success');
      carregarHistorico();
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  const carregarBriefingAntigo = async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('briefings_diarios').select('*').eq('id', id).single();
    if (data) {
      setBriefing(data);
      setTarefas(data.tarefas_propostas ?? []);
      setDataRef(data.data_referencia);
      setShowHistorico(false);
    }
  };

  if (!podeAcessar) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md text-center">
          <Lock size={28} className="text-gray-500 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-300 mb-2">Acesso restrito</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            O Briefing Diário é exclusivo para <strong className="text-gray-300">Admin e CEO</strong>.
            As tarefas aprovadas aparecem no submenu <strong className="text-gray-300">Tarefas</strong> de cada setor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Briefing Diário</h2>
        <p className="text-sm text-gray-400 mt-1">
          IA analisa o estado real do ERP e propõe tarefas operacionais por setor. Você revisa, edita e aprova — o que aprovar vai pro submenu <strong className="text-gray-300">Tarefas</strong> de cada módulo.
        </p>
      </div>

      {/* Filtros + ação */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Data</span>
          <input type="date" value={dataRef} onChange={e => setDataRef(e.target.value)}
            className="neu-input rounded-lg px-3 py-2 text-xs" />
          <button onClick={() => setDataRef(todayAcre())}
            className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors">
            hoje
          </button>
        </div>
        <div className="flex-1" />
        {briefing && (
          <button onClick={() => setShowHistorico(s => !s)}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors">
            <History size={11} />Histórico ({historico.length})
          </button>
        )}
        {!briefing && (
          <NeuButtonAccent variant="" onClick={() => gerar(false)} disabled={loading}>
            {loading ? <><Loader2 size={14} className="animate-spin" />Analisando…</> : <><Sparkles size={14} />Gerar Briefing do Dia</>}
          </NeuButtonAccent>
        )}
        {briefing && !isReadonly && (
          <button onClick={() => gerar(true)} disabled={loading}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest border border-yellow-400/30 text-yellow-400 rounded-lg px-3 py-2 hover:bg-yellow-400/10 transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />Gerar nova versão
          </button>
        )}
      </div>

      {erro && (
        <div className="neu-pressed rounded-2xl p-4 border border-red-500/30 shrink-0">
          <p className="text-xs text-red-400">{erro}</p>
        </div>
      )}

      {/* Histórico expansível */}
      <AnimatePresence>
        {showHistorico && historico.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Briefings recentes</p>
              {historico.map(h => (
                <button key={h.id} onClick={() => carregarBriefingAntigo(h.id)}
                  className="text-left flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-300">{fmtDataBR(h.data_referencia)}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      h.status === 'aprovado_total'   ? 'text-accent border border-accent/30' :
                      h.status === 'aprovado_parcial' ? 'text-yellow-400 border border-yellow-400/30' :
                      h.status === 'descartado'       ? 'text-red-400 border border-red-400/30' :
                                                        'text-gray-400 border border-white/10'
                    }`}>{h.status.replace('_', ' ')}</span>
                    <span className="text-[10px] text-gray-500">{h.total_aprovadas}/{h.total_propostas} aprovadas</span>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conteúdo do briefing */}
      {loading && !briefing && (
        <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
      )}

      {!loading && !briefing && (
        <div className="neu-flat rounded-3xl p-12 border border-white/5 shrink-0">
          <EmptyState message='Selecione a data e clique em "Gerar Briefing do Dia" pra a IA analisar o ERP e propor as tarefas.' />
        </div>
      )}

      {briefing && (
        <>
          {/* Status do briefing */}
          <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Briefing de {fmtDataBR(briefing.data_referencia)}</p>
              <p className="text-sm text-gray-300 mt-1">
                {briefing.total_propostas} tarefa(s) propostas
                {isReadonly && <> · <span className="text-accent">{briefing.total_aprovadas} aprovadas</span></>}
                {briefing.nome_gerador && <span className="text-gray-500"> · gerado por {briefing.nome_gerador}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!isReadonly && (
                <>
                  <button onClick={aprovarTodas}
                    className="text-[10px] font-bold uppercase tracking-widest border border-accent/30 text-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors">
                    Aprovar todas
                  </button>
                  <button onClick={descartarTodas}
                    className="text-[10px] font-bold uppercase tracking-widest border border-white/10 text-gray-400 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                    Desmarcar
                  </button>
                  <button onClick={descartarBriefing}
                    className="text-[10px] font-bold uppercase tracking-widest border border-red-400/30 text-red-400 rounded-lg px-3 py-1.5 hover:bg-red-400/10 transition-colors">
                    Descartar briefing
                  </button>
                </>
              )}
              {isReadonly && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5">
                  <CheckCircle2 size={10} />Briefing aplicado
                </span>
              )}
            </div>
          </div>

          {/* Tarefas agrupadas por setor */}
          {Object.keys(porSetor).length === 0 ? (
            <div className="neu-flat rounded-3xl p-8 border border-white/5 shrink-0">
              <EmptyState message="Todas as tarefas foram descartadas. Você pode descartar o briefing inteiro e gerar outro." />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(porSetor).map(([setor, lista]) => (
                <div key={setor} className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${SETOR_COLOR[setor] ?? ''}`}>
                      <ListTodo size={10} />{SETOR_LABEL[setor] ?? setor}
                    </span>
                    <span className="text-[10px] text-gray-500">{lista.length} tarefa(s)</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {lista.map(t => (
                      <div key={t._id} className={`neu-pressed rounded-xl p-4 border transition-colors ${
                        t.aprovada ? 'border-accent/30 bg-accent/5' : 'border-white/5'
                      }`}>
                        {editandoId === t._id ? (
                          <div className="flex flex-col gap-2">
                            <input type="text" value={editForm.titulo}
                              onChange={e => setEditForm(f => ({ ...f, titulo: e.target.value }))}
                              className="neu-input rounded-lg px-3 py-2 text-xs font-bold" />
                            <textarea value={editForm.descricao} rows={2}
                              onChange={e => setEditForm(f => ({ ...f, descricao: e.target.value }))}
                              className="neu-input rounded-lg px-3 py-2 text-xs resize-none" />
                            <div className="flex items-center gap-2">
                              <label htmlFor={`prazo-${t._id}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Prazo (dias)</label>
                              <input id={`prazo-${t._id}`} type="number" min={1} max={14}
                                value={editForm.prazo_dias}
                                onChange={e => setEditForm(f => ({ ...f, prazo_dias: Number(e.target.value) }))}
                                className="neu-input rounded-lg px-2 py-1 text-xs w-20" />
                              <div className="flex-1" />
                              <button onClick={() => setEditandoId(null)}
                                className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-white px-3 py-1.5">
                                Cancelar
                              </button>
                              <button onClick={salvarEdicao}
                                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5 hover:bg-accent/10">
                                <CheckCircle2 size={10} />Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            {!isReadonly && (
                              <button onClick={() => toggleAprovacao(t._id)}
                                className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5 ${
                                  t.aprovada ? 'bg-accent border-accent' : 'border-white/20 hover:border-accent/50'
                                }`}>
                                {t.aprovada && <CheckCircle2 size={12} className="text-black" />}
                              </button>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="text-sm font-bold text-gray-200">{t.titulo}</p>
                                <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${PRIO_BADGE[t.prioridade]}`}>
                                  {t.prioridade}
                                </span>
                                <span className="text-[9px] text-gray-500">prazo {t.prazo_dias}d</span>
                                {t.editada && <span className="text-[9px] text-yellow-400">editada</span>}
                              </div>
                              {t.descricao && <p className="text-xs text-gray-400 leading-relaxed">{t.descricao}</p>}
                              {t.contexto_origem && (
                                <p className="text-[10px] text-gray-500 italic mt-2 flex items-start gap-1.5">
                                  <AlertTriangle size={9} className="text-yellow-400 shrink-0 mt-0.5" />
                                  {t.contexto_origem}
                                </p>
                              )}
                            </div>
                            {!isReadonly && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => abrirEdicao(t)} title="Editar" className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-accent transition-colors">
                                  <Edit3 size={12} />
                                </button>
                                <button onClick={() => descartar(t._id)} title="Descartar" className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors">
                                  <X size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer com ação principal */}
          {!isReadonly && totalAtivas > 0 && (
            <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex items-center justify-between gap-4 sticky bottom-0"
              style={{ background: 'color-mix(in srgb, var(--color-bg-base) 95%, transparent)' }}>
              <p className="text-sm text-gray-300">
                <strong className="text-accent">{totalAprovadas}</strong> de <strong>{totalAtivas}</strong> tarefas selecionadas pra aprovação
              </p>
              <NeuButtonAccent variant="" onClick={aprovarSelecionadas} disabled={aprovando || totalAprovadas === 0}>
                {aprovando ? <><Loader2 size={14} className="animate-spin" />Enviando…</> : <><Send size={14} />Enviar {totalAprovadas} tarefa(s) pros setores</>}
              </NeuButtonAccent>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};
