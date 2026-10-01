// Mesa do Gestor (migr. 667/668) — "o que depende de mim agora?"
//
// O nome segue o cargo (Mesa do CEO, do Conselheiro, do Gerente — ver
// lib/mesaGestor). Duas abas:
//
//   Mesa — leitura das filas que já existem, em três subabas:
//     Precisa de mim     — só eu decido. Cartão enxuto, gravidade na borda;
//     Parado na equipe   — agrupado por tipo de pendência, recolhido: eram
//                          centenas de cartões soltos (240 na Contabilidade);
//     Resolvido (7 dias) — lista curta do que eu decidi.
//   Não se cria nem se arrasta cartão do sistema: quem muda o estado é a tela
//   do documento, com as regras de alçada dela. Clicar leva até lá, e o
//   cartão sai sozinho quando o documento anda.
//
//   Minhas anotações — o único lugar em que se escreve: cartões livres e
//   privados do gestor (components/MesaAnotacoes).
//
// Sem realtime de propósito (manada de 15/09): relê ao abrir, ao trocar de
// unidade, ao voltar ao foco (no máximo 1×/min) e no botão Atualizar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, ChevronRight, ChevronDown, Inbox, Users, CheckCircle2, Info, LayoutGrid, StickyNote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, AbaComContador } from '../components/ui';
import type { FilialOp } from '../components/FilialSelector';
import type { UserProfile } from '../hooks/useUserProfile';
import { EVENTO_CONTAGEM_MESA } from '../hooks/useContadorMesa';
import { MesaAnotacoes } from '../components/MesaAnotacoes';
import { nomeDaMesa } from '../lib/mesaGestor';

type Coluna = 'mim' | 'equipe' | 'feito';
type Gravidade = 'alta' | 'media' | 'baixa';

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
  gravidade?: Gravidade;
  resultado?: string;
  quando?: string;
  /** 'matriz' = a tela só abre no modo Matriz (Central de Avaliação, requerimentos). */
  modo?: 'matriz' | null;
};

type Mesa = { papel: string; escopo: string | null; gerado_em: string; cards: Cartao[] };

const UNIDADES: FilialOp[] = ['SuperMax', 'MaxLook', 'TechMax'];
const FOCO_INTERVALO_MIN_MS = 60_000;
const ORDEM_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 };

// Gravidade vira cor de borda e de ponto — uma pista só, em vez de etiqueta
// cheia em cada cartão.
const BORDA: Record<Gravidade, string> = {
  alta: 'border-l-red-500',
  media: 'border-l-amber-400',
  baixa: 'border-l-white/15',
};
const PONTO: Record<Gravidade, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-400',
  baixa: 'bg-zinc-500',
};
const TEXTO_DIAS: Record<Gravidade, string> = {
  alta: 'text-red-400',
  media: 'text-amber-300',
  baixa: 'text-gray-500',
};

const BRL = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/').slice(0, 5); // dd/mm
const horaBR = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
const quandoBR = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
const dias = (n?: number) => (n == null ? '' : n === 0 ? 'hoje' : `${n}d`);

const corResultado = (r?: string) => {
  const s = (r ?? '').toLowerCase();
  if (s.startsWith('aprov') || s.startsWith('aceit') || s.startsWith('liber')) return 'bg-green-500';
  if (s.startsWith('neg') || s.startsWith('recus') || s.startsWith('reprov')) return 'bg-red-500';
  return 'bg-zinc-500';
};

/** Cartão de "Precisa de mim": o que é, de quem/qual documento, e há quanto tempo. */
function CartaoMim({ c, mostrarFilial, onAbrir }: { c: Cartao; mostrarFilial: boolean; onAbrir: (c: Cartao) => void }) {
  const g = c.gravidade ?? 'baixa';
  const detalhes = [
    mostrarFilial && c.filial && c.filial !== 'Matriz' ? c.filial : null,
    c.valor != null && Number(c.valor) > 0 ? BRL(Number(c.valor)) : null,
    c.vencimento ? `vence ${dataBR(c.vencimento)}` : null,
  ].filter(Boolean);
  return (
    <button type="button" onClick={() => onAbrir(c)} disabled={!c.view}
      className={`group w-full text-left rounded-xl border border-white/10 border-l-[3px] ${BORDA[g]} bg-white/[0.03] hover:bg-white/[0.06] px-3.5 py-3 transition-colors disabled:cursor-default`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-100 leading-snug">{c.etapa}</p>
          {c.documento && <p className="text-xs text-gray-400 truncate mt-0.5" title={c.documento}>{c.documento}</p>}
          {detalhes.length > 0 && <p className="text-[11px] text-gray-500 mt-1 tabular-nums">{detalhes.join(' · ')}</p>}
        </div>
        <span className={`text-[11px] font-bold tabular-nums shrink-0 ${TEXTO_DIAS[g]}`}>{dias(c.dias_parado)}</span>
      </div>
      {c.view && (
        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-accent group-hover:underline">
          {c.acao ?? 'Abrir'} <ChevronRight size={12} />
        </span>
      )}
    </button>
  );
}

/** Um tipo de pendência da equipe: cabeçalho com contagem e, aberto, as linhas. */
function GrupoEquipe({ etapa, itens, mostrarFilial, onAbrir, abertoInicial }: {
  etapa: string; itens: Cartao[]; mostrarFilial: boolean; onAbrir: (c: Cartao) => void; abertoInicial: boolean;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const pior = itens.reduce<Gravidade>((p, c) => (ORDEM_GRAVIDADE[c.gravidade ?? 'baixa'] < ORDEM_GRAVIDADE[p] ? (c.gravidade ?? 'baixa') : p), 'baixa');
  const urgentes = itens.filter(c => c.gravidade === 'alta').length;
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors">
        <span className={`w-2 h-2 rounded-full shrink-0 ${PONTO[pior]}`} />
        <span className="text-xs font-semibold text-gray-200 flex-1 min-w-0 truncate">{etapa}</span>
        {/* Todos urgentes, o ponto vermelho já diz; o número só quando é parte. */}
        {urgentes > 0 && urgentes < itens.length && (
          <span className="text-[10px] font-bold text-red-400 tabular-nums">{urgentes} urgente{urgentes > 1 ? 's' : ''}</span>
        )}
        <span className="text-xs font-bold tabular-nums text-gray-400 w-7 text-right">{itens.length}</span>
        {aberto ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
      </button>
      {aberto && (
        <ul className="border-t border-white/10 divide-y divide-white/5">
          {itens.map(c => (
            <li key={`${c.etapa}-${c.documento_id}`}>
              <button type="button" onClick={() => onAbrir(c)} disabled={!c.view}
                title={c.responsavel ? `Com: ${c.responsavel}` : undefined}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors disabled:cursor-default">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PONTO[c.gravidade ?? 'baixa']}`} />
                <span className="text-xs text-gray-300 truncate flex-1 min-w-0">{c.documento ?? '—'}</span>
                {mostrarFilial && c.filial && <span className="text-[10px] text-gray-500 shrink-0 hidden sm:inline">{c.filial}</span>}
                {c.valor != null && Number(c.valor) > 0 && (
                  <span className="text-[11px] text-gray-400 tabular-nums shrink-0 hidden sm:inline">{BRL(Number(c.valor))}</span>
                )}
                <span className={`text-[11px] font-bold tabular-nums shrink-0 w-10 text-right ${TEXTO_DIAS[c.gravidade ?? 'baixa']}`}>{dias(c.dias_parado)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SubAba = 'mim' | 'equipe' | 'feito';

export const MesaGestorView = ({ profile, showToast, onNavigate, onNavegarNaUnidade }: {
  profile: UserProfile | null; showToast: any; onNavigate: (view: string) => void;
  /** Troca de unidade e abre a tela — sem ele a troca cairia na Início. */
  onNavegarNaUnidade?: (view: string, unidade: FilialOp | null) => void;
}) => {
  const { filialAtiva } = useFilial();
  const papel = profile?.role ?? '';
  const ehGerente = papel === 'gerente';
  // Na Matriz (filialAtiva null) admin/CEO/conselheiro escolhem a unidade aqui;
  // dentro de uma filial, a mesa é dela. Gerente: a RPC já recorta.
  const [recorte, setRecorte] = useState<FilialOp | null>(null);
  const escopo = ehGerente ? null : (filialAtiva ?? recorte);
  const [aba, setAba] = useState<'mesa' | 'anotacoes'>('mesa');
  const [subAba, setSubAba] = useState<SubAba>('mim');

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
    // A bolinha do menu é o mesmo número: anuncia em vez de recontar no banco.
    // Só quando o recorte é o do menu (a unidade ativa) — filtrar a MaxLook
    // aqui dentro não pode mudar o número que o menu da Matriz mostra.
    if (ehGerente || escopo === filialAtiva) {
      const mim = ((data as Mesa)?.cards ?? []).filter(c => c.coluna === 'mim').length;
      window.dispatchEvent(new CustomEvent(EVENTO_CONTAGEM_MESA, { detail: mim }));
    }
  }, [escopo, ehGerente, filialAtiva]);

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

  const { mim, grupos, totalEquipe, feito } = useMemo(() => {
    const cards = mesa?.cards ?? [];
    const ordem = (a: Cartao, b: Cartao) =>
      (ORDEM_GRAVIDADE[a.gravidade ?? 'baixa'] - ORDEM_GRAVIDADE[b.gravidade ?? 'baixa'])
      || ((b.dias_parado ?? 0) - (a.dias_parado ?? 0));
    const equipe = cards.filter(c => c.coluna === 'equipe').sort(ordem);
    // Agrupa por tipo de pendência; o grupo mais grave (e depois o maior) sobe.
    const porEtapa = new Map<string, Cartao[]>();
    equipe.forEach(c => porEtapa.set(c.etapa, [...(porEtapa.get(c.etapa) ?? []), c]));
    const grupos = [...porEtapa.entries()].sort(([, a], [, b]) =>
      (ORDEM_GRAVIDADE[a[0].gravidade ?? 'baixa'] - ORDEM_GRAVIDADE[b[0].gravidade ?? 'baixa']) || b.length - a.length);
    return {
      mim: cards.filter(c => c.coluna === 'mim').sort(ordem),
      grupos,
      totalEquipe: equipe.length,
      feito: cards.filter(c => c.coluna === 'feito'),
    };
  }, [mesa]);

  // O cartão leva à tela do documento. Admin/CEO/conselheiro entram antes na
  // unidade do cartão (as telas operacionais trabalham por unidade) ou na
  // Matriz, quando a tela só abre lá.
  const abrir = (c: Cartao) => {
    if (!c.view) return;
    let destino: FilialOp | null | undefined;
    if (ehGerente) destino = undefined;
    else if (c.modo === 'matriz') destino = null;
    else if (c.filial && (UNIDADES as string[]).includes(c.filial)) destino = c.filial as FilialOp;
    if (destino === undefined || destino === filialAtiva || !onNavegarNaUnidade) { onNavigate(c.view); return; }
    showToast?.(destino ? `Entrando na ${destino}.` : 'Entrando na Matriz.', 'info');
    onNavegarNaUnidade(c.view, destino);
  };

  const mostrarFilial = !ehGerente && !escopo;
  const urgentes = mim.filter(c => c.gravidade === 'alta').length;
  const semMapaEquipe = papel === 'ceo' || papel === 'conselheiro';
  const unidade = mesa?.escopo ?? (ehGerente ? profile?.filial : null);

  const resumo = mim.length === 0
    ? 'Nada esperando por você agora.'
    : `${mim.length} ${mim.length === 1 ? 'item espera' : 'itens esperam'} por você${urgentes ? `, ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}.`;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 pb-6">
      {/* Topo: título, resumo e os controles numa linha só. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {nomeDaMesa(papel)}
            {unidade && <span className="text-gray-400 font-semibold"> · {unidade}</span>}
          </h2>
          <p className="text-sm text-gray-400 mt-1">{resumo}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!ehGerente && filialAtiva === null && (
            <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-0.5">
              {[null, ...UNIDADES].map(u => (
                <button key={u ?? 'todas'} type="button" onClick={() => setRecorte(u)}
                  className={`px-2.5 py-1 rounded-[10px] text-xs font-semibold transition-colors ${recorte === u ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-gray-200'}`}>
                  {u ?? 'Todas'}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => { ultimoFoco.current = Date.now(); void carregar(); }} disabled={carregando}
            title={mesa?.gerado_em ? `Atualizado às ${horaBR(mesa.gerado_em)}` : 'Atualizar'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-gray-300 disabled:opacity-60">
            <RefreshCw size={13} className={carregando ? 'animate-spin' : ''} />
            {mesa?.gerado_em ? horaBR(mesa.gerado_em) : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* Abas: a leitura das filas e o bloco de notas do gestor não se misturam. */}
      <div role="tablist" className="flex items-center gap-1 border-b border-white/10">
        {([
          { id: 'mesa', label: 'Mesa', icon: LayoutGrid },
          { id: 'anotacoes', label: 'Minhas anotações', icon: StickyNote },
        ] as const).map(t => (
          <button key={t.id} role="tab" aria-selected={aba === t.id} type="button" onClick={() => setAba(t.id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${aba === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            <t.icon size={15} /> {t.label}
            {t.id === 'mesa' && mim.length > 0 && (
              <span className="rounded-full bg-accent text-black text-[10px] font-black px-1.5 min-w-[18px] text-center">{mim.length}</span>
            )}
          </button>
        ))}
      </div>

      {aba === 'anotacoes' ? (
        <MesaAnotacoes showToast={showToast} />
      ) : erro ? (
        <p className="text-sm text-red-400">{erro}</p>
      ) : !mesa && carregando ? (
        <LoadingSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Subabas na paleta do sistema (AbaComContador): cor por fila e o
              número no cartão ao lado — dourado é o que espera por mim,
              vermelho o que está parado com os outros, verde o resolvido. */}
          <div role="tablist" className="flex flex-wrap items-center gap-3">
            <AbaComContador label="Precisa de mim" cor="dourado" icon={Inbox} n={mim.length}
              ativa={subAba === 'mim'} onClick={() => setSubAba('mim')} alerta={urgentes > 0}
              title={urgentes > 0 ? `${urgentes} urgente${urgentes > 1 ? 's' : ''}` : 'O que só você decide'} />
            <AbaComContador label="Parado na equipe" cor="vermelho" icon={Users} n={totalEquipe}
              ativa={subAba === 'equipe'} onClick={() => setSubAba('equipe')} title="Com outra pessoa da unidade" />
            <AbaComContador label="Resolvido · 7 dias" cor="verde" icon={CheckCircle2} n={feito.length}
              ativa={subAba === 'feito'} onClick={() => setSubAba('feito')} title="O que você decidiu nos últimos 7 dias" />
          </div>

          {subAba === 'mim' && (
            mim.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
                <CheckCircle2 size={24} className="mx-auto text-green-400/70 mb-2" />
                <p className="text-sm text-gray-400">Nada esperando a sua decisão.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2.5">
                {mim.map(c => <CartaoMim key={`${c.etapa}-${c.documento_id}`} c={c} mostrarFilial={mostrarFilial} onAbrir={abrir} />)}
              </div>
            )
          )}

          {subAba === 'equipe' && (
            semMapaEquipe ? (
              <p className="text-sm text-gray-400 flex items-start gap-2 rounded-2xl border border-white/10 p-4">
                <Info size={15} className="shrink-0 mt-0.5" />
                O mapa de quem está com cada pendência é do professor e dos gerentes de cada unidade.
              </p>
            ) : grupos.length === 0 ? (
              <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-white/10 py-14 text-center">Nada parado com a equipe.</p>
            ) : (
              <div className="flex flex-col gap-2 max-w-4xl">
                {grupos.map(([etapa, itens], i) => (
                  <GrupoEquipe key={etapa} etapa={etapa} itens={itens} mostrarFilial={mostrarFilial} onAbrir={abrir}
                    abertoInicial={i === 0 && itens.length <= 8} />
                ))}
              </div>
            )
          )}

          {subAba === 'feito' && (
            feito.length === 0 ? (
              <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-white/10 py-14 text-center">Nenhuma decisão sua nos últimos 7 dias.</p>
            ) : (
              <ul className="rounded-2xl border border-white/10 divide-y divide-white/5 max-w-4xl">
                {feito.map(c => (
                  <li key={`${c.etapa}-${c.documento_id}-${c.quando}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${corResultado(c.resultado)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-200 truncate">{c.etapa}</p>
                      {c.documento && <p className="text-xs text-gray-500 truncate">{c.documento}</p>}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{c.resultado}</span>
                    {c.quando && <span className="text-xs text-gray-600 tabular-nums shrink-0 hidden sm:inline w-24 text-right">{quandoBR(c.quando)}</span>}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </motion.div>
  );
};
