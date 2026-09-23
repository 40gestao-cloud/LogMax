import type { KeyboardEvent, RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { formatBRL } from '../../lib/viewUtils';
import { fmtQtdArmada as fmtQtd } from '../../lib/pdv/quantidade';
import { YELLOW, YELLOW_DARK, NAVY_DARK, MONEY, RED } from './coresMaxPos';

// Linha CÓDIGO do PDV SuperMax: o campo de leitura (bipe, código ou nome), a
// quantidade armada, as sugestões enquanto digita e os botões SUSPENDER /
// RECUPERAR / CANCELAR VENDA / FECHAR VENDA. O teclado do campo é da view
// (`onKeyDown`) — é ele que conversa com o leitor, o carrinho e a gancheira.
export function LinhaCodigo({
  erro, qtdArmada, inputRef, code, onDigitar, onKeyDown, suggestions, suggestionIdx, onSugestaoIdx, onEscolherSugestao,
  temItens, vendaSuspensa, onSuspender, onRecuperar, onCancelarVenda, onFecharVenda, processando,
}: {
  erro: string | null;
  qtdArmada: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  code: string;
  onDigitar: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  suggestions: any[];
  suggestionIdx: number;
  onSugestaoIdx: (i: number) => void;
  onEscolherSugestao: (produto: any) => void;
  temItens: boolean;
  vendaSuspensa: { itens: number; suspensaEm: string | number | Date } | null;
  onSuspender: () => void;
  onRecuperar: () => void;
  onCancelarVenda: () => void;
  onFecharVenda: () => void;
  processando: boolean;
}) {
  return (
    <div className="px-6 py-2 shrink-0 border-t border-gray-300 bg-white">
      {erro && (
        <div className="mb-1.5 px-3 py-1 text-sm font-bold inline-block border" style={{ background: '#fee2e2', color: RED, borderColor: '#fca5a5' }}>
          {erro}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-gray-700 shrink-0">CÓDIGO:</span>
        {qtdArmada !== null && (
          // A quantidade armada TEM de estar visível: é estado invisível que
          // muda o resultado do próximo bipe. Sai da tela sozinha assim que
          // um item a consome, e Esc desarma.
          <span
            className="shrink-0 px-3 py-1 text-xl font-black tabular-nums border-2"
            style={{ background: YELLOW, color: NAVY_DARK, borderColor: YELLOW_DARK }}
            title="Quantidade armada — vale para o próximo item (Esc desarma)"
          >
            {fmtQtd(qtdArmada)} ×
          </span>
        )}
        <div className="relative">
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => onDigitar(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // refoca se o foco caiu no body (clique fora sem alvo)
              setTimeout(() => {
                const ae = document.activeElement;
                if (!ae || ae === document.body) inputRef.current?.focus();
              }, 0);
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="EAN / REF ou nome do produto"
            className="w-96 bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-1.5 focus:border-blue-700"
            style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 bottom-full mb-1 bg-white border-2 shadow-2xl z-50 w-[640px] max-w-[90vw]" style={{ borderColor: NAVY_DARK }}>
              <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: NAVY_DARK }}>
                {suggestions.length} {suggestions.length === 1 ? 'sugestão' : 'sugestões'} — ↑↓ navegar · Enter selecionar · Esc limpar
              </div>
              {suggestions.map((p: any, idx: number) => (
                <button
                  key={p.id}
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onEscolherSugestao(p)}
                  onMouseEnter={() => onSugestaoIdx(idx)}
                  ref={(el) => {
                    // Foco DOM segue suggestionIdx pra Tab/Arrow não dessincronizar
                    // o highlight amarelo do que está visualmente selecionado.
                    if (el && idx === suggestionIdx) el.scrollIntoView({ block: 'nearest' });
                  }}
                  className={`w-full grid grid-cols-[150px_1fr_120px] gap-3 text-left px-3 py-2 text-sm border-b border-gray-200 focus:outline-none ${idx === suggestionIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                >
                  <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                  <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                  <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {formatBRL(Number(p.preco ?? 0))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {temItens ? (
          <button
            onClick={() => onSuspender()}
            className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-600"
            style={{ background: YELLOW, color: NAVY_DARK, borderColor: NAVY_DARK }}
            title="Suspender esta venda e liberar o caixa (Ctrl+G)"
          >
            ⌖ SUSPENDER
          </button>
        ) : vendaSuspensa ? (
          <button
            onClick={() => onRecuperar()}
            className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 ring-2 ring-yellow-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-600"
            style={{ background: YELLOW, color: NAVY_DARK, borderColor: NAVY_DARK }}
            title={`Recuperar venda suspensa (${vendaSuspensa.itens} itens · suspensa às ${new Date(vendaSuspensa.suspensaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}
          >
            ⟲ RECUPERAR ({vendaSuspensa.itens})
          </button>
        ) : null}
        <button
          onClick={() => onCancelarVenda()}
          disabled={!temItens}
          className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-700"
          style={{ background: RED }}
          title="Cancelar venda (F9)"
        >
          CANCELAR VENDA
        </button>
        <button
          data-action="fechar-venda-pdv"
          onClick={() => onFecharVenda()}
          disabled={!temItens || processando}
          className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
          style={{ background: MONEY }}
          title="Subtotal / Pagamentos (F4 ou F5 · Enter no campo vazio)"
        >
          {processando ? <Loader2 size={20} className="animate-spin inline" /> : 'FECHAR VENDA'}
        </button>
      </div>
    </div>
  );
}
