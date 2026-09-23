import { trapTab } from '../../lib/focoPdv';
import { formatBRL } from '../../lib/viewUtils';
import { YELLOW, NAVY_DARK, MONEY } from './coresMaxPos';

// Troco a entregar (ou PAGAMENTO EXATO) em tela cheia, depois de uma venda com
// dinheiro. Enter, Esc ou espaço seguem para o recibo.
export function TrocoTela({ valor, onContinuar }: { valor: number; onContinuar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: valor > 0 ? NAVY_DARK : MONEY }}
      tabIndex={-1}
      ref={(el) => { if (el) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          onContinuar();
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="text-center text-white">
        {valor > 0 ? (
          <>
            <div className="text-2xl font-bold uppercase tracking-[0.3em] opacity-80 mb-4">Troco a entregar</div>
            <div className="text-9xl font-black tabular-nums leading-none" style={{ color: YELLOW }}>
              R$ {formatBRL(valor)}
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold uppercase tracking-[0.3em] opacity-90 mb-4">Pagamento</div>
            <div className="text-9xl font-black uppercase leading-none">EXATO</div>
            <div className="mt-4 text-xl font-bold uppercase tracking-widest opacity-90">Sem troco a entregar</div>
          </>
        )}
        <button
          onClick={() => onContinuar()}
          className="mt-12 px-10 py-4 text-white font-black uppercase tracking-wide text-lg border-2"
          style={{ background: valor > 0 ? MONEY : NAVY_DARK, borderColor: 'white' }}
          autoFocus
        >
          OK · Enter
        </button>
      </div>
    </div>
  );
}
