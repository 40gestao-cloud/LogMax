import { Loader2, Lock } from 'lucide-react';
import type { useAbrirCaixa } from '../../hooks/useAbrirCaixa';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

// Caixa fechado no PDV SuperMax: o operador conta o fundo de troco e abre o
// caixa ali mesmo (useAbrirCaixa), ou confere se alguém já abriu.
export function AberturaCaixaCard({ filial, abertura, onVerificar }: {
  filial: string;
  abertura: ReturnType<typeof useAbrirCaixa>;
  onVerificar: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white border-4 shadow-2xl p-8 text-center" style={{ borderColor: RED }}>
        <Lock size={48} className="mx-auto mb-4" style={{ color: RED }} />
        <h2 className="text-2xl font-black uppercase tracking-wide" style={{ color: NAVY_DARK }}>Caixa fechado</h2>
        <p className="text-sm text-gray-700 mt-3 leading-relaxed">
          O caixa de <b>{filial}</b> não está aberto hoje. Conte o fundo de troco da gaveta e abra o caixa para começar a operar.
        </p>
        <div className="mt-6 text-left space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
              Fundo de troco <span className="text-gray-400 normal-case font-medium">(dinheiro que já está na gaveta)</span>
            </label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={abertura.valor}
              onChange={(e) => abertura.onChangeValor(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); abertura.abrir(); } }}
              placeholder="0,00"
              className="w-full bg-white border-2 text-2xl font-bold text-gray-900 tabular-nums px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
              Observação <span className="text-gray-400 normal-case font-medium">(opcional)</span>
            </label>
            <input
              type="text"
              maxLength={200}
              value={abertura.obs}
              onChange={(e) => abertura.setObs(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); abertura.abrir(); } }}
              placeholder="Ex.: troco conferido com o gerente"
              className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          </div>
          <button
            onClick={abertura.abrir}
            disabled={!abertura.podeAbrir}
            className="w-full px-6 py-4 text-white font-black uppercase tracking-wide text-base disabled:opacity-30 flex items-center justify-center gap-2"
            style={{ background: MONEY }}
          >
            {abertura.abrindo ? <><Loader2 size={18} className="animate-spin" /> Abrindo…</> : 'Abrir Caixa (Enter)'}
          </button>
          <button
            onClick={() => onVerificar()}
            className="w-full px-6 py-2 font-bold uppercase tracking-wide text-xs border-2"
            style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
          >
            Já abriram para mim · Verificar novamente
          </button>
        </div>
      </div>
    </div>
  );
}
