// Mesa do Gestor (migr. 667) — "o que depende de mim agora?"
//
// Kanban de LEITURA para admin, CEO, conselheiro e gerente. Cada cartão é um
// documento que já está parado em alguma fila do sistema; não se cria cartão
// aqui e não se arrasta cartão para mudar status — quem muda estado é a tela
// do documento, com as regras de alçada dela. O botão do cartão leva até lá, e
// o cartão sai sozinho quando o documento anda.
//
// Colunas (quem tem a próxima ação):
//   Precisa de mim  — só eu decido;
//   Parado na equipe — com outra pessoa da unidade (régua do listar_pendencias);
//   Resolvido (7 dias) — o que eu decidi.
//
// Sem realtime de propósito (manada de 15/09): relê ao abrir, ao trocar de
// unidade, ao voltar ao foco (no máximo 1×/min) e no botão Atualizar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, ArrowRight, Inbox, Users, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, FilialBadge } from '../components/ui';
import type { FilialOp } from '../components/FilialSelector';
import type { UserProfile } from '../hooks/useUserProfile';

type Coluna = 'mim' | 'equipe' | 'feito';

type Cartao = {
  coluna: Coluna;
  area: string;
  etapa: string;
  documento: string | null;
  documento_id: string;
  filial: string | null;
  onde?: string;
  view: string | null;
  acao?: string;
  responsavel?: string | null;
  valor?: number | null;
  vencimento?: string | null;
  dias_parado?: number;
  gravidade?: 'alta' | 'media' | 'baixa';
  resultado?: string;
  quando?: string;
};

type Mesa = { papel: string; escopo: string | null; gerado_em: string; cards: Cartao[] };

const UNIDADES: FilialOp[] = ['SuperMax', 'MaxLook', 'TechMax'];
const FOCO_INTERVALO_MIN_MS = 60_000;
const LIMITE_EQUIPE = 30;

const COR_GRAVIDADE: Record<string, string> = {
  alta: 'bg-red-600 text-white',
  media: 'bg-amber-500 text-black',
  baixa: 'bg-zinc-700 text-zinc-200',
};
const ROTULO_GRAVIDADE: Record<string, string> = { alta: 'Urgente', media: 'Atenção', baixa: 'Na fila' };
const ORDEM_GRAVIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

// Telas que só abrem no modo Matriz (MATRIZ_ONLY_VIEWS do App).
const VIEWS_DA_MATRIZ = new Set(['matriz-avaliacoes']);

const BRL = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const quandoBR = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });

const corResultado = (r?: string) => {
  const s = (r ?? '').toLowerCase();
  if (s.startsWith('aprov') || s.startsWith('aceit') || s.startsWith('liber')) return 'bg-green-600/20 text-green-300 border-green-500/30';
  if (s.startsWith('neg') || s.startsWith('recus') || s.startsWith('reprov')) return 'bg-red-600/20 text-red-300 border-red-500/30';
  return 'bg-zinc-700/40 text-zinc-300 border-zinc-500/30';
};

function CartaoMesa({ c, mostrarFilial, onAbrir }: { c: Cartao; mostrarFilial: boolean; onAbrir: (c: Cartao) => void }) {
  const feito = c.coluna === 'feito';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {!feito && c.gravidade && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${COR_GRAVIDADE[c.gravidade]}`}>
            {ROTULO_GRAVIDADE[c.gravidade]}
          </span>
        )}
        {feito && c.resultado && (
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${corResultado(c.resultado)}`}>
            {c.resultado}
          </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{c.area}</span>
        {mostrarFilial && c.filial && <span className="ml-auto"><FilialBadge filial={c.filial} /></span>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-100 leading-snug">{c.etapa}</p>
        {c.documento && <p className="text-xs text-gray-400 truncate" title={c.documento}>{c.documento}</p>}
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-gray-500">
        {!feito && c.dias_parado != null && (
          <span>{c.dias_parado === 0 ? 'desde hoje' : `há ${c.dias_parado} dia${c.dias_parado > 1 ? 's' : ''}`}</span>
        )}
        {feito && c.quando && <span>{quandoBR(c.quando)}</span>}
        {c.valor != null && Number(c.valor) > 0 && <span className="tabular-nums text-gray-300">{BRL(Number(c.valor))}</span>}
        {c.vencimento && <span>vence {dataBR(c.vencimento)}</span>}
        {c.coluna === 'equipe' && c.responsavel && <span className="text-gray-400">com: {c.responsavel}</span>}
      </div>
      {!feito && c.view && (
        <button type="button" onClick={() => onAbrir(c)}
          className="self-start inline-flex items-center gap-1.5 rounded-lg bg-white text-gray-900 hover:bg-gray-100 px-2.5 py-1 text-[11px] font-bold transition-colors">
          {c.acao ?? 'Abrir'} <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}

function ColunaMesa({ titulo, icon: Icon, cor, cards, vazio, mostrarFilial, onAbrir, limite, aviso }: {
  titulo: string; icon: any; cor: string; cards: Cartao[]; vazio: string; mostrarFilial: boolean;
  onAbrir: (c: Cartao) => void; limite?: number; aviso?: string;
}) {
  const [todos, setTodos] = useState(false);
  const visiveis = limite && !todos ? cards.slice(0, limite) : cards;
  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 flex flex-col min-h-0 lg:max-h-[calc(100vh-260px)]">
      <header className={`flex items-center gap-2 px-4 py-3 border-b border-white/10 ${cor}`}>
        <Icon size={16} />
        <h3 className="text-xs font-black uppercase tracking-widest flex-1">{titulo}</h3>
        <span className="text-xs font-bold tabular-nums rounded-full bg-white/10 px-2 py-0.5">{cards.length}</span>
      </header>
      <div className="p-3 flex flex-col gap-2.5 overflow-y-auto main-scrollbar">
        {aviso ? (
          <p className="text-xs text-gray-500 flex items-start gap-1.5 p-2"><Info size={13} className="shrink-0 mt-0.5" />{aviso}</p>
        ) : cards.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-8">{vazio}</p>
        ) : (
          <>
            {visiveis.map(c => <CartaoMesa key={`${c.coluna}-${c.etapa}-${c.documento_id}`} c={c} mostrarFilial={mostrarFilial} onAbrir={onAbrir} />)}
            {limite && cards.length > limite && (
              <button type="button" onClick={() => setTodos(t => !t)} className="text-xs text-accent font-semibold py-2 hover:underline">
                {todos ? 'Mostrar menos' : `Mostrar mais ${cards.length - limite}`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export const MesaGestorView = ({ profile, showToast, onNavigate }: {
  profile: UserProfile | null; showToast: any; onNavigate: (view: string) => void;
}) => {
  const { filialAtiva, setFilialAtiva, escolherMatriz } = useFilial();
  const papel = profile?.role ?? '';
  const ehGerente = papel === 'gerente';
  // Na Matriz (filialAtiva null) admin/CEO/conselheiro escolhem a unidade aqui;
  // dentro de uma filial, a mesa é dela. Gerente: a RPC já recorta.
  const [recorte, setRecorte] = useState<FilialOp | null>(null);
  const escopo = ehGerente ? null : (filialAtiva ?? recorte);

  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const reqId = useRef(0);
  const ultimoFoco = useRef(0);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    const id = ++reqId.current;
    setCarregando(true);
    const { data, error } = await supabase.rpc('minha_mesa', { p_filial: escopo });
    if (id !== reqId.current) return;
    setCarregando(false);
    if (error) { setErro(error.message); setMesa(null); return; }
    setErro(null);
    setMesa(data as Mesa);
  }, [escopo]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    const refazer = () => {
      if (document.visibilityState !== 'visible') return;
      const agora = Date.now();
      if (agora - ultimoFoco.current < FOCO_INTERVALO_MIN_MS) return;
      ultimoFoco.current = agora;
      void carregar();
    };
    window.addEventListener('focus', refazer);
    document.addEventListener('visibilitychange', refazer);
    return () => { window.removeEventListener('focus', refazer); document.removeEventListener('visibilitychange', refazer); };
  }, [carregar]);

  const colunas = useMemo(() => {
    const cards = mesa?.cards ?? [];
    const ordem = (a: Cartao, b: Cartao) =>
      (ORDEM_GRAVIDADE[a.gravidade ?? 'baixa'] - ORDEM_GRAVIDADE[b.gravidade ?? 'baixa'])
      || ((b.dias_parado ?? 0) - (a.dias_parado ?? 0));
    return {
      mim: cards.filter(c => c.coluna === 'mim').sort(ordem),
      equipe: cards.filter(c => c.coluna === 'equipe').sort(ordem),
      feito: cards.filter(c => c.coluna === 'feito'),
    };
  }, [mesa]);

  // O cartão leva à tela do documento. Admin/CEO/conselheiro na Matriz entram
  // na unidade do cartão antes — as telas operacionais trabalham por unidade.
  const abrir = (c: Cartao) => {
    if (!c.view) return;
    if (VIEWS_DA_MATRIZ.has(c.view)) {
      if (filialAtiva !== null && !ehGerente) escolherMatriz();
    } else if (!ehGerente && c.filial && (UNIDADES as string[]).includes(c.filial) && filialAtiva !== c.filial) {
      setFilialAtiva(c.filial as FilialOp);
      showToast?.(`Entrando na ${c.filial}.`, 'info');
    }
    onNavigate(c.view);
  };

  const mostrarFilial = !ehGerente && !escopo;
  const urgentes = colunas.mim.filter(c => c.gravidade === 'alta').length;
  const semMapaEquipe = papel === 'ceo' || papel === 'conselheiro';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 pb-6 min-h-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            Mesa do Gestor{mesa?.escopo ? ` — ${mesa.escopo}` : ehGerente ? '' : ' — todas as unidades'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {colunas.mim.length === 0
              ? 'Nada esperando por você agora.'
              : `${colunas.mim.length} ${colunas.mim.length === 1 ? 'item espera' : 'itens esperam'} por você${urgentes ? ` — ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}.`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!ehGerente && filialAtiva === null && (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 p-1">
              {[null, ...UNIDADES].map(u => (
                <button key={u ?? 'todas'} type="button" onClick={() => setRecorte(u)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${recorte === u ? 'bg-white text-gray-900' : 'text-gray-300 hover:bg-white/10'}`}>
                  {u ?? 'Todas'}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => { ultimoFoco.current = Date.now(); void carregar(); }} disabled={carregando}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white text-gray-900 hover:bg-gray-100 px-3 py-2 text-xs font-bold disabled:opacity-60">
            <RefreshCw size={13} className={carregando ? 'animate-spin' : ''} /> Atualizar
          </button>
          {mesa?.gerado_em && <span className="text-[11px] text-gray-500">às {quandoBR(mesa.gerado_em).slice(-5)}</span>}
        </div>
      </div>

      {erro ? (
        <p className="text-sm text-red-400">{erro}</p>
      ) : !mesa && carregando ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <ColunaMesa titulo="Precisa de mim" icon={Inbox} cor="text-amber-300" cards={colunas.mim}
            vazio="Nada esperando a sua decisão." mostrarFilial={mostrarFilial} onAbrir={abrir} />
          <ColunaMesa titulo="Parado na equipe" icon={Users} cor="text-sky-300" cards={colunas.equipe}
            vazio="Nada parado com a equipe." mostrarFilial={mostrarFilial} onAbrir={abrir} limite={LIMITE_EQUIPE}
            aviso={semMapaEquipe ? 'O mapa de quem está com cada pendência é do professor e dos gerentes de cada unidade.' : undefined} />
          <ColunaMesa titulo="Resolvido (7 dias)" icon={CheckCircle2} cor="text-green-300" cards={colunas.feito}
            vazio="Nenhuma decisão sua nos últimos 7 dias." mostrarFilial={mostrarFilial} onAbrir={abrir} />
        </div>
      )}
    </motion.div>
  );
};
