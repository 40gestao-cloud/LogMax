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
import { Sparkles, FileDown, RefreshCw, ChevronRight, ChevronDown, Inbox, Users, CheckCircle2, Info, LayoutGrid, StickyNote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, AbaComContador, CardContador } from '../components/ui';
import type { FilialOp } from '../components/FilialSelector';
import type { UserProfile } from '../hooks/useUserProfile';
import { EVENTO_CONTAGEM_MESA } from '../hooks/useContadorMesa';
import { MesaAnotacoes } from '../components/MesaAnotacoes';
import { nomeDaMesa } from '../lib/mesaGestor';
import { authFetch } from '../lib/authFetch';
import { formatDataHoraBR } from '../lib/dates';
import { exportPendenciasPDF, type PendenciaLinha, type PendenciaLeitura } from '../lib/pendenciasPdf';
import { LeituraPendencias } from '../components/LeituraPendencias';

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

// Fila sem dono: `_pendencia_responsaveis` devolve esta frase quando ninguém
// na unidade responde pelo setor. É o pior caso da coluna — o documento fica
// parado para sempre e ninguém é cobrado —, por isso sai em vermelho.
const ehOrfa = (r?: string | null) => !!r && r.startsWith('ninguém alocado');

type Agrupamento = 'tipo' | 'responsavel';

/** Quem responde pelo item, com a fila órfã em destaque. */
function Responsavel({ nome, className = '' }: { nome?: string | null; className?: string }) {
  if (!nome) return null;
  return ehOrfa(nome)
    ? <span className={`text-red-400 font-semibold ${className}`}>ninguém alocado</span>
    : <span className={`text-gray-400 ${className}`} title={nome}>com {nome}</span>;
}

// Cor da faixa lateral do grupo: a pior gravidade dele.
const FAIXA: Record<Gravidade, string> = {
  alta: 'before:bg-red-500',
  media: 'before:bg-amber-400',
  baixa: 'before:bg-zinc-600',
};

/**
 * Um grupo de "Parado na equipe", em cartão. Cabeçalho em duas linhas: o que
 * é (e quantos, quantos urgentes) e, embaixo, o próximo passo e com quem está.
 * Aberto, vira tabela com colunas de verdade — documento, unidade, valor,
 * vencimento e há quanto tempo — em vez de um código solto e um número
 * lá do outro lado da linha.
 *
 * Por TIPO o cabeçalho é a pendência e o responsável aparece nele quando é o
 * mesmo para o grupo todo; misturando unidades, desce para a linha. Por
 * RESPONSÁVEL o cabeçalho é a pessoa e a linha diz o que está com ela.
 */
function GrupoEquipe({ titulo, itens, agrupamento, mostrarFilial, onAbrir, aberto, onAlternar }: {
  titulo: string; itens: Cartao[]; agrupamento: Agrupamento; mostrarFilial: boolean;
  onAbrir: (c: Cartao) => void; aberto: boolean; onAlternar: () => void;
}) {
  const pior = itens.reduce<Gravidade>((p, c) => (ORDEM_GRAVIDADE[c.gravidade ?? 'baixa'] < ORDEM_GRAVIDADE[p] ? (c.gravidade ?? 'baixa') : p), 'baixa');
  const urgentes = itens.filter(c => c.gravidade === 'alta').length;
  const atencao = itens.filter(c => c.gravidade === 'media').length;
  const maisVelho = itens.reduce((m, c) => Math.max(m, c.dias_parado ?? 0), 0);
  const porResp = agrupamento === 'responsavel';
  const responsaveis = new Set(itens.map(c => c.responsavel ?? ''));
  const respUnico = !porResp && responsaveis.size === 1 ? itens[0].responsavel : null;
  const acoes = new Set(itens.map(c => c.acao ?? ''));
  const acaoUnica = !porResp && acoes.size === 1 ? itens[0].acao : null;
  const orfa = porResp && ehOrfa(itens[0].responsavel);
  const temValor = itens.some(c => c.valor != null && Number(c.valor) > 0);
  const temVenc = itens.some(c => !!c.vencimento);
  const colunaResp = !porResp && !respUnico;

  return (
    <div className={`relative rounded-2xl border bg-white/[0.02] overflow-hidden before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${FAIXA[pior]} ${orfa ? 'border-red-500/40' : 'border-white/10'}`}>
      <button type="button" onClick={onAlternar} aria-expanded={aberto}
        className="w-full flex items-center gap-3 pl-5 pr-3 py-3 text-left hover:bg-white/[0.03] transition-colors">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold truncate ${orfa ? 'text-red-400' : 'text-gray-100'}`} title={titulo}>
            {orfa ? `Ninguém alocado${mostrarFilial && itens[0].filial ? ` — ${itens[0].filial}` : ''}` : titulo}
          </p>
          <p className="text-[11px] text-gray-500 truncate mt-0.5">
            {acaoUnica && <span className="text-gray-400">{acaoUnica}</span>}
            {acaoUnica && respUnico && <span> · </span>}
            {respUnico && <Responsavel nome={respUnico} />}
            {porResp && !orfa && <span>{itens.length === 1 ? '1 pendência' : `${itens.length} pendências`} com esta equipe</span>}
            {colunaResp && !acaoUnica && <span>responsáveis diferentes por unidade</span>}
            <span className="text-gray-600"> · mais antigo há {maisVelho === 0 ? 'hoje' : `${maisVelho}d`}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {urgentes > 0 && (
            <span className="rounded-full bg-red-500/15 text-red-300 border border-red-500/30 px-2 py-0.5 text-[10px] font-bold tabular-nums">
              {urgentes} urgente{urgentes > 1 ? 's' : ''}
            </span>
          )}
          {atencao > 0 && (
            <span className="hidden sm:inline rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/30 px-2 py-0.5 text-[10px] font-bold tabular-nums">
              {atencao} atenção
            </span>
          )}
          <span className="rounded-lg bg-white/[0.06] text-gray-200 px-2 py-0.5 text-xs font-black tabular-nums min-w-[2rem] text-center">{itens.length}</span>
          {aberto ? <ChevronDown size={15} className="text-gray-500" /> : <ChevronRight size={15} className="text-gray-500" />}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-white/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-gray-500">
                <th className="text-left font-bold pl-5 pr-3 py-2">{porResp ? 'Pendência' : 'Documento'}</th>
                {colunaResp && <th className="text-left font-bold px-3 py-2 hidden md:table-cell">Com</th>}
                {mostrarFilial && <th className="text-left font-bold px-3 py-2 hidden sm:table-cell">Unidade</th>}
                {temValor && <th className="text-right font-bold px-3 py-2 hidden sm:table-cell">Valor</th>}
                {temVenc && <th className="text-center font-bold px-3 py-2 hidden md:table-cell">Vence</th>}
                <th className="text-right font-bold px-3 py-2">Parado</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {itens.map(c => {
                const g = c.gravidade ?? 'baixa';
                return (
                  <tr key={`${c.etapa}-${c.documento_id}`} onClick={() => onAbrir(c)}
                    className={`group ${c.view ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}>
                    <td className="pl-5 pr-3 py-2 max-w-0 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PONTO[g]}`} />
                        <span className="min-w-0">
                          <span className="block text-gray-200 truncate">{porResp ? c.etapa : (c.documento ?? '—')}</span>
                          {porResp && c.documento && <span className="block text-[11px] text-gray-500 truncate">{c.documento}</span>}
                        </span>
                      </div>
                    </td>
                    {colunaResp && <td className="px-3 py-2 hidden md:table-cell max-w-[14rem] truncate"><Responsavel nome={c.responsavel} /></td>}
                    {mostrarFilial && <td className="px-3 py-2 text-gray-400 hidden sm:table-cell whitespace-nowrap">{c.filial ?? '—'}</td>}
                    {temValor && (
                      <td className="px-3 py-2 text-right text-gray-300 tabular-nums hidden sm:table-cell whitespace-nowrap">
                        {c.valor != null && Number(c.valor) > 0 ? BRL(Number(c.valor)) : '—'}
                      </td>
                    )}
                    {temVenc && <td className="px-3 py-2 text-center text-gray-400 tabular-nums hidden md:table-cell">{c.vencimento ? dataBR(c.vencimento) : '—'}</td>}
                    <td className={`px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap ${TEXTO_DIAS[g]}`}>{dias(c.dias_parado)}</td>
                    <td className="pr-3 py-2 text-gray-600 group-hover:text-accent">{c.view && <ChevronRight size={14} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
  const ehAdmin = papel === 'admin';
  // Na Matriz (filialAtiva null) admin/CEO/conselheiro escolhem a unidade aqui;
  // dentro de uma filial, a mesa é dela. Gerente: a RPC já recorta.
  const [recorte, setRecorte] = useState<FilialOp | null>(null);
  const escopo = ehGerente ? null : (filialAtiva ?? recorte);
  const [aba, setAba] = useState<'mesa' | 'anotacoes'>('mesa');
  const [subAba, setSubAba] = useState<SubAba>('mim');
  const [agrupamento, setAgrupamento] = useState<Agrupamento>('tipo');
  const [filtroGrav, setFiltroGrav] = useState<'' | 'alta' | 'media'>('');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  // Leitura do MaxAI e PDF (só admin — a Mesa dele absorveu a tela Pendências
  // da Matriz). Mesma rota e mesmo PDF da tela Pendências.
  const [leitura, setLeitura] = useState<PendenciaLeitura>(null);
  const [modeloIA, setModeloIA] = useState('');
  const [lidasIA, setLidasIA] = useState<number | null>(null);
  const [lendoIA, setLendoIA] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

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
  // Opinião sobre a SuperMax embaixo da mesa da TechMax seria pior que nenhuma.
  useEffect(() => { setLeitura(null); setLidasIA(null); }, [escopo]);

  const pedirLeitura = useCallback(async () => {
    setLendoIA(true);
    try {
      const resp = await authFetch('/api/ai-aula-atividade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'pendencias', filial: escopo }),
      });
      const json = await resp.json();
      if (!resp.ok) { showToast?.(json?.error || 'O MaxAI não conseguiu ler as pendências.', 'error'); return; }
      if (!json.leitura) { showToast?.('Nada parado para o MaxAI ler.', 'info'); return; }
      setLeitura(json.leitura as PendenciaLeitura);
      setModeloIA(String(json.modelo_ia ?? ''));
      setLidasIA(Number(json.itens_analisados ?? 0));
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : 'Falha ao falar com o MaxAI.', 'error');
    } finally {
      setLendoIA(false);
    }
  }, [escopo, showToast]);

  // O PDF é o relatório de pendências de sempre (lista completa do
  // listar_pendencias + a leitura, se houver) — busca as linhas na hora.
  const baixarPdf = useCallback(async () => {
    if (!supabase) return;
    setGerandoPdf(true);
    try {
      const { data, error } = await supabase.rpc('listar_pendencias', { p_filial: escopo });
      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as PendenciaLinha[];
      if (linhas.length === 0) { showToast?.('Nada parado para o relatório.', 'info'); return; }
      await exportPendenciasPDF(
        {
          filial: escopo,
          geradoEm: formatDataHoraBR(new Date().toISOString()),
          linhas,
          leitura,
          modeloIA: modeloIA || 'MaxAI',
          lidasPelaIA: lidasIA,
        },
        `pendencias-${(escopo || 'todas-as-unidades').toLowerCase().replace(/\s+/g, '-')}`,
        'download',
        profile,
        showToast as any,
      );
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : 'Falha ao gerar o PDF.', 'error');
    } finally {
      setGerandoPdf(false);
    }
  }, [escopo, leitura, modeloIA, lidasIA, profile, showToast]);

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

  const { mim, secoes, equipeTodas, totalEquipe, feito, orfas } = useMemo(() => {
    const cards = mesa?.cards ?? [];
    const ordem = (a: Cartao, b: Cartao) =>
      (ORDEM_GRAVIDADE[a.gravidade ?? 'baixa'] - ORDEM_GRAVIDADE[b.gravidade ?? 'baixa'])
      || ((b.dias_parado ?? 0) - (a.dias_parado ?? 0));
    const equipeTodas = cards.filter(c => c.coluna === 'equipe').sort(ordem);
    const equipe = filtroGrav ? equipeTodas.filter(c => c.gravidade === filtroGrav) : equipeTodas;
    // Por tipo: a pendência. Por responsável: a pessoa (ou o grupo de pessoas
    // do setor). Fila órfã separa por unidade — "ninguém" da SuperMax e da
    // MaxLook são buracos diferentes.
    const chave = (c: Cartao) => agrupamento === 'tipo'
      ? c.etapa
      : ehOrfa(c.responsavel) ? `${c.responsavel} · ${c.filial ?? ''}` : (c.responsavel || 'sem responsável');
    const mapa = new Map<string, Cartao[]>();
    equipe.forEach(c => mapa.set(chave(c), [...(mapa.get(chave(c)) ?? []), c]));
    const porGrav = (a: Cartao[], b: Cartao[]) =>
      (ORDEM_GRAVIDADE[a[0].gravidade ?? 'baixa'] - ORDEM_GRAVIDADE[b[0].gravidade ?? 'baixa']) || b.length - a.length;
    const grupos = [...mapa.entries()].sort(([, a], [, b]) =>
      (agrupamento === 'responsavel' ? Number(ehOrfa(b[0].responsavel)) - Number(ehOrfa(a[0].responsavel)) : 0) || porGrav(a, b));
    // Por tipo, os grupos se juntam em seções por área (Compras, Financeiro…):
    // a seção com mais urgentes sobe. Por responsável não há seção — a pessoa
    // já é o agrupamento.
    let secoes: { area: string | null; grupos: [string, Cartao[]][] }[];
    if (agrupamento === 'tipo') {
      const porArea = new Map<string, [string, Cartao[]][]>();
      grupos.forEach(g => porArea.set(g[1][0].area, [...(porArea.get(g[1][0].area) ?? []), g]));
      const urg = (gs: [string, Cartao[]][]) => gs.reduce((n, [, i]) => n + i.filter(c => c.gravidade === 'alta').length, 0);
      secoes = [...porArea.entries()]
        .sort(([, a], [, b]) => urg(b) - urg(a) || b.reduce((n, [, i]) => n + i.length, 0) - a.reduce((n, [, i]) => n + i.length, 0))
        .map(([area, gs]) => ({ area, grupos: gs }));
    } else {
      secoes = [{ area: null, grupos }];
    }
    return {
      mim: cards.filter(c => c.coluna === 'mim').sort(ordem),
      secoes,
      equipeTodas,
      totalEquipe: equipeTodas.length,
      feito: cards.filter(c => c.coluna === 'feito'),
      orfas: equipeTodas.filter(c => ehOrfa(c.responsavel)).length,
    };
  }, [mesa, agrupamento, filtroGrav]);

  const resumoEquipe = useMemo(() => ({
    urgentes: equipeTodas.filter(c => c.gravidade === 'alta').length,
    atencao: equipeTodas.filter(c => c.gravidade === 'media').length,
    maisAntigo: equipeTodas.reduce((m, c) => Math.max(m, c.dias_parado ?? 0), 0),
  }), [equipeTodas]);
  const chavesGrupos = secoes.flatMap(sec => sec.grupos.map(([k]) => `${agrupamento}-${k}`));
  const algumAberto = chavesGrupos.some(k => abertos[k]);

  // O cartão leva à tela do documento. Admin/CEO/conselheiro entram antes na
  // unidade do cartão (as telas operacionais trabalham por unidade) ou na
  // Matriz, quando a tela só abre lá.
  const abrir = (c: Cartao) => {
    if (!c.view) return;
    let destino: FilialOp | null | undefined;
    if (ehGerente) destino = undefined;
    else if (c.modo === 'matriz') destino = null;
    // Usuários não trabalha por unidade: trocar de unidade antes de abrir só
    // mudaria o contexto do professor sem motivo.
    else if (c.view !== 'usuarios' && c.filial && (UNIDADES as string[]).includes(c.filial)) destino = c.filial as FilialOp;
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
          {ehAdmin && (
            <>
              <button type="button" onClick={pedirLeitura} disabled={lendoIA}
                // Cor do Claude (terracota) — a mesma em todo botão que chama o MaxAI.
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#B5573A] bg-[#C96442] hover:bg-[#B5573A] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60 transition-colors">
                <Sparkles size={13} className={lendoIA ? 'animate-pulse' : ''} /> {lendoIA ? 'Lendo…' : 'Leitura do MaxAI'}
              </button>
              <button type="button" onClick={baixarPdf} disabled={gerandoPdf}
                className="btn-solido btn-solido--vermelho !py-1.5 !px-3 !text-xs disabled:opacity-60">
                <FileDown size={13} /> {gerandoPdf ? 'Gerando…' : 'Baixar PDF'}
              </button>
            </>
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

      {leitura && aba === 'mesa' && (
        <LeituraPendencias leitura={leitura} modeloIA={modeloIA} lidasIA={lidasIA} total={totalEquipe}
          onFechar={() => setLeitura(null)} />
      )}

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
            ) : totalEquipe === 0 ? (
              <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-white/10 py-14 text-center">Nada parado com a equipe.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Resumo: os números do sistema. Urgentes e Atenção filtram. */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <CardContador label="Paradas" value={totalEquipe} onClick={() => setFiltroGrav('')} ativo={filtroGrav === ''} />
                  <CardContador label="Urgentes" value={resumoEquipe.urgentes} tom="vermelho"
                    onClick={() => setFiltroGrav(f => f === 'alta' ? '' : 'alta')} ativo={filtroGrav === 'alta'} />
                  <CardContador label="Atenção" value={resumoEquipe.atencao} tom="amarelo"
                    onClick={() => setFiltroGrav(f => f === 'media' ? '' : 'media')} ativo={filtroGrav === 'media'} />
                  <CardContador label="Mais antiga" value={resumoEquipe.maisAntigo === 0 ? 'hoje' : `${resumoEquipe.maisAntigo} dias`} />
                </div>

                {/* Ferramentas da lista numa linha só. */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Agrupar por</span>
                  <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/10 p-0.5">
                    {([['tipo', 'Tipo'], ['responsavel', 'Responsável']] as const).map(([id, label]) => (
                      <button key={id} type="button" onClick={() => setAgrupamento(id)}
                        className={`px-3 py-1 rounded-[10px] text-xs font-semibold transition-colors ${agrupamento === id ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {orfas > 0 && (
                    <span className="text-xs text-red-400 font-semibold">{orfas} {orfas === 1 ? 'item sem' : 'itens sem'} ninguém alocado</span>
                  )}
                  <button type="button"
                    onClick={() => setAbertos(Object.fromEntries(chavesGrupos.map(k => [k, !algumAberto])))}
                    className="ml-auto text-xs font-semibold text-gray-400 hover:text-gray-200 inline-flex items-center gap-1">
                    {algumAberto ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    {algumAberto ? 'Recolher tudo' : 'Expandir tudo'}
                  </button>
                </div>

                {secoes.length === 0 || secoes.every(sec => sec.grupos.length === 0) ? (
                  <p className="text-sm text-gray-500 rounded-2xl border border-dashed border-white/10 py-10 text-center">Nada com esse filtro.</p>
                ) : secoes.map(sec => (
                  <section key={sec.area ?? 'todos'} className="flex flex-col gap-2">
                    {sec.area && (
                      <h4 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400 mt-1">
                        {sec.area}
                        <span className="text-gray-600 font-bold tabular-nums">{sec.grupos.reduce((n, [, i]) => n + i.length, 0)}</span>
                        <span className="flex-1 h-px bg-white/10" />
                      </h4>
                    )}
                    {sec.grupos.map(([chave, itens]) => {
                      const k = `${agrupamento}-${chave}`;
                      return (
                        <GrupoEquipe key={k}
                          titulo={agrupamento === 'tipo' ? itens[0].etapa : (itens[0].responsavel || 'Sem responsável')}
                          itens={itens} agrupamento={agrupamento} mostrarFilial={mostrarFilial} onAbrir={abrir}
                          aberto={!!abertos[k]} onAlternar={() => setAbertos(a => ({ ...a, [k]: !a[k] }))} />
                      );
                    })}
                  </section>
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
