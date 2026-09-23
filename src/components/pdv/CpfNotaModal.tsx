import { trapTab } from '../../lib/focoPdv';
import { mascararDocumento } from '../../lib/pdv/documento';
import { NAVY_DARK } from './coresMaxPos';

// CPF / CNPJ na nota — o mesmo modal do MaxPOS. Vazio + confirmar remove.
// O valor fica na view porque é ela que valida e guarda (`confirmarCpf`).
export function CpfNotaModal({ valor, onChange, onConfirmar, onCancelar }: {
  valor: string;
  onChange: (v: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancelar(); return; }
        if (e.key === 'Enter') {
          if ((e.target as HTMLElement)?.tagName === 'BUTTON') { e.stopPropagation(); return; }
          e.preventDefault(); e.stopPropagation(); onConfirmar();
          return;
        }
        if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
          <span className="font-black tracking-wide text-sm uppercase">CPF / CNPJ na nota</span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600">
            Informe CPF (11 dígitos) ou CNPJ (14 dígitos). Deixe vazio e confirme para remover.
          </p>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Documento</label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={valor}
              onChange={(e) => onChange(mascararDocumento(e.target.value))}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="000.000.000-00"
              className="w-full bg-white border-2 text-2xl font-bold text-gray-900 tabular-nums px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => onCancelar()}
              className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
              style={{ borderColor: '#9ca3af' }}
            >
              CANCELAR
            </button>
            <button
              onClick={() => onConfirmar()}
              className="flex-1 px-4 py-3 text-white font-bold"
              style={{ background: NAVY_DARK }}
            >
              CONFIRMAR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
