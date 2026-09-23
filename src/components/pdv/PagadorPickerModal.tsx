import { useState } from 'react';
import { Wallet, Users as UsersIcon } from 'lucide-react';
import { NAVY_DARK } from './coresMaxPos';

export type FormaUnica = 'PIX' | 'Vale-Alimentação' | 'Fiado';

// F3 no pagamento do PDV SuperMax: PIX, Vale ou Fiado — as formas que só
// valem como forma única. Nasce no PIX a cada abertura.
export function PagadorPickerModal({ onEscolher, onVoltar }: {
  onEscolher: (forma: FormaUnica) => void;
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
        if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i + 1) % 3);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => (i + 2) % 3);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          onEscolher(idx === 0 ? 'PIX' : idx === 1 ? 'Vale-Alimentação' : 'Fiado');
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F3 · Outras formas</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">PIX, Vale ou Fiado?</div>
        </div>
        <div className="p-6 space-y-3">
          {([
            { forma: 'PIX' as const,              Icon: Wallet },
            { forma: 'Vale-Alimentação' as const, Icon: Wallet },
            { forma: 'Fiado' as const,            Icon: UsersIcon },
          ]).map(({ forma, Icon }, i) => {
            const active = i === idx;
            return (
              <button
                key={forma}
                onClick={() => onEscolher(forma)}
                onMouseEnter={() => setIdx(i)}
                className={`w-full border-2 px-4 py-4 flex items-center gap-3 font-black uppercase tracking-wide text-left ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
              >
                <Icon size={22} />
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
