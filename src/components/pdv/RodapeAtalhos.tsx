import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Rodapé amarelo do PDV SuperMax com a régua de atalhos — o que o operador
// consulta sem abrir o manual.
export function RodapeAtalhos() {
  return (
    <div className="px-6 py-2 shrink-0 border-t-2" style={{ background: YELLOW, borderColor: YELLOW_DARK }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-black tracking-wide">
        <span className="px-2 py-0.5 rounded text-white font-bold" style={{ background: NAVY_DARK }}>
          Enter (campo vazio) = SUBTOTAL
        </span>
        <span className="opacity-40">·</span>
        <span><b>F4</b> Subtotal · <b>F5</b> Pagamentos</span>
        <span className="opacity-40">·</span>
        <span><b>F8</b> Buscar produto</span>
        <span className="opacity-40">·</span>
        <span><b>Del</b> Cancelar último item</span>
        <span className="opacity-40">·</span>
        <span><b>F3</b> / <b>F9</b> Cancelar cupom · <b>Esc</b> Sair tela cheia</span>
        <span className="opacity-40">·</span>
        <span><b>2*</b> Qtd — sozinho arma p/ o próximo item, ou <b>2*código</b> / <b>2*nome</b> (peso: <b>0,350*</b>)</span>
        <span className="opacity-40">·</span>
        <span><b>F6</b> Desconto (gerente) · <b>Ctrl+G</b> Suspender/recuperar</span>
        <span className="opacity-40">·</span>
        <span><b>F7</b> Consulta preço</span>
        <span className="opacity-40">·</span>
        <span><b>F10</b> Sangria · <b>F11</b> Suprimento</span>
        <span className="opacity-40">·</span>
        <span><b>F12</b> Fechar/Suspender caixa</span>
      </div>
    </div>
  );
}
