import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { buscarProdutos } from '../../lib/produtoBusca';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY } from './coresMaxPos';

// Consulta de preço (F7) do PDV SuperMax — só leitura, não adiciona ao
// carrinho. Mesma filtragem da busca F8. O termo e a linha selecionada nascem
// vazios a cada abertura: o modal monta de novo cada vez que o F7 abre.
export function ConsultaPrecoModal({ produtos, onClose }: {
  produtos: any[];
  onClose: () => void;
}) {
  const [termo, setTermo] = useState('');
  const [idx, setIdx] = useState(0);
  const filtrados = useMemo(() => buscarProdutos(produtos, termo, 50), [termo, produtos]);

  useEffect(() => {
    setIdx(filtrados.length > 0 ? 0 : -1);
  }, [filtrados.length]);

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
      <div className="w-full max-w-3xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
          <span className="font-black tracking-wide text-sm uppercase">F7 · Consulta de preço</span>
          <button onClick={() => onClose()} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
        </div>
        <div className="p-4">
          <input
            autoFocus
            value={termo}
            onChange={(e) => { setTermo(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtrados.length - 1)); return; }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
            }}
            placeholder="Nome, código ou EAN do produto..."
            className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
            style={{ borderColor: '#9ca3af' }}
          />
          <div className="mt-3 max-h-[55vh] overflow-y-auto border border-gray-300">
            {filtrados.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
            ) : filtrados.map((p: any, i: number) => {
              const active = i === idx;
              return (
                <div
                  key={p.id}
                  onMouseEnter={() => setIdx(i)}
                  ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                  className={`grid grid-cols-[150px_1fr_120px_120px] gap-3 py-2 px-3 text-sm border-b border-gray-200 ${active ? 'bg-yellow-100' : ''}`}
                >
                  <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                  <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                  <span className="text-right tabular-nums text-gray-600">Est: {Number(p.estoque ?? 0)}</span>
                  <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {formatBRL(Number(p.preco ?? 0))}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            ↑↓ navegar · Esc fechar · Consulta não adiciona ao carrinho
          </div>
        </div>
      </div>
    </div>
  );
}
