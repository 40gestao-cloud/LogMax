import { Loader2 } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK } from './coresMaxPos';

// Vale-Alimentação — a maquininha do voucher pede os 4 últimos dígitos.
// Simulação, igual ao MaxPOS: qualquer combinação de 4 autoriza. Quem grava a
// venda é a view (`confirmarVale`); Esc/Cancelar voltam ao pagamento.
export function ValeModal({ valor, digitos, onDigitos, processando, onConfirmar, onCancelar }: {
  valor: number;
  digitos: string;
  onDigitos: (v: string) => void;
  processando: boolean;
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
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          onCancelar();
          return;
        }
        if (e.key === 'Enter') {
          if ((e.target as HTMLElement)?.tagName === 'BUTTON') { e.stopPropagation(); return; }
          e.preventDefault(); e.stopPropagation(); onConfirmar();
          return;
        }
        if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-sm w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
          <span className="font-black tracking-wide text-sm uppercase">Vale-Alimentação · Autorização</span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600">
            Peça ao cliente os <b>4 últimos dígitos</b> do cartão Vale. É simulação — qualquer combinação de 4 dígitos autoriza.
          </p>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Valor</span>
            <span className="font-bold tabular-nums">R$ {formatBRL(valor)}</span>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Últimos 4 dígitos</label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={digitos}
              onChange={(e) => onDigitos(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0000"
              className="w-full bg-white border-2 text-3xl font-bold text-gray-900 tabular-nums text-center tracking-[0.4em] px-3 py-2 outline-none focus:border-blue-700"
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
              disabled={!/^\d{4}$/.test(digitos) || processando}
              className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30 flex items-center justify-center gap-2"
              style={{ background: NAVY_DARK }}
            >
              {processando ? <><Loader2 size={18} className="animate-spin" /> ...</> : 'AUTORIZAR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
