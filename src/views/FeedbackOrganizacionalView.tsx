import { isConselheiro } from '../lib/rbac';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, EyeOff, Trash2, Heart, Lock, MessageSquare } from 'lucide-react';
import { useFetchData, dbDelete, PAGE_SIZE } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, CardContador, Pagination, type TomContador } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';

// Cor cheia por categoria, a mesma no contador, no chip do formulário e no
// selo da mensagem — o olho liga os três sem ler.
const CATEGORIAS: { key: string; label: string; cls: string; tom: TomContador }[] = [
  { key: 'gestao',      label: 'Gestão',      cls: 'bg-purple-600 text-white', tom: 'roxo' },
  { key: 'processos',   label: 'Processos',   cls: 'bg-blue-600 text-white',   tom: 'azul' },
  { key: 'clima',       label: 'Clima',       cls: 'bg-green-600 text-white',  tom: 'verde' },
  { key: 'comunicacao', label: 'Comunicação', cls: 'bg-yellow-400 text-black', tom: 'amarelo' },
  { key: 'outro',       label: 'Outro',       cls: 'bg-zinc-600 text-white',   tom: 'neutro' },
];
const CATEGORIA = Object.fromEntries(CATEGORIAS.map(c => [c.key, c]));

const DESTINATARIOS = [
  { key: 'ceo',         label: 'CEO' },
  { key: 'gerente',     label: 'Gerente' },
  { key: 'colaborador', label: 'Colaboradores' },
] as const;
const DESTINATARIO_LABEL: Record<string, string> = Object.fromEntries(DESTINATARIOS.map(d => [d.key, d.label]));

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });

const rotulo = 'text-[10px] text-gray-500 uppercase tracking-widest font-bold';

// ─── Form de envio ────────────────────────────────────────────────────────────
const FormularioEnvio = ({ showToast, onEnviado }: { showToast: any; onEnviado: () => void }) => {
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState<string>('');
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  const toggleDest = (k: string) =>
    setDestinatarios(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);

  const handleEnviar = async () => {
    const t = texto.trim();
    if (t.length < 5) { showToast('Escreva ao menos 5 caracteres.', 'error'); return; }
    if (!categoria)    { showToast('Selecione uma categoria.', 'error'); return; }
    if (destinatarios.length === 0) {
      showToast('Selecione ao menos um destinatário.', 'error'); return;
    }
    setEnviando(true);
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const { error } = await supabase.rpc('enviar_feedback_anonimo', {
        p_texto:                t,
        p_categoria:            categoria,
        p_destinatarios_roles:  destinatarios,
      });
      if (error) throw error;
      setTexto('');
      setCategoria('');
      setDestinatarios([]);
      setSucesso(true);
      onEnviado();
    } catch (err: any) {
      showToast(`Erro ao enviar: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const bloqueado = enviando || texto.trim().length < 5 || !categoria || destinatarios.length === 0;

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
          <MessageSquare size={16} className="text-accent" /> Novo feedback
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-zinc-700 text-gray-200 flex items-center gap-1.5">
          <EyeOff size={11} /> Anônimo
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className={rotulo}>Para quem</span>
        <div className="grid grid-cols-3 gap-1 neu-pressed rounded-xl p-1">
          {DESTINATARIOS.map(d => {
            const ativo = destinatarios.includes(d.key);
            return (
              <button key={d.key} type="button" aria-pressed={ativo} onClick={() => toggleDest(d.key)}
                className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                  ativo ? 'btn-solido--dourado' : 'text-gray-500 hover:text-gray-200'}`}>
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={rotulo}>Categoria</span>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIAS.map(c => {
            const ativo = categoria === c.key;
            return (
              <button key={c.key} type="button" aria-pressed={ativo}
                onClick={() => setCategoria(prev => prev === c.key ? '' : c.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  ativo ? c.cls : 'neu-pressed text-gray-500 hover:text-gray-200'}`}>
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="fb-texto" className={rotulo}>Mensagem</label>
        <textarea id="fb-texto" rows={6}
          value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Sugestões, elogios, críticas, ideias…"
          className="neu-input rounded-xl px-4 py-3 text-sm resize-none" />
      </div>

      <NeuButtonAccent onClick={handleEnviar} disabled={bloqueado} isLoading={enviando}>
        <Send size={14} /> Enviar feedback
      </NeuButtonAccent>

      <AnimatePresence>
        {sucesso && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setSucesso(false)}>
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="neu-flat rounded-3xl p-8 max-w-sm w-full border border-emerald-500/20 flex flex-col items-center text-center gap-4">
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 0.12, type: 'spring', stiffness: 260, damping: 18 }}
                className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center">
                <Heart size={28} className="text-white" fill="currentColor" />
              </motion.div>
              <h3 className="text-lg font-bold text-gray-100">Feedback enviado</h3>
              <p className="text-sm text-gray-400">Obrigado por ajudar a melhorar a LogMax.</p>
              <button onClick={() => setSucesso(false)} className="btn-solido btn-solido--preto mt-1">
                Fechar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── View principal ───────────────────────────────────────────────────────────
export const FeedbackOrganizacionalView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const isDiretoria = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const confirm = useConfirm();
  const [page, setPage] = useState(0);
  const [filtroCategoria, setFiltroCategoria] = useState<string>('');
  useEffect(() => { setPage(0); }, [filtroCategoria]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/feedbacksorganizacaoview', filtroCategoria ? { categoria: filtroCategoria } : undefined, false, { page },
  );

  // Contagem por categoria sobre tudo o que a pessoa pode ler (a RLS recorta),
  // não sobre a página — a "Distribuição" antiga somava só os 50 carregados.
  const [porCategoria, setPorCategoria] = useState<Record<string, number>>({});
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let vivo = true;
    supabase.from('feedbacks_organizacao').select('categoria').then(({ data: rows }) => {
      if (!vivo || !rows) return;
      const acc: Record<string, number> = {};
      rows.forEach((r: any) => { const k = r.categoria ?? 'outro'; acc[k] = (acc[k] ?? 0) + 1; });
      setPorCategoria(acc);
    });
    return () => { vivo = false; };
  }, [versao]);
  const total = Object.values(porCategoria).reduce((a, b) => a + b, 0);
  const atualizar = () => { reload(); setVersao(v => v + 1); };

  const excluir = async (id: string) => {
    const ok = await confirm({ message: 'Excluir este feedback? Não dá para desfazer.', danger: true });
    if (!ok) return;
    try {
      await dbDelete('/api/feedbacksorganizacaoview', id);
      setData((prev: any[]) => prev.filter(f => f.id !== id));
      setVersao(v => v + 1);
      showToast('Feedback removido.', 'success');
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const filtro = filtroCategoria ? CATEGORIA[filtroCategoria] : null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      {/* Contadores = filtro: um clique mostra só a categoria. */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
        <CardContador label="Recebidos" value={total} tom="laranja"
          onClick={() => setFiltroCategoria('')} ativo={!filtroCategoria} />
        {CATEGORIAS.map(c => (
          <CardContador key={c.key} label={c.label} value={porCategoria[c.key] ?? 0} tom={c.tom}
            onClick={() => setFiltroCategoria(f => f === c.key ? '' : c.key)} ativo={filtroCategoria === c.key} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
        <div className="xl:sticky xl:top-0">
          <FormularioEnvio showToast={showToast} onEnviado={atualizar} />
        </div>

        <div className="neu-flat rounded-3xl border border-white/5 flex flex-col">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5">
            <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
              {filtro ? filtro.label : 'Caixa de entrada'}
              {totalCount != null && <span className="text-sm text-gray-500 font-semibold tabular-nums">{totalCount}</span>}
            </h3>
            <span className="text-[10px] text-gray-500 flex items-center gap-1.5">
              <Lock size={11} /> Autor não identificado
            </span>
          </div>

          {isLoading && data.length === 0 ? (
            <div className="py-10"><LoadingSpinner /></div>
          ) : data.length === 0 ? (
            <div className="p-5">
              <EmptyState message={filtro
                ? 'Nenhum feedback nessa categoria.'
                : isDiretoria ? 'Nenhum feedback recebido ainda.' : 'Nenhum feedback direcionado a você ainda.'} />
            </div>
          ) : (
            <ul className={`divide-y divide-white/5 ${isLoading ? 'opacity-60' : ''}`}>
              {data.map((f: any) => {
                const cat = CATEGORIA[f.categoria];
                const para = Array.isArray(f.destinatarios_roles) ? f.destinatarios_roles : [];
                return (
                  <li key={f.id} className="px-5 py-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {cat && (
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${cat.cls}`}>
                          {cat.label}
                        </span>
                      )}
                      {para.length > 0 && (
                        <span className="text-[11px] text-gray-500">
                          para {para.map((r: string) => DESTINATARIO_LABEL[r] ?? r).join(', ')}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-gray-500 tabular-nums">{fmtDate(f.created_at)}</span>
                      {isDiretoria && (
                        <button onClick={() => excluir(f.id)} title="Excluir feedback" className="action-btn-delete">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{f.texto}</p>
                  </li>
                );
              })}
            </ul>
          )}

          {data.length > 0 && (
            <div className="px-5 pb-4">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={totalCount}
                isLoading={isLoading}
                onPrev={() => setPage(p => Math.max(0, p - 1))}
                onNext={() => setPage(p => p + 1)}
                onReload={atualizar}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
