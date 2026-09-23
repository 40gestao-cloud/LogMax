import { X } from 'lucide-react';
import { formatBRL } from '../../lib/viewUtils';
import { fmtQtdArmada as fmtQtd } from '../../lib/pdv/quantidade';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

export interface ItemCupom {
  produto_id: string;
  nome_produto: string;
  ean?: string;
  codigo?: string;
  preco_unitario: number;
  qtd: number;
  subtotal: number;
  estoque: number;
  unidade: string;
}

// O cupom em andamento do PDV SuperMax: a tabela de itens (com Oferta e
// Ruptura por linha) e a barra lateral com o último item lido e os totais.
// Só exibe; remover item é da view.
export function CupomItens({
  cart, selectedCartIdx, ofertaDoItem, onRemover, lastAdded, totalItens, subtotal, descontoAplicado, economiaOfertas,
}: {
  cart: ItemCupom[];
  selectedCartIdx: number;
  ofertaDoItem: (produto_id: string, precoCobrado: number) => { de: number } | null;
  onRemover: (produto_id: string) => void;
  lastAdded: ItemCupom | null;
  totalItens: number;
  subtotal: number;
  descontoAplicado: number;
  economiaOfertas: number;
}) {
  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-300">
        <div
          className="grid grid-cols-[70px_160px_1fr_80px_90px_130px_150px_40px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
          style={{ background: NAVY_DARK }}
        >
          <div>ITEM</div>
          <div>CÓDIGO</div>
          <div>DESCRIÇÃO</div>
          <div className="text-right">QTD</div>
          <div className="text-right">ESTOQUE</div>
          <div className="text-right">UNIT R$</div>
          <div className="text-right">TOTAL R$</div>
          <div></div>
        </div>
        <div className="flex-1 overflow-y-auto bg-white">
          {cart.length === 0 ? (
            <div className="text-center text-gray-400 py-16 text-sm italic">
              Bipe ou digite o código do produto para iniciar.
            </div>
          ) : cart.map((item, idx) => {
            const ruptura = item.qtd > item.estoque;
            return (
            <div
              key={item.produto_id}
              className={`grid grid-cols-[70px_160px_1fr_80px_90px_130px_150px_40px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b ${
                idx === selectedCartIdx
                  ? 'bg-yellow-200 border-yellow-500 ring-2 ring-yellow-500'
                  : idx === cart.length - 1 && selectedCartIdx < 0
                    ? 'bg-yellow-50 border-gray-200'
                    : 'border-gray-200'
              }`}
            >
              <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
              <div className="text-gray-500 truncate">{item.ean || item.codigo || '—'}</div>
              <div className="truncate font-semibold flex items-center gap-2">
                <span className="truncate">{(item.nome_produto || '').toUpperCase()}</span>
                {ofertaDoItem(item.produto_id, item.preco_unitario) && (
                  <span
                    className="shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded border"
                    style={{ background: '#dcfce7', color: '#166534', borderColor: MONEY }}
                    title="Preço promocional aprovado — veio do cadastro, não do caixa"
                  >
                    Oferta
                  </span>
                )}
                {ruptura && (
                  <span
                    className="shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded border"
                    style={{ background: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' }}
                    title={`Estoque: ${item.estoque} · Vendendo: ${item.qtd}`}
                  >
                    Ruptura
                  </span>
                )}
              </div>
              <div className="text-right">{fmtQtd(item.qtd)}</div>
              <div className={`text-right ${ruptura ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{item.estoque}</div>
              <div className="text-right">
                {(() => {
                  const o = ofertaDoItem(item.produto_id, item.preco_unitario);
                  if (!o) return formatBRL(item.preco_unitario);
                  return (
                    <>
                      <span className="block text-xs font-normal text-gray-400 line-through">{formatBRL(o.de)}</span>
                      <span style={{ color: MONEY }} title={`Em oferta — preço de tabela R$ ${formatBRL(o.de)}`}>{formatBRL(item.preco_unitario)}</span>
                    </>
                  );
                })()}
              </div>
              <div className="text-right font-bold">{formatBRL(item.subtotal)}</div>
              <button
                onClick={() => onRemover(item.produto_id)}
                tabIndex={-1}
                className="w-7 h-7 flex items-center justify-center text-white rounded hover:brightness-110 self-center justify-self-end"
                style={{ background: RED }}
                title="Cancelar este item"
              >
                <X size={14} />
              </button>
            </div>
            );
          })}
        </div>
      </div>

      {/* Sidebar 420px */}
      <div className="w-[420px] shrink-0 flex flex-col bg-gray-50">
        <div className="px-5 py-5 border-b border-gray-300">
          <div className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">ÚLTIMO ITEM LIDO</div>
          {lastAdded ? (
            <>
              <div className="text-2xl font-bold leading-tight mb-2 text-gray-900 break-words">
                {(lastAdded.nome_produto || '').toUpperCase()}
              </div>
              <div className="text-xs text-gray-500 mb-4">
                CÓDIGO: {lastAdded.codigo || '—'} · EAN: {lastAdded.ean || '—'}
              </div>
              <div className="text-base text-gray-600 tabular-nums">
                {lastAdded.qtd} {(lastAdded.unidade || '').toLowerCase()} × R$ {formatBRL(lastAdded.preco_unitario)}
              </div>
              {(() => {
                const o = ofertaDoItem(lastAdded.produto_id, lastAdded.preco_unitario);
                if (!o) return null;
                return (
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <span
                      className="px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider rounded border"
                      style={{ background: '#dcfce7', color: '#166534', borderColor: MONEY }}
                    >
                      Oferta
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      de <span className="line-through">R$ {formatBRL(o.de)}</span> por R$ {formatBRL(lastAdded.preco_unitario)}
                    </span>
                  </div>
                );
              })()}
              <div className="text-6xl font-bold tabular-nums mt-1" style={{ color: MONEY }}>
                R$ {formatBRL(lastAdded.subtotal)}
              </div>
            </>
          ) : (
            <div className="h-32" />
          )}
        </div>
        <div className="px-5 py-5 flex-1 space-y-4 text-lg">
          <div className="flex justify-between items-baseline">
            <span className="text-gray-600">QTD. ITENS</span>
            <span className="tabular-nums font-bold text-gray-900 text-2xl">{totalItens}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-gray-600">SUBTOTAL</span>
            <span className="tabular-nums font-bold text-gray-900 text-2xl">R$ {formatBRL(subtotal)}</span>
          </div>
          {descontoAplicado > 0 && (
            <div className="flex justify-between items-baseline">
              <span className="text-gray-600">DESCONTO</span>
              <span className="tabular-nums font-bold text-2xl" style={{ color: RED }}>− R$ {formatBRL(descontoAplicado)}</span>
            </div>
          )}
          {economiaOfertas > 0.001 && (
            <div className="flex justify-between items-baseline border-t pt-3" style={{ borderColor: '#d1d5db' }}>
              <span className="text-gray-600">VOCÊ ECONOMIZOU</span>
              <span className="tabular-nums font-bold text-2xl" style={{ color: MONEY }}>R$ {formatBRL(economiaOfertas)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
