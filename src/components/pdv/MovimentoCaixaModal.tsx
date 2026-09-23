import { Loader2 } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL, parseBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

// Suprimento (F11, entrada) e Sangria (F10, saída) de dinheiro no caixa. Quem
// valida e grava é a view (`handleCashMoveConfirm`); sangria exige motivo.
export function MovimentoCaixaModal({
  tipo, valorTexto, onValorTexto, motivo, onMotivo, processando, onConfirmar, onFechar,
}: {
  tipo: 'suprimento' | 'sangria';
  valorTexto: string;
  onValorTexto: (v: string) => void;
  motivo: string;
  onMotivo: (v: string) => void;
  processando: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[195] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar(); }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: tipo === 'suprimento' ? MONEY : RED }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">
            {tipo === 'suprimento' ? 'F11 · Entrada de dinheiro' : 'F12 · Saída de dinheiro'}
          </div>
          <div className="text-2xl font-black tracking-wide mt-0.5">
            {tipo === 'suprimento' ? 'Suprimento' : 'Sangria'}
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor</label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={valorTexto}
              onChange={(e) => onValorTexto(formatBRL(parseBRL(e.target.value)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onConfirmar(); }
                if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
              }}
              placeholder="0,00"
              className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            />
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">
              Motivo {tipo === 'sangria' ? '(obrigatório registrar onde foi)' : '(opcional)'}
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => onMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onConfirmar(); }
                if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
              }}
              placeholder={tipo === 'sangria' ? 'Depósito no banco, pagto fornecedor...' : 'Troco inicial, reforço...'}
              className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => onFechar()} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
              Voltar
            </button>
            <button
              onClick={() => onConfirmar()}
              disabled={parseBRL(valorTexto) <= 0 || processando}
              className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
              style={{ background: tipo === 'suprimento' ? MONEY : RED }}
            >
              {processando ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : 'Confirmar (Enter)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
