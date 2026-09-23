import { FileDown } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL, gerarReciboVendaPDF } from '../../lib/viewUtils';
import { YELLOW, YELLOW_DARK, NAVY_DARK, MONEY } from './coresMaxPos';

export interface VendaConcluida {
  id: string;
  total: number;
  subtotal: number;
  desconto: number;
  forma: string;
  cliente: string | null;
  cpfNota?: string | null;
  economia?: number;
  itens: { nome_produto: string; qtd: number; preco_unitario: number; subtotal: number }[];
}

// Recibo do PDV SuperMax — resumo da venda com o PDF, antes do agradecimento.
// Enter fora dos botões (ou "Continuar") segue para o agradecimento.
export function ReciboVendaModal({ venda, filial, operador, onContinuar }: {
  venda: VendaConcluida;
  filial: string;
  operador: string;
  onContinuar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      ref={(el) => { if (el) { const btn = el.querySelector<HTMLButtonElement>('button:last-of-type'); if (btn) btn.focus(); else el.focus(); } }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault(); e.stopPropagation();
          onContinuar();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ border: `3px solid ${NAVY_DARK}` }}>
        <div className="px-5 py-4 text-center" style={{ background: NAVY_DARK, color: 'white' }}>
          <div className="text-xs font-bold uppercase tracking-[0.3em] opacity-70">Venda concluída</div>
          <div className="text-3xl font-black tabular-nums mt-1" style={{ color: YELLOW }}>
            R$ {formatBRL(venda.total)}
          </div>
          <div className="text-xs font-mono opacity-60 mt-1">#{venda.id}</div>
        </div>
        <div className="px-5 py-3 max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ color: NAVY_DARK }}>
                <th className="text-left py-1 font-bold">Item</th>
                <th className="text-center py-1 font-bold w-12">Qtd</th>
                <th className="text-right py-1 font-bold w-20">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {venda.itens.map((it, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1 text-gray-700">{it.nome_produto}</td>
                  <td className="py-1 text-center text-gray-500">{it.qtd}</td>
                  <td className="py-1 text-right font-mono text-gray-700">R$ {formatBRL(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(venda.economia ?? 0) > 0.001 && (
            <div className="flex justify-between text-xs mt-2 font-bold" style={{ color: MONEY }}>
              <span>Você economizou</span>
              <span>R$ {formatBRL(venda.economia!)}</span>
            </div>
          )}
          {venda.desconto > 0 && (
            <div className="flex justify-between text-xs mt-2 text-red-600 font-bold">
              <span>Desconto</span>
              <span>- R$ {formatBRL(venda.desconto)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm mt-2 font-black" style={{ color: NAVY_DARK }}>
            <span>Total</span>
            <span>R$ {formatBRL(venda.total)}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">{venda.forma}</div>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2 border-t">
          <button
            onClick={() => gerarReciboVendaPDF({
              id: venda.id,
              shortId: venda.id,
              data: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' }),
              hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Rio_Branco', hour: '2-digit', minute: '2-digit' }),
              filial,
              cliente: venda.cliente,
              cpfNota: venda.cpfNota ?? null,
              economia: venda.economia ?? null,
              operador,
              itens: venda.itens,
              subtotal: venda.subtotal,
              desconto: venda.desconto,
              total: venda.total,
              formaPagamento: venda.forma,
            })}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:brightness-110 transition"
            style={{ background: NAVY_DARK, color: 'white' }}
          >
            <FileDown size={16} /> Baixar Recibo (PDF)
          </button>
          <button
            onClick={() => onContinuar()}
            className="w-full px-4 py-3 rounded-lg text-base font-black uppercase tracking-wider hover:brightness-110 transition"
            style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
            autoFocus
          >
            Continuar · Enter
          </button>
        </div>
      </div>
    </div>
  );
}
