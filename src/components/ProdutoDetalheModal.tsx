import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Package, ShoppingCart } from 'lucide-react';
import { ATRIBUTOS_PRODUTO, rotuloParaCliente, valorParaCliente } from '../lib/atributosProduto';

// Ficha do produto aberta no PDV de MaxLook e TechMax — a tela que o vendedor
// vira para o cliente.
//
// Por que existe: a ficha por nicho (`produtos.atributos`) estava preenchida em
// 34/34 produtos da MaxLook e 35/40 da TechMax, e o PDV não mostrava nada dela.
// A segunda foto do produto (`imagem_url_2`, presente em 34 itens da TechMax)
// também não aparecia em tela nenhuma.
//
// Por que NÃO abre no clique do card: clicar adiciona ao carrinho, e é o gesto
// mais repetido do caixa. Consulta e venda rápida não disputam o mesmo toque —
// o botão de informação do card abre isto aqui, e daqui dá pra adicionar.
//
// CUSTO E MARGEM NÃO PASSAM POR AQUI, e não é por filtro de tela: `produtos`
// não tem essas colunas. O custo vive em `produtos_custo`, com RLS própria
// (migr. 262), lido pela view `produtos_com_custo` — nada disso trafega pro
// browser do operador de caixa.

// Acima disso o saldo vira só "Disponível". Número cru na frente do cliente
// não ajuda a vender; escassez real ajuda. O valor 2 é o mesmo que os cards da
// grade já usam pra "Últimas N" — régua diferente faria o card calar sobre um
// produto que a ficha chama de escasso.
const LIMITE_ESCASSEZ = 2;

export interface ProdutoDetalheModalProps {
  produto: any;
  filial: string;
  /** Cor de destaque da unidade (dourado MaxLook, laranja TechMax). */
  accent: string;
  /** Rótulo da unidade contável: 'peça' na moda, 'unidade' no resto. */
  substantivo?: 'peça' | 'unidade';
  onClose: () => void;
  onAdd: (produto: any) => void;
}

export const ProdutoDetalheModal = ({
  produto, filial, accent, substantivo = 'unidade', onClose, onAdd,
}: ProdutoDetalheModalProps) => {
  const imagens: string[] = [produto?.imagem_url, produto?.imagem_url_2, produto?.imagem_url_3]
    .filter((u: any): u is string => typeof u === 'string' && u.length > 0);
  const [imagemAtiva, setImagemAtiva] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const estoque = Number(produto?.estoque ?? 0);
  const semEstoque = estoque <= 0;
  const plural = substantivo === 'peça' ? 'peças' : 'unidades';
  const disponibilidade = semEstoque
    ? 'Esgotado'
    : estoque <= LIMITE_ESCASSEZ
      ? (estoque === 1 ? `Última ${substantivo}` : `Últimas ${estoque} ${plural}`)
      : 'Disponível';

  // Ficha do nicho: só o que é conversa de balcão. `bool` fica de fora — o
  // único hoje é `requer_imei`, regra de fechamento e não argumento de venda.
  const defs = ATRIBUTOS_PRODUTO[filial] ?? [];
  const atributos = (produto?.atributos && typeof produto.atributos === 'object')
    ? produto.atributos as Record<string, any>
    : {};
  const ficha = defs
    .filter(d => d.type !== 'bool')
    .map(d => ({
      key:   d.key,
      wide:  d.type === 'textarea',
      label: rotuloParaCliente(d.label),
      valor: valorParaCliente(d.key, atributos[d.key]),
    }))
    .filter(f => f.valor.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, opacity: 0 }}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto main-scrollbar rounded-2xl bg-white shadow-2xl"
        style={{ border: `2px solid ${accent}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sticky top-0 bg-white z-10"
          style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: accent }}>
            {filial} · Ficha do produto
          </span>
          {/* NÃO usa `.modal-close-btn`: este modal é a ficha da loja online e
              tem `bg-white` fixo, fora do tema do ERP. A classe pinta o fundo
              com `var(--color-bg-base)`, que no tema escuro ficaria preto sobre
              o card branco. Redondo e transparente é o desenho da vitrine. */}
          <button onClick={onClose} aria-label="Fechar"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
            style={{ color: '#525252' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 sm:p-5 grid gap-4 sm:gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="w-full aspect-square rounded-xl overflow-hidden flex items-center justify-center"
              style={{ background: '#F4F1EA', border: '1px solid rgba(0,0,0,0.06)' }}>
              {imagens.length > 0 ? (
                <img src={imagens[imagemAtiva]} alt={produto?.nome} className="w-full h-full object-cover" />
              ) : (
                <Package size={44} strokeWidth={1.4} style={{ color: '#C4BCA8' }} />
              )}
            </div>
            {imagens.length > 1 && (
              <div className="flex gap-2">
                {imagens.map((url, i) => (
                  <button key={url} onClick={() => setImagemAtiva(i)}
                    aria-label={`Foto ${i + 1}`}
                    className="w-14 h-14 rounded-lg overflow-hidden shrink-0"
                    style={{ border: i === imagemAtiva ? `2px solid ${accent}` : '1px solid rgba(0,0,0,0.12)' }}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 min-w-0">
            <div>
              {produto?.marca && (
                <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: accent }}>
                  {produto.marca}
                </p>
              )}
              <h3 className="text-lg font-black leading-tight" style={{ color: '#171717' }}>
                {produto?.nome}
              </h3>
              {produto?.categoria && (
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] mt-0.5" style={{ color: '#737373' }}>
                  {produto.categoria}
                </p>
              )}
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-black tabular-nums" style={{ color: accent }}>
                {Number(produto?.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
              <span className="text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded-md"
                style={semEstoque
                  ? { background: '#FEE2E2', color: '#B91C1C' }
                  : estoque <= LIMITE_ESCASSEZ
                    ? { background: '#1F1F1F', color: '#FFFFFF' }
                    : { background: '#ECFDF5', color: '#047857' }}>
                {disponibilidade}
              </span>
            </div>

            {ficha.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {ficha.map(f => (
                  <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
                    <dt className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: '#a3a3a3' }}>
                      {f.label}
                    </dt>
                    <dd className="text-sm font-bold leading-snug" style={{ color: '#262626' }}>
                      {f.valor}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs" style={{ color: '#737373' }}>
                Ficha técnica não preenchida no cadastro deste produto.
              </p>
            )}

            <button
              onClick={() => { onAdd(produto); onClose(); }}
              disabled={semEstoque}
              className="mt-auto w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: semEstoque ? '#E5E5E5' : accent, color: semEstoque ? '#737373' : '#FFFFFF' }}>
              <ShoppingCart size={16} />
              {semEstoque ? 'Sem estoque' : 'Adicionar ao carrinho'}
            </button>
          </div>
        </div>

        {/* Rodapé pro vendedor conferir sem virar a tela: SKU e código de barras. */}
        <div className="px-4 sm:px-5 py-2.5 flex gap-4 text-[10px] font-bold uppercase tracking-wider"
          style={{ borderTop: '1px solid rgba(0,0,0,0.08)', color: '#a3a3a3' }}>
          {produto?.codigo && <span>SKU {produto.codigo}</span>}
          {produto?.ean && <span>EAN {produto.ean}</span>}
          {produto?.unidade && <span>Un. {String(produto.unidade).toUpperCase()}</span>}
        </div>
      </motion.div>
    </motion.div>
  );
};
