import type { ReactNode } from 'react';
import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Atalhos em GRUPOS, como no MaxPOS, na ordem da operação: fechar a venda,
// achar o produto, quantidade, mexer no item, cancelar/suspender o cupom e,
// por último, o caixa. Separados por um ponto apagado.
const GRUPOS: ReactNode[] = [
  <><b>F4</b> Subtotal · <b>F5</b> Pagamentos · <b>F6</b> Desconto</>,
  <><b>F7</b> Consulta preço · <b>F8</b> Buscar produto</>,
  <><b>2*</b> Qtd — sozinho arma p/ o próximo item, ou <b>2*EAN</b> / <b>2*nome</b> (peso: <b>0,350*</b>)</>,
  <><b>↑↓</b> Escolher item · <b>Del</b> Cancelar</>,
  <><b>F3</b> / <b>F9</b> / <b>Esc</b> Cancelar cupom · <b>Ctrl+G</b> Suspender</>,
  <><b>F10</b> Sangria · <b>F11</b> Suprimento · <b>F12</b> Fechar caixa</>,
];

// Rodapé do PDV SuperMax com a régua de atalhos — o que o operador
// consulta sem abrir o manual.
export function RodapeAtalhos() {
  return (
    <div className="px-6 py-2 shrink-0 border-t-2" style={{ background: YELLOW, borderColor: YELLOW_DARK }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-black tracking-wide">
        <span
          className="px-2 py-0.5 rounded text-white font-bold"
          style={{ background: NAVY_DARK }}
          title="Padrão supermercado: Enter no campo vazio = Subtotal / Fechar venda"
        >
          Enter (campo vazio) = SUBTOTAL
        </span>
        {GRUPOS.map((grupo, i) => (
          <span key={i} className="contents">
            <span className="opacity-40">·</span>
            <span>{grupo}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
