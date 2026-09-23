import type React from 'react';
import { HelpCircle, Maximize2, Minimize2 } from 'lucide-react';
import { YELLOW, YELLOW_DARK, NAVY_DARK, MONEY } from './coresMaxPos';

// Faixa amarela do topo do PDV SuperMax (réplica do MaxPOS): operador, cupom,
// hora, status do caixa, trocar PDV, tela cheia e manual.
export const Header = ({
  operadorNome, cupomSeq, caixaAberto, datetime, onSwitchFilial, fullscreen, onToggleFullscreen, onOpenHelp, extraActions,
}: {
  operadorNome: string;
  cupomSeq: string;
  caixaAberto: boolean;
  datetime: string;
  onSwitchFilial?: (filial: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenHelp: () => void;
  extraActions?: React.ReactNode;
}) => (
  <div
    className="px-4 py-3 flex items-center justify-between shrink-0 border-b-2 gap-3"
    style={{ background: YELLOW, borderColor: YELLOW_DARK }}
  >
    <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
      <span
        className="text-3xl tracking-wide font-black shrink-0"
        style={{ color: NAVY_DARK, textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
      >
        SUPERMAX
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        CAIXA 01
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border truncate max-w-[260px]" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        OP: {operadorNome}
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        CUPOM: {cupomSeq}
      </span>
      <span className="hidden lg:inline-flex shrink-0 px-3 py-1.5 rounded-md text-sm font-bold tabular-nums border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        {datetime}
      </span>
      {caixaAberto && (
        <span className="shrink-0 px-2.5 py-1.5 rounded-md text-xs font-black uppercase tracking-wider border-2 inline-flex items-center gap-1" style={{ background: MONEY, color: 'white', borderColor: '#14532d' }}>
          CAIXA ABERTO
        </span>
      )}
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {extraActions}
      {onSwitchFilial && (
        <button
          type="button"
          onClick={() => onSwitchFilial('')}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 bg-white flex items-center gap-1.5"
          style={{ color: NAVY_DARK, borderColor: NAVY_DARK }}
          title="Trocar de PDV (Ctrl+M)"
        >
          Trocar PDV
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFullscreen}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2"
        style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
        title={fullscreen ? 'Sair tela cheia (Esc · Ctrl+F)' : 'Entrar em tela cheia (Ctrl+F)'}
        aria-label={fullscreen ? 'Sair tela cheia' : 'Entrar em tela cheia'}
      >
        {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
      <button
        type="button"
        onClick={onOpenHelp}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2 hover:brightness-110"
        style={{ background: NAVY_DARK, color: YELLOW, borderColor: NAVY_DARK }}
        title="Manual do PDV (Shift+F1 ou ?)"
        aria-label="Manual do PDV"
      >
        <HelpCircle size={20} />
      </button>
    </div>
  </div>
);
