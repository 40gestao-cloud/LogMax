import { useState } from 'react';
import { Wallet, Users as UsersIcon } from 'lucide-react';
import { NAVY_DARK } from './coresMaxPos';

export type FormaUnica = 'PIX' | 'Vale-Alimentação' | 'Fiado';

const OPCOES = [
  { forma: 'PIX' as const,              Icon: Wallet },
  { forma: 'Vale-Alimentação' as const, Icon: Wallet },
  { forma: 'Fiado' as const,            Icon: UsersIcon },
];

// F3 no pagamento do PDV SuperMax: PIX, Vale ou Fiado. PIX aceita misto;
// Vale e Fiado só como forma única. Com `misto`, os dois ficam desabilitados
// aqui mesmo — a recusa da view sai num toast que o overlay esconde, e o
// operador ficava sem saber por que o Enter não fez nada.
// Nasce no PIX a cada abertura.
export function PagadorPickerModal({ misto = false, onEscolher, onVoltar }: {
  misto?: boolean;
  onEscolher: (forma: FormaUnica) => void;
  onVoltar: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const bloqueada = (forma: FormaUnica) => misto && forma !== 'PIX';
  const escolher = (i: number) => { if (!bloqueada(OPCOES[i].forma)) onEscolher(OPCOES[i].forma); };
  // Setas pulam as opções bloqueadas; em misto só sobra o PIX.
  const andar = (passo: 1 | 2) => setIdx(i => {
    let n = i;
    for (let k = 0; k < 3; k++) {
      n = (n + passo) % 3;
      if (!bloqueada(OPCOES[n].forma)) return n;
    }
    return i;
  });

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
          andar(1);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          andar(2);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          escolher(idx);
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
          {OPCOES.map(({ forma, Icon }, i) => {
            const active = i === idx;
            const off = bloqueada(forma);
            return (
              <button
                key={forma}
                disabled={off}
                onClick={() => escolher(i)}
                onMouseEnter={() => { if (!off) setIdx(i); }}
                title={off ? `${forma} só funciona como forma única — limpe os pagamentos lançados pra usar` : undefined}
                className={`w-full border-2 px-4 py-4 flex items-center gap-3 font-black uppercase tracking-wide text-left disabled:opacity-30 disabled:cursor-not-allowed ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
              >
                <Icon size={22} />
                <span>{forma}</span>
                {off && <span className="ml-auto text-[10px] font-bold normal-case tracking-normal text-gray-500">só forma única</span>}
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
