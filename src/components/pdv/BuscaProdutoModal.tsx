import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL } from '../../lib/viewUtils';
import { fmtQtdArmada as fmtQtd } from '../../lib/pdv/quantidade';
import { YELLOW, NAVY_DARK, MONEY } from './coresMaxPos';

// Busca de produto (F8) do PDV SuperMax. O termo fica na view porque ela abre
// o F8 já preenchido (nome que casa com vários produtos) e porque a quantidade
// colada ao termo ("2*feijao") é dela. `qtd` é só para mostrar.
export function BuscaProdutoModal({ termo, onTermo, produtos, qtd, onEscolher, onClose }: {
  termo: string;
  onTermo: (v: string) => void;
  produtos: any[];
  qtd: number;
  onEscolher: (produto: any) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  // Seleção volta ao primeiro quando abre ou quando a lista muda.
  useEffect(() => {
    setIdx(produtos.length > 0 ? 0 : -1);
  }, [produtos.length]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="w-full max-w-4xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
          <span className="font-black tracking-wide text-sm uppercase flex items-center gap-2">
            <Search size={16} /> F8 · Busca de produtos
            {qtd !== 1 && (
              <span className="ml-2 px-2 py-0.5 text-xs font-black" style={{ background: YELLOW, color: NAVY_DARK }}>
                QTD {fmtQtd(qtd)} ×
              </span>
            )}
          </span>
          <button onClick={() => onClose()} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
        </div>
        <div className="p-4">
          <input
            autoFocus
            value={termo}
            onChange={(e) => { onTermo(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx(i => Math.min(i + 1, produtos.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const pick = produtos[idx >= 0 ? idx : 0];
                if (pick) onEscolher(pick);
                return;
              }
            }}
            placeholder="Nome, código ou EAN do produto..."
            className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
            style={{ borderColor: '#9ca3af' }}
          />
          <div className="mt-3 max-h-[55vh] overflow-y-auto border border-gray-300">
            {produtos.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
            ) : produtos.map((p: any, i: number) => {
              const active = i === idx;
              return (
                <button
                  key={p.id}
                  onClick={() => onEscolher(p)}
                  onMouseEnter={() => setIdx(i)}
                  tabIndex={-1}
                  ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                  className={`w-full grid grid-cols-[150px_1fr_120px] gap-3 text-left py-2 px-3 text-sm border-b border-gray-200 ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                >
                  <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                  <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                  <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {formatBRL(Number(p.preco ?? 0))}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            ↑↓ navegar · Enter adicionar {qtd !== 1 && (
              <span style={{ color: NAVY_DARK }}>({fmtQtd(qtd)} un)</span>
            )} · Esc voltar
          </div>
          <div className="mt-1 text-[11px] text-gray-400 text-center">
            Para vários do mesmo item, digite <b>2*</b> antes do nome (ex.: <b>2*feijao</b>).
          </div>
        </div>
      </div>
    </div>
  );
}
