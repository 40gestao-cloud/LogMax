import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X, Loader2, Lock, DollarSign, CreditCard, Wallet, Banknote, Users as UsersIcon, HelpCircle,
  Maximize2, Minimize2, Search,
} from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import type { CaixaAberto } from '../hooks/useCaixaAberto';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { playScannerBeep, playKaching } from '../utils/audioUtils';

// PDV do LogMax em modo SuperMax — réplica visual e UX do MaxPOS.
// Camada de dados continua sendo LogMax: /api/produtosview, RPC criar_venda_pdv,
// controle_caixa, pix_pendentes. Cores e layout: amarelo/navy/verde MaxPOS.

const YELLOW      = '#FFC107';
const YELLOW_DARK = '#B8860B';
const NAVY_DARK   = '#172554';
const MONEY       = '#15803d';
const RED         = '#b91c1c';

interface CartItem {
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

type FormaPagamento = 'Dinheiro' | 'Cartão Débito' | 'Cartão Crédito' | 'Fiado' | 'PIX';

// Foco fica preso dentro do modal — Tab/Shift+Tab ciclam só nos focáveis dele.
const FOCUSABLE_SELECTOR =
  'input:not([disabled]):not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),a[href]:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

function trapTab(e: React.KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (focusables.length === 0) { e.preventDefault(); return; }
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const insideModal = !!active && container.contains(active);
  if (e.shiftKey) {
    if (!insideModal || active === first) { e.preventDefault(); last.focus(); }
  } else {
    if (!insideModal || active === last) { e.preventDefault(); first.focus(); }
  }
}

const FORMAS_PAGAMENTO: FormaPagamento[] = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX', 'Fiado'];

// Normaliza string pra busca: lowercase + remove acentos (ã→a, é→e, etc).
// Sem isso, "feijão" digitado não casa com produto "FEIJAO" e vice-versa.
// Regex via constructor pra evitar qualquer dúvida de encoding do arquivo.
const ACCENT_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');
const norm = (s: any) => String(s ?? '').normalize('NFD').replace(ACCENT_REGEX, '').toLowerCase();

interface PDVViewSupermaxProps {
  showToast?: (msg: string, kind?: string, persist?: boolean) => void;
  profile?: any;
  onSwitchFilial?: (filial: string) => void;
  caixa: CaixaAberto | null;
  caixaLoading: boolean;
  refreshCaixa: () => Promise<void> | void;
}

export const PDVViewSupermax = ({
  showToast, profile, onSwitchFilial, caixa, caixaLoading, refreshCaixa,
}: PDVViewSupermaxProps) => {
  const { user } = useAuth();
  const filial = 'SuperMax' as const;
  const { data: produtos, isLoading: loadingProd } = useFetchData<any>('/api/produtosview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/crmview');

  const [code, setCode]                 = useState('');
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [lastAdded, setLastAdded]       = useState<CartItem | null>(null);
  const [isClosing, setIsClosing]       = useState(false);
  const [lastVenda, setLastVenda]       = useState<{ id: string; total: number } | null>(null);
  const [codeMsg, setCodeMsg]           = useState<{ type: 'err'; text: string } | null>(null);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [cashModalOpen, setCashModalOpen]       = useState(false);
  const [cashReceived, setCashReceived]         = useState('');
  const [changeModal, setChangeModal]           = useState<{ amount: number } | null>(null);
  const [pixModal, setPixModal]                 = useState<{ id: string; valor: number } | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch]         = useState('');
  const [confirmCancel, setConfirmCancel]       = useState(false);

  // Modo tela cheia (overlay sobre app shell). Default ON ao entrar no PDV.
  // ESC sai do modo tela cheia; F9/botão vermelho seguem cancelando venda.
  const [fullscreen, setFullscreen] = useState(true);

  // Índices de seleção por teclado nos modais (Arrow keys + Enter).
  const [payChoiceIdx, setPayChoiceIdx]       = useState(0);
  const [confirmFocusIdx, setConfirmFocusIdx] = useState<0 | 1>(0);
  const [clientIdx, setClientIdx]             = useState(-1);

  // Busca por nome/código (F8/F10) — replica o classicSearch do MaxPOS.
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchTerm, setSearchTerm]           = useState('');
  const [searchIdx, setSearchIdx]             = useState(0);

  // Picker de cartão (F2 no payment modal) — Crédito/Débito.
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [cardPickerIdx, setCardPickerIdx]   = useState<0 | 1>(0);

  // Confirmação de cancelar PIX — Esc/clique no botão pedem confirmação
  // antes de marcar pix_pendentes como cancelado. Sem isso, encostar no Esc
  // por engano cancelava um PIX possivelmente a 1s da confirmação.
  const [confirmPixCancel, setConfirmPixCancel] = useState(false);

  // Consulta de preço (F7) — read-only, não adiciona ao carrinho.
  const [priceQueryOpen, setPriceQueryOpen] = useState(false);
  const [priceQueryTerm, setPriceQueryTerm] = useState('');
  const [priceQueryIdx, setPriceQueryIdx]   = useState(0);

  // Suprimento (F11) / Sangria (F12) — entrada/saída de dinheiro no caixa.
  const [cashMoveModal, setCashMoveModal] = useState<{ tipo: 'suprimento' | 'sangria' } | null>(null);
  const [cashMoveValor, setCashMoveValor] = useState('');
  const [cashMoveMotivo, setCashMoveMotivo] = useState('');

  // Desconto (F6) — % ou R$ aplicado no total da venda atual.
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountKind, setDiscountKind]   = useState<'percent' | 'reais'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [desconto, setDesconto]           = useState(0);

  // Pagamento misto — lista de pagamentos lançados até cobrir o totalFinal.
  // Sem migration na RPC: forma_pagamento concatena 'Misto: X+Y'. Fiado
  // fica bloqueado no misto (gera conta_receber pelo valor cheio, não
  // pelo parcial — incoerente sem refactor do RPC).
  type PaymentLine = { forma: Exclude<FormaPagamento, 'Fiado'>; valor: number };
  const [pagamentos, setPagamentos] = useState<PaymentLine[]>([]);
  const [parcialValor, setParcialValor] = useState('');
  // Troco do dinheiro fica em standby até finalizarVendaMisto rodar — só
  // mostra o modal de troco depois que a venda fechou de verdade.
  const [trocoStash, setTrocoStash] = useState(0);

  // Tela de agradecimento — pisa em cima após troco/exato OU direto após
  // Cartão/PIX/Fiado. Só fecha com Enter; rouba o foco do PDV.
  const [thankYouOpen, setThankYouOpen] = useState(false);

  // Erro inline do payment modal — toast global some atrás do fullscreen.
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Modal de ajuda — manual passo-a-passo + tabela de teclas.
  const [helpOpen, setHelpOpen] = useState(false);

  const [cupomSeq]   = useState(() => String(Date.now()).slice(-6));
  const [nowTick, setNowTick] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const payBtnRefs   = useRef<(HTMLButtonElement | null)[]>([]);

  // Relógio do header — atualiza a cada 30s, evita repaint frenético
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { codeInputRef.current?.focus(); }, []);

  // Map<id, estoque> derivado de produtos — O(1) lookup e dep estável
  // (mesma referência de Map só muda quando produtos muda).
  const estoqueMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of produtos) m.set(p.id, Number(p.estoque ?? 0));
    return m;
  }, [produtos]);

  // Estoque fresco no carrinho via realtime — só dispara setCart se algum
  // item realmente mudou. Antes, todo update de produtos criava novo array
  // de cart (mesmo sem mudança real) → re-render gratuito do PDV inteiro.
  useEffect(() => {
    if (estoqueMap.size === 0) return;
    setCart(prev => {
      let changed = false;
      const next = prev.map(ci => {
        const fresh = estoqueMap.get(ci.produto_id);
        if (fresh !== undefined && fresh !== ci.estoque) {
          changed = true;
          return { ...ci, estoque: fresh };
        }
        return ci;
      });
      return changed ? next : prev;
    });
  }, [estoqueMap]);

  // Filtro de disponibilidade pra venda no SuperMax:
  //  - status Ativo (ou ausente = legado)
  //  - tipo != patrimonio (patrimônio é gerido pelo Financeiro, não vende)
  //  - filial: SuperMax próprio OU Matriz (compartilhado entre unidades) OU
  //    sem filial setada (cadastros antigos / não migrados)
  // Sem isso, produtos cadastrados como "Matriz" (sem prefixo SM-) ficam de
  // fora — operador busca por nome ("feijão") e nada aparece/seleciona.
  const produtosDisponiveis = useMemo(() => produtos
    .filter((p: any) => (p.status === 'Ativo' || !p.status) && p.tipo !== 'patrimonio')
    .filter((p: any) => !p.filial || p.filial === filial || p.filial === 'Matriz'),
  [produtos]);

  const subtotal   = cart.reduce((s, i) => s + i.subtotal, 0);
  // desconto pode ser maior que subtotal se o operador errou — clampa pra
  // evitar totalFinal negativo (a RPC criar_venda_pdv rejeita valores < 0).
  const descontoAplicado = Math.min(desconto, subtotal);
  const totalFinal = Math.max(0, parseFloat((subtotal - descontoAplicado).toFixed(2)));
  const totalItens = cart.reduce((s, i) => s + i.qtd, 0);
  const totalPago  = pagamentos.reduce((s, p) => s + p.valor, 0);
  const restante   = Math.max(0, parseFloat((totalFinal - totalPago).toFixed(2)));
  const fmt = (n: number) => formatBRL(n);

  // Banner visível dentro do PDV (toast global tem z-50 e fica atrás do overlay
  // fullscreen z-100 — invisível). Aqui é a única mensagem que o operador vê.
  const flashError = useCallback((text: string) => {
    setCodeMsg({ type: 'err', text });
    setTimeout(() => setCodeMsg(null), 4000);
  }, []);

  // SEM validação — sempre adiciona, mesmo com campos faltando.
  // Se algum dia faltar id/estoque/preço, usa default seguro. Se algo der
  // errado mesmo assim, o erro fica visível no banner via try/catch.
  const addToCart = useCallback((produto: any, qtdAdd: number = 1) => {
    try {
      const id      = produto?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nome    = produto?.nome ?? '(sem nome)';
      const preco   = Number(produto?.preco) || 0;
      const eRaw    = produto?.estoque;
      const eNum    = (eRaw === null || eRaw === undefined || eRaw === '') ? 999 : Number(eRaw);
      const estoque = Number.isFinite(eNum) && eNum > 0 ? eNum : 999;
      let added: CartItem | null = null;
      setCart(prev => {
        const existing = prev.find(i => i.produto_id === id);
        if (existing) {
          const newQty = existing.qtd + qtdAdd;
          const novo = { ...existing, qtd: newQty, subtotal: newQty * existing.preco_unitario };
          added = novo;
          return prev.map(i => i.produto_id === id ? novo : i);
        }
        const novo: CartItem = {
          produto_id:     id,
          nome_produto:   nome,
          ean:            produto?.ean,
          codigo:         produto?.codigo,
          preco_unitario: preco,
          qtd:            qtdAdd,
          subtotal:       preco * qtdAdd,
          estoque,
          unidade:        produto?.unidade ?? 'UN',
        };
        added = novo;
        return [...prev, novo];
      });
      if (added) {
        setLastAdded(added);
        playScannerBeep();
      }
    } catch (err: any) {
      flashError(`addToCart THROW: ${err?.message ?? String(err)}`);
    }
  }, [flashError]);

  const removeFromCart = (produto_id: string) => {
    setCart(prev => prev.filter(i => i.produto_id !== produto_id));
    // Sem isso, sidebar ÚLTIMO ITEM LIDO continuava mostrando produto removido.
    setLastAdded(prev => (prev && prev.produto_id === produto_id ? null : prev));
  };

  const removeLast = () => {
    setCart(prev => prev.length === 0 ? prev : prev.slice(0, -1));
    setLastAdded(null);
  };

  const clearAll = () => {
    setCart([]);
    setLastAdded(null);
    setCode('');
    setSuggestionIdx(-1);
    setCashReceived('');
    setDesconto(0);
    setDiscountValue('');
    setPagamentos([]);
    setParcialValor('');
    setTrocoStash(0);
  };

  // Foco vai pro botão CONFIRMAR após adicionar pagamento. Tenta em rAF
  // (React 18 commit já rodou) com 1 retry pra cobrir caso de o botão ainda
  // estar disabled no primeiro tick (restante > 0 vira 0 no commit seguinte).
  const focusFecharVenda = () => {
    const tryFocus = (retry: boolean) => {
      const btn = document.querySelector<HTMLButtonElement>('[data-action="confirmar-venda"]');
      if (btn && !btn.disabled) { btn.focus(); return; }
      if (retry) requestAnimationFrame(() => tryFocus(false));
    };
    requestAnimationFrame(() => tryFocus(true));
  };

  // Suporta N*EAN ou N×EAN com decimal vírgula (ex: 0,350*7891)
  const processCode = useCallback((raw: string) => {
    const termo = raw.trim();
    if (!termo) return;
    let qtd = 1;
    let codigoBuscar = termo;
    const m = termo.match(/^([\d.,]+)\s*[*xX×]\s*(.+)$/);
    if (m) {
      const n = parseFloat(m[1].replace(',', '.'));
      if (n > 0) {
        qtd = n;
        codigoBuscar = m[2].trim();
      }
    }
    const lower = norm(codigoBuscar);
    let match = produtosDisponiveis.find((p: any) =>
      String(p.ean ?? '').trim() === codigoBuscar ||
      norm(p.codigo) === lower
    );
    if (!match) {
      const partial = produtosDisponiveis.filter((p: any) =>
        norm(p.nome).includes(lower) ||
        norm(p.codigo).includes(lower) ||
        String(p.ean ?? '').includes(codigoBuscar)
      );
      if (partial.length === 1) match = partial[0];
    }
    if (!match) {
      setCodeMsg({ type: 'err', text: `Produto não encontrado: ${codigoBuscar}` });
      setTimeout(() => setCodeMsg(null), 3000);
      return;
    }
    addToCart(match, qtd);
    setCode('');
    setSuggestionIdx(-1);
    codeInputRef.current?.focus();
  }, [produtosDisponiveis, addToCart]);

  // Busca completa (modal F8/F10) — sem cap de 2 chars; lista 50 primeiros se vazio.
  const filteredSearch = useMemo(() => {
    const t = norm(searchTerm.trim());
    if (!t) return produtosDisponiveis.slice(0, 50);
    const ean = searchTerm.trim();
    return produtosDisponiveis.filter((p: any) =>
      norm(p.nome).includes(t) ||
      norm(p.codigo).includes(t) ||
      String(p.ean ?? '').includes(ean)
    ).slice(0, 50);
  }, [searchTerm, produtosDisponiveis]);

  // Reseta seleção do search modal ao abrir / quando lista muda
  useEffect(() => {
    if (searchModalOpen) setSearchIdx(filteredSearch.length > 0 ? 0 : -1);
  }, [searchModalOpen, filteredSearch.length]);

  // Consulta de preço — mesma filtragem da busca F8/F10, listagem só leitura.
  const filteredPriceQuery = useMemo(() => {
    const t = norm(priceQueryTerm.trim());
    if (!t) return produtosDisponiveis.slice(0, 50);
    const ean = priceQueryTerm.trim();
    return produtosDisponiveis.filter((p: any) =>
      norm(p.nome).includes(t) ||
      norm(p.codigo).includes(t) ||
      String(p.ean ?? '').includes(ean)
    ).slice(0, 50);
  }, [priceQueryTerm, produtosDisponiveis]);

  useEffect(() => {
    if (priceQueryOpen) setPriceQueryIdx(filteredPriceQuery.length > 0 ? 0 : -1);
  }, [priceQueryOpen, filteredPriceQuery.length]);

  // Sugestões enquanto digita (só quando 2+ chars e não é padrão N*EAN).
  // Acento-insensível: "feijão" digitado casa com "FEIJAO" cadastrado e vice-versa.
  const suggestions = useMemo(() => {
    const t = norm(code.trim());
    if (!t || t.length < 2) return [];
    if (/^[\d.,]+\s*[*xX×]/.test(code)) return [];
    const ean = code.trim();
    return produtosDisponiveis.filter((p: any) =>
      norm(p.nome).includes(t) ||
      norm(p.codigo).includes(t) ||
      String(p.ean ?? '').includes(ean)
    ).slice(0, 8);
  }, [code, produtosDisponiveis]);

  // Mantém suggestionIdx coerente com a lista. Antes o onChange setava
  // sempre idx=0 mesmo sem sugestões — funcionava por sorte (guard em
  // handleCodeEnter), mas confundia leitura do código.
  useEffect(() => {
    setSuggestionIdx(prev => {
      if (suggestions.length === 0) return -1;
      if (prev < 0) return 0;
      if (prev >= suggestions.length) return suggestions.length - 1;
      return prev;
    });
  }, [suggestions.length]);

  const openPayment = useCallback(() => {
    // Idempotente — bloqueia F4 + clique simultâneo, ou clique duplo rápido.
    // Sem isso, dois RPCs criar_venda_pdv saem em paralelo (2 vendas, 2 PIX).
    if (cart.length === 0) {
      showToast?.('Carrinho vazio.', 'error', true);
      return;
    }
    if (isClosing || paymentModalOpen || cashModalOpen || !!pixModal || clientPickerOpen) return;
    // Sempre abre limpo — pagamentos parciais de venda anterior poderiam
    // vazar pra esta se o operador cancelou e voltou.
    setPagamentos([]);
    setParcialValor('');
    setPayChoiceIdx(0);
    setPaymentError(null);
    setPaymentModalOpen(true);
  }, [cart.length, isClosing, paymentModalOpen, cashModalOpen, pixModal, clientPickerOpen, showToast]);

  const cancelSale = useCallback(() => {
    if (cart.length === 0) return;
    setConfirmFocusIdx(0); // foco default = "Voltar" (mais seguro)
    setConfirmCancel(true);
  }, [cart.length]);

  const reallyCancelSale = () => {
    clearAll();
    setConfirmCancel(false);
    codeInputRef.current?.focus();
  };

  // Enter no campo CÓDIGO:
  //  1) vazio        → SUBTOTAL (fechar venda)
  //  2) idx >= 0     → adiciona a sugestão destacada (usuário usou ↑↓)
  //  3) match exato  → adiciona produto por EAN/código
  //  4) sugestões    → adiciona a primeira (resolve "FEIJÃO" com múltiplos)
  //  5) fallback     → processCode (trata N*EAN e mensagem de erro)
  const handleCodeEnter = () => {
    if (code.trim() === '') {
      if (cart.length > 0) openPayment();
      return;
    }
    if (suggestionIdx >= 0 && suggestions[suggestionIdx]) {
      addToCart(suggestions[suggestionIdx]);
      setCode('');
      setSuggestionIdx(-1);
      return;
    }
    const termo = code.trim();
    const lower = norm(termo);
    const exact = produtosDisponiveis.find((p: any) =>
      String(p.ean ?? '').trim() === termo ||
      norm(p.codigo) === lower
    );
    if (exact) {
      addToCart(exact);
      setCode('');
      setSuggestionIdx(-1);
      return;
    }
    if (suggestions.length > 0) {
      addToCart(suggestions[0]);
      setCode('');
      setSuggestionIdx(-1);
      return;
    }
    processCode(code);
  };

  // F-key listeners globais — só ativos fora de modais
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // isClosing entra aqui pra F4/F5/F8/F9 não dispararem ações novas durante
      // RPC pendente (evita dupla venda, dupla busca, etc.).
      const anyModal = paymentModalOpen || cashModalOpen || !!pixModal || clientPickerOpen || confirmCancel || !!changeModal || searchModalOpen || cardPickerOpen || priceQueryOpen || !!cashMoveModal || discountModalOpen || thankYouOpen || helpOpen || isClosing;

      if (e.key === 'F4' || e.key === 'F5') {
        e.preventDefault();
        if (!anyModal && cart.length > 0) openPayment();
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (!anyModal) cancelSale();
        return;
      }
      if (e.key === 'F8' || e.key === 'F10') {
        e.preventDefault();
        if (!anyModal) {
          setSearchTerm('');
          setSearchModalOpen(true);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (anyModal) return;
        // Se input tem texto, deixa o input limpar (a propria onKeyDown trata)
        if (document.activeElement === codeInputRef.current && code.length > 0) return;
        // Prioridade: sair do modo tela cheia antes de cancelar venda
        if (fullscreen) {
          e.preventDefault();
          setFullscreen(false);
          return;
        }
        if (cart.length > 0) cancelSale();
        return;
      }
      if (e.key === 'Delete') {
        if (anyModal) return;
        // Não come Delete quando o operador está editando um input/select
        const tgt = e.target as HTMLElement | null;
        const isEditable = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable);
        if (isEditable) return;
        e.preventDefault();
        removeLast();
        return;
      }
      // F7 — consulta de preço (não adiciona ao carrinho)
      if (e.key === 'F7') {
        e.preventDefault();
        if (!anyModal) {
          setPriceQueryTerm('');
          setPriceQueryOpen(true);
        }
        return;
      }
      // F6 — desconto no total (só faz sentido com itens)
      if (e.key === 'F6') {
        e.preventDefault();
        if (!anyModal && cart.length > 0) {
          setDiscountKind('percent');
          setDiscountValue('');
          setDiscountModalOpen(true);
        }
        return;
      }
      // F11 — suprimento (entrada) · F12 — sangria (saída)
      if (e.key === 'F11' || e.key === 'F12') {
        e.preventDefault();
        if (!anyModal) {
          if (!caixa) {
            showToast?.('Abra o caixa antes de movimentar dinheiro.', 'error', true);
            return;
          }
          setCashMoveValor('');
          setCashMoveMotivo('');
          setCashMoveModal({ tipo: e.key === 'F11' ? 'suprimento' : 'sangria' });
        }
        return;
      }
    };
    // capture:true garante que F4/F5/F8/F9 rodem ANTES de qualquer elemento
    // focado (select de filial no header, botão, etc.) tentar interpretar a
    // tecla. Sem capture, o navegador pode disparar comportamento default
    // (ex: F5 = recarregar página) antes de chegar aqui.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cart.length, paymentModalOpen, cashModalOpen, pixModal, clientPickerOpen, confirmCancel, changeModal, searchModalOpen, cardPickerOpen, priceQueryOpen, cashMoveModal, discountModalOpen, thankYouOpen, helpOpen, isClosing, code.length, fullscreen, caixa, openPayment, cancelSale, showToast]);

  // === FINALIZAR ===
  const finalizarVenda = async (forma: string, cidOverride?: string) => {
    if (!supabase) throw new Error('Supabase indisponível.');
    const cid = cidOverride !== undefined ? cidOverride : null;
    const itensPayload = cart.map(item => ({
      produto_id:     item.produto_id,
      nome_produto:   item.nome_produto,
      qtd:            item.qtd,
      preco_unitario: item.preco_unitario,
      subtotal:       item.subtotal,
    }));
    const { data: vendaId, error: rpcErr } = await supabase.rpc('criar_venda_pdv', {
      p_cliente_id:      cid,
      p_total:           subtotal,
      p_desconto:        descontoAplicado,
      p_total_final:     totalFinal,
      p_forma_pagamento: forma,
      p_parcelas:        1,
      p_itens:           itensPayload,
      p_filial:          filial,
      p_cupom_codigo:    null,
      p_cupom_desconto:  0,
    });
    if (rpcErr || !vendaId) throw new Error(rpcErr?.message ?? 'Falha ao registrar venda.');
    const shortId = String(vendaId).slice(-6).toUpperCase();
    setLastVenda({ id: shortId, total: totalFinal });
    playKaching();
    clearAll();
    // NÃO foca o código aqui — caller decide (changeModal → thankYou →
    // código, ou thankYou direto). Sem isso, o foco vazava pro código
    // antes do agradecimento renderizar e o usuário começava a digitar
    // por baixo do overlay.
  };

  // Checa se ainda existe caixa aberto pra esta filial hoje. Usado antes de
  // qualquer finalização — inclusive no callback do PIX (que pode demorar
  // minutos entre abrir o QR e o cliente pagar; nesse intervalo o gerente
  // pode ter fechado o caixa).
  const caixaAindaAberto = useCallback(async (): Promise<boolean> => {
    if (!supabase) return true;
    const today = todayBR();
    const { data } = await supabase
      .from('controle_caixa')
      .select('id')
      .eq('data', today)
      .eq('filial', filial)
      .eq('status', 'Aberto')
      .eq('ativo', true)
      .limit(1);
    return !!data && data.length > 0;
  }, []);

  // Concatena pagamentos em uma string única pra passar no p_forma_pagamento.
  // RPC criar_venda_pdv cai no ELSE genérico (status='Pago') quando a string
  // não bate em 'Cartão Crédito'/'Fiado'/'Cartão Crédito Nx' — exatamente o
  // que queremos pra venda já totalmente paga em múltiplas formas.
  const composeFormaMisto = (lista: PaymentLine[]): string => {
    if (lista.length <= 1) return lista[0]?.forma ?? '';
    const parts = lista.map(p => `${p.forma} R$ ${formatBRL(p.valor)}`);
    return `Misto: ${parts.join(' + ')}`;
  };

  const finalizarVendaMisto = async () => {
    if (pagamentos.length === 0) return;
    // Captura tudo do estado ANTES do await — clearAll() vai zerar.
    const forma = composeFormaMisto(pagamentos);
    const trocoFinal = trocoStash;
    const houveDinheiro = pagamentos.some(p => p.forma === 'Dinheiro');
    try {
      setIsClosing(true);
      setPaymentError(null);
      // SEM revalidação de caixa aqui — o caixa já foi validado em
      // handlePayChoice. O tempo entre cash modal e FECHAR VENDA é de
      // segundos; revalidar gera falso-negativo silencioso (toast some
      // atrás do overlay fullscreen z-100) e mata a venda.
      await finalizarVenda(forma);
      setPaymentModalOpen(false);
      // Sequência de feedback final: troco/exato (se aplicável) → agradecimento.
      // Cartão puro pula direto pro agradecimento (sem feedback redundante).
      if (trocoFinal > 0.001) setChangeModal({ amount: trocoFinal });
      else if (houveDinheiro) setChangeModal({ amount: 0 });
      else setThankYouOpen(true);
    } catch (err: any) {
      // Banner inline dentro do modal — toast global some atrás do overlay
      // fullscreen, e o operador ficava sem feedback nenhum.
      const msg = err?.message ?? String(err);
      setPaymentError(msg);
      showToast?.(`Erro ao fechar venda: ${msg}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  const handlePayChoice = async (forma: FormaPagamento) => {
    const parcial = parseBRL(parcialValor);
    const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
    if (valorDevido <= 0 && pagamentos.length > 0) return;

    // PIX e Fiado precisam de etapa assíncrona (realtime, picker de cliente)
    // e a RPC criar_venda_pdv trata cada um especificamente — então só
    // funcionam como pagamento único, na venda inteira.
    if (forma === 'PIX' || forma === 'Fiado') {
      if (pagamentos.length > 0 || (parcial > 0 && parcial < restante - 0.001)) {
        showToast?.(`${forma} não aceita pagamento parcial — use só como forma única.`, 'error', true);
        return;
      }
      setPaymentModalOpen(false);
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        showToast?.(`Caixa de ${filial} foi fechado. Abra em Financeiro → Controle de Caixa.`, 'error', true);
        await refreshCaixa();
        return;
      }
      if (forma === 'Fiado') { setClientPickerOpen(true); return; }
      // PIX — cria pendente, realtime finaliza quando MaxBank confirma.
      try {
        if (!supabase) throw new Error('Supabase indisponível.');
        setIsClosing(true);
        const { data: pendente, error: insErr } = await supabase
          .from('pix_pendentes')
          .insert({
            valor:       totalFinal,
            cliente_id:  null,
            status:      'aguardando',
            operador_id: user?.id ?? null,
          })
          .select('id, valor')
          .single();
        if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao gerar Pix.');
        setPixModal({ id: pendente.id, valor: Number(pendente.valor) });
      } catch (err: any) {
        showToast?.(`Erro PIX: ${err?.message ?? '—'}`, 'error', true);
      } finally {
        setIsClosing(false);
      }
      return;
    }

    // Dinheiro — abre cash modal pra recebido/troco. Confirmar do modal
    // adiciona à lista de pagamentos e foca FECHAR VENDA (não finaliza).
    if (forma === 'Dinheiro') {
      setCashReceived(formatBRL(valorDevido));
      setCashModalOpen(true);
      setTimeout(() => { cashInputRef.current?.focus(); cashInputRef.current?.select(); }, 50);
      return;
    }

    // Cartão Débito / Crédito — adiciona à lista e foca FECHAR VENDA. Sem
    // auto-finalize: operador confere a lista e confirma explicitamente.
    setPagamentos(prev => [...prev, { forma, valor: parseFloat(valorDevido.toFixed(2)) }]);
    setParcialValor('');
    focusFecharVenda();
  };

  // Cash modal não finaliza mais — adiciona Dinheiro à lista de pagamentos
  // e foca FECHAR VENDA. O troco vai pra stash; só é mostrado quando a
  // venda fechar de verdade (após operador apertar FECHAR VENDA).
  const handleCashConfirm = () => {
    const recebido = parseBRL(cashReceived);
    const parcial  = parseBRL(parcialValor);
    const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
    if (recebido < valorDevido - 0.001) {
      showToast?.(`Valor recebido (R$ ${formatBRL(recebido)}) menor que devido (R$ ${formatBRL(valorDevido)}).`, 'error', true);
      return;
    }
    const trocoDessaForma = recebido - valorDevido;
    setPagamentos(prev => [...prev, { forma: 'Dinheiro', valor: parseFloat(valorDevido.toFixed(2)) }]);
    setTrocoStash(t => t + trocoDessaForma);
    setParcialValor('');
    setCashReceived('');
    setCashModalOpen(false);
    focusFecharVenda();
  };

  const handleFiadoConfirm = async (cid: string) => {
    setClientPickerOpen(false);
    try {
      setIsClosing(true);
      await finalizarVenda('Fiado', cid);
      setThankYouOpen(true);
    } catch (err: any) {
      showToast?.(`Erro Fiado: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  // PIX realtime — finaliza venda quando MaxBank confirma
  useEffect(() => {
    if (!pixModal || !supabase) return;
    const channel = supabase
      .channel(`smx_pix_${pixModal.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pix_pendentes', filter: `id=eq.${pixModal.id}` },
        async (payload: any) => {
          if (payload?.new?.status !== 'pago') return;
          // Cliente pagou mas o caixa fechou no meio tempo — não dá pra registrar
          // a venda. Avisa o operador (com persist:true) pra que ele estorne
          // manualmente no MaxBank ou abra o caixa de novo antes de tentar.
          const aberto = await caixaAindaAberto();
          if (!aberto) {
            showToast?.(`PIX pago mas caixa de ${filial} foi fechado. Estorne no MaxBank ou reabra o caixa e refaça a venda.`, 'error', true);
            setPixModal(null);
            return;
          }
          try {
            await finalizarVenda('PIX');
            setPixModal(null);
            setThankYouOpen(true);
          } catch (err: any) {
            showToast?.(`Pagamento confirmado mas falhou venda: ${err?.message ?? '—'}`, 'error', true);
            setPixModal(null);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixModal]);

  // Confirma cancelamento — UPDATE pode falhar (rede caiu, RLS rejeitou). Sem
  // try/catch, modal fechava e pix_pendentes ficava 'aguardando' eternamente.
  // Suprimento/Sangria — chama RPC registrar_movimentacao_caixa.
  // RBAC do RPC: vendas/financeiro. Operador SuperMax tem setor vendas.
  const handleCashMoveConfirm = async () => {
    if (!cashMoveModal || !caixa || !supabase) return;
    const valor = parseBRL(cashMoveValor);
    if (valor <= 0) {
      showToast?.('Valor deve ser maior que zero.', 'error', true);
      return;
    }
    const motivo = cashMoveMotivo.trim() || null;
    try {
      setIsClosing(true);
      const { error } = await supabase.rpc('registrar_movimentacao_caixa', {
        p_controle_id: caixa.id,
        p_tipo:        cashMoveModal.tipo,
        p_valor:       valor,
        p_motivo:      motivo,
      });
      if (error) throw error;
      const label = cashMoveModal.tipo === 'suprimento' ? 'Suprimento registrado' : 'Sangria registrada';
      showToast?.(`${label}: R$ ${formatBRL(valor)}`, 'success');
      setCashMoveModal(null);
      setCashMoveValor('');
      setCashMoveMotivo('');
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  const cancelarPix = async () => {
    if (!pixModal || !supabase) {
      setConfirmPixCancel(false);
      setPixModal(null);
      return;
    }
    const pixId = pixModal.id;
    try {
      const { error } = await supabase
        .from('pix_pendentes')
        .update({ status: 'cancelado' })
        .eq('id', pixId);
      if (error) throw error;
    } catch (err: any) {
      showToast?.(`Falha ao cancelar PIX (${err?.message ?? '—'}). Verifique em pix_pendentes.`, 'error', true);
    } finally {
      setConfirmPixCancel(false);
      setPixModal(null);
    }
  };

  const clientesFiltrados = useMemo(() => {
    const t = clientSearch.trim().toLowerCase();
    return (clientes ?? []).filter((c: any) =>
      !t || (c.nome ?? '').toLowerCase().includes(t)
    ).slice(0, 30);
  }, [clientes, clientSearch]);

  // Reseta seleção do picker quando abre ou quando a lista muda
  useEffect(() => {
    if (clientPickerOpen) setClientIdx(clientesFiltrados.length > 0 ? 0 : -1);
  }, [clientPickerOpen, clientesFiltrados.length]);

  // Foco inicial do payment modal — SÓ ao abrir, no primeiro forma button.
  // ANTES esse effect rodava em cada mudança de payChoiceIdx, e como cada
  // onMouseEnter chama setPayChoiceIdx, qualquer hover do mouse re-focava
  // o card de forma — roubando o foco do FECHAR VENDA depois de confirmar
  // um pagamento. User apertava Enter esperando finalizar e disparava o
  // forma button (que fazia early return porque restante=0). Sintoma:
  // "Dinheiro/Cartão não funciona, fechar venda não faz nada".
  useEffect(() => {
    if (!paymentModalOpen) return;
    const id = setTimeout(() => payBtnRefs.current[0]?.focus(), 0);
    return () => clearTimeout(id);
  }, [paymentModalOpen]);

  // Foca o FECHAR VENDA quando pagamentos.length aumenta — substitui o
  // focusFecharVenda manual (que dependia de timing de rAF e podia ser
  // roubado pelo effect acima).
  useEffect(() => {
    if (!paymentModalOpen || pagamentos.length === 0) return;
    const id = setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-action="confirmar-venda"]');
      if (btn && !btn.disabled) btn.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [pagamentos.length, paymentModalOpen]);

  const operadorNome = (profile?.nome ?? user?.email ?? '—').toUpperCase();
  // nowTick é dep só pra forçar recálculo a cada 30s
  const datetime = useMemo(() => new Date().toLocaleString('pt-BR'), [nowTick]);

  // Classe do container raiz — fullscreen sobrepõe o app shell (sidebar+topbar).
  const rootClass = fullscreen ? 'fixed inset-0 z-[100]' : 'h-full';

  // === RENDER ===
  if (caixaLoading || loadingProd) {
    return (
      <div className={`${rootClass} flex items-center justify-center bg-gray-100`}>
        <Loader2 className="animate-spin" size={32} style={{ color: NAVY_DARK }} />
      </div>
    );
  }

  if (!caixa) {
    return (
      <div className={`flex flex-col ${rootClass}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif', background: '#f3f4f6' }}>
        <Header
          operadorNome={operadorNome}
          cupomSeq={cupomSeq}
          caixaAberto={false}
          datetime={datetime}
          onSwitchFilial={onSwitchFilial}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(f => !f)}
          onOpenHelp={() => setHelpOpen(true)}
        />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-white border-4 shadow-2xl p-8 text-center" style={{ borderColor: RED }}>
            <Lock size={48} className="mx-auto mb-4" style={{ color: RED }} />
            <h2 className="text-2xl font-black uppercase tracking-wide" style={{ color: NAVY_DARK }}>Caixa fechado</h2>
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">
              O caixa do <b>SuperMax</b> não está aberto hoje. Abra em <b>Financeiro → Controle de Caixa</b> antes de operar vendas.
            </p>
            <button onClick={() => refreshCaixa()} className="mt-6 px-6 py-3 text-white font-black uppercase tracking-wide text-sm" style={{ background: NAVY_DARK }}>
              Verificar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex flex-col ${rootClass}`}
      style={{ fontFamily: 'Arial, Helvetica, sans-serif', background: '#f3f4f6' }}
      onKeyDown={(e) => {
        // Trava TAB dentro do PDV: ao chegar no último focável, volta pro
        // primeiro; ao Shift+Tab no primeiro, vai pro último. Operador nunca
        // escapa pra barra do navegador nem pra outros apps da página.
        if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
      }}
    >
      <Header
        operadorNome={operadorNome}
        cupomSeq={cupomSeq}
        caixaAberto={true}
        datetime={datetime}
        onSwitchFilial={onSwitchFilial}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen(f => !f)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {/* Tabela de itens + sidebar */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-300">
          <div
            className="grid grid-cols-[70px_160px_1fr_80px_130px_150px_40px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
            style={{ background: NAVY_DARK }}
          >
            <div>ITEM</div>
            <div>CÓDIGO</div>
            <div>DESCRIÇÃO</div>
            <div className="text-right">QTD</div>
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
                className={`grid grid-cols-[70px_160px_1fr_80px_130px_150px_40px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b border-gray-200 ${idx === cart.length - 1 ? 'bg-yellow-50' : ''}`}
              >
                <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
                <div className="text-gray-500 truncate">{item.ean || item.codigo || '—'}</div>
                <div className="truncate font-semibold flex items-center gap-2">
                  <span className="truncate">{(item.nome_produto || '').toUpperCase()}</span>
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
                <div className="text-right">{item.qtd}</div>
                <div className="text-right">{fmt(item.preco_unitario)}</div>
                <div className="text-right font-bold">{fmt(item.subtotal)}</div>
                <button
                  onClick={() => removeFromCart(item.produto_id)}
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
                  {lastAdded.qtd} {(lastAdded.unidade || '').toLowerCase()} × R$ {fmt(lastAdded.preco_unitario)}
                </div>
                <div className="text-6xl font-bold tabular-nums mt-1" style={{ color: MONEY }}>
                  R$ {fmt(lastAdded.subtotal)}
                </div>
              </>
            ) : (
              <div className="h-32" />
            )}
          </div>
          <div className="px-5 py-5 flex-1 space-y-3 text-lg">
            <div className="flex justify-between">
              <span className="text-gray-600">QTD. ITENS</span>
              <span className="tabular-nums font-bold text-gray-900">{totalItens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">SUBTOTAL</span>
              <span className="tabular-nums font-bold text-gray-900">R$ {fmt(subtotal)}</span>
            </div>
            {descontoAplicado > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">DESCONTO</span>
                <span className="tabular-nums font-bold" style={{ color: RED }}>− R$ {fmt(descontoAplicado)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra TOTAL A PAGAR */}
      <div className="px-6 py-4 flex items-center justify-between border-t-2 shrink-0 bg-gray-100" style={{ borderColor: YELLOW_DARK }}>
        <span className="text-3xl font-bold tracking-wide text-gray-700">TOTAL A PAGAR</span>
        <span className="text-7xl font-bold tabular-nums leading-none" style={{ color: NAVY_DARK }}>
          R$ {fmt(totalFinal)}
        </span>
      </div>

      {/* Linha CÓDIGO */}
      <div className="px-6 py-2 shrink-0 border-t border-gray-300 bg-white">
        {codeMsg && codeMsg.type === 'err' && (
          <div className="mb-1.5 px-3 py-1 text-sm font-bold inline-block border" style={{ background: '#fee2e2', color: RED, borderColor: '#fca5a5' }}>
            {codeMsg.text}
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-gray-700 shrink-0">CÓDIGO:</span>
          <div className="relative">
            <input
              ref={codeInputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCodeEnter();
                } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
                  e.preventDefault();
                  setSuggestionIdx(prev => Math.min(prev + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                  e.preventDefault();
                  setSuggestionIdx(prev => Math.max(prev - 1, 0));
                } else if (e.key === 'Escape' && code.length > 0) {
                  e.preventDefault();
                  setCode('');
                  setSuggestionIdx(-1);
                }
              }}
              onBlur={() => {
                // refoca se o foco caiu no body (clique fora sem alvo)
                setTimeout(() => {
                  const ae = document.activeElement;
                  if (!ae || ae === document.body) codeInputRef.current?.focus();
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
                    onClick={() => { addToCart(p); setCode(''); setSuggestionIdx(-1); codeInputRef.current?.focus(); }}
                    onMouseEnter={() => setSuggestionIdx(idx)}
                    ref={(el) => {
                      // Foco DOM segue suggestionIdx pra Tab/Arrow não dessincronizar
                      // o highlight amarelo do que está visualmente selecionado.
                      if (el && idx === suggestionIdx) el.scrollIntoView({ block: 'nearest' });
                    }}
                    className={`w-full grid grid-cols-[150px_1fr_120px] gap-3 text-left px-3 py-2 text-sm border-b border-gray-200 focus:outline-none ${idx === suggestionIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                  >
                    <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                    <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                    <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(Number(p.preco ?? 0))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={cancelSale}
            disabled={cart.length === 0}
            className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-700"
            style={{ background: RED }}
            title="Cancelar venda (F9)"
          >
            CANCELAR VENDA
          </button>
          <button
            onClick={openPayment}
            disabled={cart.length === 0 || isClosing}
            className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
            style={{ background: MONEY }}
            title="Fechar venda (F4/F5 ou Enter no campo vazio)"
          >
            {isClosing ? <Loader2 size={20} className="animate-spin inline" /> : 'FECHAR VENDA'}
          </button>
        </div>
      </div>

      {/* Rodapé amarelo F-keys */}
      <div className="px-6 py-2 shrink-0 border-t-2" style={{ background: YELLOW, borderColor: YELLOW_DARK }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-black tracking-wide">
          <span className="px-2 py-0.5 rounded text-white font-bold" style={{ background: NAVY_DARK }}>
            Enter (campo vazio) = SUBTOTAL
          </span>
          <span className="opacity-40">·</span>
          <span><b>F4</b> / <b>F5</b> Subtotal</span>
          <span className="opacity-40">·</span>
          <span><b>F8</b> / <b>F10</b> Buscar produto</span>
          <span className="opacity-40">·</span>
          <span><b>Del</b> Cancelar último item</span>
          <span className="opacity-40">·</span>
          <span><b>F9</b> Cancelar venda · <b>Esc</b> Sair tela cheia</span>
          <span className="opacity-40">·</span>
          <span><b>N*EAN</b> ou <b>N×EAN</b> Qtd (decimal: <b>0,350*EAN</b>)</span>
          <span className="opacity-40">·</span>
          <span><b>F6</b> Desconto</span>
          <span className="opacity-40">·</span>
          <span><b>F7</b> Consulta preço</span>
          <span className="opacity-40">·</span>
          <span><b>F11</b> Suprimento · <b>F12</b> Sangria</span>
        </div>
      </div>

      {/* === MODAIS === */}

      {/* Forma de pagamento — nav por teclado: ↑↓←→ ou Tab/Shift+Tab, F1/F2/F3 atalho, Enter confirma o botão focado */}
      {paymentModalOpen && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              // Em misto com pagamentos lançados, Esc não fecha direto — limpa
              // os pagamentos primeiro. Operador aperta Esc de novo pra sair.
              if (pagamentos.length > 0) {
                setPagamentos([]);
                setParcialValor('');
                setTrocoStash(0);
                return;
              }
              setPaymentModalOpen(false);
              return;
            }
            // Misto pronto + Enter = finaliza. Se foco está num input ou botão,
            // deixa o evento nativo cuidar.
            if (e.key === 'Enter' && pagamentos.length > 0 && restante <= 0.001 && !isClosing) {
              const tgt = e.target as HTMLElement | null;
              const isEditable = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
              if (!isEditable && tgt?.tagName !== 'BUTTON') {
                e.preventDefault(); e.stopPropagation();
                finalizarVendaMisto();
                return;
              }
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              e.preventDefault(); e.stopPropagation();
              const next = (payChoiceIdx + 1) % FORMAS_PAGAMENTO.length;
              setPayChoiceIdx(next);
              payBtnRefs.current[next]?.focus();
              return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              e.preventDefault(); e.stopPropagation();
              const next = (payChoiceIdx - 1 + FORMAS_PAGAMENTO.length) % FORMAS_PAGAMENTO.length;
              setPayChoiceIdx(next);
              payBtnRefs.current[next]?.focus();
              return;
            }
            // F1/F2 funcionam mesmo em misto (Dinheiro/Cartão aceitam parcial).
            // F3 (PIX) só fora do misto — PIX é forma única.
            const mistoActive = pagamentos.length > 0 || parseBRL(parcialValor) > 0;
            if (e.key === 'F1') { e.preventDefault(); e.stopPropagation(); handlePayChoice('Dinheiro'); return; }
            if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); setCardPickerIdx(0); setCardPickerOpen(true); return; }
            if (e.key === 'F3' && !mistoActive) { e.preventDefault(); e.stopPropagation(); handlePayChoice('PIX'); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-2xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Total a pagar</div>
                <div className="text-3xl font-black tabular-nums">R$ {fmt(totalFinal)}</div>
              </div>
              {pagamentos.length > 0 && (
                <div className="text-right">
                  <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Restante</div>
                  <div className="text-3xl font-black tabular-nums" style={{ color: restante <= 0.001 ? '#22c55e' : YELLOW }}>R$ {fmt(restante)}</div>
                </div>
              )}
              <button onClick={() => setPaymentModalOpen(false)} className="text-white p-1" tabIndex={-1}><X size={20} /></button>
            </div>

            {paymentError && (
              <div className="mx-6 mt-4 px-3 py-2 border-2 text-sm font-bold" style={{ background: '#fee2e2', borderColor: RED, color: RED }}>
                Erro ao fechar venda: {paymentError}
              </div>
            )}

            {/* Misto: input parcial + lista de pagamentos lançados */}
            <div className="px-6 pt-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                Valor desta forma <span className="text-gray-400 normal-case font-medium">(vazio = restante · PIX e Fiado só como forma única)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={parcialValor}
                onChange={(e) => setParcialValor(formatBRL(parseBRL(e.target.value)))}
                onKeyDown={(e) => {
                  // Esc limpa só o input — NÃO deve fechar modal nem limpar
                  // pagamentos. Sem stopPropagation, o handler do payment modal
                  // pega e bagunça tudo.
                  if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    setParcialValor('');
                  }
                  if (/^F\d+$/.test(e.key)) e.stopPropagation();
                }}
                placeholder={`Restante: ${fmt(restante)}`}
                className="w-full border-2 text-xl font-black tabular-nums px-3 py-1.5 outline-none focus:border-blue-700"
                style={{ borderColor: '#9ca3af', color: NAVY_DARK, fontFamily: 'Consolas, "Courier New", monospace' }}
              />
              {pagamentos.length > 0 && (
                <div className="mt-3 border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
                  <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: NAVY_DARK }}>
                    Pagamentos lançados
                  </div>
                  {pagamentos.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-sm border-b last:border-b-0 border-gray-200">
                      <span className="font-bold">{p.forma}</span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums font-bold" style={{ color: MONEY }}>R$ {fmt(p.valor)}</span>
                        <button
                          tabIndex={-1}
                          onClick={() => setPagamentos(prev => prev.filter((_, i) => i !== idx))}
                          className="w-6 h-6 flex items-center justify-center text-white rounded hover:brightness-110"
                          style={{ background: RED }}
                          title="Remover este pagamento"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 pt-4 grid grid-cols-2 gap-3">
              {([
                ['Dinheiro',       Banknote,    'F1'],
                ['Cartão Débito',  CreditCard,  'F2'],
                ['Cartão Crédito', CreditCard,  'F2'],
                ['PIX',            Wallet,      'F3'],
                ['Fiado',          UsersIcon,   ''],
              ] as const).map(([forma, Icon, hint], i) => {
                const active = i === payChoiceIdx;
                // PIX e Fiado só funcionam como forma única (sem parcial),
                // por causa de realtime / RPC que cria conta_receber pelo
                // valor cheio. Dinheiro e Cartão D/C aceitam misto.
                const parcial = parseBRL(parcialValor);
                const isMistoActive = pagamentos.length > 0 || (parcial > 0 && parcial < restante - 0.001);
                const isPixOrFiado = forma === 'PIX' || forma === 'Fiado';
                const isDisabled = isMistoActive && isPixOrFiado;
                return (
                  <button
                    key={forma}
                    ref={(el) => { payBtnRefs.current[i] = el; }}
                    disabled={isDisabled}
                    onClick={() => handlePayChoice(forma as FormaPagamento)}
                    onFocus={() => setPayChoiceIdx(i)}
                    onMouseEnter={() => setPayChoiceIdx(i)}
                    title={isDisabled ? `${forma} só funciona como forma única — limpe os pagamentos lançados pra usar` : undefined}
                    className={`relative border-2 px-4 py-5 flex flex-col items-center gap-2 font-black uppercase tracking-wide transition focus:outline-none ${active && !isDisabled ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'} ${isDisabled ? 'opacity-30 cursor-not-allowed' : ''}`}
                    style={{ borderColor: active && !isDisabled ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active && !isDisabled ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                  >
                    <Icon size={28} />
                    <span>{forma}</span>
                    {hint && (
                      <span className="absolute top-1 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', color: NAVY_DARK }}>
                        {hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Botão FECHAR VENDA — aparece após o 1º pagamento, ativo quando restante=0 */}
            {pagamentos.length > 0 && (
              <div className="px-6 pb-4">
                <button
                  data-action="confirmar-venda"
                  onClick={finalizarVendaMisto}
                  disabled={restante > 0.001 || isClosing}
                  className="w-full px-6 py-4 text-white font-black uppercase tracking-wide text-lg disabled:opacity-30 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
                  style={{ background: MONEY }}
                >
                  {isClosing
                    ? <><Loader2 size={20} className="animate-spin" /> Finalizando...</>
                    : restante > 0.001
                      ? `Faltam R$ ${fmt(restante)} para finalizar`
                      : 'FECHAR VENDA (Enter)'}
                </button>
              </div>
            )}

            <div className="px-6 pb-4 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
              ↑↓←→ navegar · Enter confirmar · Esc voltar · F1 Dinheiro · F2 Cartão · F3 PIX
            </div>
          </div>
        </div>
      )}

      {/* Dinheiro com cálculo de troco — em misto, valorDevido = parcial */}
      {cashModalOpen && (() => {
        const parcial = parseBRL(parcialValor);
        const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
        const recebido = parseBRL(cashReceived);
        const trocoLocal = Math.max(0, recebido - valorDevido);
        return (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            // Bloqueia F-keys vazarem
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Dinheiro</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">
                {valorDevido < totalFinal - 0.001 ? `Parcial R$ ${fmt(valorDevido)} de ${fmt(totalFinal)}` : `Total R$ ${fmt(totalFinal)}`}
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor recebido</label>
                <input
                  ref={cashInputRef}
                  type="text"
                  inputMode="numeric"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(formatBRL(parseBRL(e.target.value)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault(); e.stopPropagation();
                      handleCashConfirm();
                    } else if (e.key === 'Escape') {
                      e.preventDefault(); e.stopPropagation();
                      setCashModalOpen(false);
                    }
                  }}
                  placeholder="0,00"
                  className="w-full border-2 text-4xl font-black tabular-nums px-4 py-3 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                />
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-bold uppercase tracking-widest text-gray-600">Troco</span>
                <span className="text-3xl font-black tabular-nums" style={{ color: MONEY }}>
                  R$ {fmt(trocoLocal)}
                </span>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setCashModalOpen(false)} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
                  Voltar
                </button>
                <button
                  onClick={handleCashConfirm}
                  disabled={recebido < valorDevido - 0.001 || isClosing}
                  className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ background: MONEY }}
                >
                  {isClosing ? <><Loader2 size={16} className="animate-spin" /> Confirmando...</> : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Troco / Pagamento exato em tela cheia — Enter fecha + abre agradecimento */}
      {changeModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: changeModal.amount > 0 ? NAVY_DARK : MONEY }}
          tabIndex={-1}
          ref={(el) => { if (el && changeModal) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
              e.preventDefault(); e.stopPropagation();
              setChangeModal(null);
              setThankYouOpen(true);
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="text-center text-white">
            {changeModal.amount > 0 ? (
              <>
                <div className="text-2xl font-bold uppercase tracking-[0.3em] opacity-80 mb-4">Troco a entregar</div>
                <div className="text-9xl font-black tabular-nums leading-none" style={{ color: YELLOW }}>
                  R$ {fmt(changeModal.amount)}
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold uppercase tracking-[0.3em] opacity-90 mb-4">Pagamento</div>
                <div className="text-9xl font-black uppercase leading-none">EXATO</div>
                <div className="mt-4 text-xl font-bold uppercase tracking-widest opacity-90">Sem troco a entregar</div>
              </>
            )}
            <button
              onClick={() => { setChangeModal(null); setThankYouOpen(true); }}
              className="mt-12 px-10 py-4 text-white font-black uppercase tracking-wide text-lg border-2"
              style={{ background: changeModal.amount > 0 ? MONEY : NAVY_DARK, borderColor: 'white' }}
              autoFocus
            >
              OK · Enter
            </button>
          </div>
        </div>
      )}

      {/* Manual do PDV — passo a passo + tabela de atalhos */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}
          tabIndex={-1}
          ref={(el) => { if (el && helpOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHelpOpen(false); }
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
              <button onClick={() => setHelpOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center border-2 hover:bg-white/40" style={{ borderColor: NAVY_DARK, color: NAVY_DARK }} aria-label="Fechar">
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
                    Para quantidade, digite <b>N*EAN</b> (ex: <code>3*7891</code>) ou peso decimal <b>0,350*EAN</b>.
                  </li>
                  <li>
                    <b>Conferir.</b> A última leitura aparece destacada na barra lateral direita.
                    Pra remover o último item: <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Del</kbd>.
                    Pra remover qualquer item: clique no <span className="inline-flex items-center justify-center w-5 h-5 text-white rounded text-xs" style={{ background: RED }}><X size={11} /></span> da linha.
                  </li>
                  <li>
                    <b>Subtotal / fechar venda.</b> Com o carrinho montado, aperte <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>Enter</kbd> no campo CÓDIGO vazio, ou <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F4</kbd>/<kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F5</kbd>, ou clique <b>FECHAR VENDA</b>.
                  </li>
                  <li>
                    <b>Escolher forma de pagamento.</b> Use <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F1</kbd> Dinheiro, <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F2</kbd> Cartão (abre picker Crédito/Débito), <kbd className="px-1.5 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F3</kbd> PIX, ou setas + Enter pra Fiado.
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
                    ['F4 / F5', 'Subtotal — abre o modal de pagamento.'],
                    ['F6', 'Desconto no total (% ou R$).'],
                    ['F7', 'Consulta de preço (não adiciona ao carrinho).'],
                    ['F8 / F10', 'Buscar produto por nome ou código.'],
                    ['F9', 'Cancelar venda (pede confirmação).'],
                    ['F11', 'Suprimento — entrada de dinheiro no caixa.'],
                    ['F12', 'Sangria — retirada de dinheiro do caixa.'],
                    ['Del', 'Remove o último item do carrinho.'],
                    ['↑ ↓', 'Navega nas sugestões enquanto digita.'],
                    ['Esc', 'Limpa o campo / sai da tela cheia / cancela venda.'],
                    ['N*EAN', 'Quantidade do mesmo item (ex: 3*7891 ou 0,350*7891 pra peso).'],
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
                    ['F2', 'Cartão — abre picker Crédito / Débito.'],
                    ['F3', 'PIX — gera QR Code (só como forma única).'],
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

              {/* Dicas */}
              <section>
                <h3 className="text-base font-black uppercase tracking-wider mb-3 pb-2 border-b-2" style={{ color: NAVY_DARK, borderColor: YELLOW_DARK }}>
                  Boas práticas
                </h3>
                <ul className="space-y-2 list-disc list-inside" style={{ color: '#374151' }}>
                  <li>Antes de operar, garanta que o <b>caixa está aberto</b> em Financeiro → Controle de Caixa. O badge verde no header confirma.</li>
                  <li>Badge <span className="px-1.5 py-0.5 text-[10px] font-black uppercase rounded border" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' }}>Ruptura</span> aparece quando a quantidade vendida supera o estoque — confira o produto antes de fechar.</li>
                  <li>Pra deixar dinheiro no caixa (troco inicial, reforço): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F11</kbd>. Pra retirar (depósito, pagto fornecedor): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F12</kbd> — sempre registrando o motivo.</li>
                  <li><b>PIX/Fiado não aceitam pagamento parcial</b>. Pra dividir entre formas, use Dinheiro + Cartão.</li>
                  <li>Pra alternar entre filiais (SuperMax/MaxLook/TechMax) sem perder o turno, use o seletor no header.</li>
                </ul>
              </section>
            </div>

            <div className="px-6 py-3 border-t-2 text-xs font-bold uppercase tracking-wider text-center shrink-0" style={{ borderColor: YELLOW_DARK, background: '#f9fafb', color: NAVY_DARK }}>
              Esc fecha · Tab preso dentro do modal
            </div>
          </div>
        </div>
      )}

      {/* Agradecimento — tela final supermercado (só fecha com Enter) */}
      {thankYouOpen && (
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.98)' }}
          tabIndex={-1}
          ref={(el) => { if (el && thankYouOpen) el.focus(); }}
          onKeyDown={(e) => {
            // Só Enter fecha — Esc/Space/clique ignorados pra evitar fechar
            // sem o cliente ter visto. Todo resto do teclado fica preso pra
            // não vazar pro PDV atrás.
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              setThankYouOpen(false);
              // Limpa o toast 'Venda concluída' — a tela de agradecimento já
              // é o feedback principal; sem isso o card ficava no canto da
              // tela pra sempre, até o operador clicar o X.
              setLastVenda(null);
              setTimeout(() => codeInputRef.current?.focus(), 50);
            } else {
              e.stopPropagation();
            }
          }}
        >
          <div className="flex flex-col items-center justify-center text-center px-8 py-6 max-h-screen w-full">
            <img
              src="/icon-supermax.png"
              alt="SuperMax"
              className="object-contain drop-shadow-2xl"
              style={{ maxHeight: '60vh', maxWidth: '70vw', width: 'auto', height: 'auto' }}
              draggable={false}
            />
            <div className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-wide shrink-0" style={{ color: NAVY_DARK }}>
              Agradecemos a sua preferência
            </div>
            <div
              className="mt-5 px-6 py-3 rounded-full text-sm md:text-base font-black uppercase tracking-[0.3em] animate-pulse shrink-0"
              style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
            >
              Pressione ENTER para continuar
            </div>
          </div>
        </div>
      )}

      {/* Cliente picker (Fiado) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {clientPickerOpen && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase">Fiado · Selecione o cliente</span>
              <button onClick={() => setClientPickerOpen(false)} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              <input
                autoFocus
                type="text"
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setClientIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setClientPickerOpen(false); return; }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setClientIdx(i => Math.min(i + 1, clientesFiltrados.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setClientIdx(i => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = clientesFiltrados[clientIdx >= 0 ? clientIdx : 0];
                    if (pick) handleFiadoConfirm(pick.id);
                    return;
                  }
                }}
                placeholder="Buscar cliente por nome..."
                className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
                style={{ borderColor: '#9ca3af' }}
              />
              <div className="max-h-96 overflow-y-auto space-y-1">
                {clientesFiltrados.length === 0 ? (
                  <div className="text-center text-gray-500 py-4 text-sm">Nenhum cliente encontrado.</div>
                ) : clientesFiltrados.map((c: any, i: number) => {
                  const active = i === clientIdx;
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleFiadoConfirm(c.id)}
                      onMouseEnter={() => setClientIdx(i)}
                      tabIndex={-1}
                      ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                      className={`w-full text-left px-3 py-2 border-2 font-bold ${active ? 'bg-yellow-100' : 'hover:bg-yellow-50'}`}
                      style={{ borderColor: active ? NAVY_DARK : '#e5e7eb' }}
                    >
                      {c.nome}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                ↑↓ navegar · Enter selecionar · Esc voltar
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIX aguardando — Esc pede confirmação (não cancela direto) */}
      {pixModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && pixModal && !confirmPixCancel) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape' && !confirmPixCancel) {
              e.preventDefault(); e.stopPropagation();
              setConfirmPixCancel(true);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Aguardando pagamento</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">PIX</div>
            </div>
            <div className="p-6 space-y-4 text-center">
              {/* QR didático — payload tem id+valor; o MaxBank lê e marca
                  como 'pago', daí o realtime fecha a venda. Não é PIX real
                  (BR Code do BACEN), só simulação pedagógica. */}
              <div className="flex justify-center">
                <div className="p-3 bg-white border-4" style={{ borderColor: NAVY_DARK }}>
                  <QRCodeSVG
                    value={`logmax-pix:${pixModal.id}:${pixModal.valor.toFixed(2)}`}
                    size={220}
                    level="M"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-gray-600 mb-1">Valor</div>
                <div className="text-4xl font-black tabular-nums" style={{ color: MONEY }}>
                  R$ {fmt(pixModal.valor)}
                </div>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                Cliente lê o QR no <b>MaxBank</b>. A venda fecha sozinha quando o pagamento for confirmado.
              </p>
              <button
                onClick={() => setConfirmPixCancel(true)}
                className="w-full px-4 py-3 border-2 text-gray-700 font-bold uppercase text-sm tracking-wide"
                style={{ borderColor: '#9ca3af' }}
              >
                Cancelar PIX
              </button>
            </div>
          </div>

          {/* Sub-modal: confirma cancelamento — protege contra Esc por engano */}
          {confirmPixCancel && (
            <div
              className="fixed inset-0 z-[215] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.85)' }}
              tabIndex={-1}
              ref={(el) => { if (el && confirmPixCancel) el.focus(); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmPixCancel(false); return; }
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cancelarPix(); return; }
                if (/^F\d+$/.test(e.key)) e.stopPropagation();
              }}
            >
              <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: RED }}>
                <div className="px-5 py-4 text-white" style={{ background: RED }}>
                  <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Confirmar</div>
                  <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar PIX?</div>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Se o cliente já confirmou o pagamento no MaxBank, este cancelamento <b>não estorna</b> o valor — é só do nosso lado. Continue só se o cliente desistiu.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmPixCancel(false)}
                      autoFocus
                      className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                      style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                    >
                      Voltar (Esc)
                    </button>
                    <button
                      onClick={cancelarPix}
                      className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
                      style={{ background: RED }}
                    >
                      Cancelar PIX (Enter)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmar cancelar venda — ← → escolher · Enter confirma · Esc volta */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && confirmCancel) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmCancel(false); return; }
            if (e.key === 'Tab') {
              e.preventDefault(); e.stopPropagation();
              setConfirmFocusIdx(i => (i === 0 ? 1 : 0));
              return;
            }
            if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setConfirmFocusIdx(0); return; }
            if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setConfirmFocusIdx(1); return; }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              if (confirmFocusIdx === 1) reallyCancelSale();
              else setConfirmCancel(false);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: RED }}>
            <div className="px-5 py-4 text-white" style={{ background: RED }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Confirmar</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar venda?</div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Todos os {cart.length} item(s) serão removidos do carrinho. Esta ação não pode ser desfeita.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmCancel(false)}
                  onMouseEnter={() => setConfirmFocusIdx(0)}
                  className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm ${confirmFocusIdx === 0 ? 'bg-gray-100' : ''}`}
                  style={{ borderColor: confirmFocusIdx === 0 ? NAVY_DARK : '#9ca3af', color: NAVY_DARK, boxShadow: confirmFocusIdx === 0 ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                >
                  Voltar
                </button>
                <button
                  onClick={reallyCancelSale}
                  onMouseEnter={() => setConfirmFocusIdx(1)}
                  className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
                  style={{ background: RED, boxShadow: confirmFocusIdx === 1 ? `inset 0 0 0 2px white` : undefined }}
                >
                  Cancelar venda
                </button>
              </div>
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                ← → escolher · Enter confirmar · Esc voltar
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Busca de produto (F8/F10) — ↑↓ navega · Enter adiciona · Esc fecha */}
      {searchModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSearchModalOpen(false); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="w-full max-w-4xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase flex items-center gap-2">
                <Search size={16} /> F8/F10 · Busca de produtos
              </span>
              <button onClick={() => setSearchModalOpen(false)} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
            </div>
            <div className="p-4">
              <input
                autoFocus
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setSearchIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setSearchModalOpen(false); return; }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchIdx(i => Math.min(i + 1, filteredSearch.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchIdx(i => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = filteredSearch[searchIdx >= 0 ? searchIdx : 0];
                    if (pick) {
                      addToCart(pick);
                      setSearchModalOpen(false);
                      codeInputRef.current?.focus();
                    }
                    return;
                  }
                }}
                placeholder="Nome, código ou EAN do produto..."
                className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                style={{ borderColor: '#9ca3af' }}
              />
              <div className="mt-3 max-h-[55vh] overflow-y-auto border border-gray-300">
                {filteredSearch.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
                ) : filteredSearch.map((p: any, i: number) => {
                  const active = i === searchIdx;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { addToCart(p); setSearchModalOpen(false); codeInputRef.current?.focus(); }}
                      onMouseEnter={() => setSearchIdx(i)}
                      tabIndex={-1}
                      ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                      className={`w-full grid grid-cols-[150px_1fr_120px] gap-3 text-left py-2 px-3 text-sm border-b border-gray-200 ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                    >
                      <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                      <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                      <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(Number(p.preco ?? 0))}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                ↑↓ navegar · Enter adicionar · Esc voltar
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Consulta de preço (F7) — read-only, não adiciona ao carrinho */}
      {priceQueryOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPriceQueryOpen(false); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="w-full max-w-3xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase">F7 · Consulta de preço</span>
              <button onClick={() => setPriceQueryOpen(false)} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
            </div>
            <div className="p-4">
              <input
                autoFocus
                value={priceQueryTerm}
                onChange={(e) => { setPriceQueryTerm(e.target.value); setPriceQueryIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setPriceQueryOpen(false); return; }
                  if (e.key === 'ArrowDown') { e.preventDefault(); setPriceQueryIdx(i => Math.min(i + 1, filteredPriceQuery.length - 1)); return; }
                  if (e.key === 'ArrowUp')   { e.preventDefault(); setPriceQueryIdx(i => Math.max(i - 1, 0)); return; }
                }}
                placeholder="Nome, código ou EAN do produto..."
                className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                style={{ borderColor: '#9ca3af' }}
              />
              <div className="mt-3 max-h-[55vh] overflow-y-auto border border-gray-300">
                {filteredPriceQuery.length === 0 ? (
                  <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
                ) : filteredPriceQuery.map((p: any, i: number) => {
                  const active = i === priceQueryIdx;
                  return (
                    <div
                      key={p.id}
                      onMouseEnter={() => setPriceQueryIdx(i)}
                      ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }}
                      className={`grid grid-cols-[150px_1fr_120px_120px] gap-3 py-2 px-3 text-sm border-b border-gray-200 ${active ? 'bg-yellow-100' : ''}`}
                    >
                      <span className="tabular-nums text-gray-500 truncate">{p.codigo || p.ean || '—'}</span>
                      <span className="truncate font-semibold text-gray-900">{(p.nome || '').toUpperCase()}</span>
                      <span className="text-right tabular-nums text-gray-600">Est: {Number(p.estoque ?? 0)}</span>
                      <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(Number(p.preco ?? 0))}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                ↑↓ navegar · Esc fechar · Consulta não adiciona ao carrinho
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Picker de cartão (F2 no payment modal) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {cardPickerOpen && (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          tabIndex={-1}
          ref={(el) => { if (el && cardPickerOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCardPickerOpen(false); return; }
            if (e.key === 'Tab') {
              e.preventDefault(); e.stopPropagation();
              setCardPickerIdx(i => (i === 0 ? 1 : 0));
              return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              e.preventDefault(); e.stopPropagation();
              setCardPickerIdx(i => (i === 0 ? 1 : 0));
              return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              e.preventDefault(); e.stopPropagation();
              setCardPickerIdx(i => (i === 0 ? 1 : 0));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              const forma: FormaPagamento = cardPickerIdx === 0 ? 'Cartão Crédito' : 'Cartão Débito';
              setCardPickerOpen(false);
              handlePayChoice(forma);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F2 · Cartão</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Crédito ou Débito?</div>
            </div>
            <div className="p-6 space-y-3">
              {(['Cartão Crédito', 'Cartão Débito'] as const).map((forma, idx) => {
                const active = idx === cardPickerIdx;
                return (
                  <button
                    key={forma}
                    onClick={() => { setCardPickerOpen(false); handlePayChoice(forma); }}
                    onMouseEnter={() => setCardPickerIdx(idx as 0 | 1)}
                    className={`w-full border-2 px-4 py-4 flex items-center gap-3 font-black uppercase tracking-wide text-left ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                    style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                  >
                    <CreditCard size={22} />
                    <span>{forma}</span>
                  </button>
                );
              })}
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center pt-2">
                ↑↓ navegar · Enter selecionar · Esc voltar
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desconto (F6) — % ou R$ aplicado no total · Enter aplica · Esc cancela */}
      {discountModalOpen && (() => {
        const parsed = parseBRL(discountValue);
        const valorReais = discountKind === 'percent'
          ? parseFloat(((subtotal * parsed) / 100).toFixed(2))
          : parsed;
        const valorClamp = Math.min(valorReais, subtotal);
        const novoTotal = Math.max(0, subtotal - valorClamp);
        const aplicar = () => {
          if (valorClamp <= 0) { showToast?.('Informe um desconto maior que zero.', 'error', true); return; }
          setDesconto(valorClamp);
          setDiscountModalOpen(false);
        };
        return (
          <div
            className="fixed inset-0 z-[195] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDiscountModalOpen(false); }
              if (e.key === '%') { e.preventDefault(); setDiscountKind('percent'); }
              if (e.key === '$') { e.preventDefault(); setDiscountKind('reais'); }
              if (/^F\d+$/.test(e.key)) e.stopPropagation();
            }}
          >
            <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
              <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
                <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F6 · Desconto no total</div>
                <div className="text-2xl font-black tracking-wide mt-0.5">Subtotal R$ {fmt(subtotal)}</div>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiscountKind('percent')}
                    className={`flex-1 px-3 py-2 border-2 font-black uppercase tracking-wide text-sm ${discountKind === 'percent' ? 'bg-yellow-100' : ''}`}
                    style={{ borderColor: discountKind === 'percent' ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK }}
                  >
                    % Percentual
                  </button>
                  <button
                    onClick={() => setDiscountKind('reais')}
                    className={`flex-1 px-3 py-2 border-2 font-black uppercase tracking-wide text-sm ${discountKind === 'reais' ? 'bg-yellow-100' : ''}`}
                    style={{ borderColor: discountKind === 'reais' ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK }}
                  >
                    R$ Valor
                  </button>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">
                    {discountKind === 'percent' ? 'Percentual (0-100)' : 'Valor em R$'}
                  </label>
                  <input
                    autoFocus
                    type="text"
                    inputMode="numeric"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(formatBRL(parseBRL(e.target.value)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); aplicar(); }
                      if (e.key === 'Escape') { e.preventDefault(); setDiscountModalOpen(false); }
                    }}
                    placeholder="0,00"
                    className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                  />
                </div>
                <div className="border-2 px-3 py-2 bg-gray-50" style={{ borderColor: '#e5e7eb' }}>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Desconto aplicado</span>
                    <span className="font-bold tabular-nums" style={{ color: RED }}>− R$ {fmt(valorClamp)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold mt-1">
                    <span>Novo total</span>
                    <span className="tabular-nums" style={{ color: MONEY }}>R$ {fmt(novoTotal)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setDesconto(0); setDiscountModalOpen(false); }} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
                    {desconto > 0 ? 'Remover' : 'Voltar'}
                  </button>
                  <button onClick={aplicar} className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm" style={{ background: NAVY_DARK }}>
                    Aplicar (Enter)
                  </button>
                </div>
                <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                  Atalhos: % percentual · $ valor R$
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Suprimento (F11) / Sangria (F12) — Enter confirma · Esc fecha */}
      {cashMoveModal && (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCashMoveModal(null); }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: cashMoveModal.tipo === 'suprimento' ? MONEY : RED }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">
                {cashMoveModal.tipo === 'suprimento' ? 'F11 · Entrada de dinheiro' : 'F12 · Saída de dinheiro'}
              </div>
              <div className="text-2xl font-black tracking-wide mt-0.5">
                {cashMoveModal.tipo === 'suprimento' ? 'Suprimento' : 'Sangria'}
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={cashMoveValor}
                  onChange={(e) => setCashMoveValor(formatBRL(parseBRL(e.target.value)))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCashMoveConfirm(); }
                    if (e.key === 'Escape') { e.preventDefault(); setCashMoveModal(null); }
                  }}
                  placeholder="0,00"
                  className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">
                  Motivo {cashMoveModal.tipo === 'sangria' ? '(obrigatório registrar onde foi)' : '(opcional)'}
                </label>
                <input
                  type="text"
                  value={cashMoveMotivo}
                  onChange={(e) => setCashMoveMotivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCashMoveConfirm(); }
                    if (e.key === 'Escape') { e.preventDefault(); setCashMoveModal(null); }
                  }}
                  placeholder={cashMoveModal.tipo === 'sangria' ? 'Depósito no banco, pagto fornecedor...' : 'Troco inicial, reforço...'}
                  className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCashMoveModal(null)} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
                  Voltar
                </button>
                <button
                  onClick={handleCashMoveConfirm}
                  disabled={parseBRL(cashMoveValor) <= 0 || isClosing}
                  className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ background: cashMoveModal.tipo === 'suprimento' ? MONEY : RED }}
                >
                  {isClosing ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : 'Confirmar (Enter)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast venda concluída */}
      {lastVenda && (
        <div className="fixed bottom-6 right-6 z-[150] bg-white border-4 shadow-2xl p-4 min-w-[280px]" style={{ borderColor: MONEY }}>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full" style={{ background: '#dcfce7' }}>
              <DollarSign size={20} style={{ color: MONEY }} />
            </div>
            <div className="flex-1">
              <div className="text-xs font-black uppercase tracking-widest text-gray-600">Venda concluída</div>
              <div className="font-mono text-xs text-gray-500 mt-0.5">#{lastVenda.id}</div>
              <div className="text-2xl font-black tabular-nums mt-1" style={{ color: MONEY }}>
                R$ {fmt(lastVenda.total)}
              </div>
            </div>
            <button onClick={() => setLastVenda(null)} className="text-gray-400 hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const Header = ({
  operadorNome, cupomSeq, caixaAberto, datetime, onSwitchFilial, fullscreen, onToggleFullscreen, onOpenHelp,
}: {
  operadorNome: string;
  cupomSeq: string;
  caixaAberto: boolean;
  datetime: string;
  onSwitchFilial?: (filial: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenHelp: () => void;
}) => (
  <div
    className="px-4 py-3 flex items-center justify-between shrink-0 border-b-2 gap-3"
    style={{ background: YELLOW, borderColor: YELLOW_DARK }}
  >
    <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
      <span
        className="text-3xl tracking-wide font-black shrink-0"
        style={{ color: NAVY_DARK, textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
      >
        SUPERMAX
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        CAIXA 01
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border truncate max-w-[260px]" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        OP: {operadorNome}
      </span>
      <span className="shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        CUPOM: {cupomSeq}
      </span>
      <span className="hidden lg:inline-flex shrink-0 px-3 py-1.5 rounded-md text-sm font-bold tabular-nums border" style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}>
        {datetime}
      </span>
      {caixaAberto && (
        <span className="shrink-0 px-2.5 py-1.5 rounded-md text-xs font-black uppercase tracking-wider border-2 inline-flex items-center gap-1" style={{ background: MONEY, color: 'white', borderColor: '#14532d' }}>
          CAIXA ABERTO
        </span>
      )}
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {onSwitchFilial && (
        <select
          onChange={(e) => { if (e.target.value && e.target.value !== 'SuperMax') onSwitchFilial(e.target.value); }}
          value="SuperMax"
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 bg-white outline-none"
          style={{ color: NAVY_DARK, borderColor: NAVY_DARK }}
          title="Trocar para outra filial"
        >
          <option value="SuperMax">Filial: SuperMax</option>
          <option value="MaxLook">→ MaxLook</option>
          <option value="TechMax">→ TechMax</option>
        </select>
      )}
      <button
        type="button"
        onClick={onToggleFullscreen}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2"
        style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
        title={fullscreen ? 'Sair tela cheia (Esc)' : 'Entrar em tela cheia'}
        aria-label={fullscreen ? 'Sair tela cheia' : 'Entrar em tela cheia'}
      >
        {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
      <button
        type="button"
        onClick={onOpenHelp}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2 hover:brightness-110"
        style={{ background: NAVY_DARK, color: YELLOW, borderColor: NAVY_DARK }}
        title="Manual do PDV"
        aria-label="Manual do PDV"
      >
        <HelpCircle size={20} />
      </button>
    </div>
  </div>
);
