import { Calculator, Loader2, PauseCircle } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL, parseBRL } from '../../lib/viewUtils';
import { YELLOW_DARK, NAVY_DARK, RED } from './coresMaxPos';

// F12 do PDV SuperMax: o operador fecha o caixa (conta o dinheiro e informa)
// ou suspende (troca de turno, intervalo). Quem grava é a view
// (`handleCaixaOpConfirm`).
export function OperacaoCaixaModal({
  modo, onModo, valorTexto, onValorTexto, obs, onObs, processando, onConfirmar, onFechar,
}: {
  modo: 'fechar' | 'suspender';
  onModo: (m: 'fechar' | 'suspender') => void;
  valorTexto: string;
  onValorTexto: (v: string) => void;
  obs: string;
  onObs: (v: string) => void;
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
      <div className="bg-white border-4 max-w-lg w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F3 · Operador</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Fechar / Suspender Caixa</div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => onModo('fechar')}
              className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm flex items-center justify-center gap-2 ${modo === 'fechar' ? 'text-white' : ''}`}
              style={modo === 'fechar' ? { background: RED, borderColor: RED, color: 'white' } : { borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              <Calculator size={16} /> Fechar
            </button>
            <button
              onClick={() => onModo('suspender')}
              className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm flex items-center justify-center gap-2 ${modo === 'suspender' ? 'text-white' : ''}`}
              style={modo === 'suspender' ? { background: YELLOW_DARK, borderColor: YELLOW_DARK, color: 'white' } : { borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              <PauseCircle size={16} /> Suspender
            </button>
          </div>

          {modo === 'fechar' && (
            <>
              <p className="text-xs text-gray-500">
                Conte o dinheiro fisicamente e informe abaixo. O sistema calcula o esperado e mostra a diferença para conferência do financeiro.
              </p>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor contado em dinheiro</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={valorTexto}
                  onChange={(e) => onValorTexto(formatBRL(parseBRL(e.target.value)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); onConfirmar(); }
                  }}
                  placeholder="0,00"
                  className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                />
              </div>
            </>
          )}
          {modo === 'suspender' && (
            <p className="text-xs text-gray-500">
              Suspender pausa o caixa temporariamente (troca de turno, intervalo). O financeiro poderá reabrir ou fechar definitivamente.
            </p>
          )}

          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Observação (opcional)</label>
            <input
              autoFocus={modo === 'suspender'}
              type="text"
              value={obs}
              onChange={(e) => onObs(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onConfirmar(); }
              }}
              placeholder={modo === 'suspender' ? 'Ex: troca de turno, intervalo...' : 'Ex: fechamento fim do expediente'}
              className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onFechar()}
              className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              Voltar
            </button>
            <button
              onClick={() => onConfirmar()}
              disabled={processando || (modo === 'fechar' && parseBRL(valorTexto) <= 0)}
              className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
              style={{ background: modo === 'fechar' ? RED : YELLOW_DARK }}
            >
              {processando
                ? <><Loader2 size={16} className="animate-spin" /> Processando...</>
                : modo === 'fechar' ? 'Fechar caixa (Enter)' : 'Suspender caixa (Enter)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
