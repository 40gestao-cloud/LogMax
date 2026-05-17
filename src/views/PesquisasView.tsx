import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Send, Lock, BarChart3, ChevronRight, Trash2, Eye, FileText } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';

type Status = 'Rascunho' | 'Ativa' | 'Encerrada';

const STATUS_STYLE: Record<Status, string> = {
  'Rascunho':  'bg-gray-500/10 text-gray-400 border-gray-500/20',
  'Ativa':     'bg-accent/10 text-accent border-accent/20',
  'Encerrada': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const ROLES_DISPONIVEIS = ['admin', 'ceo', 'gerente', 'colaborador'] as const;
const SETORES_DISPONIVEIS = ['all', 'logistica', 'vendas', 'financeiro', 'rh', 'marketing'] as const;

const EMPTY_FORM = {
  titulo: '', descricao: '', anonima: true,
  alvo_roles: [] as string[], alvo_setores: [] as string[],
  data_inicio: '', data_fim: '',
};

const EMPTY_PERGUNTA = { tipo: 'escala' as 'escala' | 'texto', enunciado: '', obrigatoria: true };

export const PesquisasView = ({ showToast, profile }: any) => {
  const { data: pesquisas, setData, isLoading, reload } = useFetchData<any>('/api/pesquisasview');

  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState<any>(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [resultadosId, setResultadosId] = useState<string | null>(null);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const canManage = profile?.setor === 'rh' || profile?.role === 'admin' || profile?.role === 'ceo';
  if (!canManage) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas RH, admin ou CEO podem gerenciar pesquisas.</p>
      </div>
    );
  }

  const rascunho  = pesquisas.filter((p: any) => p.status === 'Rascunho').length;
  const ativas    = pesquisas.filter((p: any) => p.status === 'Ativa').length;
  const encerradas = pesquisas.filter((p: any) => p.status === 'Encerrada').length;

  const kpis = [
    { label: 'Total',       value: pesquisas.length, warn: false },
    { label: 'Rascunho',    value: rascunho,         warn: rascunho > 0 },
    { label: 'Ativas',      value: ativas,           warn: false },
    { label: 'Encerradas',  value: encerradas,       warn: false },
  ];

  const toggleArrayValue = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const handleCreate = async () => {
    if (!form.titulo.trim()) { showToast('Título é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        titulo:       form.titulo.trim(),
        descricao:    form.descricao.trim() || null,
        anonima:      form.anonima,
        alvo_roles:   form.alvo_roles.length   ? form.alvo_roles   : null,
        alvo_setores: form.alvo_setores.length ? form.alvo_setores : null,
        data_inicio:  form.data_inicio || null,
        data_fim:     form.data_fim    || null,
        status:       'Rascunho',
        nome_criador: profile?.nome ?? '',
      };
      const created = await dbInsert<any>('/api/pesquisasview', payload);
      setData((prev: any[]) => [created, ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setExpandedId(created?.id ?? null); // abre direto para adicionar perguntas
      showToast('Rascunho criado. Adicione perguntas e publique.', 'success');
    } catch {
      showToast('Erro ao criar pesquisa.', 'error');
    }
    setSaving(false);
  };

  const handlePublicar = async (p: any, qtdPerguntas: number) => {
    if (qtdPerguntas === 0) { showToast('Adicione ao menos uma pergunta antes de publicar.', 'error'); return; }
    try {
      const updated = await dbUpdate('/api/pesquisasview', p.id, {
        status: 'Ativa',
        data_inicio: p.data_inicio ?? new Date().toISOString().slice(0, 10),
      });
      setData((prev: any[]) => prev.map(x => x.id === p.id ? { ...x, ...updated } : x));
      showToast('Pesquisa publicada.', 'success');
    } catch {
      showToast('Erro ao publicar.', 'error');
    }
  };

  const handleEncerrar = async (p: any) => {
    try {
      const updated = await dbUpdate('/api/pesquisasview', p.id, { status: 'Encerrada' });
      setData((prev: any[]) => prev.map(x => x.id === p.id ? { ...x, ...updated } : x));
      showToast('Pesquisa encerrada.', 'success');
    } catch {
      showToast('Erro ao encerrar.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dbDelete('/api/pesquisasview', id);
      setData((prev: any[]) => prev.filter(x => x.id !== id));
      showToast('Pesquisa removida.', 'success');
    } catch {
      showToast('Erro ao remover.', 'error');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pesquisas</h2>
        <p className="text-sm text-gray-400 mt-1">Crie pesquisas de clima, satisfação ou feedback e acompanhe os resultados.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end shrink-0">
        <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />Nova Pesquisa
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Nova Pesquisa</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input type="text" value={form.titulo} onChange={e => setForm((f: any) => ({ ...f, titulo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Pesquisa de clima organizacional Q1" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <input type="text" value={form.descricao} onChange={e => setForm((f: any) => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Contexto e objetivo da pesquisa..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início</label>
                <input type="date" value={form.data_inicio} onChange={e => setForm((f: any) => ({ ...f, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim</label>
                <input type="date" value={form.data_fim} onChange={e => setForm((f: any) => ({ ...f, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Roles-alvo (vazio = todos)</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES_DISPONIVEIS.map(r => {
                    const active = form.alvo_roles.includes(r);
                    return (
                      <button key={r} type="button"
                        onClick={() => setForm((f: any) => ({ ...f, alvo_roles: toggleArrayValue(f.alvo_roles, r) }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${active ? 'bg-accent/10 text-accent border-accent/30' : 'neu-button text-gray-500 border-transparent'}`}>
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setores-alvo (vazio = todos)</label>
                <div className="flex flex-wrap gap-2">
                  {SETORES_DISPONIVEIS.map(s => {
                    const active = form.alvo_setores.includes(s);
                    return (
                      <button key={s} type="button"
                        onClick={() => setForm((f: any) => ({ ...f, alvo_setores: toggleArrayValue(f.alvo_setores, s) }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${active ? 'bg-accent/10 text-accent border-accent/30' : 'neu-button text-gray-500 border-transparent'}`}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 sm:col-span-2 cursor-pointer">
                <input type="checkbox" checked={form.anonima}
                  onChange={e => setForm((f: any) => ({ ...f, anonima: e.target.checked }))}
                  className="accent-current" />
                <span>Anônima — respostas não gravam quem respondeu (recomendado para clima)</span>
              </label>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleCreate} disabled={saving}>
                {saving ? 'Criando...' : 'Criar Rascunho'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-3 shrink-0">
        {pesquisas.length === 0 ? (
          <EmptyState message="Nenhuma pesquisa cadastrada" />
        ) : (
          <AnimatePresence>
            {pesquisas.map((p: any) => (
              <PesquisaCard
                key={p.id}
                pesquisa={p}
                expanded={expandedId === p.id}
                onToggleExpand={() => setExpandedId(prev => prev === p.id ? null : p.id)}
                onPublicar={(qtd) => handlePublicar(p, qtd)}
                onEncerrar={() => handleEncerrar(p)}
                onDelete={() => handleDelete(p.id)}
                onVerResultados={() => setResultadosId(p.id)}
                showToast={showToast}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {resultadosId && (
        <ResultadosModal
          pesquisa={pesquisas.find((p: any) => p.id === resultadosId)}
          onClose={() => setResultadosId(null)}
        />
      )}
    </motion.div>
  );
};

// ---------------------------------------------------------------
// Card de pesquisa: linha colapsada + expansão para gerir perguntas
// ---------------------------------------------------------------
function PesquisaCard({ pesquisa, expanded, onToggleExpand, onPublicar, onEncerrar, onDelete, onVerResultados, showToast }: any) {
  const filter = useMemo(() => ({ pesquisa_id: pesquisa.id }), [pesquisa.id]);
  const { data: perguntas, setData: setPerguntas } = useFetchData<any>('/api/pesquisaperguntasview', filter);

  const [novaPergunta, setNovaPergunta] = useState<any>(EMPTY_PERGUNTA);
  const [adding, setAdding] = useState(false);

  const isRascunho = pesquisa.status === 'Rascunho';

  const alvoLabel = (() => {
    const r = (pesquisa.alvo_roles ?? []).join(', ');
    const s = (pesquisa.alvo_setores ?? []).join(', ');
    if (!r && !s) return 'Todos os usuários';
    return [r && `roles: ${r}`, s && `setores: ${s}`].filter(Boolean).join(' · ');
  })();

  const handleAddPergunta = async () => {
    if (!novaPergunta.enunciado.trim()) { showToast('Enunciado é obrigatório.', 'error'); return; }
    setAdding(true);
    try {
      const created = await dbInsert('/api/pesquisaperguntasview', {
        pesquisa_id: pesquisa.id,
        ordem:       perguntas.length,
        tipo:        novaPergunta.tipo,
        enunciado:   novaPergunta.enunciado.trim(),
        obrigatoria: novaPergunta.obrigatoria,
      });
      setPerguntas((prev: any[]) => [...prev, created].sort((a, b) => a.ordem - b.ordem));
      setNovaPergunta(EMPTY_PERGUNTA);
    } catch {
      showToast('Erro ao adicionar pergunta.', 'error');
    }
    setAdding(false);
  };

  const handleRemovePergunta = async (id: string) => {
    try {
      await dbDelete('/api/pesquisaperguntasview', id);
      setPerguntas((prev: any[]) => prev.filter(x => x.id !== id));
    } catch {
      showToast('Erro ao remover pergunta.', 'error');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[pesquisa.status as Status] ?? ''}`}>
              {pesquisa.status}
            </span>
            {pesquisa.anonima && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500">
                <Lock size={9} />Anônima
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-gray-200 truncate">{pesquisa.titulo}</p>
          {pesquisa.descricao && <p className="text-xs text-gray-500 mt-0.5 truncate">{pesquisa.descricao}</p>}
          <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px] text-gray-600">
            <span>{alvoLabel}</span>
            {pesquisa.data_inicio && <span className="font-mono">{pesquisa.data_inicio}{pesquisa.data_fim ? ` → ${pesquisa.data_fim}` : ''}</span>}
            {pesquisa.nome_criador && <span>Por: {pesquisa.nome_criador}</span>}
            <span>{perguntas.length} {perguntas.length === 1 ? 'pergunta' : 'perguntas'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isRascunho && (
            <>
              <button onClick={onToggleExpand}
                className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-gray-400 hover:text-accent flex items-center gap-1.5">
                <FileText size={12} />{expanded ? 'Fechar' : 'Perguntas'}
              </button>
              <button onClick={() => onPublicar(perguntas.length)}
                className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 flex items-center gap-1.5">
                <Send size={12} />Publicar
              </button>
            </>
          )}
          {pesquisa.status === 'Ativa' && (
            <>
              <button onClick={onVerResultados}
                className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent hover:bg-accent/10 flex items-center gap-1.5">
                <BarChart3 size={12} />Resultados
              </button>
              <button onClick={onEncerrar}
                className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-yellow-400 border border-yellow-400/20 hover:bg-yellow-400/10 flex items-center gap-1.5">
                <ChevronRight size={12} />Encerrar
              </button>
            </>
          )}
          {pesquisa.status === 'Encerrada' && (
            <button onClick={onVerResultados}
              className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent hover:bg-accent/10 flex items-center gap-1.5">
              <BarChart3 size={12} />Resultados
            </button>
          )}
          {(isRascunho || pesquisa.status === 'Encerrada') && (
            <button onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && isRascunho && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 pt-3 overflow-hidden">
            <div className="flex flex-col gap-2">
              {perguntas.length === 0 ? (
                <p className="text-xs text-gray-500">Nenhuma pergunta ainda. Adicione abaixo.</p>
              ) : (
                perguntas.map((q: any, idx: number) => (
                  <div key={q.id} className="flex items-center gap-2 neu-pressed rounded-xl px-3 py-2">
                    <span className="text-[10px] font-mono text-gray-600 w-5">{idx + 1}.</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${q.tipo === 'escala' ? 'text-accent' : 'text-yellow-400'}`}>
                      {q.tipo}
                    </span>
                    <span className="text-xs text-gray-300 flex-1 truncate">{q.enunciado}</span>
                    {!q.obrigatoria && <span className="text-[9px] text-gray-600">(opcional)</span>}
                    <button onClick={() => handleRemovePergunta(q.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500">
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <select value={novaPergunta.tipo}
                onChange={e => setNovaPergunta((p: any) => ({ ...p, tipo: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2 text-xs">
                <option value="escala">Escala 1-5</option>
                <option value="texto">Texto livre</option>
              </select>
              <input type="text" value={novaPergunta.enunciado}
                onChange={e => setNovaPergunta((p: any) => ({ ...p, enunciado: e.target.value }))}
                placeholder="Enunciado da pergunta..."
                className="neu-input rounded-xl px-3 py-2 text-xs flex-1" />
              <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer px-2">
                <input type="checkbox" checked={novaPergunta.obrigatoria}
                  onChange={e => setNovaPergunta((p: any) => ({ ...p, obrigatoria: e.target.checked }))} />
                Obrigatória
              </label>
              <button onClick={handleAddPergunta} disabled={adding}
                className="neu-button py-2 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 disabled:opacity-40 flex items-center gap-1">
                <Plus size={12} />Adicionar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------
// Modal de resultados: agrega por pergunta
// ---------------------------------------------------------------
function ResultadosModal({ pesquisa, onClose }: { pesquisa: any; onClose: () => void }) {
  const filterPerg = useMemo(() => ({ pesquisa_id: pesquisa.id }), [pesquisa.id]);
  const filterResp = useMemo(() => ({ pesquisa_id: pesquisa.id }), [pesquisa.id]);
  const { data: perguntas } = useFetchData<any>('/api/pesquisaperguntasview', filterPerg);
  const { data: respostas } = useFetchData<any>('/api/pesquisarespostasview', filterResp);

  const [itens, setItens] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || respostas.length === 0) { setItens([]); setLoading(false); return; }
      const ids = respostas.map((r: any) => r.id);
      const { data } = await supabase
        .from('pesquisa_resposta_itens')
        .select('*')
        .in('resposta_id', ids);
      if (!cancelled) {
        setItens(data ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [respostas]);

  const sorted = useMemo(() => [...perguntas].sort((a, b) => a.ordem - b.ordem), [perguntas]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-base neu-flat rounded-3xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto main-scrollbar border border-white/5"
        style={{ background: 'var(--color-bg-base)' }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-accent">{pesquisa.titulo}</h3>
            <p className="text-xs text-gray-500 mt-1">{respostas.length} {respostas.length === 1 ? 'resposta' : 'respostas'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        {loading ? <LoadingSpinner /> : (
          respostas.length === 0 ? <EmptyState message="Nenhuma resposta ainda" /> : (
            <div className="flex flex-col gap-4">
              {sorted.map((q: any, idx: number) => {
                const itensQ = (itens ?? []).filter((i: any) => i.pergunta_id === q.id);
                if (q.tipo === 'escala') {
                  const escalas = itensQ.map((i: any) => i.valor_escala).filter((v: any) => v != null);
                  const total = escalas.length;
                  const media = total > 0 ? (escalas.reduce((s: number, v: number) => s + v, 0) / total).toFixed(2) : '—';
                  const dist = [1, 2, 3, 4, 5].map(n => ({
                    n,
                    count: escalas.filter((v: number) => v === n).length,
                  }));
                  const maxCount = Math.max(...dist.map(d => d.count), 1);
                  return (
                    <div key={q.id} className="neu-pressed rounded-2xl p-4">
                      <p className="text-xs font-bold text-gray-300 mb-1">{idx + 1}. {q.enunciado}</p>
                      <p className="text-[10px] text-gray-500 mb-3">Média: <span className="font-mono text-accent font-bold">{media}</span> · {total} resposta(s)</p>
                      <div className="flex flex-col gap-1.5">
                        {dist.map(d => (
                          <div key={d.n} className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-500 w-3">{d.n}</span>
                            <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-accent/60" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-gray-400 w-6 text-right">{d.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                // texto
                const textos = itensQ.map((i: any) => i.valor_texto).filter(Boolean);
                return (
                  <div key={q.id} className="neu-pressed rounded-2xl p-4">
                    <p className="text-xs font-bold text-gray-300 mb-1">{idx + 1}. {q.enunciado}</p>
                    <p className="text-[10px] text-gray-500 mb-3">{textos.length} resposta(s)</p>
                    {textos.length === 0 ? (
                      <p className="text-xs text-gray-600 italic">Sem respostas.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {textos.map((t: string, i: number) => (
                          <li key={i} className="text-xs text-gray-300 bg-white/5 rounded-lg px-3 py-2">{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </motion.div>
    </motion.div>
  );
}
