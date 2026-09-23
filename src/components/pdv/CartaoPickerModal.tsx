import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { NAVY_DARK } from './coresMaxPos';

export type FormaCartao = 'Cartão Crédito' | 'Cartão Débito';

// F2 no pagamento do PDV SuperMax: Crédito ou Débito. Nasce em Crédito a cada
// abertura; Tab e as setas alternam entre as duas.
export function CartaoPickerModal({ onEscolher, onVoltar }: {
  onEscolher: (forma: FormaCartao) => void;
  onVoltar: () => void;
}) {
  const [idx, setIdx] = useState<0 | 1>(0);

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
          setIdx(i => (i === 0 ? 1 : 0));
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i === 0 ? 1 : 0));
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i === 0 ? 1 : 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          onEscolher(idx === 0 ? 'Cartão Crédito' : 'Cartão Débito');
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F2 · Cartão</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Crédito ou Débito?</div>
        </div>
        <div className="p-6 space-y-3">
          {(['Cartão Crédito', 'Cartão Débito'] as const).map((forma, i) => {
            const active = i === idx;
            return (
              <button
                key={forma}
                onClick={() => onEscolher(forma)}
                onMouseEnter={() => setIdx(i as 0 | 1)}
                className={`w-full border-2 px-4 py-4 flex items-center gap-3 font-black uppercase tracking-wide text-left ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
              >
                <CreditCard size={22} />
                <span>{forma}</span>
              </button>
            );
          })}
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center pt-2">
            ↑↓ navegar · Enter selecionar · Esc voltar
          </div>
        </div>
      </div>
    </div>
  );
}
