import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { NAVY_DARK } from './coresMaxPos';

// Seletor de cliente do PDV SuperMax: para o Fiado e para vincular um cliente
// à venda. A busca fica na view — o Fiado reabre com o que já estava digitado.
export function ClientePickerModal({ titulo, clientes, busca, onBusca, onEscolher, onClose }: {
  titulo: string;
  clientes: { id: string; nome: string }[];
  busca: string;
  onBusca: (v: string) => void;
  onEscolher: (c: { id: string; nome: string }) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(-1);
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (clientes ?? []).filter((c: any) =>
      !t || (c.nome ?? '').toLowerCase().includes(t)
    ).slice(0, 30);
  }, [clientes, busca]);

  // Seleção volta ao primeiro quando abre ou quando a lista muda.
  useEffect(() => {
    setIdx(filtrados.length > 0 ? 0 : -1);
  }, [filtrados.length]);

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
          <span className="font-black tracking-wide text-sm uppercase">
            {titulo}
          </span>
          <button onClick={() => onClose()} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            type="text"
            value={busca}
            onChange={(e) => { onBusca(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx(i => Math.min(i + 1, filtrados.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const pick = filtrados[idx >= 0 ? idx : 0];
                if (pick) onEscolher(pick);
                return;
              }
            }}
            placeholder="Buscar cliente por nome..."
            className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
            style={{ borderColor: '#9ca3af' }}
          />
          <div className="max-h-96 overflow-y-auto space-y-1">
            {filtrados.length === 0 ? (
              <div className="text-center text-gray-500 py-4 text-sm">Nenhum cliente encontrado.</div>
            ) : filtrados.map((c: any, i: number) => {
              const active = i === idx;
              return (
                <button
                  key={c.id}
                  onClick={() => onEscolher(c)}
                  onMouseEnter={() => setIdx(i)}
                  tabIndex={-1}
                  ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                  className={`w-full text-left px-3 py-2 border-2 font-bold ${active ? 'bg-yellow-100' : 'hover:bg-yellow-50'}`}
                  style={{ borderColor: active ? NAVY_DARK : '#e5e7eb' }}
                >
                  {c.nome}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
            ↑↓ navegar · Enter selecionar · Esc voltar
          </div>
        </div>
      </div>
    </div>
  );
}
