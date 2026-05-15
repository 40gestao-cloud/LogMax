import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trash2, Plus, Minus, ShoppingCart, CheckCircle2, X, Loader2, User, AlertTriangle } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { useWhatsApp } from '../hooks/useWhatsApp';
import { LoadingSpinner } from '../components/ui';
import { supabase } from '../lib/supabase';

interface CartItem {
  produto_id: string;
  nome_produto: string;
  preco_unitario: number;
  qtd: number;
  subtotal: number;
  estoque: number;
}

const FORMAS = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX', 'Fiado'];

export const PDVView = ({ showToast, profile }: any) => {
  // Realtime enabled: any other cashier's sale triggers a produtos update via the stock trigger
  const { data: produtos, isLoading: loadingProd } = useFetchData<any>('/api/produtosview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/crmview');
  const { notify: wppNotify } = useWhatsApp();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [desconto, setDesconto] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [clienteId, setClienteId] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [lastVenda, setLastVenda] = useState<{ id: string; total: number } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Keep cart estoque values fresh when realtime pushes produto updates from other cashiers
  useEffect(() => {
    if (produtos.length === 0) return;
    setCart(prev => prev.map(cartItem => {
      const fresh = produtos.find((p: any) => p.id === cartItem.produto_id);
      if (!fresh) return cartItem;
      return { ...cartItem, estoque: Number(fresh.estoque ?? 0) };
    }));
  }, [produtos]);

  const produtosAtivos = produtos.filter((p: any) => p.status === 'Ativo' || !p.status);
  const filtered = produtosAtivos.filter((p: any) =>
    [p.nome, p.codigo].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  const descontoNum = parseFloat(String(desconto).replace(',', '.')) || 0;
  const totalFinal = Math.max(0, subtotal - descontoNum);

  const addToCart = useCallback((produto: any) => {
    const preco = Number(produto.preco) || 0;
    setCart(prev => {
      const existing = prev.find(i => i.produto_id === produto.id);
      if (existing) {
        if (existing.qtd >= (produto.estoque ?? 999)) {
          showToast?.('Quantidade máxima em estoque atingida.', 'error', true);
          return prev;
        }
        return prev.map(i => i.produto_id === produto.id
          ? { ...i, qtd: i.qtd + 1, subtotal: (i.qtd + 1) * i.preco_unitario }
          : i
        );
      }
      if ((produto.estoque ?? 999) <= 0) {
        showToast?.('Produto sem estoque.', 'error', true);
        return prev;
      }
      return [...prev, { produto_id: produto.id, nome_produto: produto.nome, preco_unitario: preco, qtd: 1, subtotal: preco, estoque: produto.estoque ?? 999 }];
    });
  }, [showToast]);

  const changeQty = (produto_id: string, delta: number) => {
    setCart(prev => prev
      .map(i => {
        if (i.produto_id !== produto_id) return i;
        const newQty = i.qtd + delta;
        if (newQty <= 0) return null as any;
        if (newQty > i.estoque) { showToast?.('Quantidade máxima em estoque atingida.', 'error', true); return i; }
        return { ...i, qtd: newQty, subtotal: newQty * i.preco_unitario };
      })
      .filter(Boolean)
    );
  };

  const removeFromCart = (produto_id: string) => setCart(prev => prev.filter(i => i.produto_id !== produto_id));
  const clearCart = () => { setCart([]); setDesconto(''); setFormaPagamento('Dinheiro'); setClienteId(''); setLastVenda(null); setNetworkError(false); };

  const handleFecharVenda = async () => {
    if (networkError) return;
    if (cart.length === 0) { showToast?.('Carrinho vazio.', 'error', true); return; }
    if (formaPagamento === 'Fiado' && !clienteId) { showToast?.('Selecione o cliente para venda Fiado.', 'error', true); return; }
    setIsClosing(true);
    try {
      // Fresh stock check against DB — cannot rely on local state with multiple cashiers
      if (supabase) {
        const prodIds = cart.map(i => i.produto_id);
        const { data: freshProd } = await supabase
          .from('produtos')
          .select('id, nome, estoque')
          .in('id', prodIds);
        if (freshProd) {
          const insuficientes = cart.filter(cartItem => {
            const fp = freshProd.find((p: any) => p.id === cartItem.produto_id);
            return fp && Number(fp.estoque ?? 0) < cartItem.qtd;
          });
          if (insuficientes.length > 0) {
            const nomes = insuficientes.map(i => i.nome_produto).join(', ');
            showToast?.(`Estoque insuficiente: ${nomes}. Ajuste o carrinho.`, 'error', true);
            // Sync cart with actual DB stock so the user sees correct limits
            setCart(prev => prev.map(cartItem => {
              const fp = freshProd.find((p: any) => p.id === cartItem.produto_id);
              return fp ? { ...cartItem, estoque: Number(fp.estoque ?? 0) } : cartItem;
            }));
            setIsClosing(false);
            return;
          }
        }
      }

      const today = new Date().toISOString().slice(0, 10);

      const venda = await dbInsert('/api/vendasview', {
        cliente_id: clienteId || null,
        total: subtotal,
        desconto: descontoNum,
        total_final: totalFinal,
        forma_pagamento: formaPagamento,
        status: 'Concluída',
      }) as any;

      for (const item of cart) {
        await dbInsert('/api/itensvendaview', {
          venda_id: venda.id,
          produto_id: item.produto_id,
          nome_produto: item.nome_produto,
          qtd: item.qtd,
          preco_unitario: item.preco_unitario,
          subtotal: item.subtotal,
        });
        await dbInsert('/api/movimentacoesestoqueview', {
          produto_id: item.produto_id,
          tipo: 'Saída',
          qtd: item.qtd,
          origem: 'PDV',
          destino: `Venda #${venda.id.slice(-6).toUpperCase()}`,
          data: today,
        });
      }

      if (formaPagamento === 'Fiado' && clienteId) {
        const cli = clientes.find((c: any) => c.id === clienteId);
        await dbInsert('/api/contasreceberview', {
          cliente_id: clienteId,
          descricao: `Venda PDV #${venda.id.slice(-6).toUpperCase()} — ${cli?.nome ?? 'Cliente'}`,
          valor: totalFinal,
          status: 'Aberto',
        });
      }

      const totalFmt = totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      wppNotify(`🛒 *LogMax PDV — Venda concluída*\n💰 Total: ${totalFmt}\n💳 Pagamento: ${formaPagamento}${formaPagamento === 'Fiado' ? '\n⚠️ Gerado título em Contas a Receber' : ''}`);
      setLastVenda({ id: venda.id.slice(-6).toUpperCase(), total: totalFinal });
      setCart([]);
      setDesconto('');
      setFormaPagamento('Dinheiro');
      setClienteId('');
      setIsClosing(false);
      searchRef.current?.focus();
    } catch (err: any) {
      const isNetworkError =
        err instanceof TypeError ||
        !navigator.onLine ||
        /fetch|network|failed to fetch/i.test(String(err?.message ?? ''));

      if (isNetworkError) {
        // Keep isClosing=true so the button stays disabled while the warning is shown
        setNetworkError(true);
      } else {
        showToast?.(`Erro ao fechar venda: ${err?.message ?? 'verifique o console'}`, 'error', true);
        setIsClosing(false);
      }
    }
  };

  if (loadingProd) return <LoadingSpinner />;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-0 -mt-2">
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">PDV</h2>
          <p className="text-sm text-gray-400 mt-1">Ponto de Venda — registre vendas e baixe o estoque automaticamente.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">

        {/* LEFT — busca + grade de produtos */}
        <div className="lg:col-span-7 flex flex-col gap-4 min-h-0">
          <div className="relative shrink-0">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar produto por nome ou código..."
              className="neu-input py-3 pl-10 pr-4 rounded-2xl text-sm w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <AnimatePresence>
            {lastVenda && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center justify-between p-4 rounded-2xl shrink-0"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={18} className="text-accent" />
                  <div>
                    <p className="text-sm font-bold text-accent">Venda #{lastVenda.id} concluída!</p>
                    <p className="text-xs text-gray-400">Total: {lastVenda.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                  </div>
                </div>
                <button onClick={() => setLastVenda(null)} className="text-gray-500 hover:text-white transition-colors"><X size={14} /></button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto main-scrollbar pr-1 pb-4">
            {filtered.length === 0 ? (
              <div className="col-span-3 flex items-center justify-center py-12 text-gray-500 text-sm">
                {search ? 'Nenhum produto encontrado.' : 'Nenhum produto ativo cadastrado.'}
              </div>
            ) : (
              filtered.map((p: any) => {
                const inCart = cart.find(i => i.produto_id === p.id);
                const semEstoque = (p.estoque ?? 999) <= 0;
                return (
                  <motion.button
                    key={p.id}
                    onClick={() => !semEstoque && addToCart(p)}
                    whileTap={!semEstoque ? { scale: 0.97 } : {}}
                    disabled={semEstoque}
                    className="neu-button rounded-2xl p-4 flex flex-col gap-2 text-left transition-all border border-transparent relative"
                    style={inCart ? { borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)' } : semEstoque ? { opacity: 0.4 } : {}}
                  >
                    {inCart && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                        {inCart.qtd}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{p.codigo || '—'}</span>
                    <span className="text-sm font-bold text-gray-200 leading-tight">{p.nome}</span>
                    <div className="flex items-end justify-between mt-auto pt-1">
                      <span className="text-base font-black text-accent">
                        {Number(p.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                      <span className={`text-[10px] font-bold ${semEstoque ? 'text-red-500' : 'text-gray-500'}`}>
                        {semEstoque ? 'Sem estoque' : `Saldo: ${p.estoque ?? '∞'}`}
                      </span>
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — carrinho + pagamento */}
        <div className="lg:col-span-5 flex flex-col gap-4 min-h-0">
          <div className="neu-flat rounded-3xl p-5 flex flex-col gap-3 flex-1 min-h-0 border border-white/5">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-accent" />
                <h3 className="text-sm font-bold text-gray-200">Carrinho</h3>
                {cart.length > 0 && (
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>{cart.length}</span>
                )}
              </div>
              {cart.length > 0 && (
                <button onClick={clearCart} className="text-[10px] text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1">
                  <X size={10} /> Limpar
                </button>
              )}
            </div>

            {/* Itens do carrinho */}
            <div className="flex flex-col gap-2 overflow-y-auto main-scrollbar flex-1 min-h-0">
              {cart.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-gray-600 text-center">Clique em um produto<br />para adicionar ao carrinho</p>
                </div>
              ) : (
                <AnimatePresence>
                  {cart.map(item => (
                    <motion.div key={item.produto_id}
                      initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                      className="flex items-center gap-2 p-3 neu-pressed rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-200 truncate">{item.nome_produto}</p>
                        <p className="text-[10px] text-gray-500">
                          {item.preco_unitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un.
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => changeQty(item.produto_id, -1)}
                          className="w-6 h-6 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                          <Minus size={10} />
                        </button>
                        <span className="text-xs font-bold text-gray-200 w-6 text-center">{item.qtd}</span>
                        <button onClick={() => changeQty(item.produto_id, +1)}
                          className="w-6 h-6 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                          <Plus size={10} />
                        </button>
                      </div>
                      <div className="w-20 text-right shrink-0">
                        <p className="text-xs font-bold text-accent">{item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                      </div>
                      <button onClick={() => removeFromCart(item.produto_id)}
                        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 size={11} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Totais */}
            <div className="flex flex-col gap-2 pt-3 border-t border-white/5 shrink-0">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Subtotal</span>
                <span className="font-mono">{subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">Desconto (R$)</span>
                <input
                  type="text"
                  value={desconto}
                  onChange={e => setDesconto(e.target.value)}
                  placeholder="0,00"
                  className="neu-input py-1.5 px-3 rounded-xl text-xs text-right w-28 font-mono"
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-gray-200">Total</span>
                <span className="text-xl font-black text-accent font-mono">
                  {totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </div>

            {/* Pagamento */}
            <div className="flex flex-col gap-2 pt-3 border-t border-white/5 shrink-0">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Forma de pagamento</label>
              <div className="grid grid-cols-3 gap-1.5">
                {FORMAS.map(f => (
                  <button key={f} onClick={() => setFormaPagamento(f)}
                    className="py-2 px-2 rounded-xl text-[10px] font-bold transition-all border"
                    style={formaPagamento === f
                      ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-accent)' }
                      : { background: 'transparent', borderColor: 'rgba(255,255,255,0.05)', color: '#6b7280' }
                    }>
                    {f}
                  </button>
                ))}
              </div>

              {formaPagamento === 'Fiado' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                  <div className="flex items-center gap-2 p-2 rounded-xl mt-1" style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                    <User size={12} className="text-accent shrink-0" />
                    <select
                      value={clienteId}
                      onChange={e => setClienteId(e.target.value)}
                      className="neu-input py-1.5 px-2 rounded-lg text-xs flex-1 bg-transparent border-none outline-none"
                    >
                      <option value="">Selecione o cliente *</option>
                      {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Fechar venda / Aviso de erro de conexão */}
            <AnimatePresence mode="wait">
              {networkError ? (
                <motion.div
                  key="network-error"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="w-full rounded-2xl flex flex-col gap-3 p-4 shrink-0 mt-1"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-red-500">Erro de conexão</p>
                      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        Antes de tentar novamente, verifique no{' '}
                        <span className="font-bold text-gray-300">Histórico de Vendas</span>{' '}
                        se a venda já foi registrada para evitar duplicidade.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setNetworkError(false); setIsClosing(false); }}
                    className="w-full py-2.5 rounded-xl text-xs font-bold transition-all"
                    style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', background: 'rgba(239,68,68,0.05)' }}>
                    Entendi — tentar novamente
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="fechar-venda"
                  onClick={handleFecharVenda}
                  disabled={cart.length === 0 || isClosing}
                  whileTap={cart.length > 0 && !isClosing ? { scale: 0.98 } : {}}
                  className="w-full py-4 rounded-2xl text-sm font-black flex items-center justify-center gap-2 transition-all shrink-0 mt-1"
                  style={{
                    background: cart.length === 0 || isClosing ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)' : 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
                    color: cart.length === 0 || isClosing ? '#4b5563' : 'var(--color-accent-text)',
                    boxShadow: cart.length > 0 && !isClosing ? '0 4px 20px color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'none',
                    cursor: cart.length === 0 || isClosing ? 'not-allowed' : 'pointer',
                  }}>
                  {isClosing ? <><Loader2 size={16} className="animate-spin" /> Processando...</> : <><CheckCircle2 size={16} /> Fechar Venda</>}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
