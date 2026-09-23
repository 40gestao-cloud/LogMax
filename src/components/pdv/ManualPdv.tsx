import React from 'react';
import { HelpCircle, X } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Manual do PDV SuperMax (Shift+F1 ou ?) — passo a passo + tabela de atalhos.
// Só leitura. Esc fecha; o Tab fica preso dentro do modal.
export function ManualPdv({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 flex items-center justify-between shrink-0 border-b-2" style={{ background: YELLOW, borderColor: YELLOW_DARK }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: NAVY_DARK, color: YELLOW }}>
              <HelpCircle size={22} />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK }}>Manual</div>
              <div className="text-xl font-black tracking-wide" style={{ color: NAVY_DARK }}>PDV SuperMax</div>
            </div>
          </div>
          <button onClick={() => onClose()} className="w-9 h-9 rounded-full flex items-center justify-center border-2 hover:bg-white/40" style={{ borderColor: NAVY_DARK, color: NAVY_DARK }} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm" style={{ color: '#111827' }}>
          {/* Passo a passo */}
          <section>
            <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
              Fluxo da venda
            </h3>
            <ol className="space-y-3 list-decimal list-inside">
              <li>
                <b>Adicionar produtos.</b> Bipe o código de barras OU digite EAN/REF/nome no campo <b>CÓDIGO</b> e aperte <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd>.
                Para <b>vários do mesmo item</b>, informe a quantidade antes — como no caixa de mercado:
                digite <code>2*</code> e <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> para
                <b> armar</b> (aparece <b>2 ×</b> em amarelo ao lado do campo) e então identifique o item de qualquer
                forma: bipe, código, nome ou escolha no <b>F8</b>. Também funciona colado:
                <code>3*7891</code>, <code>2*feijao</code> ou peso <code>0,350*7891</code>.
                Nome que casa com vários produtos abre o <b>F8</b> já filtrado, com a quantidade.
              </li>
              <li>
                <b>Conferir.</b> A última leitura aparece destacada na barra lateral direita.
                Pra remover o último item: <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Del</kbd>.
                Pra remover <b>qualquer item</b>: com o campo CÓDIGO vazio, use <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>↑ ↓</kbd> pra selecionar a linha (fica amarela) e aperte <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Del</kbd>.
              </li>
              <li>
                <b>Subtotal / fechar venda.</b> Com o carrinho montado, aperte <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> no campo CÓDIGO vazio, ou <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F4</kbd>/<kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F5</kbd>, ou clique <b>FECHAR VENDA</b>.
              </li>
              <li>
                <b>Escolher forma de pagamento.</b> Use <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F1</kbd> Dinheiro, <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F2</kbd> Cartão (picker Crédito/Débito) ou <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F3</kbd> PIX/Fiado (picker) — <b>tudo por teclado</b>.
              </li>
              <li>
                <b>Confirmar o valor.</b>
                <ul className="ml-5 mt-1 space-y-1 list-disc">
                  <li><b>Dinheiro:</b> o valor exato já vem preenchido. Pra troco, digite por cima o valor recebido.</li>
                  <li><b>Cartão D/C:</b> entra direto na lista de pagamentos.</li>
                  <li><b>PIX:</b> QR Code aparece — cliente paga pelo MaxBank, sistema confirma sozinho.</li>
                  <li><b>Fiado:</b> escolha o cliente.</li>
                </ul>
              </li>
              <li>
                <b>Pagamento misto.</b> Digite um valor parcial em <b>VALOR DESTA FORMA</b> e escolha Cartão ou Dinheiro. Repita até o restante chegar a R$ 0,00. PIX/Fiado não aceitam misto.
              </li>
              <li>
                <b>Fechar venda.</b> Quando todos pagamentos cobrirem o total, aperte <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> ou clique <b>FECHAR VENDA</b>.
              </li>
              <li>
                <b>Conferir troco</b> (se houve dinheiro): tela cheia mostra o valor a entregar (ou <b>PAGAMENTO EXATO</b>). <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> avança.
              </li>
              <li>
                <b>Recibo da venda.</b> Baixe o PDF se necessário; <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> avança.
              </li>
              <li>
                <b>Tela de agradecimento.</b> <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> volta pro campo CÓDIGO pronto pra próxima venda.
              </li>
            </ol>
          </section>

          {/* Tabela de teclas - leitura */}
          <section>
            <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
              Atalhos na tela de leitura
            </h3>
            <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2">
              {[
                ['Enter', 'No campo vazio: abre o pagamento. Com texto: adiciona produto.'],
                ['F3 / F9', 'Cancelar cupom (pede confirmação).'],
                ['F4', 'Subtotal — abre o modal de pagamento.'],
                ['F5', 'Pagamentos — mesmo destino do F4 (padrão Linx/VR).'],
                ['F6', 'Desconto no total — pede autorização do gerente da unidade e o motivo. Promoção não passa por aqui: já vem no preço.'],
                ['F7', 'Consulta de preço (não adiciona ao carrinho).'],
                ['F8', 'Buscar produto por nome ou código.'],
                ['F10', 'Sangria — retirada de dinheiro do caixa.'],
                ['F11', 'Suprimento — entrada de dinheiro no caixa.'],
                ['F12', 'Fechar / suspender caixa (fora de venda).'],
                ['Tab', 'Anda entre os campos do cupom. Nunca sai do PDV: no último focável volta ao primeiro.'],
                ['Del', 'Remove o último item — ou o item selecionado por ↑↓.'],
                ['↑ ↓', 'Sugestões enquanto digita · com campo vazio: seleciona item do carrinho.'],
                ['Esc', 'Limpa o campo / desmarca item / sai da tela cheia / cancela venda.'],
                ['2*', 'Arma a quantidade para o PRÓXIMO item, identificado como você quiser (bipe, código, nome, F8).'],
                ['2*item', 'Quantidade colada ao item: 3*7891, 2*feijao, ou peso 0,350*7891.'],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <kbd className="text-xs font-mono px-2 py-1 rounded border self-start text-center" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>{k}</kbd>
                  <span style={{ color: '#374151' }}>{v}</span>
                </React.Fragment>
              ))}
            </div>
          </section>

          {/* Tabela de teclas - pagamento */}
          <section>
            <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
              Atalhos no modal de pagamento
            </h3>
            <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2">
              {[
                ['F1', 'Dinheiro — abre modal de valor recebido.'],
                ['F2', 'Cartão — picker Crédito / Débito.'],
                ['F3', 'Picker PIX / Vale / Fiado (só como forma única — não aceitam misto).'],
                ['↑ ↓ ← →', 'Navega entre as formas.'],
                ['Tab', 'Próximo elemento focável (preso no modal).'],
                ['Enter', 'Confirma forma focada. Com pagamentos lançados e restante 0: fecha venda.'],
                ['Esc', 'Em misto com pagamentos: limpa pagamentos. Sem pagamentos: fecha o modal.'],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <kbd className="text-xs font-mono px-2 py-1 rounded border self-start text-center" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>{k}</kbd>
                  <span style={{ color: '#374151' }}>{v}</span>
                </React.Fragment>
              ))}
            </div>
          </section>

          {/* Operação de caixa — 100% teclado */}
          <section>
            <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
              Operação de caixa — teclado 100%
            </h3>
            <div className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2">
              {[
                ['Ctrl+R', 'Reimprimir uma das últimas vendas concluídas desta sessão.'],
                ['Ctrl+L', 'Fechar meu caixa (relatório do turno + valor contado).'],
                ['Ctrl+M', 'Trocar de PDV (SuperMax / MaxLook / TechMax).'],
                ['Ctrl+G', 'Gancheira: suspende a venda atual (ou recupera a suspensa, com o carrinho vazio).'],
                ['Ctrl+F', 'Entrar / sair de tela cheia.'],
                ['Shift+F1 · ?', 'Abrir este manual.'],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <kbd className="text-xs font-mono px-2 py-1 rounded border self-start text-center" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>{k}</kbd>
                  <span style={{ color: '#374151' }}>{v}</span>
                </React.Fragment>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
              Todas as ações do PDV têm atalho — o operador não precisa tirar as mãos do teclado durante o turno.
            </p>
          </section>

          {/* Dicas */}
          <section>
            <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
              Boas práticas
            </h3>
            <ul className="space-y-2 list-disc list-inside" style={{ color: '#374151' }}>
              <li>Antes de operar, garanta que o <b>caixa está aberto</b> em Financeiro → Controle de Caixa. O badge verde no header confirma.</li>
              <li>Badge <span className="px-1.5 py-0.5 text-[10px] font-black uppercase rounded border" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' }}>Ruptura</span> aparece quando a quantidade vendida supera o estoque — confira o produto antes de fechar.</li>
              <li>Pra deixar dinheiro no caixa (troco inicial, reforço): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F11</kbd>. Pra retirar (depósito, pagto fornecedor): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F10</kbd> — sempre registrando o motivo.</li>
              <li><b>PIX/Fiado não aceitam pagamento parcial</b>. Pra dividir entre formas, use Dinheiro + Cartão.</li>
              <li>Pra alternar entre filiais (SuperMax/MaxLook/TechMax) sem perder o turno: <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Ctrl+M</kbd> (só com carrinho vazio).</li>
            </ul>
          </section>
        </div>

        <div className="px-6 py-3 border-t-2 text-xs font-bold uppercase tracking-wider text-center shrink-0" style={{ borderColor: YELLOW_DARK, background: '#f9fafb', color: NAVY_DARK }}>
          Esc fecha · Tab preso dentro do modal
        </div>
      </div>
    </div>
  );
}
