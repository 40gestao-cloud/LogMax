// FAB de pedidos da loja online — visível em qualquer tela enquanto houver
// pedido esperando atendimento. Clica → modal com a fila → "Atender" leva para
// Vendas → Pedidos Online. Fila vazia, o FAB some sozinho.
//
// Mesmo padrão do AvisoMatrizFAB, e a diferença é o que tira o item da fila:
// no aviso é o "Ciente" do destinatário; aqui é o pedido virar venda ou ser
// cancelado. Não existe botão de "já vi" — dar ciência sem atender deixaria o
// comprador esperando com a consciência tranquila de quem clicou.
//
// Nasce acima do AvisoMatrizFAB (bottom-24) para não colidir com ele nem com o
// PontoFAB (bottom-6) — mas é arrastável: ancorado no canto ele tapava conteúdo
// em tela cheia de tabela, e não havia como tirar da frente sem atender a fila.
// A posição escolhida fica salva por navegador.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'motion/react';
import { ShoppingCart, X, ArrowRight, Store, AlertTriangle } from 'lucide-react';
import { usePedidosNovos } from '../hooks/usePedidosNovos';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from './FilialSelector';
import type { UserProfile } from '../hooks/useUserProfile';

const FILIAIS_OP: readonly string[] = ['SuperMax', 'MaxLook', 'TechMax'];

// Deslocamento em relação ao canto padrão, não coordenada absoluta: assim a
// posição salva continua fazendo sentido se a âncora do CSS mudar.
const POS_KEY = 'logmax:pedido-fab-pos';
const MARGEM = 8;

const brl = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const desdeQuando = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
};

export function PedidoOnlineFAB({ profile, onNavigate, hideTrigger, openSignal, onCount }: {
  profile: UserProfile; onNavigate: (v: string) => void;
  /** FAB único de pendências (item 23): esconde o próprio botão e só reage
   *  ao `openSignal` para abrir a lista. `onCount` devolve o tamanho da fila
   *  para quem mostra a contagem — o hook fica montado só aqui. */
  hideTrigger?: boolean; openSignal?: number; onCount?: (n: number) => void;
}) {
  // A régua de quem opera a loja mora na RLS (`auth_opera_loja`). Aqui só
  // evitamos a consulta para quem certamente não tem nada a ver com vendas —
  // conselheiro é observador, e ninguém sem setor recebe fila de trabalho.
  const podeAtender = profile?.role !== 'conselheiro' && !!profile?.setor;
  const { pendentes } = usePedidosNovos(podeAtender);
  const { filialAtiva, setFilialAtiva } = useFilial();
  const [open, setOpen] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Arrastar termina em click no DOM. Sem esta guarda, soltar o FAB abriria
  // a fila toda vez que alguém só quisesse tirá-lo da frente.
  const arrastou = useRef(false);
  const visivel = pendentes.length > 0;

  // Puxa de volta pra dentro da tela. Necessário em dois momentos: ao restaurar
  // uma posição salva num monitor maior, e ao redimensionar a janela — senão o
  // FAB fica inalcançável fora da viewport, e com ele a fila de pedidos.
  const acomodar = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < MARGEM) dx = MARGEM - r.left;
    else if (r.right > window.innerWidth - MARGEM) dx = window.innerWidth - MARGEM - r.right;
    if (r.top < MARGEM) dy = MARGEM - r.top;
    else if (r.bottom > window.innerHeight - MARGEM) dy = window.innerHeight - MARGEM - r.bottom;
    if (dx) x.set(x.get() + dx);
    if (dy) y.set(y.get() + dy);
  }, [x, y]);

  useEffect(() => {
    if (!visivel) return;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) { x.set(p.x); y.set(p.y); }
      }
    } catch { /* storage bloqueado ou json torto: fica no canto padrão */ }
    // Espera o layout aplicar o transform antes de medir.
    const id = requestAnimationFrame(acomodar);
    window.addEventListener('resize', acomodar);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', acomodar); };
  }, [visivel, x, y, acomodar]);

  useEffect(() => { if (pendentes.length === 0) setOpen(false); }, [pendentes.length]);

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Antes do early return: fila vazia também é notícia para quem conta.
  useEffect(() => { onCount?.(pendentes.length); }, [pendentes.length, onCount]);
  useEffect(() => () => { onCount?.(0); }, [onCount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (pendentes.length === 0) return null;

  // O FAB mostra tudo que a RLS deixa ver — para admin, CEO e quem opera mais
  // de uma unidade, isso inclui filial diferente da ativa. A tela de destino
  // opera UMA unidade por vez (e em modo Matriz não renderiza nada), então sem
  // trocar a filial aqui o clique leva a uma lista sem o pedido que o próprio
  // FAB acabou de mostrar — ou a uma tela em branco.
  const atender = () => {
    setOpen(false);
    const temNaAtiva = pendentes.some(p => p.filial === filialAtiva);
    const alvo = temNaAtiva ? filialAtiva : pendentes.find(p => FILIAIS_OP.includes(p.filial))?.filial;
    if (alvo && alvo !== filialAtiva) setFilialAtiva(alvo as FilialOp);
    onNavigate('vendas-pedidosonline');
  };

  const total = pendentes.reduce((s, p) => s + Number(p.total_final ?? 0), 0);

  return (
    <>
      {!hideTrigger && (
      <motion.button
        ref={btnRef}
        onClick={() => {
          if (arrastou.current) { arrastou.current = false; return; }
          setOpen(true);
        }}
        drag
        dragMomentum={false}
        dragElastic={0}
        onDragStart={() => { arrastou.current = true; }}
        onDragEnd={() => {
          acomodar();
          try {
            localStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }));
          } catch { /* sem storage, a posição vale só nesta sessão */ }
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        whileTap={{ scale: 0.95 }}
        whileDrag={{ scale: 1.04 }}
        aria-label="Ver pedidos da loja online esperando atendimento. Arraste para reposicionar."
        title="Clique para ver a fila · arraste para tirar da frente"
        className="fixed bottom-40 right-6 z-40 h-12 pl-4 pr-5 rounded-full neu-flat border border-emerald-400/40 flex items-center gap-2 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)] cursor-grab active:cursor-grabbing"
        style={{ x, y, background: 'var(--color-card-bg)' }}
      >
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex w-5 h-5 rounded-full bg-emerald-400/30 animate-ping" />
          <ShoppingCart size={18} className="relative" />
        </span>
        <span className="text-xs font-black uppercase tracking-widest">
          {pendentes.length === 1 ? 'Novo pedido' : 'Novos pedidos'}
        </span>
        {pendentes.length > 1 && (
          <span className="text-[10px] font-black tabular-nums w-5 h-5 rounded-full bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center">
            {pendentes.length}
          </span>
        )}
      </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="pedido-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="pedido-dialog"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="neu-flat rounded-3xl border border-emerald-400/30 p-5 sm:p-6 w-full max-w-lg max-h-[85vh] flex flex-col gap-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-400/10 ring-1 ring-emerald-400/30 flex items-center justify-center shrink-0">
                    <Store size={18} className="text-emerald-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Loja online</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {pendentes.length} pedido{pendentes.length === 1 ? '' : 's'} esperando · {brl(total)}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar"
                  className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-2 -mx-1 px-1">
                {pendentes.map(p => (
                  <div key={p.id} className="neu-pressed rounded-xl p-3 flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-accent tracking-wider shrink-0">{p.codigo}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-200 truncate">{p.comprador_apelido}</p>
                      <p className="text-[10px] text-gray-500">
                        {p.filial} · prefere {p.forma_desejada} · {desdeQuando(p.created_at)}
                        {Number(p.origem_pedidos_24h ?? 1) > 2 && (
                          <span className="text-yellow-400 inline-flex items-center gap-1 ml-1">
                            <AlertTriangle size={9} />{p.origem_pedidos_24h}º da mesma origem
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-100 tabular-nums shrink-0">{brl(p.total_final)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-[10px] text-gray-500 leading-relaxed max-w-[55%]">
                  O pedido não reserva estoque — quanto mais tempo na fila, maior a chance
                  de faltar item na hora de fechar.
                </p>
                <button
                  onClick={atender}
                  className="text-xs font-black uppercase tracking-widest px-5 py-2.5 rounded-xl neu-button text-emerald-300 ring-1 ring-emerald-500/40 hover:ring-emerald-400 flex items-center gap-2 shrink-0"
                >
                  Atender <ArrowRight size={13} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
