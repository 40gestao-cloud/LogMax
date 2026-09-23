import { useState } from 'react';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK } from './coresMaxPos';

// Parcelas do Cartão Crédito (1x–12x), na grade 4×3 do MaxPOS. A marcada nasce
// em 1x a cada abertura. Aqui o Tab é da grade (anda em ciclo), não do foco.
export function ParcelasModal({ valorDevido, onEscolher, onVoltar }: {
  valorDevido: number;
  onEscolher: (parcelas: number) => void;
  onVoltar: () => void;
}) {
  const [idx, setIdx] = useState(0);

  return (
    <div
      className="fixed inset-0 z-[195] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onVoltar(); return; }
        if (e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i + 1) % 12);
          return;
        }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setIdx(i => Math.min(i + 1, 11)); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setIdx(i => Math.max(i - 1, 0)); return; }
        if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); setIdx(i => Math.min(i + 4, 11)); return; }
        if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); setIdx(i => Math.max(i - 4, 0)); return; }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          onEscolher(idx + 1);
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Cartão Crédito</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Em quantas parcelas? · R$ {formatBRL(valorDevido)}</div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
              const active = n - 1 === idx;
              const valorParcela = Math.ceil(valorDevido * 100 / n) / 100;
              return (
                <button
                  key={n}
                  onClick={() => onEscolher(n)}
                  onMouseEnter={() => setIdx(n - 1)}
                  className={`border-2 px-2 py-3 flex flex-col items-center gap-0.5 font-black uppercase tracking-wide ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                  style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                >
                  <span className="text-lg">{n}x</span>
                  <span className="text-[10px] text-gray-600 tabular-nums normal-case">
                    {n === 1 ? 'à vista' : `R$ ${formatBRL(valorParcela)}`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            ↑↓←→ navegar · Enter confirmar · Esc voltar
          </div>
        </div>
      </div>
    </div>
  );
}
