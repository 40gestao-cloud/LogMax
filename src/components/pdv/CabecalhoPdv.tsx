import type React from 'react';
import { useEffect, useState } from 'react';
import { HelpCircle, Maximize2, Minimize2 } from 'lucide-react';
import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Relógio da faixa, isolado como o RelogioPdv do MaxPOS: o tique de 1s
// redesenha só este texto. Antes o PDVViewSupermax guardava um tique de 30s
// e repassava a hora por prop — os segundos ficavam parados na tela e cada
// tique redesenhava o PDV inteiro.
function RelogioPdv() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{agora.toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}</>;
}

// Faixa amarela do topo do PDV SuperMax (réplica do MaxPOS): operador, cupom,
// hora, trocar PDV, tela cheia e manual. Sem selo "caixa aberto": o botão de
// fechar o caixa ao lado já diz que ele está aberto.
export const Header = ({
  operadorNome, cupomSeq, onSwitchFilial, fullscreen, onToggleFullscreen, onOpenHelp, extraActions,
}: {
  operadorNome: string;
  cupomSeq: string;
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
    {/* Uma linha só, como no MaxPOS: o que não cabe é cortado. Com flex-wrap a
        última etiqueta caía para a linha de baixo e engordava a faixa. */}
    <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
      {/* Marca MaxPOS em arte, como no cabeçalho do MaxPOS (mesmo arquivo,
          482x180 transparente, e mesma altura). -my-1 para a faixa não
          engordar só por causa dela. */}
      <img
        src="/icon-maxpos-header.png"
        alt="MaxPOS"
        className="h-14 -my-1 w-auto shrink-0 select-none"
        draggable={false}
      />
      {/* Selo da unidade, igual ao do MaxPOS: navy com a logo e o nome. */}
      <span
        className="shrink-0 pl-1 pr-3 py-1 rounded-md text-base font-black tracking-wide border-2 flex items-center gap-2"
        style={{ background: NAVY_DARK, color: YELLOW, borderColor: '#ffffff' }}
        title="Você está operando o PDV SuperMax"
      >
        {/* Selo leve (icon-supermax.png, 503x388), não o
            logo-supermax-agradecimento.png: aquele é o de 1571x1215 da tela de
            agradecimento, pesado para 36px. Mesmos nomes do MaxPOS. Placa branca porque a
            arte é azul-marinho e sumia sobre o navy do selo. */}
        <img src="/icon-supermax.png" alt="" className="w-9 h-9 object-contain rounded bg-white" />
        SUPERMAX
      </span>
      {/* Etiquetas do caixa encostadas à direita, junto dos botões; marca e
          selo ficam à esquerda. */}
      <div className="ml-auto flex items-center gap-3 min-w-0 overflow-hidden">
        <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border-2" style={{ background: '#ffffff', color: NAVY_DARK, borderColor: NAVY_DARK }}>
          CAIXA 01
        </span>
        <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border-2 truncate max-w-[260px]" style={{ background: '#ffffff', color: NAVY_DARK, borderColor: NAVY_DARK }}>
          OP: {operadorNome}
        </span>
        <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border-2" style={{ background: '#ffffff', color: NAVY_DARK, borderColor: NAVY_DARK }}>
          CUPOM: {cupomSeq}
        </span>
        <span className="hidden lg:inline-flex shrink-0 px-3 py-1.5 rounded-md text-sm font-bold tabular-nums border-2" style={{ background: '#ffffff', color: NAVY_DARK, borderColor: NAVY_DARK }}>
          <RelogioPdv />
        </span>
      </div>
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
