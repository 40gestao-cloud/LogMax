import { useState } from 'react';
import { Loader2, Receipt, X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY } from './coresMaxPos';

export interface VendaReimpressao {
  id: string;
  created_at: string;
  total_final: number;
  forma_pagamento: string;
}

// Reimpressão (Ctrl+R) do PDV SuperMax: as últimas vendas concluídas da filial
// nesta sessão. Quem busca a lista e remonta o recibo é a view; aqui é só a
// escolha, por teclado (↑↓ Enter Esc) ou clique.
export function ReimpressaoModal({ lista, carregando, onEscolher, onClose }: {
  lista: VendaReimpressao[];
  carregando: boolean;
  onEscolher: (vendaId: string) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          onClose();
          return;
        }
        if (carregando || lista.length === 0) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => Math.min(i + 1, lista.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setIdx(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const v = lista[idx];
          if (v) onEscolher(v.id);
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-2xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK, fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
          <div className="flex items-center gap-2">
            <Receipt size={20} />
            <div>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Ctrl+R · Reimpressão</div>
              <div className="text-lg font-black tracking-wide">Últimas vendas desta sessão</div>
            </div>
          </div>
          <button
            onClick={() => onClose()}
            className="text-white p-1" tabIndex={-1}
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {carregando ? (
            <div className="text-center py-10 text-gray-500 flex flex-col items-center gap-2">
              <Loader2 className="animate-spin" size={28} />
              <span className="text-sm font-bold uppercase tracking-wider">Carregando vendas…</span>
            </div>
          ) : lista.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              Nenhuma venda concluída nesta sessão do PDV.
            </div>
          ) : (
            <div className="border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
              <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white grid grid-cols-[110px_1fr_120px_100px] gap-2" style={{ background: NAVY_DARK }}>
                <span>ID</span>
                <span>Forma de pagamento</span>
                <span className="text-right">Total</span>
                <span className="text-right">Hora</span>
              </div>
              {lista.map((v, i) => {
                const hh = new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <button
                    key={v.id}
                    type="button"
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => onEscolher(v.id)}
                    className={`w-full grid grid-cols-[110px_1fr_120px_100px] gap-2 px-3 py-2 text-sm tabular-nums text-left border-b border-gray-200 last:border-b-0 ${i === idx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                  >
                    <span className="font-mono text-gray-600 truncate">#{String(v.id).slice(-6).toUpperCase()}</span>
                    <span className="truncate font-bold text-gray-900">{v.forma_pagamento || '—'}</span>
                    <span className="text-right font-black" style={{ color: MONEY }}>R$ {formatBRL(Number(v.total_final ?? 0))}</span>
                    <span className="text-right text-gray-500">{hh}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center pt-3">
            ↑↓ navegar · Enter reimprimir · Esc voltar
          </div>
        </div>
      </div>
    </div>
  );
}
