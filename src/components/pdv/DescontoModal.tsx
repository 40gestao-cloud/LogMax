import { trapTab } from '../../lib/focoPdv';
import { formatBRL, parseBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

// F6 — desconto no total do PDV SuperMax. Não aplica: em supermercado o
// desconto sai com a senha do gerente, então "Pedir autorização" entrega o
// valor (já limitado ao subtotal) para a view abrir a autorização. `%` e `$`
// trocam o tipo pelo teclado.
export function DescontoModal({
  subtotal, tipo, onTipo, valorTexto, onValorTexto, temDesconto, onPedirAutorizacao, onRemover, onFechar,
}: {
  subtotal: number;
  tipo: 'percent' | 'reais';
  onTipo: (t: 'percent' | 'reais') => void;
  valorTexto: string;
  onValorTexto: (v: string) => void;
  temDesconto: boolean;
  onPedirAutorizacao: (valor: number) => void;
  onRemover: () => void;
  onFechar: () => void;
}) {
  const parsed = parseBRL(valorTexto);
  const valorReais = tipo === 'percent'
    ? parseFloat(((subtotal * parsed) / 100).toFixed(2))
    : parsed;
  const valorClamp = Math.min(valorReais, subtotal);
  const novoTotal = Math.max(0, subtotal - valorClamp);
  const aplicar = () => onPedirAutorizacao(valorClamp);

  return (
    <div
      className="fixed inset-0 z-[195] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar(); }
        if (e.key === '%') { e.preventDefault(); onTipo('percent'); }
        if (e.key === '$') { e.preventDefault(); onTipo('reais'); }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F6 · Desconto no total (com o gerente)</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Subtotal R$ {formatBRL(subtotal)}</div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => onTipo('percent')}
              className={`flex-1 px-3 py-2 border-2 font-black uppercase tracking-wide text-sm ${tipo === 'percent' ? 'bg-yellow-100' : ''}`}
              style={{ borderColor: tipo === 'percent' ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK }}
            >
              % Percentual
            </button>
            <button
              onClick={() => onTipo('reais')}
              className={`flex-1 px-3 py-2 border-2 font-black uppercase tracking-wide text-sm ${tipo === 'reais' ? 'bg-yellow-100' : ''}`}
              style={{ borderColor: tipo === 'reais' ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK }}
            >
              R$ Valor
            </button>
          </div>
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">
              {tipo === 'percent' ? 'Percentual (0-100)' : 'Valor em R$'}
            </label>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={valorTexto}
              onChange={(e) => onValorTexto(formatBRL(parseBRL(e.target.value)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); aplicar(); }
                if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
              }}
              placeholder="0,00"
              className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            />
          </div>
          <div className="border-2 px-3 py-2 bg-gray-50" style={{ borderColor: '#e5e7eb' }}>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Desconto aplicado</span>
              <span className="font-bold tabular-nums" style={{ color: RED }}>− R$ {formatBRL(valorClamp)}</span>
            </div>
            <div className="flex justify-between text-base font-bold mt-1">
              <span>Novo total</span>
              <span className="tabular-nums" style={{ color: MONEY }}>R$ {formatBRL(novoTotal)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onRemover()} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
              {temDesconto ? 'Remover' : 'Voltar'}
            </button>
            <button onClick={aplicar} className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm" style={{ background: NAVY_DARK }}>
              Pedir autorização (Enter)
            </button>
          </div>
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            Atalhos: % percentual · $ valor R$
          </div>
        </div>
      </div>
    </div>
  );
}
