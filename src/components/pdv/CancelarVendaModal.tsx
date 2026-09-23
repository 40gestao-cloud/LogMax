import { useState } from 'react';
import { NAVY_DARK, RED } from './coresMaxPos';

// Confirmar o cancelamento da venda inteira. Nasce em "Voltar" — o mais
// seguro; ← → escolhem, Tab alterna, Enter confirma o escolhido.
export function CancelarVendaModal({ itens, onCancelarVenda, onVoltar }: {
  itens: number;
  onCancelarVenda: () => void;
  onVoltar: () => void;
}) {
  const [idx, setIdx] = useState<0 | 1>(0);

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      ref={(el) => { if (el) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onVoltar(); return; }
        if (e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i === 0 ? 1 : 0));
          return;
        }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setIdx(0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setIdx(1); return; }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          if (idx === 1) onCancelarVenda();
          else onVoltar();
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: RED }}>
        <div className="px-5 py-4 text-white" style={{ background: RED }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Confirmar</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar venda?</div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Todos os {itens} item(s) serão removidos do carrinho. Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onVoltar()}
              onMouseEnter={() => setIdx(0)}
              className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm ${idx === 0 ? 'bg-gray-100' : ''}`}
              style={{ borderColor: idx === 0 ? NAVY_DARK : '#9ca3af', color: NAVY_DARK, boxShadow: idx === 0 ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
            >
              Voltar
            </button>
            <button
              onClick={() => onCancelarVenda()}
              onMouseEnter={() => setIdx(1)}
              className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
              style={{ background: RED, boxShadow: idx === 1 ? `inset 0 0 0 2px white` : undefined }}
            >
              Cancelar venda
            </button>
          </div>
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            ← → escolher · Enter confirmar · Esc voltar
          </div>
        </div>
      </div>
    </div>
  );
}
