import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trash2, Plus, Minus, ShoppingCart, CheckCircle2, X, Loader2, User, AlertTriangle, Lock, CreditCard, Smartphone, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useWhatsApp } from '../hooks/useWhatsApp';
import { useCaixaAberto } from '../hooks/useCaixaAberto';
import { LoadingSpinner, FilialBadge, ProdutoThumb } from '../components/ui';
import { supabase } from '../lib/supabase';
import { playBeep, playKaching, playPlim } from '../utils/audioUtils';

interface CartItem {
  produto_id: string;
  nome_produto: string;
  preco_unitario: number;
  qtd: number;
  subtotal: number;
  estoque: number;
  filial?: string;
}

const FORMAS = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX', 'Fiado'];

export const PDVView = ({ showToast, profile }: any) => {
  const { caixa, isLoading: caixaLoading, refresh: refreshCaixa } = useCaixaAberto();
  // Realtime enabled: any other cashier's sale triggers a produtos update via the stock trigger
  const { data: produtos, isLoading: loadingProd } = useFetchData<any>('/api/produtosview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/crmview');
  const { notify: wppNotify } = useWhatsApp();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [desconto, setDesconto] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [parcelas, setParcelas] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [lastVenda, setLastVenda] = useState<{ id: string; total: number } | null>(null);
  // Pix em aguardo: payload na DB + snapshot do carrinho para chamar o RPC após confirmação
  const [pixPendente, setPixPendente] = useState<{ id: string; valor: number } | null>(null);
  const vendaSnapshotRef = useRef<{
    cart: CartItem[]; subtotal: number; descontoNum: number; totalFinal: number; clienteId: string;
  } | null>(null);

  // Quando o usuário troca de forma de pagamento, sempre volta parcelas para 1
  // (evita ficar com 6x setado e mudar para Dinheiro).
  useEffect(() => {
    if (formaPagamento !== 'Cartão Crédito') setParcelas(1);
  }, [formaPagamento]);

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
  const searchLower = search.toLowerCase();
  const filtered = produtosAtivos.filter((p: any) =>
    [p.nome, p.codigo, p.ean].some((v: any) => v?.toString().toLowerCase().includes(searchLower))
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
        playBeep();
        return prev.map(i => i.produto_id === produto.id
          ? { ...i, qtd: i.qtd + 1, subtotal: (i.qtd + 1) * i.preco_unitario }
          : i
        );
      }
      if ((produto.estoque ?? 999) <= 0) {
        showToast?.('Produto sem estoque.', 'error', true);
        return prev;
      }
      playBeep();
      return [...prev, { produto_id: produto.id, nome_produto: produto.nome, preco_unitario: preco, qtd: 1, subtotal: preco, estoque: produto.estoque ?? 999, filial: produto.filial }];
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

  // Lógica de busca por código (EAN/código interno) ou termo livre. Usada
  // pelo Enter manual no input e pelo listener global do scanner. Recebe o
  // código por argumento (não lê `search`) porque o scanner pode disparar
  // mesmo com o foco fora do input.
  const processBarcode = useCallback((codeRaw: string) => {
    const termo = codeRaw.trim();
    if (!termo) return;
    const termoLower = termo.toLowerCase();
    let match = produtosAtivos.find((p: any) =>
      String(p.ean ?? '').trim() === termo ||
      String(p.codigo ?? '').trim().toLowerCase() === termoLower
    );
    if (!match) {
      const partial = produtosAtivos.filter((p: any) =>
        [p.nome, p.codigo, p.ean].some((v: any) => v?.toString().toLowerCase().includes(termoLower))
      );
      if (partial.length === 1) match = partial[0];
    }
    if (!match) {
      showToast?.(`Produto não encontrado: ${termo}`, 'error', true);
    } else {
      addToCart(match);
    }
    setSearch('');
    searchRef.current?.focus();
  }, [produtosAtivos, addToCart, showToast]);

  const handleSearchEnter = () => processBarcode(search);

  // Mantém a função processBarcode mais recente acessível ao listener global
  // sem que seja necessário rebindar o evento a cada render.
  const processBarcodeRef = useRef(processBarcode);
  useEffect(() => { processBarcodeRef.current = processBarcode; }, [processBarcode]);

  const pixPendenteRef = useRef(pixPendente);
  useEffect(() => { pixPendenteRef.current = pixPendente; }, [pixPendente]);

  // Leitor de código de barras (hardware): teclas chegam em <50ms entre si e
  // terminam com Enter. Listener global em fase de CAPTURE para que mesmo
  // quando o foco está num botão (Tema, forma de pagamento, card de produto),
  // a leitura seja processada e o Enter não active o botão focado.
  useEffect(() => {
    const SCANNER_MAX_INTERVAL_MS = 50;
    let chars = '';
    let lastTs = 0;

    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();
      const fast = now - lastTs < SCANNER_MAX_INTERVAL_MS;

      if (e.key === 'Enter') {
        if (chars.length >= 4 && fast) {
          e.preventDefault();
          e.stopPropagation();
          const code = chars;
          chars = '';
          lastTs = 0;
          if (!pixPendenteRef.current) processBarcodeRef.current(code);
          return;
        }
        chars = '';
        lastTs = 0;
        return;
      }

      if (e.key.length !== 1) return;
      if (!fast) chars = '';
      chars += e.key;
      lastTs = now;
    };

    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const removeFromCart = (produto_id: string) => setCart(prev => prev.filter(i => i.produto_id !== produto_id));
  const clearCart = () => { setCart([]); setDesconto(''); setFormaPagamento('Dinheiro'); setParcelas(1); setClienteId(''); setLastVenda(null); setNetworkError(false); };

  const valorPorParcela = parcelas > 1 ? totalFinal / parcelas : totalFinal;

  // Chama o RPC transacional. Usado tanto pelo fluxo síncrono (Dinheiro/Cartão/Fiado)
  // quanto pelo callback do realtime após confirmação do Pix. Recebe snapshot para
  // que o fluxo Pix possa usar o estado capturado no momento da geração do QR.
  const finalizarVenda = async (snap: {
    cart: CartItem[]; subtotal: number; descontoNum: number; totalFinal: number; clienteId: string;
  }, forma: string, parcelasEfetivas: number) => {
    if (!supabase) throw new Error('Supabase indisponível.');
    const itensPayload = snap.cart.map(item => ({
      produto_id:    item.produto_id,
      nome_produto:  item.nome_produto,
      qtd:           item.qtd,
      preco_unitario: item.preco_unitario,
      subtotal:      item.subtotal,
    }));
    // Filial da venda: usa a filial do primeiro produto se todos os itens
    // forem da mesma unidade; caso contrário (carrinho misto ou item sem
    // filial), cai para a filial do operador (profile.filial). Default
    // 'Matriz' se nada estiver definido — evita venda sem atribuição.
    const filiaisCarrinho = Array.from(
      new Set(snap.cart.map((it: any) => it.filial).filter(Boolean))
    );
    const filialVenda: string =
      filiaisCarrinho.length === 1
        ? String(filiaisCarrinho[0])
        : (profile?.filial ?? 'Matriz');

    const { data: vendaId, error: rpcErr } = await supabase.rpc('criar_venda_pdv', {
      p_cliente_id:      snap.clienteId || null,
      p_total:           snap.subtotal,
      p_desconto:        snap.descontoNum,
      p_total_final:     snap.totalFinal,
      p_forma_pagamento: forma,
      p_parcelas:        forma === 'Cartão Crédito' ? parcelasEfetivas : 1,
      p_itens:           itensPayload,
      p_filial:          filialVenda,
    });
    if (rpcErr || !vendaId) throw new Error(rpcErr?.message ?? 'Falha ao registrar venda.');

    // Pix já tocou o "Plim" no callback do realtime (confirmação do cliente);
    // demais formas tocam "ka-ching" agora que a venda foi efetivamente persistida.
    if (forma !== 'PIX') playKaching();

    const shortId = String(vendaId).slice(-6).toUpperCase();
    const totalFmt = snap.totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const valorParcela = parcelasEfetivas > 1 ? snap.totalFinal / parcelasEfetivas : snap.totalFinal;
    const parcelaInfo = forma === 'Cartão Crédito' && parcelasEfetivas > 1
      ? `\n📅 ${parcelasEfetivas}x de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      : '';
    const financeiroInfo =
      forma === 'Fiado' ? '\n⚠️ Gerado título em Contas a Receber'
      : forma === 'Cartão Crédito' && parcelasEfetivas > 1 ? `\n⚠️ Gerados ${parcelasEfetivas} títulos em Contas a Receber`
      : forma === 'Cartão Crédito' ? '\n⚠️ Gerado título em Contas a Receber'
      : '';
    wppNotify(`🛒 *LogMax PDV — Venda concluída*\n💰 Total: ${totalFmt}\n💳 Pagamento: ${forma}${parcelaInfo}${financeiroInfo}`);
    setLastVenda({ id: shortId, total: snap.totalFinal });
    setCart([]);
    setDesconto('');
    setFormaPagamento('Dinheiro');
    setParcelas(1);
    setClienteId('');
    setIsClosing(false);
    searchRef.current?.focus();
  };

  const handleFecharVenda = async () => {
    if (networkError) return;
    if (cart.length === 0) { showToast?.('Carrinho vazio.', 'error', true); return; }
    if (formaPagamento === 'Fiado' && !clienteId) { showToast?.('Selecione o cliente para venda Fiado.', 'error', true); return; }
    setIsClosing(true);
    try {
      // Revalida o caixa antes de fechar a venda — outro operador pode tê-lo fechado
      // enquanto o carrinho estava a ser montado.
      if (supabase) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: caixaAtual } = await supabase
          .from('controle_caixa')
          .select('id, status')
          .eq('data', today)
          .eq('status', 'Aberto')
          .limit(1);
        if (!caixaAtual || caixaAtual.length === 0) {
          showToast?.('O caixa de hoje foi fechado. Abra um novo caixa em Financeiro → Controle de Caixa antes de continuar.', 'error', true);
          await refreshCaixa();
          setIsClosing(false);
          return;
        }
      }

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
            setCart(prev => prev.map(cartItem => {
              const fp = freshProd.find((p: any) => p.id === cartItem.produto_id);
              return fp ? { ...cartItem, estoque: Number(fp.estoque ?? 0) } : cartItem;
            }));
            setIsClosing(false);
            return;
          }
        }
      }

      if (!supabase) throw new Error('Supabase indisponível.');

      // Fluxo Pix: cria pendente, mostra QR e aguarda confirmação do simulador
      // via realtime. A venda só é persistida no RPC quando o cliente confirma.
      if (formaPagamento === 'PIX') {
        const { data: pendente, error: insErr } = await supabase
          .from('pix_pendentes')
          .insert({ valor: totalFinal, cliente_id: clienteId || null, status: 'aguardando' })
          .select('id, valor')
          .single();
        if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao gerar Pix.');

        vendaSnapshotRef.current = {
          cart: [...cart],
          subtotal,
          descontoNum,
          totalFinal,
          clienteId,
        };
        setPixPendente({ id: pendente.id, valor: Number(pendente.valor) });
        // isClosing fica true enquanto o overlay está aberto (botão "Fechar Venda" desabilitado)
        return;
      }

      await finalizarVenda(
        { cart, subtotal, descontoNum, totalFinal, clienteId },
        formaPagamento,
        parcelas,
      );
    } catch (err: any) {
      const isNetworkError =
        err instanceof TypeError ||
        !navigator.onLine ||
        /fetch|network|failed to fetch/i.test(String(err?.message ?? ''));

      if (isNetworkError) {
        setNetworkError(true);
      } else {
        showToast?.(`Erro ao fechar venda: ${err?.message ?? 'verifique o console'}`, 'error', true);
        setIsClosing(false);
      }
    }
  };

  // Realtime: escuta a linha do pendente Pix. Quando UPDATE marca status='pago',
  // chama o RPC com o snapshot do carrinho. Cancelamento manual ou cancelado
  // simplesmente fecha o overlay e devolve o controlo ao operador.
  useEffect(() => {
    if (!pixPendente || !supabase) return;
    const channel = supabase
      .channel(`pix_pendente_${pixPendente.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pix_pendentes', filter: `id=eq.${pixPendente.id}` },
        async (payload: any) => {
          const novoStatus = payload?.new?.status;
          if (novoStatus !== 'pago') return;
          const snap = vendaSnapshotRef.current;
          if (!snap) return;
          try {
            playPlim();
            await finalizarVenda(snap, 'PIX', 1);
            vendaSnapshotRef.current = null;
            setPixPendente(null);
          } catch (err: any) {
            showToast?.(`Pagamento confirmado mas falhou ao gerar venda: ${err?.message ?? '—'}`, 'error', true);
            setPixPendente(null);
            setIsClosing(false);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pixPendente, showToast]);

  const cancelarPix = async () => {
    if (!pixPendente || !supabase) return;
    // Tenta marcar como cancelado; ignora erro porque o desfecho local é o mesmo.
    await supabase.from('pix_pendentes')
      .update({ status: 'cancelado' })
      .eq('id', pixPendente.id);
    vendaSnapshotRef.current = null;
    setPixPendente(null);
    setIsClosing(false);
  };

  if (loadingProd || caixaLoading) return <LoadingSpinner />;

  if (!caixa) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-gray-600" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-gray-300">Caixa não aberto</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          O caixa do dia ainda não foi aberto. Vá até{' '}
          <span className="text-accent font-bold">Financeiro → Controle de Caixa</span>{' '}
          para realizar a abertura.
        </p>
      </div>
      <button onClick={refreshCaixa}
        className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors">
        Verificar novamente
      </button>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-0 -mt-2">
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">PDV</h2>
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
              placeholder="Buscar por nome, código ou bipar o código de barras..."
              className="neu-input py-3 pl-10 pr-4 rounded-2xl text-sm w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearchEnter(); } }}
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

          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto main-scrollbar pr-1 pb-4 max-h-[45vh] lg:max-h-none">
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
                    className="neu-button rounded-2xl p-3 flex flex-col gap-2 text-left transition-all border border-transparent relative"
                    style={inCart ? { borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)' } : semEstoque ? { opacity: 0.4 } : {}}
                  >
                    {inCart && (
                      <span className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black z-10"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                        {inCart.qtd}
                      </span>
                    )}
                    <div className="flex gap-3 items-start">
                      <ProdutoThumb url={p.imagem_url} size="md" alt={p.nome} />
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {p.filial && <FilialBadge filial={p.filial} />}
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">{p.codigo || '—'}</span>
                        <span className="text-sm font-bold text-gray-200 leading-tight line-clamp-2">{p.nome}</span>
                      </div>
                    </div>
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
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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

              <AnimatePresence>
                {formaPagamento === 'Cartão Crédito' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden">
                    <div className="flex items-center gap-2 p-2 rounded-xl mt-1" style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                      <CreditCard size={12} className="text-accent shrink-0" />
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest shrink-0">Parcelas</label>
                      <select
                        value={parcelas}
                        onChange={e => setParcelas(Number(e.target.value))}
                        className="neu-input py-1.5 px-2 rounded-lg text-xs flex-1 bg-transparent border-none outline-none"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                          <option key={n} value={n}>
                            {n}x de {(totalFinal / n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            {n === 1 ? ' (à prazo, 30d)' : ' sem juros'}
                          </option>
                        ))}
                      </select>
                    </div>
                    {parcelas > 1 && (
                      <p className="text-[10px] text-gray-500 mt-1.5 px-1">
                        {parcelas}x de <span className="font-bold text-accent">{valorPorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span> — 1ª parcela vence em 30 dias.
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
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

      {/* Overlay Pix — fica em cima do PDV enquanto aguarda confirmação do simulador */}
      <AnimatePresence>
        {pixPendente && (
          <motion.div
            key="pix-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
          >
            <motion.div
              initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="neu-flat rounded-3xl w-full max-w-sm p-6 flex flex-col items-center gap-4 border border-white/5 relative"
              style={{ background: 'var(--color-bg-base)' }}
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <QrCode size={18} className="text-accent" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent animate-ping" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Aguardando Pagamento</span>
              </div>

              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pix — Total</p>
                <p className="text-3xl font-black text-gray-100 tabular-nums tracking-tight mt-1">
                  {pixPendente.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>

              {/* QR sempre preto-sobre-branco com quiet zone — exigência dos scanners,
                  independente do tema da app. */}
              <div className="p-4 rounded-3xl border border-white/5"
                style={{ background: '#ffffff' }}>
                <QRCodeSVG
                  value={`LOGMAX-PIX-${pixPendente.id}`}
                  size={208}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-gray-500 text-center max-w-[18rem]">
                <Smartphone size={12} className="shrink-0 text-accent" />
                <span>Peça ao cliente para escanear este código no <span className="font-bold text-gray-300">simulador de pagamento</span>.</span>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-gray-600 font-mono">
                <Loader2 size={10} className="animate-spin" />
                <span>Escutando confirmação em tempo real…</span>
              </div>

              <button
                onClick={cancelarPix}
                className="mt-1 w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', background: 'rgba(239,68,68,0.05)' }}
              >
                <X size={12} /> Cancelar pagamento
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
