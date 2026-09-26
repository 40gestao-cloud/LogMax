import { YELLOW, NAVY_DARK } from './coresMaxPos';

const ATALHOS: [string, string][] = [
  ['F4', 'Subtotal'],
  ['F5', 'Pagamentos'],
  ['F6', 'Desconto'],
  ['F7', 'Consulta preço'],
  ['F8', 'Buscar produto'],
  ['Del', 'Cancelar último'],
  ['F3/F9', 'Cancelar cupom'],
  ['Ctrl+G', 'Suspender'],
  ['F10', 'Sangria'],
  ['F11', 'Suprimento'],
  ['F12', 'Fechar caixa'],
  ['2*', 'Quantidade'],
  ['0,350*', 'Peso'],
  ['Esc', 'Sair tela cheia'],
];

// Rodapé do PDV SuperMax com a régua de atalhos — o que o operador
// consulta sem abrir o manual.
export function RodapeAtalhos() {
  return (
    <div className="px-6 py-2 shrink-0 border-t-2" style={{ background: NAVY_DARK, borderColor: YELLOW }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/85 tracking-wide">
        <span className="px-2 py-0.5 rounded font-bold" style={{ background: YELLOW, color: NAVY_DARK }}>
          Enter = Subtotal
        </span>
        {ATALHOS.map(([tecla, acao]) => (
          <span key={tecla} className="flex items-center gap-1.5 whitespace-nowrap">
            <b style={{ color: YELLOW }}>{tecla}</b>
            {acao}
          </span>
        ))}
      </div>
    </div>
  );
}
