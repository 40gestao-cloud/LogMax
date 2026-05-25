import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, MessageSquare, EyeOff, Filter, Calendar, Lock } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';

const CATEGORIAS = [
  { key: 'gestao',       label: 'Gestão' },
  { key: 'processos',    label: 'Processos' },
  { key: 'clima',        label: 'Clima organizacional' },
  { key: 'comunicacao',  label: 'Comunicação' },
  { key: 'outro',        label: 'Outro' },
] as const;

const CATEGORIA_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map(c => [c.key, c.label]));

const CATEGORIA_CLS: Record<string, string> = {
  gestao:      'bg-purple-900/30 text-purple-400',
  processos:   'bg-blue-900/30 text-blue-400',
  clima:       'bg-emerald-900/30 text-emerald-400',
  comunicacao: 'bg-yellow-900/30 text-yellow-400',
  outro:       'bg-gray-800 text-gray-400',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });

// ─── Form de envio (colaborador / gerente) ────────────────────────────────────
const FormularioEnvio = ({ showToast }: { showToast: any }) => {
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState<string>('');
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  const handleEnviar = async () => {
    const t = texto.trim();
    if (t.length < 5) {
      showToast('Escreva ao menos 5 caracteres.', 'error');
      return;
    }
    setEnviando(true);
    try {
      await dbInsert('/api/feedbacksorganizacaoview', {
        texto: t,
        categoria: categoria || null,
      });
      setTexto('');
      setCategoria('');
      setSucesso(true);
      showToast('Feedback enviado anonimamente.', 'success');
      setTimeout(() => setSucesso(false), 4000);
    } catch (err: any) {
      showToast(`Erro ao enviar: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 neu-pressed rounded-xl flex items-center justify-center shrink-0">
          <EyeOff size={16} className="text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-200">Envie um feedback</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Totalmente anônimo. A diretoria (admin/CEO) lê sem saber quem enviou — nem sua identidade é registrada.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="fb-categoria" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Categoria (opcional)</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map(c => (
            <button key={c.key} type="button"
              onClick={() => setCategoria(prev => prev === c.key ? '' : c.key)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all
                ${categoria === c.key
                  ? `${CATEGORIA_CLS[c.key]} border-current/30`
                  : 'neu-button border-white/5 text-gray-600 hover:text-gray-300'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="fb-texto" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Seu feedback</label>
        <textarea id="fb-texto" rows={6}
          value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Escreva à vontade. Sugestões, elogios, críticas construtivas, ideias..."
          className="neu-input rounded-xl px-4 py-3 text-sm resize-none" />
        <p className="text-[10px] text-gray-600 self-end">{texto.length} caracteres</p>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
        <p className="text-[10px] text-gray-600 flex items-center gap-1.5">
          <Lock size={10} /> Anônimo — não é possível rastrear o autor.
        </p>
        <NeuButtonAccent variant="" onClick={handleEnviar} disabled={enviando || texto.trim().length < 5}>
          <Send size={14} /> {enviando ? 'Enviando...' : 'Enviar feedback'}
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {sucesso && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-center">
            Feedback enviado anonimamente. Obrigado pela contribuição.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Lista (admin/CEO) ────────────────────────────────────────────────────────
const ListaParaDiretoria = ({ showToast }: { showToast: any }) => {
  const [page, setPage] = useState(0);
  const [filtroCategoria, setFiltroCategoria] = useState<string>('');
  const extraFilter = filtroCategoria ? { categoria: filtroCategoria } : undefined;
  const { data, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/feedbacksorganizacaoview', extraFilter, false, { page }
  );

  // KPIs sumarizados (sobre a página atual — sem agregação server-side)
  const porCategoria = (data ?? []).reduce((acc: Record<string, number>, f: any) => {
    const cat = f.categoria ?? 'sem_categoria';
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-5">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-yellow-400" />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filtrar por categoria</span>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFiltroCategoria('')}
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all
              ${!filtroCategoria ? 'neu-pressed text-accent border-accent/30' : 'neu-button border-white/5 text-gray-600 hover:text-gray-300'}`}>
            Todas
          </button>
          {CATEGORIAS.map(c => (
            <button key={c.key} onClick={() => setFiltroCategoria(c.key)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all
                ${filtroCategoria === c.key ? `${CATEGORIA_CLS[c.key]} border-current/30` : 'neu-button border-white/5 text-gray-600 hover:text-gray-300'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5">
        {isLoading ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState message={filtroCategoria ? 'Nenhum feedback nessa categoria.' : 'Nenhum feedback recebido ainda.'} />
        ) : (
          <div className="flex flex-col gap-3">
            {data.map((f: any) => (
              <motion.div key={f.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                className="neu-pressed rounded-2xl p-4 border border-white/5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 text-[10px] text-gray-600">
                    <EyeOff size={11} />
                    <span className="uppercase tracking-widest font-bold">Anônimo</span>
                    {f.categoria && (
                      <span className={`ml-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${CATEGORIA_CLS[f.categoria] ?? 'bg-gray-800 text-gray-400'}`}>
                        {CATEGORIA_LABEL[f.categoria] ?? f.categoria}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                    <Calendar size={11} />
                    <span className="font-mono">{fmtDate(f.created_at)}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{f.texto}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Paginação simplificada (sem componente, pra evitar import extra; lista raramente cresce muito) */}
        {(data ?? []).length > 0 && totalCount && totalCount > 50 && (
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/5 text-xs text-gray-500">
            <span>Página {page + 1} · {totalCount} feedbacks</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="neu-button px-3 py-1.5 rounded-lg disabled:opacity-30">Anterior</button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * 50 >= totalCount}
                className="neu-button px-3 py-1.5 rounded-lg disabled:opacity-30">Próxima</button>
              <button onClick={reload} className="neu-button px-3 py-1.5 rounded-lg">Atualizar</button>
            </div>
          </div>
        )}
      </div>

      {/* Resumo por categoria (página atual) */}
      {(data ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 px-2">
          <span className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mr-1">Distribuição:</span>
          {Object.entries(porCategoria).map(([cat, n]) => (
            <span key={cat} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${CATEGORIA_CLS[cat] ?? 'bg-gray-800 text-gray-400'}`}>
              {CATEGORIA_LABEL[cat] ?? 'Sem categoria'}: {n as number}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── View principal ───────────────────────────────────────────────────────────
export const FeedbackOrganizacionalView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const isDiretoria = profile.role === 'admin' || profile.role === 'ceo';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-3">
          <MessageSquare size={24} />
          Feedback Organizacional
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          {isDiretoria
            ? 'Feedbacks anônimos enviados por colaboradores e gerentes. Não é possível identificar quem enviou.'
            : 'Canal anônimo para envio de feedback à diretoria. Suas sugestões chegam direto a admin e CEO.'}
        </p>
      </div>

      {isDiretoria ? <ListaParaDiretoria showToast={showToast} /> : <FormularioEnvio showToast={showToast} />}
    </motion.div>
  );
};
