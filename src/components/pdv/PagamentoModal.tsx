import type { MutableRefObject, RefObject } from 'react';
import { Banknote, CreditCard, DollarSign, Loader2, Pencil, Trash2, Users as UsersIcon, Wallet, X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL, parseBRL } from '../../lib/viewUtils';
import { mistoAtivo, type LinhaPagamento } from '../../lib/pdv/pagamento';
import { mascararDocumento } from '../../lib/pdv/documento';
import { YELLOW, YELLOW_DARK, NAVY_DARK, MONEY, RED } from './coresMaxPos';

export type FormaPagamentoSupermax = 'Dinheiro' | 'Cartão Débito' | 'Cartão Crédito' | 'Fiado' | 'PIX' | 'Vale-Alimentação';

// A grade de formas, na ordem e com os atalhos do MaxPOS. As setas andam por ela.
const FORMAS = [
  ['Dinheiro',       DollarSign,  'F1', 'DINHEIRO'],
  ['Cartão Crédito', CreditCard,  'F2', 'CRÉDITO'],
  ['Cartão Débito',  Banknote,    'F2', 'DÉBITO'],
  ['PIX',            Wallet,      'F3', 'PIX'],
  ['Vale-Alimentação', Wallet,    'F3', 'VALE'],
  ['Fiado',          UsersIcon,   'F3', 'FIADO'],
] as const;

// Pagamento do PDV SuperMax: valor desta forma (misto), pagamentos lançados,
// grade de formas, extras (desconto, CPF, cliente) e VOLTAR/CANCELAR/FECHAR.
// Todo o estado é da view — a lista de pagamentos, a edição de linha, a forma
// marcada e os refs de foco. Aqui é a tela e o teclado dela.
export function PagamentoModal(p: {
  totalFinal: number;
  subtotal: number;
  descontoAplicado: number;
  restante: number;
  pagamentos: LinhaPagamento[];
  parcialValor: string;
  onParcial: (v: string) => void;
  parcialInputRef: RefObject<HTMLInputElement | null>;
  erro: string | null;
  processando: boolean;
  payChoiceIdx: number;
  setPayChoiceIdx: (i: number) => void;
  payBtnRefs: MutableRefObject<(HTMLButtonElement | null)[]>;
  editPagIdx: number | null;
  editPagValor: string;
  onEditPagValor: (v: string) => void;
  onIniciarEdicao: (idx: number) => void;
  onConfirmarEdicao: () => void;
  onCancelarEdicao: () => void;
  onRemoverPagamento: (idx: number) => void;
  onLimparPagamentos: () => void;
  onEscolherForma: (forma: FormaPagamentoSupermax) => void;
  onAbrirCartao: () => void;
  onAbrirOutras: () => void;
  cpfNota: string;
  clienteVinculado: { nome: string } | null;
  onDesconto: () => void;
  onCpf: () => void;
  onVincularCliente: () => void;
  onDesvincularCliente: () => void;
  onVoltar: () => void;
  onCancelarVenda: () => void;
  onFecharVenda: () => void;
  onFechar: () => void;
}) {
  const {
    totalFinal, subtotal, descontoAplicado, restante, pagamentos, parcialValor, onParcial, parcialInputRef,
    erro, processando, payChoiceIdx, setPayChoiceIdx, payBtnRefs, editPagIdx, editPagValor, onEditPagValor,
    onIniciarEdicao, onConfirmarEdicao, onCancelarEdicao, onRemoverPagamento, onLimparPagamentos,
    onEscolherForma, onAbrirCartao, onAbrirOutras, cpfNota, clienteVinculado, onDesconto, onCpf,
    onVincularCliente, onDesvincularCliente, onVoltar, onCancelarVenda, onFecharVenda, onFechar,
  } = p;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          // Em misto com pagamentos lançados, Esc não fecha direto — limpa
          // os pagamentos primeiro. Operador aperta Esc de novo pra sair.
          if (pagamentos.length > 0) {
            onLimparPagamentos();
            return;
          }
          onFechar();
          return;
        }
        // Misto pronto + Enter = finaliza. Se foco está num input ou botão,
        // deixa o evento nativo cuidar.
        if (e.key === 'Enter' && pagamentos.length > 0 && restante <= 0.001 && !processando) {
          const tgt = e.target as HTMLElement | null;
          const isEditable = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
          if (!isEditable && tgt?.tagName !== 'BUTTON') {
            e.preventDefault(); e.stopPropagation();
            onFecharVenda();
            return;
          }
        }
        // Com o foco no campo de valor, seta e digito pertencem ao campo. Sem
        // isto, ←/→ (mover o cursor) pulavam pro botao de forma no meio da
        // digitacao.
        const tgtEl = e.target as HTMLElement | null;
        const emInput = !!tgtEl && (tgtEl.tagName === 'INPUT' || tgtEl.tagName === 'TEXTAREA');
        if (emInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
        // Digito com o foco num botao volta pro campo de valor — mesma ideia
        // do digito solto na leitura: dentro do pagamento, numero e valor.
        if (
          !emInput && !e.ctrlKey && !e.altKey && !e.metaKey &&
          e.key.length === 1 && e.key >= '0' && e.key <= '9'
        ) {
          e.preventDefault(); e.stopPropagation();
          const centavos = Math.round(parseBRL(parcialValor) * 100);
          onParcial(formatBRL(`${centavos > 0 ? centavos : ''}${e.key}`));
          parcialInputRef.current?.focus();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          const next = (payChoiceIdx + 1) % FORMAS.length;
          setPayChoiceIdx(next);
          payBtnRefs.current[next]?.focus();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          const next = (payChoiceIdx - 1 + FORMAS.length) % FORMAS.length;
          setPayChoiceIdx(next);
          payBtnRefs.current[next]?.focus();
          return;
        }
        // F1/F2 funcionam mesmo em misto (Dinheiro/Cartão aceitam parcial).
        // F3 (PIX) só fora do misto — PIX é forma única.
        const mistoActive = pagamentos.length > 0 || parseBRL(parcialValor) > 0;
        if (e.key === 'F1' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onEscolherForma('Dinheiro'); return; }
        if (e.key === 'F2' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onAbrirCartao(); return; }
        if (e.key === 'F3' && !e.shiftKey && !mistoActive) { e.preventDefault(); e.stopPropagation(); onAbrirOutras(); return; }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-2xl w-full shadow-2xl my-4" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Total a pagar</div>
            <div className="text-3xl font-black tabular-nums">R$ {formatBRL(totalFinal)}</div>
          </div>
          {pagamentos.length > 0 && (
            <div className="text-right">
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Restante</div>
              <div className="text-3xl font-black tabular-nums" style={{ color: restante <= 0.001 ? '#22c55e' : YELLOW }}>R$ {formatBRL(restante)}</div>
            </div>
          )}
          <button onClick={() => onFechar()} className="text-white p-1 shrink-0" tabIndex={-1} title="Voltar para a leitura (Esc)"><X size={20} /></button>
        </div>

        {erro && (
          <div className="mx-6 mt-4 px-3 py-2 border-2 text-sm font-bold" style={{ background: '#fee2e2', borderColor: RED, color: RED }}>
            Erro ao fechar venda: {erro}
          </div>
        )}

        {/* Misto: input parcial + lista de pagamentos lançados */}
        <div className="px-6 pt-4">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
            VALOR DESTA FORMA <span className="text-gray-400 normal-case font-medium">(vazio = restante · PIX e Fiado só como forma única)</span>
          </label>
          <input
            ref={parcialInputRef}
            type="text"
            inputMode="numeric"
            value={parcialValor}
            onChange={(e) => onParcial(formatBRL(parseBRL(e.target.value)))}
            onKeyDown={(e) => {
              // Esc limpa só o input — NÃO deve fechar modal nem limpar
              // pagamentos. Sem stopPropagation, o handler do payment modal
              // pega e bagunça tudo.
              if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                onParcial('');
              }
              if (/^F\d+$/.test(e.key)) e.stopPropagation();
            }}
            placeholder={`Restante: ${formatBRL(restante)}`}
            className="w-full bg-white border-2 text-xl font-bold text-gray-900 tabular-nums px-3 py-1.5 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-500/30"
            style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
          />
          {/* Valor acima do restante entra cortado no restante — dizer isso ANTES
              do clique evita a conta que nao fecha na cabeca do operador. */}
          {parcialValor && parseBRL(parcialValor) > restante + 0.001 && restante > 0 && (
            <p className="mt-1 text-[11px] font-bold" style={{ color: '#a16207' }}>
              Valor maior que o restante (R$ {formatBRL(restante)}) — sera lancado so R$ {formatBRL(restante)}.
            </p>
          )}
          {pagamentos.length > 0 && (
            <div className="mt-3 border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
              <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: NAVY_DARK }}>
                <span className="text-[11px] font-black uppercase tracking-wider text-white">Pagamentos Lançados</span>
                <span
                  className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full"
                  style={{ background: YELLOW, color: NAVY_DARK }}
                >
                  {pagamentos.length} {pagamentos.length === 1 ? 'forma' : 'formas'}
                </span>
              </div>
              <div className="p-2 space-y-1.5 bg-white max-h-40 overflow-y-auto">
                {pagamentos.map((p, idx) => {
                  const editando = editPagIdx === idx;
                  const temTroco = !!p.troco && p.troco > 0.001;
                  return (
                    <div key={idx} className="flex items-center justify-between bg-gray-50 border border-gray-300 px-2.5 py-1.5 gap-2 rounded">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wide truncate">
                          {p.forma}
                          {p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x (R$ ${formatBRL(p.valor / p.parcelas)}/parc.)` : ''}
                          {temTroco ? ` · troco R$ ${formatBRL(p.troco!)}` : ''}
                        </div>
                        {editando ? (
                          <input
                            autoFocus
                            value={editPagValor}
                            onChange={(e) => onEditPagValor(formatBRL(parseBRL(e.target.value)))}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') { e.preventDefault(); onConfirmarEdicao(); }
                              else if (e.key === 'Escape') { e.preventDefault(); onCancelarEdicao(); }
                            }}
                            // Blur CANCELA a edicao (previsivel): confirma no Enter ou no lapis.
                            onBlur={() => onCancelarEdicao()}
                            className="w-full mt-0.5 bg-white border-2 text-sm font-bold tabular-nums px-1.5 py-0.5 outline-none focus:border-blue-700"
                            style={{ borderColor: '#9ca3af', color: NAVY_DARK, fontFamily: 'Consolas, "Courier New", monospace' }}
                          />
                        ) : (
                          <span className="text-base font-bold tabular-nums" style={{ color: MONEY }}>R$ {formatBRL(p.valor)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          tabIndex={-1}
                          disabled={temTroco && !editando}
                          // mousedown com preventDefault evita o blur do input (que
                          // cancela) antes do click — assim o lapis confirma o valor.
                          onMouseDown={editando ? (e) => e.preventDefault() : undefined}
                          onClick={() => editando ? onConfirmarEdicao() : onIniciarEdicao(idx)}
                          className="w-6 h-6 flex items-center justify-center text-white rounded hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ background: NAVY_DARK }}
                          title={temTroco
                            ? 'Pagamento com troco — remova e lance de novo para mudar o valor'
                            : editando ? 'Confirmar valor (Enter)' : 'Editar valor'}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          tabIndex={-1}
                          onClick={() => onRemoverPagamento(idx)}
                          className="w-6 h-6 flex items-center justify-center text-white rounded hover:brightness-110"
                          style={{ background: RED }}
                          title="Remover este pagamento"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Formas de pagamento — mesmo desenho do MaxPOS: titulo com a regua
            de teclas, 3 colunas, cartao branco de borda cinza que vira azul
            no foco. O amarelo saiu: quem manda no realce e o foco real. */}
        <div className="px-6 pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
            FORMA DE PAGAMENTO <span className="text-gray-400 normal-case font-medium">(Tab/← → navegar · Enter selecionar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado)</span>
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {FORMAS.map(([forma, Icon, hint, label], i) => {
              const active = i === payChoiceIdx;
              // PIX e Fiado só funcionam como forma única (sem parcial),
              // por causa de realtime / RPC que cria conta_receber pelo
              // valor cheio. Dinheiro e Cartão D/C aceitam misto.
              const parcial = parseBRL(parcialValor);
              const isMistoActive = mistoAtivo(pagamentos.length, parcial, restante);
              const isPixOrFiado = forma === 'PIX' || forma === 'Fiado' || forma === 'Vale-Alimentação';
              const isDisabled = restante <= 0.001 || (isMistoActive && isPixOrFiado);
              return (
                <button
                  key={forma}
                  ref={(el) => { payBtnRefs.current[i] = el; }}
                  data-pay-method={forma}
                  disabled={isDisabled}
                  onClick={() => onEscolherForma(forma)}
                  onFocus={() => setPayChoiceIdx(i)}
                  onMouseEnter={() => setPayChoiceIdx(i)}
                  title={isDisabled && isMistoActive && isPixOrFiado
                    ? `${forma} só funciona como forma única — limpe os pagamentos lançados pra usar`
                    : undefined}
                  className={`relative border-2 bg-white rounded py-4 flex flex-col items-center gap-1.5 transition disabled:opacity-30 focus:outline-none hover:border-blue-700 hover:text-blue-700 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${active && !isDisabled ? 'border-blue-700 text-blue-700' : 'text-gray-900'}`}
                  style={{ borderColor: active && !isDisabled ? '#1d4ed8' : '#9ca3af' }}
                >
                  {hint && (
                    <span className="absolute top-1 right-1.5 text-[9px] font-black text-gray-400 tracking-wider">{hint}</span>
                  )}
                  <Icon size={26} />
                  <span className="text-[11px] font-bold tracking-wide">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Extras do fechamento — desconto, documento na nota e cliente
            vinculado, os mesmos três do MaxPOS e na mesma posição. */}
        <div className="px-6 pt-4 grid grid-cols-2 gap-2">
          <button
            data-extra-action="desconto"
            tabIndex={-1}
            onClick={() => onDesconto()}
            disabled={subtotal <= 0 || pagamentos.length > 0}
            className="py-2 text-[11px] font-black uppercase tracking-wider border-2 disabled:opacity-30 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
            style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
            title={pagamentos.length > 0
              ? 'Com pagamento lançado o total não muda mais — remova os pagamentos para dar desconto'
              : 'Desconto no total (F6)'}
          >
            {descontoAplicado > 0 ? `− R$ ${formatBRL(descontoAplicado)} · F6 DESCONTO` : 'F6 DESCONTO'}
          </button>
          <button
            data-extra-action="cpf"
            tabIndex={-1}
            onClick={() => onCpf()}
            className="py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
            style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
            title="CPF / CNPJ na nota"
          >
            {cpfNota ? `CPF: ${mascararDocumento(cpfNota)}` : '+ CPF NA NOTA'}
          </button>
          <button
            data-extra-action="cliente"
            tabIndex={-1}
            onClick={() => onVincularCliente()}
            className="col-span-2 py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
            style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
            title="Vincular cliente à venda"
          >
            <UsersIcon size={12} />
            {clienteVinculado ? `CLIENTE: ${clienteVinculado.nome.toUpperCase()}` : '+ VINCULAR CLIENTE'}
            {clienteVinculado && (
              <span
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onDesvincularCliente(); }}
                className="ml-1 text-xs px-1 border rounded hover:bg-red-100"
                style={{ borderColor: RED, color: RED }}
              >×</span>
            )}
          </button>
        </div>

        {/* VOLTAR / CANCELAR / FECHAR VENDA — os tres sempre na tela, como no
            MaxPOS. Antes so aparecia o FECHAR VENDA, e depois do primeiro
            pagamento: sair do modal so pelo X ou pelo Esc. */}
        <div className="px-6 pt-4 pb-2 flex gap-2">
          <button
            tabIndex={-1}
            onClick={() => onVoltar()}
            className="px-4 py-3 border-2 text-gray-700 text-sm font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
            style={{ borderColor: '#9ca3af' }}
            title={pagamentos.length > 0
              ? 'Voltar para a leitura — descarta os pagamentos lançados (Esc)'
              : 'Voltar para a leitura (Esc)'}
          >
            VOLTAR
          </button>
          <button
            tabIndex={-1}
            onClick={() => onCancelarVenda()}
            className="px-4 py-3 text-white text-sm font-bold hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-400"
            style={{ background: RED }}
            title="Cancelar venda (F9)"
          >
            CANCELAR
          </button>
          <button
            data-action="confirmar-venda"
            onClick={() => onFecharVenda()}
            disabled={pagamentos.length === 0 || restante > 0.001 || processando}
            className="flex-1 px-5 py-3 text-white font-black uppercase tracking-wide text-base disabled:opacity-30 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
            style={{ background: MONEY }}
            title="Confirma a venda quando o restante chega a R$ 0,00"
          >
            {processando
              ? <><Loader2 size={20} className="animate-spin" /> SALVANDO...</>
              : restante > 0.001
                ? `FALTAM R$ ${formatBRL(restante)}`
                : 'FECHAR VENDA (Enter)'}
          </button>
        </div>

        <div className="px-6 pb-4 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
          ↑↓←→ navegar · Enter confirmar · Esc voltar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado · F6 Desconto · F9 Cancelar
        </div>
      </div>
    </div>
  );
}
