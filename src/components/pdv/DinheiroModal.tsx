import type { RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL, parseBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY } from './coresMaxPos';

// Dinheiro no pagamento do PDV SuperMax: valor recebido e troco. Confirmar não
// fecha a venda — lança a linha de Dinheiro na lista (a view faz isso em
// `handleCashConfirm`). `inputRef` é da view, que põe o foco ao abrir.
export function DinheiroModal({
  valorDevido, totalFinal, recebidoTexto, onRecebido, inputRef, processando, onConfirmar, onVoltar,
}: {
  valorDevido: number;
  totalFinal: number;
  recebidoTexto: string;
  onRecebido: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  processando: boolean;
  onConfirmar: () => void;
  onVoltar: () => void;
}) {
  const recebido = parseBRL(recebidoTexto);
  const trocoLocal = Math.max(0, recebido - valorDevido);

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        // Bloqueia F-keys vazarem
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Dinheiro</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">
            {valorDevido < totalFinal - 0.001 ? `Parcial R$ ${formatBRL(valorDevido)} de ${formatBRL(totalFinal)}` : `Total R$ ${formatBRL(totalFinal)}`}
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor recebido</label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={recebidoTexto}
              onChange={(e) => onRecebido(formatBRL(parseBRL(e.target.value)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault(); e.stopPropagation();
                  onConfirmar();
                } else if (e.key === 'Escape') {
                  e.preventDefault(); e.stopPropagation();
                  onVoltar();
                }
              }}
              placeholder="0,00"
              className="w-full border-2 text-4xl font-black tabular-nums px-4 py-3 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            />
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-bold uppercase tracking-widest text-gray-600">Troco</span>
            <span className="text-3xl font-black tabular-nums" style={{ color: MONEY }}>
              R$ {formatBRL(trocoLocal)}
            </span>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => onVoltar()} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
              Voltar
            </button>
            <button
              onClick={() => onConfirmar()}
              disabled={recebido < valorDevido - 0.001 || processando}
              className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
              style={{ background: MONEY }}
            >
              {processando ? <><Loader2 size={16} className="animate-spin" /> Confirmando...</> : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
