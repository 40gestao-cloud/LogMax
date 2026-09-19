// FAB único de pendências (plano de requisições, fase 5, item 23).
//
// Seis FABs empilhados no canto — Ponto, Avisos da Matriz, Pedido online,
// Convite de vaga, Novo documento, Requisição devolvida — viraram um segundo
// menu que ninguém desenhou, cada um de uma cor, todos pulsando ao mesmo
// tempo numa tela de 768px de altura. Cada um nasceu certo sozinho.
//
// Este componente não reescreve os cinco: cada um continua dono da própria
// fila, do próprio "abre sozinho quando não está atrapalhando" e do próprio
// modal — são regras finas (naoInterromper, "já mostrei este", represar a
// cada 30s) que valem a pena preservar intactas. O que muda é só o botão:
// os cinco escondem o deles (`hideTrigger`), reportam o tamanho da fila
// (`onCount`) e passam a abrir por um sinal (`openSignal`, um contador —
// reenviar o mesmo valor não dispara nada, por isso soma sempre).
//
// ── Por que a contagem vem dos filhos, e não de hooks aqui ─────────────────
//
// A primeira versão chamava os cinco hooks aqui também, só para somar. Dois
// defeitos, os dois calados:
//
//   1. `useAvisosMatriz`, `usePedidosNovos` e `useConvitesVaga` abriam canal
//      de realtime com nome FIXO. Montar o hook duas vezes fazia
//      `supabase.channel(nome)` devolver o canal já assinado, e o segundo
//      `.on()` estourava "cannot add postgres_changes callbacks after
//      subscribe()" — o realtime morria sem erro na tela. Os três passaram
//      para `assinarRealtime`, que dá sufixo único a cada instância, então
//      hoje esta armadilha em particular já não morde.
//   2. Dar "Ciente" encolhe a fila da instância que foi chamada. A ciência
//      grava em `*_ciencia`, tabela que nenhum desses canais escuta, então a
//      segunda instância nunca saberia — a pílula continuaria contando o que
//      a pessoa já confirmou, e o clique abriria um modal vazio.
//
// Uma instância por fila resolve os dois: quem é dono da fila é quem a
// mostra, e a contagem é derivada dela, não uma segunda leitura do banco.
//
// `PontoFAB` fica de fora de propósito: não é aviso, é ação (bater o ponto),
// e mora em telas específicas (Início, Ponto Eletrônico), não na pilha global.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { Bell, Megaphone, ShoppingCart, BriefcaseBusiness, FileText, RotateCcw } from 'lucide-react';
import { emOperacao } from '../lib/naoInterromper';
import { AvisoMatrizFAB } from './AvisoMatrizFAB';
import { PedidoOnlineFAB } from './PedidoOnlineFAB';
import { ConviteVagaFAB } from './ConviteVagaFAB';
import { NovoDocumentoModal } from './NovoDocumentoModal';
import { RequisicaoAvisoModal } from './RequisicaoAvisoModal';
import type { UserProfile } from '../hooks/useUserProfile';

type ShowToast = (msg: string, type: string, persist?: boolean) => void;
type Tipo = 'avisoMatriz' | 'pedidoOnline' | 'conviteVaga' | 'documento' | 'requisicao';

const ZERO: Record<Tipo, number> = {
  avisoMatriz: 0, pedidoOnline: 0, conviteVaga: 0, documento: 0, requisicao: 0,
};

// ── Onde a pílula fica ────────────────────────────────────────────────────
//
// Parada no canto inferior direito ela cobria conteúdo — em Registro de Ponto
// tapava a coluna de ações da última linha da tabela. Agora se arrasta, e o
// lugar escolhido é por máquina: a posição vive no localStorage, não no
// banco, porque é preferência de quem está sentado ali, não do usuário.
//
// O deslocamento é guardado como offset a partir do canto (x/y negativos
// andam para dentro da tela), então a pílula continua ancorada ao canto
// inferior direito quando a janela muda de tamanho.
const POS_KEY = 'logmax:pendencias-fab-pos';
/** Folga para a pílula nunca sumir inteira fora da janela. */
const LARGURA_PILULA = 200;
const ALTURA_BLOCO = 120;

const lerPos = (): { x: number; y: number } => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return { x: 0, y: 0 };
    const p = JSON.parse(raw);
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return { x: 0, y: 0 };
    return p;
  } catch { return { x: 0, y: 0 }; }
};

const gravarPos = (p: { x: number; y: number }) => {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* aba anônima, storage bloqueado */ }
};

/** Recorta a posição guardada ao tamanho ATUAL da janela: quem arrastou a
 *  pílula para a esquerda num monitor grande abriria o notebook com ela fora
 *  da tela, sem botão nenhum para trazê-la de volta. */
const dentroDaTela = (p: { x: number; y: number }) => ({
  x: Math.min(0, Math.max(p.x, -(window.innerWidth - LARGURA_PILULA))),
  y: Math.min(24, Math.max(p.y, -(window.innerHeight - ALTURA_BLOCO))),
});

export function PendenciasFAB({ profile, showToast, activeView, onNavigate, aulaFiltro }: {
  profile: UserProfile;
  showToast: ShowToast;
  activeView: string;
  onNavigate: (view: string) => void;
  /** Modo Aula esconde Avisos, Pedido Online e Convite de vaga — a mesma
   *  régua que App.tsx já aplicava antes de existir este FAB. */
  aulaFiltro: boolean;
}) {
  const [contagens, setContagens] = useState<Record<Tipo, number>>(ZERO);
  const [rotuloReq, setRotuloReq] = useState('Requisição devolvida');
  const [open, setOpen] = useState(false);
  const [sinais, setSinais] = useState<Record<Tipo, number>>(ZERO);

  // Estáveis: os filhos põem `onCount` nas dependências de um efeito, e um
  // callback recriado a cada render faria o efeito correr em laço.
  const contar = useCallback(
    (tipo: Tipo) => (n: number) =>
      setContagens(prev => (prev[tipo] === n ? prev : { ...prev, [tipo]: n })),
    [],
  );
  const onCount = useMemo(() => ({
    avisoMatriz:  contar('avisoMatriz'),
    pedidoOnline: contar('pedidoOnline'),
    conviteVaga:  contar('conviteVaga'),
    documento:    contar('documento'),
    requisicao:   (n: number, rotulo: string) => {
      setContagens(prev => (prev.requisicao === n ? prev : { ...prev, requisicao: n }));
      if (rotulo) setRotuloReq(prev => (prev === rotulo ? prev : rotulo));
    },
  }), [contar]);

  // Posição arrastável. `arrastou` guarda o clique que era só arraste: sem
  // ele, soltar a pílula em cima do novo lugar abriria (ou fecharia) a lista.
  const dragControls = useDragControls();
  const arrastou = useRef(false);
  const [pos, setPos] = useState(() => (typeof window === 'undefined' ? { x: 0, y: 0 } : dentroDaTela(lerPos())));

  useEffect(() => {
    const aoRedimensionar = () => setPos(p => dentroDaTela(p));
    window.addEventListener('resize', aoRedimensionar);
    return () => window.removeEventListener('resize', aoRedimensionar);
  }, []);

  const disparar = (tipo: Tipo) => {
    setSinais(prev => ({ ...prev, [tipo]: prev[tipo] + 1 }));
    setOpen(false);
  };

  // Tela de operação (PDV, caixa, recebimento, expedição, inventário): a
  // pílula inteira some. Antes deste FAB a régua era por componente —
  // Documento e Requisição escondiam o botão deles ali, os outros três
  // ficavam —, e essa diferença só fazia sentido quando cada fila tinha um
  // botão próprio: dava para calar um sem calar os outros.
  //
  // Num botão só ela deixa de fazer sentido: uma pílula que aparece durante
  // a operação continua sendo interrupção, e ela agora carrega TODAS as
  // filas — calar metade delas mostraria uma contagem que não bate com o que
  // a lista abre. Em tela de operação há alguém do outro lado do balcão
  // esperando (src/lib/naoInterromper.ts); o recado espera a operação
  // terminar. Nada se perde: as filas continuam vivas, o sino continua
  // avisando, e a pílula reaparece assim que a pessoa troca de tela.
  const operando = emOperacao(activeView);

  const itens = ([
    { tipo: 'avisoMatriz'  as Tipo, oculto: aulaFiltro, label: 'Avisos da Matriz',       icon: Megaphone,         cor: 'text-amber-300' },
    { tipo: 'pedidoOnline' as Tipo, oculto: aulaFiltro, label: 'Pedidos da loja online', icon: ShoppingCart,      cor: 'text-emerald-300' },
    { tipo: 'conviteVaga'  as Tipo, oculto: aulaFiltro, label: 'Convite de vaga',        icon: BriefcaseBusiness, cor: 'text-indigo-300' },
    { tipo: 'documento'    as Tipo, oculto: false,      label: 'Documento novo',         icon: FileText,          cor: 'text-sky-300' },
    { tipo: 'requisicao'   as Tipo, oculto: false,      label: rotuloReq,                icon: RotateCcw,         cor: 'text-orange-300' },
  ]).filter(i => !i.oculto && contagens[i.tipo] > 0);

  const total = operando ? 0 : itens.reduce((s, i) => s + contagens[i.tipo], 0);

  return (
    <>
      {/* Pílula e lista andam juntas num só bloco arrastável — separadas, a
          lista ficaria para trás no canto quando a pílula mudasse de lugar.
          `dragListener={false}` + `dragControls`: só a pílula pega o arraste,
          senão apertar um item da lista arrastaria o bloco em vez de abrir. */}
      {total > 0 && (
        <motion.div
          drag
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          dragElastic={0}
          dragConstraints={{
            left: -(window.innerWidth - LARGURA_PILULA), right: 0,
            top: -(window.innerHeight - ALTURA_BLOCO), bottom: 24,
          }}
          animate={{ x: pos.x, y: pos.y }}
          transition={{ type: 'tween', duration: 0 }}
          onDragStart={() => { arrastou.current = true; }}
          onDragEnd={(_e, info) => {
            const novo = dentroDaTela({ x: pos.x + info.offset.x, y: pos.y + info.offset.y });
            setPos(novo);
            gravarPos(novo);
            // O clique de soltar chega depois do dragEnd; o timeout devolve a
            // pílula ao estado clicável logo em seguida.
            setTimeout(() => { arrastou.current = false; }, 0);
          }}
          className="fixed bottom-24 right-6 z-40 flex flex-col items-end gap-3"
        >
          <AnimatePresence>
            {open && (
              <motion.div
                key="pendencias-lista"
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                className="neu-flat rounded-2xl border border-white/10 p-2 w-64 flex flex-col gap-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                style={{ background: 'var(--color-card-bg)' }}
              >
                {itens.map(({ tipo, label, icon: Icon, cor }) => (
                  <button key={tipo} onClick={() => disparar(tipo)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-left">
                    <Icon size={16} className={cor} />
                    <span className="text-xs font-semibold text-gray-200 flex-1">{label}</span>
                    <span className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full bg-white/10 ${cor}`}>
                      {contagens[tipo]}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            onPointerDown={e => dragControls.start(e)}
            onClick={() => { if (!arrastou.current) setOpen(o => !o); }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileTap={{ scale: 0.95 }}
            aria-label={`${total} pendência(s) esperando você`}
            title="Clique para abrir · arraste para mover"
            className="h-12 pl-4 pr-5 rounded-full neu-flat border border-accent/40 flex items-center gap-2 text-accent hover:border-accent hover:brightness-110 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)] cursor-grab active:cursor-grabbing touch-none"
            style={{ background: 'var(--color-card-bg)' }}
          >
            <span className="relative flex items-center justify-center">
              <span className="absolute inline-flex w-5 h-5 rounded-full bg-accent/30 animate-ping" />
              <Bell size={18} className="relative" />
            </span>
            <span className="text-xs font-black uppercase tracking-widest">Pendências</span>
            <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center">
              {total}
            </span>
          </motion.button>
        </motion.div>
      )}

      {/* Os cinco continuam montados — cada um dono da própria fila, do
          próprio auto-abrir e do próprio modal. Só o botão deles some. */}
      {!aulaFiltro && <AvisoMatrizFAB profile={profile} showToast={showToast} hideTrigger openSignal={sinais.avisoMatriz} onCount={onCount.avisoMatriz} />}
      {!aulaFiltro && <PedidoOnlineFAB profile={profile} onNavigate={onNavigate} hideTrigger openSignal={sinais.pedidoOnline} onCount={onCount.pedidoOnline} />}
      {!aulaFiltro && <ConviteVagaFAB profile={profile} showToast={showToast} hideTrigger openSignal={sinais.conviteVaga} onCount={onCount.conviteVaga} />}
      <NovoDocumentoModal profile={profile} showToast={showToast} activeView={activeView} hideTrigger openSignal={sinais.documento} onCount={onCount.documento} />
      <RequisicaoAvisoModal profile={profile} showToast={showToast} activeView={activeView} onNavigate={onNavigate} hideTrigger openSignal={sinais.requisicao} onCount={onCount.requisicao} />
    </>
  );
}
