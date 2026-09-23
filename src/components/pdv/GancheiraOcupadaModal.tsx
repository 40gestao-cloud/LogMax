import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Gancheira ocupada (Ctrl+G com uma venda já suspensa): ela guarda uma venda
// por vez, e suspender esta descarta aquela. Enter suspende, Esc volta.
export function GancheiraOcupadaModal({ suspensa, onSuspender, onVoltar }: {
  suspensa: { itens: number; suspensaEm: string | number | Date } | null;
  onSuspender: () => void;
  onVoltar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          onVoltar();
          return;
        }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onSuspender(); return; }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: YELLOW_DARK }}>
        <div className="px-5 py-4" style={{ background: YELLOW, color: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-80">Gancheira ocupada</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Já há uma venda suspensa</div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            A gancheira guarda <b>uma venda por vez</b>. A que está lá tem{' '}
            <b>{suspensa?.itens ?? 0} item(s)</b>, suspensa às{' '}
            <b>{suspensa ? new Date(suspensa.suspensaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b>.
            Suspender esta descarta aquela.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onVoltar()}
              className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              Voltar
            </button>
            <button
              onClick={() => onSuspender()}
              className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
              style={{ background: NAVY_DARK }}
            >
              Suspender (Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
