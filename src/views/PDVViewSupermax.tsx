import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { codigoCobranca } from '../lib/cobranca';
import {
  X, Loader2, Lock, CreditCard, Wallet, Banknote, Users as UsersIcon, HelpCircle,
  Maximize2, Minimize2, Search, FileDown, PauseCircle, Calculator, Receipt,
  Pencil, Trash2, DollarSign,
} from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { ehVendavel } from '../lib/tipoProduto';
import type { CaixaAberto } from '../hooks/useCaixaAberto';
import { PDVFecharCaixa } from '../components/PDVFecharCaixa';
import { useAuth } from '../hooks/useAuth';
import { useVarrerPendentesOrfaos } from '../hooks/usePendentesOrfaos';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { supabase, criarClienteEfemero } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { formatBRL, parseBRL, gerarReciboVendaPDF } from '../lib/viewUtils';
import { consultarCreditoCliente, bloqueioFiado } from '../lib/credito';
import { buildPixQrValue, buildCartaoQrValue } from '../lib/pixQr';
import { playScannerBeep, playKaching } from '../utils/audioUtils';
import { normalizarBusca as norm, produtoCasa, buscarProdutos, separarQtdETermo } from '../lib/produtoBusca';
import { UNIDADES_FRACIONARIAS, normalizarUnidade } from '../lib/unidades';

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

type FormaPagamento = 'Dinheiro' | 'Cartão Débito' | 'Cartão Crédito' | 'Fiado' | 'PIX' | 'Vale-Alimentação';

// O que fazer quando o MaxBank autorizar a maquininha: fechar a venda inteira
// ('venda', cartão como forma única) ou devolver o valor como uma linha da
// lista do pagamento misto ('linha').
type DestinoCartao = 'venda' | 'linha';

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

const FORMAS_PAGAMENTO: FormaPagamento[] = ['Dinheiro', 'Cartão Crédito', 'Cartão Débito', 'PIX', 'Vale-Alimentação', 'Fiado'];

// CPF/CNPJ na nota: só dígitos no banco (migr. 574), máscara só na tela.
const mascararDocumento = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

// Busca de produto (prefixo, acento-insensível) vive em lib/produtoBusca.ts —
// compartilhada com PDVView.tsx. `norm` segue em uso aqui para outras buscas
// da tela, como a de clientes.

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
  // Filtrado por filial (+ Matriz, pra cadastros legados sem prefixo SM-) na
  // própria query — não deixa produto de MaxLook/TechMax trafegar pro browser
  // do operador SuperMax. Filtro client-side abaixo (produtosDisponiveis)
  // continua como rede de segurança pro caso raro de filial nula.
  const { data: produtos, isLoading: loadingProd } = useFetchData<any>('/api/produtosview', { filial: [filial, 'Matriz'] }, true);
  const { data: clientes } = useFetchData<any>('/api/crmview', { filial });

  // Cobranças abandonadas da SuperMax (Pix e cartão). Até agora só o PDV de
  // MaxLook/TechMax varria, e só Pix — a SuperMax acumulava as duas coisas.
  useVarrerPendentesOrfaos(filial, user?.id, showToast);

  const [code, setCode]                 = useState('');
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [lastAdded, setLastAdded]       = useState<CartItem | null>(null);
  const [isClosing, setIsClosing]       = useState(false);
  const [lastVenda, setLastVenda]       = useState<{
    id: string;
    total: number;
    subtotal: number;
    desconto: number;
    forma: string;
    cliente: string | null;
    cpfNota?: string | null;
    economia?: number;
    itens: { nome_produto: string; qtd: number; preco_unitario: number; subtotal: number }[];
  } | null>(null);
  const [codeMsg, setCodeMsg]           = useState<{ type: 'err'; text: string } | null>(null);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [cashModalOpen, setCashModalOpen]       = useState(false);
  const [cashReceived, setCashReceived]         = useState('');
  const [changeModal, setChangeModal]           = useState<{ amount: number } | null>(null);
  const [pixModal, setPixModal]                 = useState<{ id: string; valor: number } | null>(null);
  // `destino` diz o que fazer quando o MaxBank autorizar: 'venda' fecha a
  // venda inteira (cartão como forma única), 'linha' devolve o valor como um
  // pagamento da lista do misto.
  const [cartaoModal, setCartaoModal]           = useState<{ id: string; valor: number; metodo: 'debito' | 'credito'; parcelas: number; destino: DestinoCartao } | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch]         = useState('');
  const [confirmCancel, setConfirmCancel]       = useState(false);

  // Modo tela cheia (overlay sobre app shell + tela cheia do navegador).
  // Default ON ao entrar no PDV. ESC sai do modo tela cheia; F9/botão vermelho
  // seguem cancelando venda.
  const [fullscreen, setFullscreen] = useState(true);
  // Sem isto o overlay cobria só a shell, e a barra do navegador e a do
  // sistema continuavam ocupando a tela do caixa.
  // Tela cheia e SO overlay CSS (rootClass): o PDV cobre sidebar e topbar.
  // Com a Fullscreen API do navegador, o Esc do operador era consumido por ele
  // pra sair da tela cheia — quem so queria voltar da operacao perdia a tela.
  // Quem quiser esconder tambem a barra do navegador usa o F11 do proprio
  // navegador, que nao rouba o Esc do PDV.

  // Índices de seleção por teclado nos modais (Arrow keys + Enter).
  const [payChoiceIdx, setPayChoiceIdx]       = useState(0);
  const [confirmFocusIdx, setConfirmFocusIdx] = useState<0 | 1>(0);
  const [clientIdx, setClientIdx]             = useState(-1);

  // Busca por nome/código (F8) — replica o classicSearch do MaxPOS.
  // Quantidade ARMADA — a régua do caixa de mercado: o operador informa quantos
  // são ANTES de identificar o item ("2*" e Enter), e a próxima identificação
  // — bipe, código digitado, sugestão ou item escolhido no F8 — vale por essa
  // quantidade. Antes o `N*` só funcionava colado a um código, então quem não
  // tinha o código na mão (nem leitor) só conseguia vender 2 do mesmo produto
  // adicionando duas vezes.
  const [qtdArmada, setQtdArmada] = useState<number | null>(null);
  const qtdArmadaRef = useRef<number | null>(null);
  qtdArmadaRef.current = qtdArmada;

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
  const [confirmCartaoCancel, setConfirmCartaoCancel] = useState(false);
  // PIX pago no MaxBank mas criar_venda_pdv falhou — modal segura erro
  // visível com retry, em vez de fechar e mostrar toast que some atrás
  // do overlay (sintoma: PIX pago no banco mas sem venda no LogMax).
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixProcessing, setPixProcessing] = useState(false);
  const pixHandledRef = useRef(false);

  // Consulta de preço (F7) — read-only, não adiciona ao carrinho.
  const [priceQueryOpen, setPriceQueryOpen] = useState(false);
  const [priceQueryTerm, setPriceQueryTerm] = useState('');
  const [priceQueryIdx, setPriceQueryIdx]   = useState(0);

  // Suprimento (F11) / Sangria (F12) — entrada/saída de dinheiro no caixa.
  const [cashMoveModal, setCashMoveModal] = useState<{ tipo: 'suprimento' | 'sangria' } | null>(null);
  const [cashMoveValor, setCashMoveValor] = useState('');
  const [cashMoveMotivo, setCashMoveMotivo] = useState('');

  // Fechar/Suspender caixa pelo operador (F3)
  const [caixaOpModal, setCaixaOpModal] = useState<'fechar' | 'suspender' | null>(null);
  const [caixaOpValor, setCaixaOpValor] = useState('');
  const [caixaOpObs, setCaixaOpObs] = useState('');

  // Desconto (F6) — % ou R$ aplicado no total da venda atual.
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountKind, setDiscountKind]   = useState<'percent' | 'reais'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [desconto, setDesconto]           = useState(0);

  // Pagamento misto — lista de pagamentos lançados até cobrir o totalFinal.
  // Sem migration na RPC: forma_pagamento concatena 'Misto: X+Y'. Fiado
  // fica bloqueado no misto (gera conta_receber pelo valor cheio, não
  // pelo parcial — incoerente sem refactor do RPC).
  // troco fica gravado na linha do Dinheiro (não em stash agregado), pra
  // que remover uma linha decremente o troco corretamente. `parcelas` vale
  // também dentro do misto desde a migr. 415 — a parte do crédito vira conta
  // a receber parcelada pela RPC `pdv_registrar_credito_misto`.
  type PaymentLine = { forma: Exclude<FormaPagamento, 'Fiado'>; valor: number; troco?: number; parcelas?: number };
  const [pagamentos, setPagamentos] = useState<PaymentLine[]>([]);
  const [parcialValor, setParcialValor] = useState('');
  // Editar o valor de um pagamento ja lancado sem remover e refazer (padrao
  // MaxPOS). Linha de dinheiro COM troco fica fora: o troco foi calculado
  // sobre o valor antigo e nao guardamos quanto o cliente entregou.
  const [editPagIdx, setEditPagIdx] = useState<number | null>(null);
  const [editPagValor, setEditPagValor] = useState('');

  // Extras do fechamento — os mesmos do MaxPOS, onde a turma treina:
  // documento na nota, cliente vinculado a qualquer venda (não só ao Fiado) e
  // Vale-Alimentação como forma. Sem eles o aluno aprendia um fechamento que
  // não existia aqui.
  const [cpfNota, setCpfNota] = useState('');          // só dígitos
  const [cpfModalOpen, setCpfModalOpen] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  const [clienteVinculado, setClienteVinculado] = useState<{ id: string; nome: string } | null>(null);
  // O picker de cliente serve a dois donos: escolher o pagador do Fiado
  // (finaliza a venda) e vincular cliente (só carimba a venda).
  const [clientPickerModo, setClientPickerModo] = useState<'fiado' | 'vincular'>('fiado');
  const [valeModal, setValeModal] = useState<{ valor: number } | null>(null);
  const [valeDigitos, setValeDigitos] = useState('');

  // Abertura do caixa PELO OPERADOR, na própria tela do PDV (padrão de
  // supermercado e do MaxPOS, onde a turma treina). Antes o PDV só dizia
  // "abra em Financeiro → Controle de Caixa": o operador começava o dia numa
  // tela que não é dele. A RLS de `controle_caixa` já autorizava o setor
  // vendas na própria unidade — só a tela não oferecia.
  // Gancheira: UMA venda suspensa por vez, como no MaxPOS. Serve pro cliente
  // que voltou pra buscar o que esqueceu — a fila anda em vez de esperar.
  const [vendaSuspensa, setVendaSuspensa] = useState<{
    cart: CartItem[];
    desconto: number;
    cpfNota: string;
    clienteVinculado: { id: string; nome: string } | null;
    suspensaEm: string;
  } | null>(null);
  const [confirmSuspender, setConfirmSuspender] = useState(false);

  // Ofertas vigentes da unidade (view `v_promocao_vigente`, migr. 575). A
  // aprovação da promoção já trocou `produtos.preco` pelo promocional (migr.
  // 402) — o que falta no caixa é o "de", que mora na promoção. Sem isto o
  // operador não sabe que o item está em oferta e o cliente não vê a economia.
  const [ofertas, setOfertas] = useState<Map<string, { de: number; por: number }>>(new Map());

  // Desconto no caixa de supermercado não é decisão do operador: ele existe
  // para divergência de etiqueta e avaria, e sai com a senha do gerente da
  // unidade (é o "desconto supervisionado" dos PDVs de mercado). O motivo fica
  // gravado na venda — desconto sem motivo é buraco de margem sem dono.
  const [descAuth, setDescAuth] = useState<{ valor: number } | null>(null);
  const [descAuthEmail, setDescAuthEmail] = useState('');
  const [descAuthSenha, setDescAuthSenha] = useState('');
  const [descAuthMotivo, setDescAuthMotivo] = useState('Divergência de preço na gôndola');
  const [descAuthObs, setDescAuthObs] = useState('');
  const [descAuthLoading, setDescAuthLoading] = useState(false);
  const [descontoAutorizacao, setDescontoAutorizacao] = useState<{ por: string; motivo: string } | null>(null);

  const [aberturaValor, setAberturaValor] = useState('');
  const [aberturaObs, setAberturaObs] = useState('');
  const [abrindoCaixa, setAbrindoCaixa] = useState(false);

  // Parcelamento Cartão Crédito (1x-12x) — só pergunta quando Crédito é
  // forma única; em misto cai no ELSE genérico da RPC e parcelas é ignorado.
  const [parcelasModalOpen, setParcelasModalOpen] = useState(false);
  const [parcelasIdx, setParcelasIdx] = useState(0);

  // Modal do recibo — exibe resumo da venda + download PDF antes do agradecimento.
  const [reciboModalOpen, setReciboModalOpen] = useState(false);

  // Tela de agradecimento — pisa em cima após recibo. Só fecha com Enter.
  const [thankYouOpen, setThankYouOpen] = useState(false);

  // Erro inline do payment modal — toast global some atrás do fullscreen.
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Modal de ajuda — manual passo-a-passo + tabela de teclas.
  const [helpOpen, setHelpOpen] = useState(false);

  // Picker F3 (PIX / Fiado) — padrão do card picker F2. Navegação por ↑↓ + Enter.
  const [payerPickerOpen, setPayerPickerOpen] = useState(false);
  const [payerPickerIdx, setPayerPickerIdx]   = useState(0);

  // Seleção de item no carrinho por ↑↓ (Del apaga selecionado). -1 = último item.
  const [selectedCartIdx, setSelectedCartIdx] = useState<number>(-1);

  // Reimpressão (Ctrl+R) — últimas N vendas concluídas da filial nesta sessão.
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintList, setReprintList] = useState<Array<{ id: string; created_at: string; total_final: number; forma_pagamento: string }>>([]);
  const [reprintIdx, setReprintIdx]   = useState(0);
  const [reprintLoading, setReprintLoading] = useState(false);
  const sessionStartRef = useRef<string>(new Date().toISOString());

  const [cupomSeq]   = useState(() => String(Date.now()).slice(-6));
  const [nowTick, setNowTick] = useState(0);
  const codeInputRef   = useRef<HTMLInputElement>(null);
  const codeNativeRef  = useRef('');
  // `limpoEm` existe por causa do Enter que o leitor manda DEPOIS dos dígitos:
  // quando o auto-add do buffer já consumiu o código e limpou o campo, esse
  // Enter chega num campo vazio — e Enter vazio é "fechar venda". O operador
  // via o modal de pagamento abrir sozinho no meio do bipe, e daí em diante o
  // leitor lia para dentro do modal (é o "lê e não adiciona").
  const scanBufferRef  = useRef({ chars: '' as string, lastTime: 0, timer: 0 as any, limpoEm: 0 });
  const cashInputRef   = useRef<HTMLInputElement>(null);
  const payBtnRefs   = useRef<(HTMLButtonElement | null)[]>([]);
  // Campo VALOR DESTA FORMA: e o foco de entrada do modal de pagamento.
  const parcialInputRef = useRef<HTMLInputElement>(null);
  const cartRef              = useRef(cart);
  cartRef.current            = cart;
  // Último caixa aberto conhecido — segura a árvore de render de pé se o
  // hook devolver null por um instante (hiccup de rede/RLS) no meio de uma
  // cobrança. Ver caixaAtivo, antes do RENDER.
  const ultimoCaixaRef       = useRef(caixa);
  const finalizarVendaRef    = useRef<(forma: string, cidOverride?: string, parcelas?: number, dinheiroEmEspecie?: number) => Promise<string>>(null!);

  // Relógio do header — atualiza a cada 30s, evita repaint frenético
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Carrinho e gancheira são trabalho não gravado que não tem campo na tela:
  // o reload automático da PWA não pode passar por cima nem de um nem do outro.
  useTravaAtualizacao(cart.length > 0 || vendaSuspensa !== null, 'venda-pdv-supermax',
    'há uma venda aberta ou suspensa no caixa');

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('v_promocao_vigente')
        .select('produto_id, preco_de, preco_por')
        .eq('filial', filial);
      if (!vivo) return;
      if (error) {
        // Oferta é informação de vitrine: se a consulta falhar, o PDV segue
        // vendendo pelo preço do catálogo (que já é o promocional).
        console.warn('[PDV] Não foi possível carregar as ofertas vigentes:', error.message);
        return;
      }
      const mapa = new Map<string, { de: number; por: number }>();
      for (const o of data ?? []) {
        mapa.set(String(o.produto_id), { de: Number(o.preco_de ?? 0), por: Number(o.preco_por ?? 0) });
      }
      setOfertas(mapa);
    })();
    return () => { vivo = false; };
  }, [filial]);

  useEffect(() => { codeInputRef.current?.focus(); }, []);

  // Se o carrinho encolheu, reseta seleção pra não ficar apontando pra idx inválido
  useEffect(() => {
    if (selectedCartIdx >= cart.length) setSelectedCartIdx(-1);
  }, [cart.length, selectedCartIdx]);

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

  // Filtro de disponibilidade pra venda no SuperMax: só produtos da própria
  // filial. Fallback anterior (Matriz + null-filial) foi removido junto com
  // o UNIQUE global de produtos.codigo: agora dois produtos ativos podem ter
  // "001" em filiais distintas, e o match por código em processCode/scanner
  // não teria como escolher o certo.
  const produtosDisponiveis = useMemo(() => produtos
    .filter((p: any) => (p.status === 'Ativo' || !p.status) && ehVendavel(p.tipo))
    .filter((p: any) => p.filial === filial),
  [produtos, filial]);

  const subtotal   = cart.reduce((s, i) => s + i.subtotal, 0);
  // desconto pode ser maior que subtotal se o operador errou — clampa pra
  // evitar totalFinal negativo (a RPC criar_venda_pdv rejeita valores < 0).
  const descontoAplicado = Math.min(desconto, subtotal);
  const totalFinal = Math.max(0, parseFloat((subtotal - descontoAplicado).toFixed(2)));
  // Só é oferta se o "de" for maior que o preço que está sendo cobrado — o
  // preço do catálogo é a fonte da verdade da venda, a promoção só explica.
  const ofertaDoItem = (produto_id: string, precoCobrado: number) => {
    const o = ofertas.get(produto_id);
    return o && o.de > precoCobrado + 0.001 ? o : null;
  };
  // Economia do cupom: a diferença entre o preço de tabela e o cobrado, item a
  // item. É o número que a rede imprime no rodapé do cupom.
  const economiaOfertas = cart.reduce((s, i) => {
    const o = ofertaDoItem(i.produto_id, i.preco_unitario);
    return o ? s + (o.de - i.preco_unitario) * i.qtd : s;
  }, 0);
  const totalItens = cart.reduce((s, i) => s + i.qtd, 0);
  const totalPago  = pagamentos.reduce((s, p) => s + p.valor, 0);
  const restante   = Math.max(0, parseFloat((totalFinal - totalPago).toFixed(2)));
  const fmt = (n: number) => formatBRL(n);
  // Quantidade na tela: 2 e não "2,000"; 0,350 mantém o peso.
  const fmtQtd = (n: number) => Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { minimumFractionDigits: 3 });

  // Banner visível dentro do PDV (toast global tem z-50 e fica atrás do overlay
  // fullscreen z-100 — invisível). Aqui é a única mensagem que o operador vê.
  const flashError = useCallback((text: string) => {
    setCodeMsg({ type: 'err', text });
    setTimeout(() => setCodeMsg(null), 4000);
  }, []);

  // Consumir o código = limpar o campo E desarmar o bipe pendente. Os dois
  // juntos, sempre: era o timer que sobrevivia ao Enter do leitor que fazia o
  // mesmo item entrar duas vezes (o Enter adicionava e limpava o campo, e 120ms
  // depois o timer ainda tinha o código no buffer e adicionava de novo).
  const consumirCodigo = useCallback(() => {
    const buf = scanBufferRef.current;
    clearTimeout(buf.timer);
    buf.chars = '';
    buf.limpoEm = performance.now();
    setCode('');
    codeNativeRef.current = '';
    setSuggestionIdx(-1);
  }, []);

  // SEM validação — sempre adiciona, mesmo com campos faltando.
  // Se algum dia faltar id/estoque/preço, usa default seguro. Se algo der
  // errado mesmo assim, o erro fica visível no banner via try/catch.
  const addToCart = useCallback((produto: any, qtdExplicita?: number) => {
    try {
      // Sem quantidade explícita, vale a que estiver armada — e ela vale UMA
      // vez, como no caixa de mercado: armou 2, o próximo item sai 2, o
      // seguinte volta a 1. Ref (e não estado) porque este callback é chamado
      // de dentro do timer do leitor, onde uma closure velha erraria a conta.
      let qtdAdd = qtdExplicita ?? qtdArmadaRef.current ?? 1;
      // Quantidade fracionada só existe em item de balança (KG, L, M...).
      // "0,350*" num produto vendido por unidade dava meia água sanitária e
      // baixava 0,35 do estoque — o banco aceita (só exige qtd > 0), então a
      // régua tem de estar aqui. Este PDV não tinha nenhuma: era o único lugar
      // do sistema que ignorava `UNIDADES_FRACIONARIAS`.
      if (!UNIDADES_FRACIONARIAS.has(normalizarUnidade(produto?.unidade)) && !Number.isInteger(qtdAdd)) {
        const inteira = Math.max(1, Math.round(qtdAdd));
        flashError(`${produto?.nome ?? 'Item'} é vendido por unidade — ${fmtQtd(qtdAdd)} virou ${inteira}.`);
        qtdAdd = inteira;
      }
      // Desarma em QUALQUER adição, inclusive quando a quantidade veio colada
      // ao item ("2*7891" com 3 armado): deixar sobrando o que o operador já
      // acha que gastou é como o multiplicador vira erro de conferência.
      if (qtdArmadaRef.current !== null) {
        qtdArmadaRef.current = null;
        setQtdArmada(null);
      }
      const id      = produto?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nome    = produto?.nome ?? '(sem nome)';
      const preco   = Number(produto?.preco) || 0;
      const eRaw    = produto?.estoque;
      const eNum    = (eRaw === null || eRaw === undefined || eRaw === '') ? 999 : Number(eRaw);
      // Estoque ZERO é zero, não "sem informação". O `> 0` daqui trocava 0 por
      // 999: item esgotado entrava no carrinho sem badge de ruptura, sem aviso
      // e sem cair na trava do pagamento — e a recusa só aparecia no banco,
      // depois do cliente pagar. 999 continua valendo para campo vazio ou
      // ilegível, que é o caso que este default existia para cobrir.
      const estoque = Number.isFinite(eNum) ? eNum : 999;
      // O item é calculado AQUI, fora do updater do setCart. Antes, `added`
      // era preenchido DENTRO de `setCart(prev => …)` e lido logo depois — o
      // que só funciona quando o React resolve o updater na hora (otimização
      // que ele aplica apenas se não houver update pendente no componente).
      // Com um update já na fila — o realtime de estoque, o relógio do header,
      // o próprio setCode do bipe — o updater roda DEPOIS, `added` continuava
      // null, e o item entrava no carrinho SEM beep e SEM aparecer em "ÚLTIMO
      // ITEM LIDO". Para quem está no caixa, isso é o leitor não ter lido.
      const base = cartRef.current;
      const jaTem = base.find(i => i.produto_id === id);
      const novaQtd = (jaTem?.qtd ?? 0) + qtdAdd;
      const added: CartItem = jaTem
        ? { ...jaTem, qtd: novaQtd, subtotal: novaQtd * jaTem.preco_unitario }
        : {
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
      // Adiantar o ref mantém dois bipes no mesmo quadro somando certo em
      // "ÚLTIMO ITEM LIDO" (o carrinho em si já somava, por vir do `prev`).
      cartRef.current = jaTem
        ? base.map(i => i.produto_id === id ? added : i)
        : [...base, added];
      setCart(prev => {
        const atual = prev.find(i => i.produto_id === id);
        if (!atual) return [...prev, added];
        const q = atual.qtd + qtdAdd;
        return prev.map(i => i.produto_id === id
          ? { ...atual, qtd: q, subtotal: q * atual.preco_unitario }
          : i);
      });
      setLastAdded(added);
      playScannerBeep();
      // Ruptura avisa NA HORA. O banco recusa a venda inteira quando a
      // quantidade passa do estoque (`criar_venda_pdv`), então descobrir isso
      // só no FECHAR VENDA significa descobrir depois de o cliente pagar. O
      // badge na linha já mostrava, mas badge não interrompe ninguém — e com a
      // quantidade armada ("10*") passar do estoque ficou fácil demais.
      if (added.qtd > added.estoque) {
        flashError(`${added.nome_produto}: estoque ${fmtQtd(added.estoque)}, no carrinho ${fmtQtd(added.qtd)}. O banco recusa a venda assim.`);
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
    cartRef.current = [];
    setLastAdded(null);
    qtdArmadaRef.current = null;
    setQtdArmada(null);
    // Desarma o bipe pendente também: cancelar o cupom com um código em voo
    // fazia o item cair no carrinho novo, já zerado.
    consumirCodigo();
    setCashReceived('');
    setDesconto(0);
    setDiscountValue('');
    setPagamentos([]);
    setParcialValor('');
    setCpfNota('');
    setClienteVinculado(null);
    setDescontoAutorizacao(null);
  };

  const iniciarEdicaoPagamento = (idx: number) => {
    const p = pagamentos[idx];
    if (!p) return;
    setEditPagIdx(idx);
    setEditPagValor(formatBRL(p.valor));
  };

  const confirmarEdicaoPagamento = () => {
    if (editPagIdx === null) return;
    const idx = editPagIdx;
    const novo = parseBRL(editPagValor);
    setEditPagIdx(null);
    setEditPagValor('');
    if (novo <= 0) return;
    setPagamentos(prev => {
      const outros = prev.reduce((acc, p, i) => i === idx ? acc : acc + p.valor, 0);
      const teto = parseFloat((totalFinal - outros).toFixed(2));
      const valor = parseFloat(Math.min(novo, Math.max(teto, 0)).toFixed(2));
      return prev.map((p, i) => i === idx ? { ...p, valor } : p);
    });
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

  // Foco no FECHAR VENDA da tela principal (não o do modal de pagamento).
  // Usado após aplicar desconto pra operador apertar Enter direto.
  const focusFecharVendaPDV = () => {
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-action="fechar-venda-pdv"]');
      if (btn && !btn.disabled) btn.focus();
    });
  };

  // Suporta N*EAN ou N×EAN com decimal vírgula (ex: 0,350*7891)
  const processCode = useCallback((raw: string) => {
    const termo = raw.trim();
    if (!termo) return;
    const { qtd, termo: codigoBuscar, temMultiplicador } = separarQtdETermo(termo);
    if (!codigoBuscar) return;
    // Multiplicador digitado manda; sem ele, quem manda é a quantidade armada
    // (resolvida dentro do addToCart).
    const qtdDoTermo = temMultiplicador ? qtd : undefined;
    const lower = norm(codigoBuscar);
    let match = produtosDisponiveis.find((p: any) =>
      String(p.ean ?? '').trim() === codigoBuscar ||
      norm(p.codigo) === lower
    );
    if (!match) {
      // Busca por prefixo: com o `.includes()` antigo, "ca" casava café E
      // macarrão, virava ambíguo e caía no "não encontrado". Agora resolve.
      const partial = produtosDisponiveis.filter((p: any) => produtoCasa(p, lower, codigoBuscar));
      if (partial.length === 1) match = partial[0];
      else if (partial.length > 1) {
        // Nome que casa com vários NÃO é "produto não encontrado" — é escolha
        // pendente. Abre o F8 já filtrado, levando a quantidade: era aqui que
        // "2*leite" morria numa mensagem errada.
        if (temMultiplicador) { qtdArmadaRef.current = qtd; setQtdArmada(qtd); }
        setSearchTerm(codigoBuscar);
        setSearchModalOpen(true);
        consumirCodigo();
        return;
      }
    }
    if (!match) {
      setCodeMsg({ type: 'err', text: `Produto não encontrado: ${codigoBuscar}` });
      setTimeout(() => setCodeMsg(null), 3000);
      // Bipe que não achou produto LIMPA o campo; texto digitado à mão fica.
      // Sem isso o código recusado ficava no campo e o bipe seguinte colava
      // atrás dele ("78912…78912…"), então a partir do primeiro erro NENHUMA
      // leitura funcionava mais até alguém apertar Esc.
      if (/^\d{8,}$/.test(termo)) consumirCodigo();
      return;
    }
    addToCart(match, qtdDoTermo);
    consumirCodigo();
    codeInputRef.current?.focus();
  }, [produtosDisponiveis, addToCart, consumirCodigo]);

  // Toda digitação no campo CÓDIGO passa por aqui — o `onChange` do input e o
  // resgate de tecla perdida do listener global. Um leitor de código de barras
  // é um teclado: os dígitos chegam em rajada e, 120ms depois do último, se o
  // que está no campo for um código completo que casa exatamente, o item entra
  // sozinho (é o que faz o bipe funcionar mesmo em leitor sem sufixo Enter).
  const registrarDigitacao = useCallback((val: string) => {
    codeNativeRef.current = val;
    setCode(val);
    const buf = scanBufferRef.current;
    buf.chars = val;
    buf.lastTime = performance.now();
    clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      const v = buf.chars.trim();
      if (v.length >= 8 && /^\d+$/.test(v)) {
        const lower = norm(v);
        const exact = produtosDisponiveis.find((p: any) =>
          String(p.ean ?? '').trim() === v ||
          norm(p.codigo) === lower
        );
        if (exact) {
          addToCart(exact);
          consumirCodigo();
        }
        // Sem match não limpa nada: o Enter do leitor (se vier) cai em
        // processCode, que é quem mostra "produto não encontrado".
      }
    }, 120);
  }, [produtosDisponiveis, addToCart, consumirCodigo]);

  // Busca completa (modal F8) — sem cap de 2 chars; lista 50 primeiros se vazio.
  // A busca do F8 aceita a mesma gramática do campo CÓDIGO: "2*feijao" filtra
  // por feijão e adiciona 2. Sem isto, o único caminho para quantidade era ter
  // o código do produto na mão.
  const buscaF8 = useMemo(() => separarQtdETermo(searchTerm), [searchTerm]);
  const filteredSearch = useMemo(
    () => buscarProdutos(produtosDisponiveis, buscaF8.termo, 50),
    [buscaF8.termo, produtosDisponiveis],
  );
  // Quantidade que o F8 vai aplicar: a digitada na própria busca, senão a
  // armada, senão 1.
  const qtdDoF8 = buscaF8.temMultiplicador ? buscaF8.qtd : (qtdArmada ?? 1);

  // Reseta seleção do search modal ao abrir / quando lista muda
  useEffect(() => {
    if (searchModalOpen) setSearchIdx(filteredSearch.length > 0 ? 0 : -1);
  }, [searchModalOpen, filteredSearch.length]);

  // Consulta de preço — mesma filtragem da busca F8, listagem só leitura.
  const filteredPriceQuery = useMemo(
    () => buscarProdutos(produtosDisponiveis, priceQueryTerm, 50),
    [priceQueryTerm, produtosDisponiveis],
  );

  useEffect(() => {
    if (priceQueryOpen) setPriceQueryIdx(filteredPriceQuery.length > 0 ? 0 : -1);
  }, [priceQueryOpen, filteredPriceQuery.length]);

  // Sugestões enquanto digita (só quando 2+ chars e não é padrão N*EAN).
  // Acento-insensível: "feijão" digitado casa com "FEIJAO" cadastrado e vice-versa.
  const suggestions = useMemo(() => {
    // Sugestão sai do termo DEPOIS do multiplicador: com "2*fei" a lista
    // aparece igual, e o Enter adiciona 2 do item destacado. Antes a lista
    // simplesmente não aparecia quando havia multiplicador, então quem não
    // sabia o código de cor não tinha caminho nenhum.
    const { termo } = separarQtdETermo(code);
    const t = norm(termo);
    if (!t || t.length < 2) return [];
    return buscarProdutos(produtosDisponiveis, termo, 8);
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
    if (isClosing || paymentModalOpen || cashModalOpen || !!pixModal || !!cartaoModal || clientPickerOpen) return;
    // Carrinho que o banco vai recusar não abre pagamento. `criar_venda_pdv`
    // confere o estoque com FOR UPDATE e aborta a venda inteira — sem esta
    // trava o erro aparecia DEPOIS do dinheiro na gaveta, que é o pior lugar
    // possível para ele. (Conferido exercitando a RPC: "Estoque insuficiente
    // para X: disponível 25, pedido 26".)
    const ruptura = cartRef.current.filter(i => i.qtd > i.estoque);
    if (ruptura.length > 0) {
      const lista = ruptura.map(i => `${i.nome_produto} (estoque ${fmtQtd(i.estoque)}, carrinho ${fmtQtd(i.qtd)})`).join(' · ');
      flashError(`Ajuste antes de receber — o banco recusa venda acima do estoque: ${lista}`);
      return;
    }
    // Sempre abre limpo — pagamentos parciais de venda anterior poderiam
    // vazar pra esta se o operador cancelou e voltou.
    setPagamentos([]);
    setParcialValor('');
    setPayChoiceIdx(0);
    setPaymentError(null);
    setPaymentModalOpen(true);
    // `cartaoModal` estava sendo lido sem constar das deps: quando ele era a
    // ÚNICA coisa que mudava, este callback ficava com a versão antiga (nula) e
    // o F4 abria o modal de pagamento por cima da maquininha.
  }, [cart.length, isClosing, paymentModalOpen, cashModalOpen, pixModal, cartaoModal, clientPickerOpen, showToast, flashError]);

  const cancelSale = useCallback(() => {
    if (cart.length === 0) return;
    setConfirmFocusIdx(0); // foco default = "Voltar" (mais seguro)
    setConfirmCancel(true);
  }, [cart.length]);

  const reallyCancelSale = () => {
    clearAll();
    setConfirmCancel(false);
    // Cancelar de dentro do modal de pagamento deixava o modal aberto sobre um
    // carrinho ja vazio — o operador ficava preso numa tela sem venda.
    setPaymentModalOpen(false);
    codeInputRef.current?.focus();
  };

  // Enter no campo CÓDIGO:
  //  1) vazio        → SUBTOTAL (fechar venda)
  //  2) match exato  → EAN/código exato (prioridade pra scanner)
  //  3) idx >= 0     → adiciona a sugestão destacada (usuário usou ↑↓)
  //  4) sugestões    → adiciona a primeira (resolve "FEIJÃO" com múltiplos)
  //  5) fallback     → processCode (trata N*EAN e mensagem de erro)
  const handleCodeEnter = () => {
    const raw = codeNativeRef.current || code;
    const { qtd, termo, temMultiplicador } = separarQtdETermo(raw);
    if (termo === '') {
      // "2*" e Enter: arma a quantidade e espera o item. É o gesto do caixa de
      // mercado — quantos são primeiro, o que é depois.
      if (temMultiplicador) {
        qtdArmadaRef.current = qtd;
        setQtdArmada(qtd);
        consumirCodigo();
        return;
      }
      // Enter num campo vazio é "fechar venda" — menos quando o campo acabou
      // de ser limpo por uma leitura: aí este Enter é o sufixo do leitor, não
      // um comando do operador.
      if (performance.now() - scanBufferRef.current.limpoEm < 400) return;
      if (cart.length > 0) openPayment();
      return;
    }
    const qtdDoTermo = temMultiplicador ? qtd : undefined;
    const lower = norm(termo);
    const exact = produtosDisponiveis.find((p: any) =>
      String(p.ean ?? '').trim() === termo ||
      norm(p.codigo) === lower
    );
    if (exact) {
      addToCart(exact, qtdDoTermo);
      consumirCodigo();
      return;
    }
    if (suggestionIdx >= 0 && suggestions[suggestionIdx]) {
      addToCart(suggestions[suggestionIdx], qtdDoTermo);
      consumirCodigo();
      return;
    }
    if (suggestions.length > 0) {
      addToCart(suggestions[0], qtdDoTermo);
      consumirCodigo();
      return;
    }
    processCode(raw);
  };

  // Reimprimir (Ctrl+R): busca últimas 10 vendas da filial nesta sessão do PDV
  // e abre um picker; ao escolher, popula lastVenda e reabre reciboModalOpen.
  const openReprint = useCallback(async () => {
    if (!supabase) return;
    try {
      setReprintLoading(true);
      setReprintOpen(true);
      setReprintIdx(0);
      const { data, error } = await supabase
        .from('vendas')
        .select('id, created_at, total_final, forma_pagamento')
        .eq('filial', filial)
        .eq('status', 'Concluída')
        .eq('ativo', true)
        .gte('created_at', sessionStartRef.current)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      setReprintList((data ?? []) as Array<{ id: string; created_at: string; total_final: number; forma_pagamento: string }>);
    } catch (err: any) {
      showToast?.(`Erro ao carregar vendas: ${err?.message ?? '—'}`, 'error', true);
      setReprintOpen(false);
    } finally {
      setReprintLoading(false);
    }
  }, [filial, showToast]);

  const confirmReprint = useCallback(async (vendaId: string) => {
    if (!supabase) return;
    try {
      const [{ data: venda, error: vErr }, { data: itens, error: iErr }] = await Promise.all([
        supabase.from('vendas').select('id, total_final, total, desconto, forma_pagamento, cliente_id, cpf_cnpj_nota').eq('id', vendaId).single(),
        supabase.from('itens_venda').select('nome_produto, qtd, preco_unitario, subtotal').eq('venda_id', vendaId),
      ]);
      if (vErr) throw vErr;
      if (iErr) throw iErr;
      const cli = venda?.cliente_id ? ((clientes as any[]).find(c => c.id === venda.cliente_id)?.nome ?? null) : null;
      setLastVenda({
        id: String(venda!.id).slice(-6).toUpperCase(),
        total: Number(venda!.total_final ?? 0),
        subtotal: Number(venda!.total ?? 0),
        desconto: Number(venda!.desconto ?? 0),
        forma: String(venda!.forma_pagamento ?? '—'),
        cliente: cli,
        cpfNota: (venda as any)?.cpf_cnpj_nota ?? null,
        itens: (itens ?? []).map((it: any) => ({
          nome_produto: it.nome_produto,
          qtd: Number(it.qtd ?? 0),
          preco_unitario: Number(it.preco_unitario ?? 0),
          subtotal: Number(it.subtotal ?? 0),
        })),
      });
      setReprintOpen(false);
      setReciboModalOpen(true);
    } catch (err: any) {
      showToast?.(`Erro ao reimprimir: ${err?.message ?? '—'}`, 'error', true);
    }
  }, [clientes, showToast]);

  // F-key listeners globais — só ativos fora de modais
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // isClosing entra aqui pra F3/F4/F5/F8/F9 não dispararem ações novas durante
      // RPC pendente (evita dupla venda, dupla busca, etc.).
      const anyModal = paymentModalOpen || cashModalOpen || !!pixModal || !!cartaoModal || clientPickerOpen || confirmCancel || !!changeModal || searchModalOpen || cardPickerOpen || parcelasModalOpen || priceQueryOpen || !!cashMoveModal || discountModalOpen || reciboModalOpen || thankYouOpen || helpOpen || !!caixaOpModal || payerPickerOpen || reprintOpen || cpfModalOpen || !!valeModal || confirmSuspender || !!descAuth || isClosing;
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      // Dígito solto = bipe que caiu fora do campo. O foco sai do CÓDIGO a cada
      // clique num botão, num item do carrinho ou no header — e a partir dali o
      // leitor digitava para o vazio (pior: o Enter do sufixo "clicava" o botão
      // focado). O operador vê o leitor ler e o PDV não reagir. Aqui a tecla é
      // devolvida ao campo, que é o único lugar do PDV onde dígito significa
      // produto.
      if (
        !anyModal && !isEditable && !e.ctrlKey && !e.altKey && !e.metaKey &&
        e.key.length === 1 && e.key >= '0' && e.key <= '9'
      ) {
        e.preventDefault();
        codeInputRef.current?.focus();
        registrarDigitacao((codeNativeRef.current || '') + e.key);
        return;
      }

      // Shift+F1 ou ? — abrir manual/ajuda (padrão universal)
      if ((e.key === 'F1' && e.shiftKey) || (e.key === '?' && !isEditable)) {
        e.preventDefault();
        if (anyModal) return;
        setHelpOpen(true);
        return;
      }

      // Ctrl+M — trocar PDV (equivalente ao "menu" do MaxPOS)
      if ((e.key === 'm' || e.key === 'M') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (anyModal) return;
        if (cart.length === 0 && onSwitchFilial) onSwitchFilial('');
        return;
      }

      // Ctrl+L — abrir "Fechar meu caixa" (modal do header com relatório do turno)
      if ((e.key === 'l' || e.key === 'L') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (anyModal) return;
        if (cart.length === 0) {
          document.querySelector<HTMLButtonElement>('[data-action="fechar-caixa-header"]')?.click();
        }
        return;
      }

      // Ctrl+G — gancheira: suspende a venda atual ou recupera a suspensa.
      if ((e.key === 'g' || e.key === 'G') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (anyModal) return;
        if (cart.length > 0) suspenderVenda();
        else recuperarVendaSuspensa();
        return;
      }

      // Ctrl+F — alternar tela cheia
      if ((e.key === 'f' || e.key === 'F') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (anyModal) return;
        setFullscreen(f => !f);
        return;
      }

      // Ctrl+R — reimprimir última venda (fora de venda)
      if ((e.key === 'r' || e.key === 'R') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (anyModal || cart.length > 0) return;
        openReprint();
        return;
      }

      // F4 — Subtotal · F5 — Pagamentos (Linx/VR: F4 mostra subtotal, F5
      // abre formas de pagamento; no LogMax ambos abrem o modal que já
      // exibe subtotal + escolha da forma — mesmo destino, rótulo do
      // mercado preservado).
      if (e.key === 'F4' || e.key === 'F5') {
        e.preventDefault();
        if (!anyModal && cart.length > 0) openPayment();
        return;
      }
      // F3 / F9 — Cancelar cupom (padrão Linx/VR usa F3; F9 mantido como
      // alias por muscle memory do operador do LogMax anterior).
      if (e.key === 'F9' || e.key === 'F3') {
        e.preventDefault();
        if (!anyModal) cancelSale();
        return;
      }
      if (e.key === 'F8') {
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
        // Prioridade: a OPERACAO vem antes da tela cheia. Com cupom aberto o Esc
        // volta/cancela a venda; sair da tela cheia so quando nao ha o que voltar.
        if (cart.length > 0) {
          e.preventDefault();
          cancelSale();
          return;
        }
        if (fullscreen) {
          e.preventDefault();
          setFullscreen(false);
          return;
        }
        return;
      }
      if (e.key === 'Delete') {
        if (anyModal) return;
        // Não come Delete quando o operador está editando um input/select
        if (isEditable) return;
        e.preventDefault();
        // Se há item selecionado por seta → remove ele; senão, último
        if (selectedCartIdx >= 0 && selectedCartIdx < cart.length) {
          const sel = cart[selectedCartIdx];
          if (sel) {
            removeFromCart(sel.produto_id);
            setSelectedCartIdx(-1);
          }
          return;
        }
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
      // F12 — fechar/suspender caixa pelo operador (padrão gerencial
      // Linx/VR: menu fechamento/supervisor fica em F12).
      if (e.key === 'F12') {
        e.preventDefault();
        if (!anyModal && cart.length === 0) {
          setCaixaOpValor('');
          setCaixaOpObs('');
          setCaixaOpModal('fechar');
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
      // F10 — sangria (saída) · F11 — suprimento (entrada). Padrão real:
      // Linx/VR expõem sangria em F10 (menu supervisor) e suprimento em F11.
      if (e.key === 'F10' || e.key === 'F11') {
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
    // capture:true garante que F3/F4/F5/F8/F9 rodem ANTES de qualquer elemento
    // focado (select de filial no header, botão, etc.) tentar interpretar a
    // tecla. Sem capture, o navegador pode disparar comportamento default
    // (ex: F5 = recarregar página) antes de chegar aqui.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cart, cart.length, paymentModalOpen, cashModalOpen, pixModal, clientPickerOpen, confirmCancel, changeModal, searchModalOpen, cardPickerOpen, parcelasModalOpen, priceQueryOpen, cashMoveModal, discountModalOpen, reciboModalOpen, thankYouOpen, helpOpen, caixaOpModal, payerPickerOpen, reprintOpen, cpfModalOpen, valeModal, confirmSuspender, vendaSuspensa, descAuth, isClosing, code.length, fullscreen, caixa, openPayment, cancelSale, showToast, selectedCartIdx, onSwitchFilial, openReprint, registrarDigitacao]);

  // === FINALIZAR ===
  // Devolve o id da venda criada — o fluxo misto precisa dele pra registrar a
  // parte do crédito como conta a receber (migr. 415).
  // `dinheiroEmEspecie` é quanto desta venda entra na GAVETA. Vai à RPC como
  // `p_valor_dinheiro` (migr. 562) porque "venda em dinheiro" era deduzido do
  // texto da forma de pagamento — e o misto grava "Misto: Dinheiro R$ 20,00 +
  // PIX R$ 6,00", que não casava com o prefixo. Resultado: o misto furava a
  // trava do caixa aberto e a parte em espécie ficava fora da conferência do
  // fim do dia. Troco NÃO entra: o que volta para o cliente não fica na gaveta.
  const finalizarVenda = async (forma: string, cidOverride?: string, parcelas: number = 1, dinheiroEmEspecie: number = 0): Promise<string> => {
    if (!supabase) throw new Error('Supabase indisponível.');
    // Sem override (Fiado escolhe o pagador), vale o cliente vinculado na tela
    // de fechamento — é o que carimba a venda, a conta a receber e a nota.
    const cid = cidOverride !== undefined ? cidOverride : (clienteVinculado?.id ?? null);
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
      p_parcelas:        parcelas,
      p_itens:           itensPayload,
      p_filial:          filial,
      p_cupom_codigo:    null,
      p_cupom_desconto:  0,
      p_valor_dinheiro:  parseFloat(dinheiroEmEspecie.toFixed(2)),
      p_cpf_nota:        cpfNota || null,
    });
    if (rpcErr || !vendaId) throw new Error(rpcErr?.message ?? 'Falha ao registrar venda.');
    // Desconto autorizado deixa rastro na própria venda. A RPC não recebe
    // observação, então vai num update logo depois — mesmo caminho que o PDV
    // dos nichos usa para os campos de vitrine.
    if (descontoAutorizacao && descontoAplicado > 0) {
      const { error: obsErr } = await supabase
        .from('vendas')
        .update({ observacao: `Desconto de ${formatBRL(descontoAplicado)} autorizado por ${descontoAutorizacao.por} — ${descontoAutorizacao.motivo}` })
        .eq('id', vendaId);
      if (obsErr) console.warn('[PDV] Venda registrada, mas a autorização do desconto não foi gravada:', obsErr.message);
    }
    const shortId = String(vendaId).slice(-6).toUpperCase();
    const clienteNome = cid ? ((clientes as any[]).find(c => c.id === cid)?.nome ?? null) : null;
    setLastVenda({
      id: shortId,
      total: totalFinal,
      subtotal,
      desconto: descontoAplicado,
      forma,
      cliente: clienteNome,
      // Guardado aqui porque `clearAll()` logo abaixo zera o campo da tela —
      // e o recibo só é gerado depois, no clique do operador. Mesmo motivo
      // para a economia: ela é calculada sobre o carrinho, que some em seguida.
      cpfNota: cpfNota || null,
      economia: parseFloat(economiaOfertas.toFixed(2)),
      itens: itensPayload.map(i => ({
        nome_produto: i.nome_produto,
        qtd: i.qtd,
        preco_unitario: i.preco_unitario,
        subtotal: i.subtotal,
      })),
    });
    playKaching();
    clearAll();
    // NÃO foca o código aqui — caller decide (changeModal → thankYou →
    // código, ou thankYou direto). Sem isso, o foco vazava pro código
    // antes do agradecimento renderizar e o usuário começava a digitar
    // por baixo do overlay.
    return String(vendaId);
  };
  finalizarVendaRef.current = finalizarVenda;

  // Checa se ainda existe caixa aberto pra esta filial hoje. Usado antes de
  // qualquer finalização — inclusive no callback do PIX (que pode demorar
  // minutos entre abrir o QR e o cliente pagar; nesse intervalo o gerente
  // pode ter fechado o caixa).
  // Gancheira (Ctrl+G). Suspender guarda a venda inteira num slot e limpa a
  // tela; recuperar devolve tudo. Cancelar o cupom NÃO mexe na gancheira — são
  // duas vendas diferentes.
  const doSuspenderVenda = () => {
    setVendaSuspensa({
      cart,
      desconto,
      cpfNota,
      clienteVinculado,
      suspensaEm: new Date().toISOString(),
    });
    setConfirmSuspender(false);
    clearAll();
    showToast?.(`Venda suspensa (${cart.length} ${cart.length === 1 ? 'item' : 'itens'}). Ctrl+G recupera.`, 'success');
    requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  const suspenderVenda = () => {
    if (cart.length === 0) return;
    // Slot ocupado: suspender de novo descartaria a antiga, então pergunta.
    if (vendaSuspensa) { setConfirmSuspender(true); return; }
    doSuspenderVenda();
  };

  const recuperarVendaSuspensa = () => {
    if (!vendaSuspensa) return;
    if (cart.length > 0) {
      showToast?.('Termine ou cancele a venda atual antes de recuperar a suspensa.', 'error', true);
      return;
    }
    setCart(vendaSuspensa.cart);
    cartRef.current = vendaSuspensa.cart;
    setDesconto(vendaSuspensa.desconto);
    setCpfNota(vendaSuspensa.cpfNota);
    setClienteVinculado(vendaSuspensa.clienteVinculado);
    setVendaSuspensa(null);
    showToast?.('Venda recuperada da gancheira.', 'success');
    requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  // Valida a senha do gerente num cliente descartável: a sessão do operador
  // continua de pé (é ele quem opera o caixa), e o gerente só carimba.
  const confirmarAutorizacaoDesconto = async () => {
    if (!descAuth) return;
    const email = descAuthEmail.trim().toLowerCase();
    const motivo = descAuthMotivo === 'Outro' ? descAuthObs.trim() : descAuthMotivo;
    if (!email || !descAuthSenha) {
      showToast?.('Informe o e-mail e a senha do gerente.', 'error', true);
      return;
    }
    if (!motivo) {
      showToast?.('Descreva o motivo do desconto.', 'error', true);
      return;
    }
    const cliente = criarClienteEfemero();
    if (!cliente) { showToast?.('Supabase indisponível.', 'error', true); return; }
    setDescAuthLoading(true);
    try {
      const { data: auth, error: authErr } = await cliente.auth.signInWithPassword({ email, password: descAuthSenha });
      if (authErr || !auth?.user) {
        showToast?.('E-mail ou senha não conferem.', 'error', true);
        return;
      }
      const { data: perfil } = await cliente
        .from('user_profiles')
        .select('nome, role, filial')
        .eq('id', auth.user.id)
        .maybeSingle();
      const ehGerenteDaUnidade = perfil?.role === 'gerente' && perfil?.filial === filial;
      // O professor (admin) também autoriza: em aula é ele quem faz o papel do
      // fiscal quando o gerente da filial não está na sala.
      const ehAdmin = perfil?.role === 'admin';
      if (!ehGerenteDaUnidade && !ehAdmin) {
        showToast?.(`${perfil?.nome ?? 'Essa conta'} não é gerente de ${filial} — só o gerente da unidade autoriza desconto.`, 'error', true);
        return;
      }
      setDesconto(descAuth.valor);
      setDescontoAutorizacao({ por: perfil?.nome ?? email, motivo });
      showToast?.(`Desconto de ${formatBRL(descAuth.valor)} autorizado por ${perfil?.nome ?? email}.`, 'success');
      setDescAuth(null);
      setDescAuthEmail(''); setDescAuthSenha(''); setDescAuthObs('');
      setDescAuthMotivo('Divergência de preço na gôndola');
      focusFecharVendaPDV();
    } catch (err: any) {
      showToast?.(`Erro na autorização: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      // O cliente descartável não pode ficar segurando a sessão do gerente.
      await cliente.auth.signOut().catch(() => {});
      setDescAuthLoading(false);
    }
  };

  const abrirCaixa = async () => {
    const valor = parseBRL(aberturaValor);
    if (!valor || valor <= 0) {
      showToast?.('Informe o fundo de troco para abrir o caixa.', 'error', true);
      return;
    }
    if (!supabase) { showToast?.('Supabase indisponível.', 'error', true); return; }
    setAbrindoCaixa(true);
    try {
      const { error } = await supabase.from('controle_caixa').insert({
        data:            todayBR(),
        filial,
        valor_abertura:  valor,
        status:          'Aberto',
        aberto_por:      user?.id ?? null,
        aberto_por_nome: profile?.nome ?? user?.email ?? 'Operador',
        aberto_em:       new Date().toISOString(),
        observacao:      aberturaObs.trim() || null,
      });
      if (error) {
        // 23505: já existe sessão do dia para a unidade — alguém abriu antes.
        if (error.code === '23505') showToast?.(`Já existe caixa aberto hoje em ${filial}.`, 'error', true);
        else throw error;
      } else {
        showToast?.(`Caixa aberto com ${formatBRL(valor)} de fundo de troco.`, 'success');
        setAberturaValor('');
        setAberturaObs('');
      }
      await refreshCaixa();
    } catch (err: any) {
      showToast?.(`Erro ao abrir o caixa: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setAbrindoCaixa(false);
    }
  };

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
    // Troco = soma dos trocos por linha (Dinheiro). Recalcular daqui
    // garante que remover/editar pagamento Dinheiro mantenha o troco
    // coerente — versão antiga usava trocoStash agregado e ficava
    // dessincronizado ao remover linha.
    const trocoFinal = parseFloat(pagamentos.reduce((s, p) => s + (p.troco ?? 0), 0).toFixed(2));
    const houveDinheiro = pagamentos.some(p => p.forma === 'Dinheiro');
    // Parcelamento só aplica quando Cartão Crédito é forma única; em
    // misto a RPC cai no ELSE genérico (status='Pago') e ignora p_parcelas.
    const parcelas = (pagamentos.length === 1 && pagamentos[0].forma === 'Cartão Crédito')
      ? (pagamentos[0].parcelas ?? 1)
      : 1;
    // Parte da venda paga em crédito. A RPC de venda marca o misto inteiro
    // como recebido no dia; o crédito só é repassado pela operadora depois,
    // e é isso que `pdv_registrar_credito_misto` corrige (migr. 415).
    // Linhas de crédito com parcelamentos diferentes são raras no balcão —
    // somamos os valores e usamos o maior parcelamento lançado.
    const linhasCredito = pagamentos.filter(p => p.forma === 'Cartão Crédito');
    const creditoValor = parseFloat(linhasCredito.reduce((s, p) => s + p.valor, 0).toFixed(2));
    const creditoParcelas = linhasCredito.reduce((mx, p) => Math.max(mx, p.parcelas ?? 1), 1);
    try {
      setIsClosing(true);
      setPaymentError(null);
      // SEM revalidação de caixa aqui — o caixa já foi validado em
      // handlePayChoice. O tempo entre cash modal e FECHAR VENDA é de
      // segundos; revalidar gera falso-negativo silencioso (toast some
      // atrás do overlay fullscreen z-100) e mata a venda.
      // Só o VALOR das linhas em Dinheiro — `troco` fica fora, porque volta
      // para o cliente e não para a gaveta.
      const dinheiroNaGaveta = parseFloat(
        pagamentos.filter(p => p.forma === 'Dinheiro').reduce((s, p) => s + p.valor, 0).toFixed(2),
      );
      const vendaId = await finalizarVenda(forma, undefined, parcelas, dinheiroNaGaveta);
      // Só em misto com crédito. Falha aqui não desfaz a venda — ela já
      // persistiu, e o aviso diz exatamente o que ficou pendente de ajuste
      // pro Financeiro não descobrir isso no fechamento do mês.
      if (pagamentos.length > 1 && creditoValor > 0 && supabase) {
        const { error: creditoErr } = await supabase.rpc('pdv_registrar_credito_misto', {
          p_venda_id:      vendaId,
          p_valor_credito: creditoValor,
          p_parcelas:      creditoParcelas,
        });
        if (creditoErr) {
          showToast?.(
            `Venda fechada, mas a parte no crédito (R$ ${formatBRL(creditoValor)}) ficou lançada como recebida hoje. Ajuste em Financeiro → Contas a Receber. (${creditoErr.message})`,
            'error',
            true,
          );
        }
      }
      setPaymentModalOpen(false);
      // Sequência de feedback final: troco/exato (se aplicável) → agradecimento.
      // Cartão puro pula direto pro agradecimento (sem feedback redundante).
      if (trocoFinal > 0.001) setChangeModal({ amount: trocoFinal });
      else if (houveDinheiro) setChangeModal({ amount: 0 });
      else setReciboModalOpen(true);
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
    // Idempotência — F3 + clique simultâneo no PIX criava 2 pix_pendentes.
    // openPayment já protege a entrada, aqui protege as escolhas dentro
    // do payment modal.
    if (isClosing) return;
    const parcial = parseBRL(parcialValor);
    const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
    if (valorDevido <= 0 && pagamentos.length > 0) return;

    // PIX e Fiado precisam de etapa assíncrona (realtime, picker de cliente)
    // e a RPC criar_venda_pdv trata cada um especificamente — então só
    // funcionam como pagamento único, na venda inteira.
    if (forma === 'PIX' || forma === 'Fiado' || forma === 'Vale-Alimentação') {
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
      if (forma === 'Fiado') { setClientPickerModo('fiado'); setClientPickerOpen(true); return; }
      // Vale-Alimentação: a maquininha do voucher pede os 4 últimos dígitos do
      // cartão. É simulação, como no MaxPOS — qualquer 4 dígitos autorizam.
      if (forma === 'Vale-Alimentação') {
        setValeDigitos('');
        setValeModal({ valor: parseFloat(restante.toFixed(2)) });
        return;
      }
      // PIX — cria pendente, realtime finaliza quando MaxBank confirma.
      try {
        if (!supabase) throw new Error('Supabase indisponível.');
        setIsClosing(true);
        // Cancela pendentes 'aguardando' antigos do mesmo operador (> 30s)
        // para evitar que MaxPay/MaxBank confunda com cobrança nova.
        if (user?.id) {
          const cutoff = new Date(Date.now() - 30_000).toISOString();
          await supabase
            .from('pix_pendentes')
            .update({ status: 'cancelado' })
            .eq('operador_id', user.id)
            .eq('status', 'aguardando')
            .lt('created_at', cutoff);
        }
        const { data: pendente, error: insErr } = await supabase
          .from('pix_pendentes')
          .insert({
            valor:       totalFinal,
            cliente_id:  null,
            status:      'aguardando',
            operador_id: user?.id ?? null,
            // Filial do CAIXA, não a do perfil — admin opera pelo hub com
            // perfil 'Matriz', que não vende (migr. 414).
            filial,
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

    // Cartão SEMPRE passa pela maquininha, sozinho ou dentro do misto.
    //
    // Até 2026-08-13 a linha de cartão no misto era só adicionada à lista, sem
    // criar `cartao_pendentes` e sem esperar o MaxBank autorizar. Um centavo em
    // dinheiro convertia qualquer venda de cartão num fechamento sem
    // maquininha — o caminho curto para furar o fluxo que o resto do PDV
    // obriga. O que muda no misto é só o destino da autorização: em vez de
    // fechar a venda, ela vira uma linha de pagamento.
    // Crédito pergunta parcelas antes, nos dois casos: agora que o misto gera
    // conta a receber de verdade (RPC pdv_registrar_credito_misto), parcelar
    // dentro do misto deixou de ser mentira contábil. `confirmarParcelas`
    // recalcula o destino e segue daqui.
    if (forma === 'Cartão Crédito') {
      setParcelasIdx(0);
      setParcelasModalOpen(true);
      return;
    }

    // Só Cartão Débito chega aqui: Dinheiro, PIX e Fiado retornaram acima.
    const isMistoActive = pagamentos.length > 0 || (parcial > 0 && parcial < restante - 0.001);
    setPaymentModalOpen(false);
    await criarCartaoPendente('debito', parseFloat(valorDevido.toFixed(2)), 1, isMistoActive ? 'linha' : 'venda');
  };

  // Cria cartao_pendentes e abre overlay aguardando aproximação na maquininha.
  // Quando MaxBank autoriza, realtime/polling finaliza venda.
  const criarCartaoPendente = async (
    metodo: 'debito' | 'credito',
    valor: number,
    parcelas: number,
    destino: DestinoCartao = 'venda',
  ) => {
    try {
      if (!supabase) throw new Error('Supabase indisponível.');
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        showToast?.(`Caixa de ${filial} foi fechado.`, 'error', true);
        await refreshCaixa();
        return;
      }
      setIsClosing(true);
      // Cancela pendentes antigos do mesmo operador (> 30s)
      if (user?.id) {
        const cutoff = new Date(Date.now() - 30_000).toISOString();
        await supabase
          .from('cartao_pendentes')
          .update({ status: 'cancelado' })
          .eq('operador_id', user.id)
          .eq('status', 'aguardando')
          .lt('created_at', cutoff);
      }
      const { data: pendente, error: insErr } = await supabase
        .from('cartao_pendentes')
        .insert({
          valor,
          metodo,
          parcelas,
          status: 'aguardando',
          operador_id: user?.id ?? null,
          filial,
        })
        .select('id, valor, metodo, parcelas')
        .single();
      if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao criar cobrança.');
      setCartaoModal({
        id: pendente.id,
        valor: Number(pendente.valor),
        metodo: pendente.metodo,
        parcelas: pendente.parcelas,
        destino,
      });
    } catch (err: any) {
      showToast?.(`Erro Cartão: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  // Confirma parcelamento Cartão Crédito (forma única). Em vez de adicionar
  // à lista, cria cartao_pendentes para a maquininha.
  const confirmarParcelas = async (n: number) => {
    const parcial = parseBRL(parcialValor);
    const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
    const isMistoActive = pagamentos.length > 0 || (parcial > 0 && parcial < restante - 0.001);
    setParcelasModalOpen(false);
    setParcialValor('');
    setPaymentModalOpen(false);
    await criarCartaoPendente('credito', parseFloat(valorDevido.toFixed(2)), n, isMistoActive ? 'linha' : 'venda');
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
    const trocoDessaForma = parseFloat((recebido - valorDevido).toFixed(2));
    setPagamentos(prev => [...prev, {
      forma: 'Dinheiro',
      valor: parseFloat(valorDevido.toFixed(2)),
      troco: trocoDessaForma,
    }]);
    setParcialValor('');
    setCashReceived('');
    setCashModalOpen(false);
    focusFecharVenda();
  };

  const confirmarCpf = () => {
    const digitos = cpfInput.replace(/\D/g, '');
    if (digitos === '') {
      setCpfNota('');
      setCpfModalOpen(false);
      return;
    }
    // Simulação didática: conferimos o tamanho (11 CPF / 14 CNPJ), não o
    // dígito verificador. O banco recusa qualquer outro tamanho (migr. 574).
    if (digitos.length !== 11 && digitos.length !== 14) {
      showToast?.('CPF tem 11 dígitos e CNPJ tem 14. Digite um dos dois.', 'error', true);
      return;
    }
    setCpfNota(digitos);
    setCpfModalOpen(false);
  };

  const confirmarVale = async () => {
    if (!valeModal) return;
    if (!/^\d{4}$/.test(valeDigitos)) {
      showToast?.('Digite os 4 últimos dígitos do cartão Vale.', 'error', true);
      return;
    }
    setValeModal(null);
    setValeDigitos('');
    try {
      setIsClosing(true);
      // Vale não é dinheiro na gaveta: `p_valor_dinheiro` fica zero e a RPC
      // lança a conta a receber como paga no dia (migr. 574).
      await finalizarVenda('Vale-Alimentação', undefined, 1, 0);
      setReciboModalOpen(true);
    } catch (err: any) {
      showToast?.(`Erro Vale: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  // Um clique no picker: no Fiado fecha a venda no nome do pagador; no
  // vincular só carimba o cliente e devolve o operador ao pagamento.
  const escolherCliente = (c: { id: string; nome: string }) => {
    if (clientPickerModo === 'fiado') { handleFiadoConfirm(c.id); return; }
    setClienteVinculado({ id: c.id, nome: c.nome });
    setClientPickerOpen(false);
    setPaymentModalOpen(true);
  };

  const handleFiadoConfirm = async (cid: string) => {
    setClientPickerOpen(false);
    try {
      setIsClosing(true);
      // Revalida caixa — o operador pode ter ficado tempo escolhendo o
      // cliente no picker; o gerente pode ter fechado o caixa nesse
      // intervalo. Sem esse check, criar_venda_pdv roda com caixa fechado.
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        showToast?.(`Caixa de ${filial} foi fechado. Abra em Financeiro → Controle de Caixa.`, 'error', true);
        await refreshCaixa();
        return;
      }
      // Limite de crédito e inadimplência (migr. 416). Consultado aqui, depois
      // do picker: é o último ponto antes da venda, e entre escolher o cliente
      // e confirmar já pode ter entrado outro fiado dele em outro caixa. Quem
      // recusa de fato é a trigger em `vendas` — isto troca o erro de banco por
      // uma frase que diz o que fazer.
      const motivo = bloqueioFiado(await consultarCreditoCliente(cid), totalFinal);
      if (motivo) { showToast?.(motivo, 'error', true); return; }
      await finalizarVenda('Fiado', cid);
      setReciboModalOpen(true);
    } catch (err: any) {
      showToast?.(`Erro Fiado: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  // Reseta estado de erro/processamento sempre que abre/troca pix_modal
  useEffect(() => {
    pixHandledRef.current = false;
    setPixError(null);
    setPixProcessing(false);
  }, [pixModal?.id]);

  // Registra a venda quando o pix vira 'pago'. Idempotente: pode ser chamado
  // pelo realtime, polling ou botão "Tentar Novamente" — só dispara uma vez
  // por sessão de pixModal, e libera retry quando o RPC falha.
  const processarPagamentoPix = useCallback(async () => {
    if (!pixModal) return;
    setPixError(null);
    setPixProcessing(true);
    try {
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        throw new Error(`Caixa de ${filial} foi fechado. Reabra em Financeiro → Controle de Caixa e clique em "Tentar Novamente". O PIX já foi pago no MaxBank — NÃO cancele aqui.`);
      }
      await finalizarVendaRef.current('PIX');
      setPixModal(null);
      setReciboModalOpen(true);
    } catch (err: any) {
      setPixError(err?.message ?? String(err));
      pixHandledRef.current = false; // permite retry manual ou novo trigger
    } finally {
      setPixProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixModal, filial]);

  // PIX realtime + polling — finaliza venda quando MaxBank/MaxPay confirma
  useEffect(() => {
    if (!pixModal || !supabase) return;

    const tryProcess = () => {
      if (pixHandledRef.current) return;
      pixHandledRef.current = true;
      processarPagamentoPix();
    };

    const channel = supabase
      .channel(`smx_pix_${pixModal.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pix_pendentes', filter: `id=eq.${pixModal.id}` },
        (payload: any) => { if (payload?.new?.status === 'pago') tryProcess(); }
      )
      .subscribe();

    const timer = setInterval(async () => {
      if (pixHandledRef.current) return;
      const { data } = await supabase
        .from('pix_pendentes')
        .select('status')
        .eq('id', pixModal.id)
        .maybeSingle();
      if (data?.status === 'pago') tryProcess();
    }, 2000);

    return () => { supabase.removeChannel(channel); clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixModal]);

  // Cartão (maquininha) realtime + polling — finaliza venda quando MaxBank autoriza
  useEffect(() => {
    if (!cartaoModal || !supabase) return;
    let handled = false;

    const onAutorizado = async () => {
      if (handled) return;
      handled = true;
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        showToast?.(`Cartão autorizado mas caixa de ${filial} foi fechado.`, 'error', true);
        setCartaoModal(null);
        return;
      }
      const formaCanon = cartaoModal.metodo === 'debito' ? 'Cartão Débito' : 'Cartão Crédito';

      // Misto: a autorização vira uma linha de pagamento e o operador volta ao
      // modal pra lançar o resto. A venda só fecha no FECHAR VENDA.
      if (cartaoModal.destino === 'linha') {
        setPagamentos(prev => [...prev, {
          forma:    formaCanon as Exclude<FormaPagamento, 'Fiado'>,
          valor:    cartaoModal.valor,
          parcelas: cartaoModal.metodo === 'credito' ? cartaoModal.parcelas : undefined,
        }]);
        // O parcial já virou linha — deixar o campo preenchido faria o próximo
        // lançamento herdar o valor do anterior.
        setParcialValor('');
        setCartaoModal(null);
        setPaymentModalOpen(true);
        focusFecharVenda();
        return;
      }

      try {
        await finalizarVendaRef.current(formaCanon as any, undefined, cartaoModal.parcelas);
        setCartaoModal(null);
        setReciboModalOpen(true);
      } catch (err: any) {
        showToast?.(`Autorizado mas falhou venda: ${err?.message ?? '—'}`, 'error', true);
        setCartaoModal(null);
      }
    };

    const channel = supabase
      .channel(`smx_cartao_${cartaoModal.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cartao_pendentes', filter: `id=eq.${cartaoModal.id}` },
        (payload: any) => { if (payload?.new?.status === 'autorizado') onAutorizado(); }
      )
      .subscribe();

    const timer = setInterval(async () => {
      if (handled) return;
      const { data } = await supabase
        .from('cartao_pendentes')
        .select('status')
        .eq('id', cartaoModal.id)
        .maybeSingle();
      if (data?.status === 'autorizado') onAutorizado();
    }, 2000);

    return () => { handled = true; supabase.removeChannel(channel); clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartaoModal]);

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
    const motivoTrimmed = cashMoveMotivo.trim();
    // Sangria precisa de motivo — o label da UI diz "obrigatório registrar
    // onde foi"; sem essa validação, operador podia confirmar vazio e
    // ficar uma saída de caixa sem rastro.
    if (cashMoveModal.tipo === 'sangria' && !motivoTrimmed) {
      showToast?.('Sangria requer motivo (onde foi o dinheiro).', 'error', true);
      return;
    }
    const motivo = motivoTrimmed || null;
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
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error', true);
    } finally {
      setIsClosing(false);
    }
  };

  const handleCaixaOpConfirm = async () => {
    if (!caixa || !supabase || !caixaOpModal) return;
    if (caixaOpModal === 'fechar') {
      const valor = parseBRL(caixaOpValor);
      if (valor <= 0) {
        showToast?.('Informe o valor contado em dinheiro.', 'error', true);
        return;
      }
      try {
        setIsClosing(true);
        const { data, error } = await supabase.rpc('fechar_caixa_conferido', {
          p_controle_id: caixa.id,
          p_valor_contado: valor,
          p_observacao: caixaOpObs.trim() || null,
          p_origem: 'operador',
        });
        if (error) throw error;
        const res = data as any;
        const tipo = res?.tipo as string;
        const dif = Number(res?.diferenca ?? 0);
        const msg = tipo === 'exato'
          ? 'Caixa fechado pelo operador — valor exato.'
          : tipo === 'sobra'
            ? `Caixa fechado com SOBRA de ${formatBRL(dif)}.`
            : `Caixa fechado com FALTA de ${formatBRL(Math.abs(dif))}.`;
        showToast?.(msg, tipo === 'exato' ? 'success' : 'info', true);
        setCaixaOpModal(null);
        await refreshCaixa();
      } catch (err: any) {
        showToast?.(`Erro ao fechar: ${err?.message ?? '—'}`, 'error', true);
      } finally {
        setIsClosing(false);
      }
    } else {
      try {
        setIsClosing(true);
        const { error } = await supabase.rpc('suspender_caixa', {
          p_controle_id: caixa.id,
          p_observacao: caixaOpObs.trim() || null,
        });
        if (error) throw error;
        showToast?.('Caixa suspenso pelo operador.', 'info', true);
        setCaixaOpModal(null);
        await refreshCaixa();
      } catch (err: any) {
        showToast?.(`Erro ao suspender: ${err?.message ?? '—'}`, 'error', true);
      } finally {
        setIsClosing(false);
      }
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

  const cancelarCartao = async () => {
    if (!cartaoModal || !supabase) {
      setConfirmCartaoCancel(false);
      setCartaoModal(null);
      return;
    }
    const cartaoId = cartaoModal.id;
    // Cartão que ia virar linha do misto: desistir dele não pode abandonar a
    // venda pela metade — o operador volta pro modal com o que já lançou.
    const voltaProMisto = cartaoModal.destino === 'linha';
    try {
      const { error } = await supabase
        .from('cartao_pendentes')
        .update({ status: 'cancelado' })
        .eq('id', cartaoId);
      if (error) throw error;
    } catch (err: any) {
      showToast?.(`Falha ao cancelar cartão (${err?.message ?? '—'}).`, 'error', true);
    } finally {
      setConfirmCartaoCancel(false);
      setCartaoModal(null);
      if (voltaProMisto) setPaymentModalOpen(true);
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
    // ANTES o foco ia pro botao DINHEIRO: o operador abria o pagamento, digitava
    // o valor parcial e nada aparecia — a tecla morria no botao focado, porque o
    // redirecionamento de digito do PDV se desliga com modal aberto. O foco entra
    // no campo (padrao do MaxPOS); F1/F2/F3 e setas seguem escolhendo a forma.
    const id = setTimeout(() => parcialInputRef.current?.focus(), 0);
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
  const datetime = useMemo(() => new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' }), [nowTick]);

  // Classe do container raiz — fullscreen sobrepõe o app shell (sidebar+topbar).
  const rootClass = fullscreen ? 'fixed inset-0 z-[100]' : 'h-full';

  // Cobrança pendente (QR do PIX na tela, maquininha aguardando) — os dois
  // modais moram dentro da árvore principal, então qualquer early return aqui
  // arranca a operação da frente do cliente. Era o que acontecia: `produtos`
  // está na publicação realtime e cada venda da turma disparava um refetch
  // que ligava loadingProd → PDV virava spinner (a tela "piscando") e o modal
  // do PIX sumia no meio do pagamento.
  const cobrancaEmCurso = !!pixModal || !!cartaoModal;
  if (caixa) ultimoCaixaRef.current = caixa;
  const caixaAtivo = caixa ?? (cobrancaEmCurso ? ultimoCaixaRef.current : null);

  // === RENDER ===
  if ((caixaLoading || loadingProd) && !cobrancaEmCurso) {
    return (
      <div className={`${rootClass} flex items-center justify-center bg-gray-100`}>
        <Loader2 className="animate-spin" size={32} style={{ color: NAVY_DARK }} />
      </div>
    );
  }

  if (!caixaAtivo) {
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
              O caixa de <b>{filial}</b> não está aberto hoje. Conte o fundo de troco da gaveta e abra o caixa para começar a operar.
            </p>
            <div className="mt-6 text-left space-y-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  Fundo de troco <span className="text-gray-400 normal-case font-medium">(dinheiro que já está na gaveta)</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={aberturaValor}
                  onChange={(e) => setAberturaValor(formatBRL(parseBRL(e.target.value)))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); abrirCaixa(); } }}
                  placeholder="0,00"
                  className="w-full bg-white border-2 text-2xl font-bold text-gray-900 tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  Observação <span className="text-gray-400 normal-case font-medium">(opcional)</span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={aberturaObs}
                  onChange={(e) => setAberturaObs(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); abrirCaixa(); } }}
                  placeholder="Ex.: troco conferido com o gerente"
                  className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>
              <button
                onClick={abrirCaixa}
                disabled={abrindoCaixa || parseBRL(aberturaValor) <= 0}
                className="w-full px-6 py-4 text-white font-black uppercase tracking-wide text-base disabled:opacity-30 flex items-center justify-center gap-2"
                style={{ background: MONEY }}
              >
                {abrindoCaixa ? <><Loader2 size={18} className="animate-spin" /> Abrindo…</> : 'Abrir Caixa (Enter)'}
              </button>
              <button
                onClick={() => refreshCaixa()}
                className="w-full px-6 py-2 font-bold uppercase tracking-wide text-xs border-2"
                style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
              >
                Já abriram para mim · Verificar novamente
              </button>
            </div>
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
        extraActions={
          <PDVFecharCaixa
            caixa={{ id: caixaAtivo.id, valor_abertura: caixaAtivo.valor_abertura, filial: caixaAtivo.filial, data: caixaAtivo.data }}
            showToast={showToast}
            onFechamentoSolicitado={refreshCaixa}
            className="px-3 py-1.5 text-xs uppercase tracking-wider bg-white flex items-center gap-1.5 border-2"
          />
        }
      />

      {/* Tabela de itens + sidebar */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-300">
          <div
            className="grid grid-cols-[70px_160px_1fr_80px_90px_130px_150px_40px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
            style={{ background: NAVY_DARK }}
          >
            <div>ITEM</div>
            <div>CÓDIGO</div>
            <div>DESCRIÇÃO</div>
            <div className="text-right">QTD</div>
            <div className="text-right">ESTOQUE</div>
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
                className={`grid grid-cols-[70px_160px_1fr_80px_90px_130px_150px_40px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b ${
                  idx === selectedCartIdx
                    ? 'bg-yellow-200 border-yellow-500 ring-2 ring-yellow-500'
                    : idx === cart.length - 1 && selectedCartIdx < 0
                      ? 'bg-yellow-50 border-gray-200'
                      : 'border-gray-200'
                }`}
              >
                <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
                <div className="text-gray-500 truncate">{item.ean || item.codigo || '—'}</div>
                <div className="truncate font-semibold flex items-center gap-2">
                  <span className="truncate">{(item.nome_produto || '').toUpperCase()}</span>
                  {ofertaDoItem(item.produto_id, item.preco_unitario) && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded border"
                      style={{ background: '#dcfce7', color: '#166534', borderColor: MONEY }}
                      title="Preço promocional aprovado — veio do cadastro, não do caixa"
                    >
                      Oferta
                    </span>
                  )}
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
                <div className="text-right">{fmtQtd(item.qtd)}</div>
                <div className={`text-right ${ruptura ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{item.estoque}</div>
                <div className="text-right">
                  {(() => {
                    const o = ofertaDoItem(item.produto_id, item.preco_unitario);
                    if (!o) return fmt(item.preco_unitario);
                    return (
                      <>
                        <span className="block text-xs font-normal text-gray-400 line-through">{fmt(o.de)}</span>
                        <span style={{ color: MONEY }} title={`Em oferta — preço de tabela R$ ${fmt(o.de)}`}>{fmt(item.preco_unitario)}</span>
                      </>
                    );
                  })()}
                </div>
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
                {(() => {
                  const o = ofertaDoItem(lastAdded.produto_id, lastAdded.preco_unitario);
                  if (!o) return null;
                  return (
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <span
                        className="px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider rounded border"
                        style={{ background: '#dcfce7', color: '#166534', borderColor: MONEY }}
                      >
                        Oferta
                      </span>
                      <span className="text-gray-500 tabular-nums">
                        de <span className="line-through">R$ {fmt(o.de)}</span> por R$ {fmt(lastAdded.preco_unitario)}
                      </span>
                    </div>
                  );
                })()}
                <div className="text-6xl font-bold tabular-nums mt-1" style={{ color: MONEY }}>
                  R$ {fmt(lastAdded.subtotal)}
                </div>
              </>
            ) : (
              <div className="h-32" />
            )}
          </div>
          <div className="px-5 py-5 flex-1 space-y-4 text-lg">
            <div className="flex justify-between items-baseline">
              <span className="text-gray-600">QTD. ITENS</span>
              <span className="tabular-nums font-bold text-gray-900 text-2xl">{totalItens}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-gray-600">SUBTOTAL</span>
              <span className="tabular-nums font-bold text-gray-900 text-2xl">R$ {fmt(subtotal)}</span>
            </div>
            {descontoAplicado > 0 && (
              <div className="flex justify-between items-baseline">
                <span className="text-gray-600">DESCONTO</span>
                <span className="tabular-nums font-bold text-2xl" style={{ color: RED }}>− R$ {fmt(descontoAplicado)}</span>
              </div>
            )}
            {economiaOfertas > 0.001 && (
              <div className="flex justify-between items-baseline border-t pt-3" style={{ borderColor: '#d1d5db' }}>
                <span className="text-gray-600">VOCÊ ECONOMIZOU</span>
                <span className="tabular-nums font-bold text-2xl" style={{ color: MONEY }}>R$ {fmt(economiaOfertas)}</span>
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
              ref={codeInputRef}
              value={code}
              onChange={(e) => registrarDigitacao(e.target.value)}
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
                } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && code.length === 0 && cart.length > 0) {
                  // Sem código digitado e sem sugestões: setas navegam itens do carrinho.
                  // Del em cima do selecionado remove aquele item específico.
                  e.preventDefault();
                  setSelectedCartIdx(prev => {
                    if (prev < 0) return e.key === 'ArrowUp' ? cart.length - 1 : 0;
                    if (e.key === 'ArrowUp')   return prev <= 0 ? cart.length - 1 : prev - 1;
                    return prev >= cart.length - 1 ? 0 : prev + 1;
                  });
                } else if (e.key === 'Escape' && (code.length > 0 || qtdArmada !== null)) {
                  e.preventDefault();
                  // Esc é o "desisti": limpa o campo E desarma a quantidade.
                  qtdArmadaRef.current = null;
                  setQtdArmada(null);
                  consumirCodigo();
                } else if (e.key === 'Escape' && selectedCartIdx >= 0) {
                  e.preventDefault();
                  setSelectedCartIdx(-1);
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
          {cart.length > 0 ? (
            <button
              onClick={suspenderVenda}
              className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-600"
              style={{ background: YELLOW, color: NAVY_DARK, borderColor: NAVY_DARK }}
              title="Suspender esta venda e liberar o caixa (Ctrl+G)"
            >
              ⌖ SUSPENDER
            </button>
          ) : vendaSuspensa ? (
            <button
              onClick={recuperarVendaSuspensa}
              className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 ring-2 ring-yellow-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-600"
              style={{ background: YELLOW, color: NAVY_DARK, borderColor: NAVY_DARK }}
              title={`Recuperar venda suspensa (${vendaSuspensa.cart.length} itens · suspensa às ${new Date(vendaSuspensa.suspensaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}
            >
              ⟲ RECUPERAR ({vendaSuspensa.cart.length})
            </button>
          ) : null}
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
            data-action="fechar-venda-pdv"
            onClick={openPayment}
            disabled={cart.length === 0 || isClosing}
            className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
            style={{ background: MONEY }}
            title="Subtotal / Pagamentos (F4 ou F5 · Enter no campo vazio)"
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

      {/* === MODAIS === */}

      {/* Forma de pagamento — nav por teclado: ↑↓←→ ou Tab/Shift+Tab, F1/F2/F3 atalho, Enter confirma o botão focado */}
      {paymentModalOpen && (
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
                setPagamentos([]);
                setParcialValor('');
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
              setParcialValor(formatBRL(`${centavos > 0 ? centavos : ''}${e.key}`));
              parcialInputRef.current?.focus();
              return;
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
            if (e.key === 'F1' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); handlePayChoice('Dinheiro'); return; }
            if (e.key === 'F2' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); setCardPickerIdx(0); setCardPickerOpen(true); return; }
            if (e.key === 'F3' && !e.shiftKey && !mistoActive) { e.preventDefault(); e.stopPropagation(); setPayerPickerIdx(0); setPayerPickerOpen(true); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-2xl w-full shadow-2xl my-4" style={{ borderColor: NAVY_DARK }}>
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
              <button onClick={() => setPaymentModalOpen(false)} className="text-white p-1 shrink-0" tabIndex={-1} title="Voltar para a leitura (Esc)"><X size={20} /></button>
            </div>

            {paymentError && (
              <div className="mx-6 mt-4 px-3 py-2 border-2 text-sm font-bold" style={{ background: '#fee2e2', borderColor: RED, color: RED }}>
                Erro ao fechar venda: {paymentError}
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
                className="w-full bg-white border-2 text-xl font-bold text-gray-900 tabular-nums px-3 py-1.5 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-500/30"
                style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
              />
              {/* Valor acima do restante entra cortado no restante — dizer isso ANTES
                  do clique evita a conta que nao fecha na cabeca do operador. */}
              {parcialValor && parseBRL(parcialValor) > restante + 0.001 && restante > 0 && (
                <p className="mt-1 text-[11px] font-bold" style={{ color: '#a16207' }}>
                  Valor maior que o restante (R$ {fmt(restante)}) — sera lancado so R$ {fmt(restante)}.
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
                              {p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x (R$ ${fmt(p.valor / p.parcelas)}/parc.)` : ''}
                              {temTroco ? ` · troco R$ ${fmt(p.troco!)}` : ''}
                            </div>
                            {editando ? (
                              <input
                                autoFocus
                                value={editPagValor}
                                onChange={(e) => setEditPagValor(formatBRL(parseBRL(e.target.value)))}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') { e.preventDefault(); confirmarEdicaoPagamento(); }
                                  else if (e.key === 'Escape') { e.preventDefault(); setEditPagIdx(null); setEditPagValor(''); }
                                }}
                                // Blur CANCELA a edicao (previsivel): confirma no Enter ou no lapis.
                                onBlur={() => { setEditPagIdx(null); setEditPagValor(''); }}
                                className="w-full mt-0.5 bg-white border-2 text-sm font-bold tabular-nums px-1.5 py-0.5 outline-none focus:border-blue-700"
                                style={{ borderColor: '#9ca3af', color: NAVY_DARK, fontFamily: 'Consolas, "Courier New", monospace' }}
                              />
                            ) : (
                              <span className="text-base font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.valor)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              tabIndex={-1}
                              disabled={temTroco && !editando}
                              // mousedown com preventDefault evita o blur do input (que
                              // cancela) antes do click — assim o lapis confirma o valor.
                              onMouseDown={editando ? (e) => e.preventDefault() : undefined}
                              onClick={() => editando ? confirmarEdicaoPagamento() : iniciarEdicaoPagamento(idx)}
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
                              onClick={() => {
                                setPagamentos(prev => prev.filter((_, i) => i !== idx));
                                setEditPagIdx(null);
                                setEditPagValor('');
                              }}
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
                {([
                  ['Dinheiro',       DollarSign,  'F1', 'DINHEIRO'],
                  ['Cartão Crédito', CreditCard,  'F2', 'CRÉDITO'],
                  ['Cartão Débito',  Banknote,    'F2', 'DÉBITO'],
                  ['PIX',            Wallet,      'F3', 'PIX'],
                  ['Vale-Alimentação', Wallet,    'F3', 'VALE'],
                  ['Fiado',          UsersIcon,   'F3', 'FIADO'],
                ] as const).map(([forma, Icon, hint, label], i) => {
                  const active = i === payChoiceIdx;
                  // PIX e Fiado só funcionam como forma única (sem parcial),
                  // por causa de realtime / RPC que cria conta_receber pelo
                  // valor cheio. Dinheiro e Cartão D/C aceitam misto.
                  const parcial = parseBRL(parcialValor);
                  const isMistoActive = pagamentos.length > 0 || (parcial > 0 && parcial < restante - 0.001);
                  const isPixOrFiado = forma === 'PIX' || forma === 'Fiado' || forma === 'Vale-Alimentação';
                  const isDisabled = restante <= 0.001 || (isMistoActive && isPixOrFiado);
                  return (
                    <button
                      key={forma}
                      ref={(el) => { payBtnRefs.current[i] = el; }}
                      data-pay-method={forma}
                      disabled={isDisabled}
                      onClick={() => handlePayChoice(forma as FormaPagamento)}
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
                onClick={() => { setDiscountKind('percent'); setDiscountValue(''); setDiscountModalOpen(true); }}
                disabled={subtotal <= 0 || pagamentos.length > 0}
                className="py-2 text-[11px] font-black uppercase tracking-wider border-2 disabled:opacity-30 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
                title={pagamentos.length > 0
                  ? 'Com pagamento lançado o total não muda mais — remova os pagamentos para dar desconto'
                  : 'Desconto no total (F6)'}
              >
                {descontoAplicado > 0 ? `− R$ ${fmt(descontoAplicado)} · F6 DESCONTO` : 'F6 DESCONTO'}
              </button>
              <button
                data-extra-action="cpf"
                tabIndex={-1}
                onClick={() => { setCpfInput(cpfNota ? mascararDocumento(cpfNota) : ''); setCpfModalOpen(true); }}
                className="py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                title="CPF / CNPJ na nota"
              >
                {cpfNota ? `CPF: ${mascararDocumento(cpfNota)}` : '+ CPF NA NOTA'}
              </button>
              <button
                data-extra-action="cliente"
                tabIndex={-1}
                onClick={() => { setClientSearch(''); setClientPickerModo('vincular'); setClientPickerOpen(true); }}
                className="col-span-2 py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                title="Vincular cliente à venda"
              >
                <UsersIcon size={12} />
                {clienteVinculado ? `CLIENTE: ${clienteVinculado.nome.toUpperCase()}` : '+ VINCULAR CLIENTE'}
                {clienteVinculado && (
                  <span
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); setClienteVinculado(null); }}
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
                onClick={() => {
                  if (pagamentos.length > 0) {
                    setPagamentos([]);
                    showToast?.('Pagamentos lançados descartados.', 'success');
                  }
                  setParcialValor('');
                  // Os extras são desta venda, não do operador: voltar à leitura
                  // devolve documento e cliente ao estado vazio (padrão MaxPOS).
                  setCpfNota('');
                  setClienteVinculado(null);
                  setPaymentModalOpen(false);
                }}
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
                onClick={cancelSale}
                className="px-4 py-3 text-white text-sm font-bold hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-400"
                style={{ background: RED }}
                title="Cancelar venda (F9)"
              >
                CANCELAR
              </button>
              <button
                data-action="confirmar-venda"
                onClick={finalizarVendaMisto}
                disabled={pagamentos.length === 0 || restante > 0.001 || isClosing}
                className="flex-1 px-5 py-3 text-white font-black uppercase tracking-wide text-base disabled:opacity-30 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
                style={{ background: MONEY }}
                title="Confirma a venda quando o restante chega a R$ 0,00"
              >
                {isClosing
                  ? <><Loader2 size={20} className="animate-spin" /> SALVANDO...</>
                  : restante > 0.001
                    ? `FALTAM R$ ${fmt(restante)}`
                    : 'FECHAR VENDA (Enter)'}
              </button>
            </div>

            <div className="px-6 pb-4 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
              ↑↓←→ navegar · Enter confirmar · Esc voltar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado · F6 Desconto · F9 Cancelar
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
              setReciboModalOpen(true);
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
              onClick={() => { setChangeModal(null); setReciboModalOpen(true); }}
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
          onClick={(e) => { if (e.target === e.currentTarget) { setHelpOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); } }}
          tabIndex={-1}
          ref={(el) => { if (el && helpOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHelpOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }
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
              <button onClick={() => { setHelpOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }} className="w-9 h-9 rounded-full flex items-center justify-center border-2 hover:bg-white/40" style={{ borderColor: NAVY_DARK, color: NAVY_DARK }} aria-label="Fechar">
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
                  <li>Pra deixar dinheiro no caixa (troco inicial, reforço): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F11</kbd>. Pra retirar (depósito, pagto fornecedor): <kbd className="px-1 py-0.5 text-xs font-mono border rounded font-bold" style={{ background: '#f3f4f6', borderColor: NAVY_DARK, color: NAVY_DARK }}>F12</kbd> — sempre registrando o motivo.</li>
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
      )}

      {/* Recibo — resumo da venda com opção de baixar PDF antes do agradecimento */}
      {reciboModalOpen && lastVenda && (
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && reciboModalOpen) { const btn = el.querySelector<HTMLButtonElement>('button:last-of-type'); if (btn) btn.focus(); else el.focus(); } }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
              e.preventDefault(); e.stopPropagation();
              setReciboModalOpen(false);
              setThankYouOpen(true);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
            } else {
              e.stopPropagation();
            }
          }}
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ border: `3px solid ${NAVY_DARK}` }}>
            <div className="px-5 py-4 text-center" style={{ background: NAVY_DARK, color: 'white' }}>
              <div className="text-xs font-bold uppercase tracking-[0.3em] opacity-70">Venda concluída</div>
              <div className="text-3xl font-black tabular-nums mt-1" style={{ color: YELLOW }}>
                R$ {fmt(lastVenda.total)}
              </div>
              <div className="text-xs font-mono opacity-60 mt-1">#{lastVenda.id}</div>
            </div>
            <div className="px-5 py-3 max-h-[40vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b" style={{ color: NAVY_DARK }}>
                    <th className="text-left py-1 font-bold">Item</th>
                    <th className="text-center py-1 font-bold w-12">Qtd</th>
                    <th className="text-right py-1 font-bold w-20">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lastVenda.itens.map((it, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1 text-gray-700">{it.nome_produto}</td>
                      <td className="py-1 text-center text-gray-500">{it.qtd}</td>
                      <td className="py-1 text-right font-mono text-gray-700">R$ {fmt(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(lastVenda.economia ?? 0) > 0.001 && (
                <div className="flex justify-between text-xs mt-2 font-bold" style={{ color: MONEY }}>
                  <span>Você economizou</span>
                  <span>R$ {fmt(lastVenda.economia!)}</span>
                </div>
              )}
              {lastVenda.desconto > 0 && (
                <div className="flex justify-between text-xs mt-2 text-red-600 font-bold">
                  <span>Desconto</span>
                  <span>- R$ {fmt(lastVenda.desconto)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm mt-2 font-black" style={{ color: NAVY_DARK }}>
                <span>Total</span>
                <span>R$ {fmt(lastVenda.total)}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">{lastVenda.forma}</div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-2 border-t">
              <button
                onClick={() => gerarReciboVendaPDF({
                  id: lastVenda.id,
                  shortId: lastVenda.id,
                  data: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' }),
                  hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Rio_Branco', hour: '2-digit', minute: '2-digit' }),
                  filial,
                  cliente: lastVenda.cliente,
                  cpfNota: lastVenda.cpfNota ?? null,
                  economia: lastVenda.economia ?? null,
                  operador: operadorNome,
                  itens: lastVenda.itens,
                  subtotal: lastVenda.subtotal,
                  desconto: lastVenda.desconto,
                  total: lastVenda.total,
                  formaPagamento: lastVenda.forma,
                })}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:brightness-110 transition"
                style={{ background: NAVY_DARK, color: 'white' }}
              >
                <FileDown size={16} /> Baixar Recibo (PDF)
              </button>
              <button
                onClick={() => { setReciboModalOpen(false); setThankYouOpen(true); }}
                className="w-full px-4 py-3 rounded-lg text-base font-black uppercase tracking-wider hover:brightness-110 transition"
                style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
                autoFocus
              >
                Continuar · Enter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agradecimento — tela final supermercado (só fecha com Enter) */}
      {thankYouOpen && (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.98)' }}
          tabIndex={-1}
          ref={(el) => { if (el && thankYouOpen) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              setThankYouOpen(false);
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
              <span className="font-black tracking-wide text-sm uppercase">
                {clientPickerModo === 'fiado' ? 'Fiado · Selecione o cliente' : 'Vincular cliente à venda'}
              </span>
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
                    if (pick) escolherCliente(pick);
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
                      onClick={() => escolherCliente(c)}
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
          // contains(activeElement): a callback ref roda a cada render (nova
          // identidade sempre); sem a guarda o foco era arrancado de volta pro
          // overlay a cada refetch/tick enquanto o cliente pagava.
          ref={(el) => { if (el && pixModal && !confirmPixCancel && !el.contains(document.activeElement)) el.focus(); }}
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
                    value={buildPixQrValue(pixModal.id)}
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
                {/* O mesmo número que a MaxPay mostra no desempate. */}
                <div className="text-xs font-black uppercase tracking-widest text-gray-600 mt-2">
                  Cobrança nº <span className="font-mono tracking-normal" style={{ color: NAVY_DARK }}>{codigoCobranca(pixModal.id)}</span>
                </div>
              </div>
              {pixError ? (
                <div className="border-2 p-4 space-y-3 text-left" style={{ borderColor: RED }}>
                  <div className="text-xs font-black uppercase tracking-widest" style={{ color: RED }}>
                    ⚠ PIX recebido — falha ao registrar venda
                  </div>
                  <div className="text-sm text-gray-900 font-mono whitespace-pre-wrap break-words bg-gray-50 p-2 border" style={{ borderColor: '#d1d5db' }}>
                    {pixError}
                  </div>
                  <div className="text-xs text-gray-700 leading-relaxed">
                    O cliente já pagou no MaxBank. <b>NÃO cancele</b> — corrija o problema acima e clique em Tentar Novamente.
                  </div>
                  <button
                    onClick={processarPagamentoPix}
                    disabled={pixProcessing}
                    className="w-full px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-50"
                    style={{ background: NAVY_DARK }}
                  >
                    {pixProcessing ? 'Tentando...' : 'Tentar Novamente'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-700 leading-relaxed">
                  Cliente lê o QR no <b>MaxBank</b>. A venda fecha sozinha quando o pagamento for confirmado.
                  {/* A MaxPay acha a cobrança pelo VALOR (janela de 5 min), não pelo
                      QR: sem dizer isso, o operador digita um valor arredondado,
                      a maquininha não casa nada e fica em "aguardando" para sempre. */}
                  <br /><span className="text-gray-600">Pela <b>MaxPay</b>, cobre <b>este mesmo valor</b> — é assim que ela acha a cobrança.
                  Havendo outra do mesmo valor, ela pergunta qual: informe o <b>nº acima</b>.</span>
                </p>
              )}
              <button
                onClick={() => setConfirmPixCancel(true)}
                className="w-full px-4 py-3 border-2 text-gray-700 font-bold uppercase text-sm tracking-wide"
                style={{ borderColor: '#9ca3af' }}
              >
                {pixError ? 'Descartar (PIX já pago — vai perder o registro)' : 'Cancelar PIX'}
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

      {/* Cartão (Maquininha) aguardando — MaxPay/MaxBank autoriza */}
      {cartaoModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && cartaoModal && !confirmCartaoCancel && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !confirmCartaoCancel) {
              e.preventDefault(); e.stopPropagation();
              setConfirmCartaoCancel(true);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Aguardando maquininha</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">
                Cartão {cartaoModal.metodo === 'debito' ? 'Débito' : 'Crédito'}
                {cartaoModal.parcelas > 1 && ` ${cartaoModal.parcelas}x`}
              </div>
            </div>
            <div className="p-6 space-y-4 text-center">
              <div className="flex justify-center">
                <div className="p-3 bg-white border-4" style={{ borderColor: NAVY_DARK }}>
                  <QRCodeSVG
                    value={buildCartaoQrValue(cartaoModal.id)}
                    size={220}
                    level="M"
                  />
                </div>
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-gray-600 mb-1">Valor</div>
                <div className="text-4xl font-black tabular-nums" style={{ color: MONEY }}>
                  R$ {fmt(cartaoModal.valor)}
                </div>
                <div className="text-xs font-black uppercase tracking-widest text-gray-600 mt-2">
                  Cobrança nº <span className="font-mono tracking-normal" style={{ color: NAVY_DARK }}>{codigoCobranca(cartaoModal.id)}</span>
                </div>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                Operador digita o valor na <b>MaxPay</b> e o cliente aproxima o cartão (lendo o QR no <b>MaxBank</b>). A venda fecha sozinha quando for autorizado.
                Se a maquininha perguntar qual cobrança é, informe o <b>nº acima</b>.
              </p>
              <button
                onClick={() => setConfirmCartaoCancel(true)}
                className="w-full px-4 py-3 border-2 text-gray-700 font-bold uppercase text-sm tracking-wide"
                style={{ borderColor: '#9ca3af' }}
              >
                Cancelar Cartão
              </button>
            </div>
          </div>

          {confirmCartaoCancel && (
            <div
              className="fixed inset-0 z-[215] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.85)' }}
              tabIndex={-1}
              ref={(el) => { if (el && confirmCartaoCancel) el.focus(); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmCartaoCancel(false); return; }
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cancelarCartao(); return; }
                if (/^F\d+$/.test(e.key)) e.stopPropagation();
              }}
            >
              <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: RED }}>
                <div className="px-5 py-4 text-white" style={{ background: RED }}>
                  <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Confirmar</div>
                  <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar Cartão?</div>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Se o cliente já autorizou no MaxBank, este cancelamento <b>não estorna</b> o valor — é só do nosso lado.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmCartaoCancel(false)}
                      autoFocus
                      className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                      style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                    >
                      Voltar (Esc)
                    </button>
                    <button
                      onClick={cancelarCartao}
                      className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
                      style={{ background: RED }}
                    >
                      Cancelar (Enter)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmar cancelar venda — ← → escolher · Enter confirma · Esc volta */}
      {/* Autorização do gerente para o desconto (padrão "desconto supervisionado"
          dos PDVs de supermercado: o operador pede, o gerente libera). */}
      {descAuth && (
        <div
          className="fixed inset-0 z-[205] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && descAuth && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              setDescAuth(null); setDescAuthSenha('');
              requestAnimationFrame(() => codeInputRef.current?.focus());
              return;
            }
            if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
              e.preventDefault(); e.stopPropagation();
              if (!descAuthLoading) confirmarAutorizacaoDesconto();
              return;
            }
            if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Autorização do gerente</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Desconto de R$ {fmt(descAuth.valor)}</div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                No caixa, desconto sai com o gerente de <b>{filial}</b> — é para divergência de etiqueta
                e avaria, não para negociação. Promoção já vem no preço. O motivo fica gravado na venda.
              </p>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Motivo</label>
                <select
                  value={descAuthMotivo}
                  onChange={(e) => setDescAuthMotivo(e.target.value)}
                  className="w-full bg-white border-2 text-sm font-bold px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  <option>Divergência de preço na gôndola</option>
                  <option>Produto avariado</option>
                  <option>Produto perto do vencimento</option>
                  <option value="Outro">Outro (descrever)</option>
                </select>
              </div>
              {descAuthMotivo === 'Outro' && (
                <input
                  type="text"
                  maxLength={120}
                  value={descAuthObs}
                  onChange={(e) => setDescAuthObs(e.target.value)}
                  placeholder="Descreva o motivo"
                  className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              )}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">E-mail do gerente</label>
                <input
                  autoFocus
                  type="email"
                  autoComplete="off"
                  value={descAuthEmail}
                  onChange={(e) => setDescAuthEmail(e.target.value)}
                  placeholder="gerente@empresa.com"
                  className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Senha</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={descAuthSenha}
                  onChange={(e) => setDescAuthSenha(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setDescAuth(null); setDescAuthSenha(''); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
                  className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarAutorizacaoDesconto}
                  disabled={descAuthLoading}
                  className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: NAVY_DARK }}
                >
                  {descAuthLoading ? <><Loader2 size={16} className="animate-spin" /> Conferindo…</> : 'Autorizar (Enter)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gancheira ocupada — suspender de novo descarta a venda que está lá. */}
      {confirmSuspender && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && confirmSuspender && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              setConfirmSuspender(false);
              requestAnimationFrame(() => codeInputRef.current?.focus());
              return;
            }
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSuspenderVenda(); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: YELLOW_DARK }}>
            <div className="px-5 py-4" style={{ background: YELLOW, color: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-80">Gancheira ocupada</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Já há uma venda suspensa</div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                A gancheira guarda <b>uma venda por vez</b>. A que está lá tem{' '}
                <b>{vendaSuspensa?.cart.length ?? 0} item(s)</b>, suspensa às{' '}
                <b>{vendaSuspensa ? new Date(vendaSuspensa.suspensaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</b>.
                Suspender esta descarta aquela.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmSuspender(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
                  className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  Voltar
                </button>
                <button
                  onClick={doSuspenderVenda}
                  className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
                  style={{ background: NAVY_DARK }}
                >
                  Suspender (Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmCancel && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          tabIndex={-1}
          ref={(el) => { if (el && confirmCancel) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirmCancel(false); requestAnimationFrame(() => codeInputRef.current?.focus()); return; }
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
              else { setConfirmCancel(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }
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
                  onClick={() => { setConfirmCancel(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
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

      {/* Busca de produto (F8) — ↑↓ navega · Enter adiciona · Esc fecha */}
      {searchModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSearchModalOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="w-full max-w-4xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase flex items-center gap-2">
                <Search size={16} /> F8 · Busca de produtos
                {qtdDoF8 !== 1 && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-black" style={{ background: YELLOW, color: NAVY_DARK }}>
                    QTD {fmtQtd(qtdDoF8)} ×
                  </span>
                )}
              </span>
              <button onClick={() => { setSearchModalOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
            </div>
            <div className="p-4">
              <input
                autoFocus
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setSearchIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setSearchModalOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); return; }
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
                      addToCart(pick, buscaF8.temMultiplicador ? buscaF8.qtd : undefined);
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
                      onClick={() => {
                        addToCart(p, buscaF8.temMultiplicador ? buscaF8.qtd : undefined);
                        setSearchModalOpen(false);
                        codeInputRef.current?.focus();
                      }}
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
                ↑↓ navegar · Enter adicionar {qtdDoF8 !== 1 && (
                  <span style={{ color: NAVY_DARK }}>({fmtQtd(qtdDoF8)} un)</span>
                )} · Esc voltar
              </div>
              <div className="mt-1 text-[11px] text-gray-400 text-center">
                Para vários do mesmo item, digite <b>2*</b> antes do nome (ex.: <b>2*feijao</b>).
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
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPriceQueryOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="w-full max-w-3xl mt-12 bg-white border-4 shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase">F7 · Consulta de preço</span>
              <button onClick={() => { setPriceQueryOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }} className="text-white p-1" tabIndex={-1}><X size={18} /></button>
            </div>
            <div className="p-4">
              <input
                autoFocus
                value={priceQueryTerm}
                onChange={(e) => { setPriceQueryTerm(e.target.value); setPriceQueryIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setPriceQueryOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); return; }
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

      {/* Reimpressão (Ctrl+R) — últimas 10 vendas concluídas da filial nesta sessão */}
      {reprintOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          tabIndex={-1}
          ref={(el) => { if (el && reprintOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              setReprintOpen(false);
              requestAnimationFrame(() => codeInputRef.current?.focus());
              return;
            }
            if (reprintLoading || reprintList.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault(); e.stopPropagation();
              setReprintIdx(i => Math.min(i + 1, reprintList.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault(); e.stopPropagation();
              setReprintIdx(i => Math.max(i - 1, 0));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              const v = reprintList[reprintIdx];
              if (v) confirmReprint(v.id);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-2xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK, fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <div className="px-5 py-4 text-white flex items-center justify-between" style={{ background: NAVY_DARK }}>
              <div className="flex items-center gap-2">
                <Receipt size={20} />
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Ctrl+R · Reimpressão</div>
                  <div className="text-lg font-black tracking-wide">Últimas vendas desta sessão</div>
                </div>
              </div>
              <button
                onClick={() => { setReprintOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
                className="text-white p-1" tabIndex={-1}
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {reprintLoading ? (
                <div className="text-center py-10 text-gray-500 flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin" size={28} />
                  <span className="text-sm font-bold uppercase tracking-wider">Carregando vendas…</span>
                </div>
              ) : reprintList.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-sm">
                  Nenhuma venda concluída nesta sessão do PDV.
                </div>
              ) : (
                <div className="border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
                  <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white grid grid-cols-[110px_1fr_120px_100px] gap-2" style={{ background: NAVY_DARK }}>
                    <span>ID</span>
                    <span>Forma de pagamento</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Hora</span>
                  </div>
                  {reprintList.map((v, idx) => {
                    const hh = new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onMouseEnter={() => setReprintIdx(idx)}
                        onClick={() => confirmReprint(v.id)}
                        className={`w-full grid grid-cols-[110px_1fr_120px_100px] gap-2 px-3 py-2 text-sm tabular-nums text-left border-b border-gray-200 last:border-b-0 ${idx === reprintIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                      >
                        <span className="font-mono text-gray-600 truncate">#{String(v.id).slice(-6).toUpperCase()}</span>
                        <span className="truncate font-bold text-gray-900">{v.forma_pagamento || '—'}</span>
                        <span className="text-right font-black" style={{ color: MONEY }}>R$ {fmt(Number(v.total_final ?? 0))}</span>
                        <span className="text-right text-gray-500">{hh}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center pt-3">
                ↑↓ navegar · Enter reimprimir · Esc voltar
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Picker PIX/Fiado (F3 no payment modal) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {/* CPF / CNPJ na nota — mesmo modal do MaxPOS. Vazio + confirmar remove. */}
      {cpfModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          tabIndex={-1}
          ref={(el) => { if (el && cpfModalOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCpfModalOpen(false); return; }
            if (e.key === 'Enter') {
              if ((e.target as HTMLElement)?.tagName === 'BUTTON') { e.stopPropagation(); return; }
              e.preventDefault(); e.stopPropagation(); confirmarCpf();
              return;
            }
            if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase">CPF / CNPJ na nota</span>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-600">
                Informe CPF (11 dígitos) ou CNPJ (14 dígitos). Deixe vazio e confirme para remover.
              </p>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Documento</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={cpfInput}
                  onChange={(e) => setCpfInput(mascararDocumento(e.target.value))}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="000.000.000-00"
                  className="w-full bg-white border-2 text-2xl font-bold text-gray-900 tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setCpfModalOpen(false)}
                  className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                  style={{ borderColor: '#9ca3af' }}
                >
                  CANCELAR
                </button>
                <button
                  onClick={confirmarCpf}
                  className="flex-1 px-4 py-3 text-white font-bold"
                  style={{ background: NAVY_DARK }}
                >
                  CONFIRMAR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vale-Alimentação — a maquininha do voucher pede os 4 últimos dígitos.
          Simulação, igual ao MaxPOS: qualquer combinação de 4 autoriza. */}
      {valeModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          tabIndex={-1}
          ref={(el) => { if (el && valeModal && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              setValeModal(null); setValeDigitos(''); setPaymentModalOpen(true);
              return;
            }
            if (e.key === 'Enter') {
              if ((e.target as HTMLElement)?.tagName === 'BUTTON') { e.stopPropagation(); return; }
              e.preventDefault(); e.stopPropagation(); confirmarVale();
              return;
            }
            if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-sm w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
              <span className="font-black tracking-wide text-sm uppercase">Vale-Alimentação · Autorização</span>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-600">
                Peça ao cliente os <b>4 últimos dígitos</b> do cartão Vale. É simulação — qualquer combinação de 4 dígitos autoriza.
              </p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Valor</span>
                <span className="font-bold tabular-nums">R$ {fmt(valeModal.valor)}</span>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Últimos 4 dígitos</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={valeDigitos}
                  onChange={(e) => setValeDigitos(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0000"
                  className="w-full bg-white border-2 text-3xl font-bold text-gray-900 tabular-nums text-center tracking-[0.4em] px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setValeModal(null); setValeDigitos(''); setPaymentModalOpen(true); }}
                  className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                  style={{ borderColor: '#9ca3af' }}
                >
                  CANCELAR
                </button>
                <button
                  onClick={confirmarVale}
                  disabled={!/^\d{4}$/.test(valeDigitos) || isClosing}
                  className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ background: NAVY_DARK }}
                >
                  {isClosing ? <><Loader2 size={18} className="animate-spin" /> ...</> : 'AUTORIZAR'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {payerPickerOpen && (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          tabIndex={-1}
          ref={(el) => { if (el && payerPickerOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPayerPickerOpen(false); return; }
            if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              e.preventDefault(); e.stopPropagation();
              setPayerPickerIdx(i => (i + 1) % 3);
              return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              e.preventDefault(); e.stopPropagation();
              setPayerPickerIdx(i => (i + 2) % 3);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              const forma: FormaPagamento = payerPickerIdx === 0 ? 'PIX' : payerPickerIdx === 1 ? 'Vale-Alimentação' : 'Fiado';
              setPayerPickerOpen(false);
              handlePayChoice(forma);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F3 · Outras formas</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">PIX, Vale ou Fiado?</div>
            </div>
            <div className="p-6 space-y-3">
              {([
                { forma: 'PIX' as const,              Icon: Wallet },
                { forma: 'Vale-Alimentação' as const, Icon: Wallet },
                { forma: 'Fiado' as const,            Icon: UsersIcon },
              ]).map(({ forma, Icon }, idx) => {
                const active = idx === payerPickerIdx;
                return (
                  <button
                    key={forma}
                    onClick={() => { setPayerPickerOpen(false); handlePayChoice(forma); }}
                    onMouseEnter={() => setPayerPickerIdx(idx)}
                    className={`w-full border-2 px-4 py-4 flex items-center gap-3 font-black uppercase tracking-wide text-left ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                    style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                  >
                    <Icon size={22} />
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

      {/* Parcelas Cartão Crédito (1x-12x) — só forma única; misto não pergunta */}
      {parcelasModalOpen && (() => {
        const parcial = parseBRL(parcialValor);
        const valorDevido = parcial > 0 ? Math.min(parcial, restante) : restante;
        return (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          tabIndex={-1}
          ref={(el) => { if (el && parcelasModalOpen && !el.contains(document.activeElement)) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setParcelasModalOpen(false); return; }
            if (e.key === 'Tab') {
              e.preventDefault(); e.stopPropagation();
              setParcelasIdx(i => (i + 1) % 12);
              return;
            }
            if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setParcelasIdx(i => Math.min(i + 1, 11)); return; }
            if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setParcelasIdx(i => Math.max(i - 1, 0)); return; }
            if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); setParcelasIdx(i => Math.min(i + 4, 11)); return; }
            if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); setParcelasIdx(i => Math.max(i - 4, 0)); return; }
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              confirmarParcelas(parcelasIdx + 1);
              return;
            }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-xl w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Cartão Crédito</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Em quantas parcelas? · R$ {fmt(valorDevido)}</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
                  const active = n - 1 === parcelasIdx;
                  const valorParcela = Math.ceil(valorDevido * 100 / n) / 100;
                  return (
                    <button
                      key={n}
                      onClick={() => confirmarParcelas(n)}
                      onMouseEnter={() => setParcelasIdx(n - 1)}
                      className={`border-2 px-2 py-3 flex flex-col items-center gap-0.5 font-black uppercase tracking-wide ${active ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                      style={{ borderColor: active ? NAVY_DARK : '#cbd5e1', color: NAVY_DARK, boxShadow: active ? `inset 0 0 0 2px ${NAVY_DARK}` : undefined }}
                    >
                      <span className="text-lg">{n}x</span>
                      <span className="text-[10px] text-gray-600 tabular-nums normal-case">
                        {n === 1 ? 'à vista' : `R$ ${fmt(valorParcela)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                ↑↓←→ navegar · Enter confirmar · Esc voltar
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Desconto (F6) — % ou R$ aplicado no total · Enter aplica · Esc cancela */}
      {discountModalOpen && (() => {
        const parsed = parseBRL(discountValue);
        const valorReais = discountKind === 'percent'
          ? parseFloat(((subtotal * parsed) / 100).toFixed(2))
          : parsed;
        const valorClamp = Math.min(valorReais, subtotal);
        const novoTotal = Math.max(0, subtotal - valorClamp);
        const fecharDesconto = () => {
          setDiscountModalOpen(false);
          requestAnimationFrame(() => codeInputRef.current?.focus());
        };
        const aplicar = () => {
          if (valorClamp <= 0) { showToast?.('Informe um desconto maior que zero.', 'error', true); return; }
          // Não aplica aqui: em supermercado o desconto sai com a senha do
          // gerente. O modal seguinte pede a autorização e o motivo.
          setDiscountModalOpen(false);
          setDescAuth({ valor: valorClamp });
        };
        return (
          <div
            className="fixed inset-0 z-[195] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharDesconto(); }
              if (e.key === '%') { e.preventDefault(); setDiscountKind('percent'); }
              if (e.key === '$') { e.preventDefault(); setDiscountKind('reais'); }
              if (/^F\d+$/.test(e.key)) e.stopPropagation();
            }}
          >
            <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
              <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
                <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F6 · Desconto no total (com o gerente)</div>
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
                      if (e.key === 'Escape') { e.preventDefault(); fecharDesconto(); }
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
                  <button onClick={() => { setDesconto(0); setDescontoAutorizacao(null); fecharDesconto(); }} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
                    {desconto > 0 ? 'Remover' : 'Voltar'}
                  </button>
                  <button onClick={aplicar} className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm" style={{ background: NAVY_DARK }}>
                    Pedir autorização (Enter)
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
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCashMoveModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }
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
                    if (e.key === 'Escape') { e.preventDefault(); setCashMoveModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }
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
                    if (e.key === 'Escape') { e.preventDefault(); setCashMoveModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }
                  }}
                  placeholder={cashMoveModal.tipo === 'sangria' ? 'Depósito no banco, pagto fornecedor...' : 'Troco inicial, reforço...'}
                  className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setCashMoveModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }} className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm" style={{ borderColor: '#9ca3af', color: NAVY_DARK }}>
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

      {/* Modal fechar/suspender caixa pelo operador (F3) */}
      {caixaOpModal && (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCaixaOpModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-lg w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
            <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">F3 · Operador</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Fechar / Suspender Caixa</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setCaixaOpModal('fechar')}
                  className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm flex items-center justify-center gap-2 ${caixaOpModal === 'fechar' ? 'text-white' : ''}`}
                  style={caixaOpModal === 'fechar' ? { background: RED, borderColor: RED, color: 'white' } : { borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  <Calculator size={16} /> Fechar
                </button>
                <button
                  onClick={() => setCaixaOpModal('suspender')}
                  className={`flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm flex items-center justify-center gap-2 ${caixaOpModal === 'suspender' ? 'text-white' : ''}`}
                  style={caixaOpModal === 'suspender' ? { background: YELLOW_DARK, borderColor: YELLOW_DARK, color: 'white' } : { borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  <PauseCircle size={16} /> Suspender
                </button>
              </div>

              {caixaOpModal === 'fechar' && (
                <>
                  <p className="text-xs text-gray-500">
                    Conte o dinheiro fisicamente e informe abaixo. O sistema calcula o esperado e mostra a diferença para conferência do financeiro.
                  </p>
                  <div>
                    <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Valor contado em dinheiro</label>
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      value={caixaOpValor}
                      onChange={(e) => setCaixaOpValor(formatBRL(parseBRL(e.target.value)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleCaixaOpConfirm(); }
                      }}
                      placeholder="0,00"
                      className="w-full border-2 text-3xl font-black tabular-nums px-3 py-2 outline-none focus:border-blue-700"
                      style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                    />
                  </div>
                </>
              )}
              {caixaOpModal === 'suspender' && (
                <p className="text-xs text-gray-500">
                  Suspender pausa o caixa temporariamente (troca de turno, intervalo). O financeiro poderá reabrir ou fechar definitivamente.
                </p>
              )}

              <div>
                <label className="text-xs font-black uppercase tracking-widest text-gray-600 block mb-2">Observação (opcional)</label>
                <input
                  autoFocus={caixaOpModal === 'suspender'}
                  type="text"
                  value={caixaOpObs}
                  onChange={(e) => setCaixaOpObs(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCaixaOpConfirm(); }
                  }}
                  placeholder={caixaOpModal === 'suspender' ? 'Ex: troca de turno, intervalo...' : 'Ex: fechamento fim do expediente'}
                  className="w-full border-2 text-base px-3 py-2 outline-none focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setCaixaOpModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
                  className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                  style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
                >
                  Voltar
                </button>
                <button
                  onClick={handleCaixaOpConfirm}
                  disabled={isClosing || (caixaOpModal === 'fechar' && parseBRL(caixaOpValor) <= 0)}
                  className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ background: caixaOpModal === 'fechar' ? RED : YELLOW_DARK }}
                >
                  {isClosing
                    ? <><Loader2 size={16} className="animate-spin" /> Processando...</>
                    : caixaOpModal === 'fechar' ? 'Fechar caixa (Enter)' : 'Suspender caixa (Enter)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </motion.div>
  );
};

const Header = ({
  operadorNome, cupomSeq, caixaAberto, datetime, onSwitchFilial, fullscreen, onToggleFullscreen, onOpenHelp, extraActions,
}: {
  operadorNome: string;
  cupomSeq: string;
  caixaAberto: boolean;
  datetime: string;
  onSwitchFilial?: (filial: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenHelp: () => void;
  extraActions?: React.ReactNode;
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
      {extraActions}
      {onSwitchFilial && (
        <button
          type="button"
          onClick={() => onSwitchFilial('')}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 bg-white flex items-center gap-1.5"
          style={{ color: NAVY_DARK, borderColor: NAVY_DARK }}
          title="Trocar de PDV (Ctrl+M)"
        >
          Trocar PDV
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFullscreen}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2"
        style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
        title={fullscreen ? 'Sair tela cheia (Esc · Ctrl+F)' : 'Entrar em tela cheia (Ctrl+F)'}
        aria-label={fullscreen ? 'Sair tela cheia' : 'Entrar em tela cheia'}
      >
        {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
      <button
        type="button"
        onClick={onOpenHelp}
        className="w-11 h-11 rounded-full flex items-center justify-center font-black border-2 hover:brightness-110"
        style={{ background: NAVY_DARK, color: YELLOW, borderColor: NAVY_DARK }}
        title="Manual do PDV (Shift+F1 ou ?)"
        aria-label="Manual do PDV"
      >
        <HelpCircle size={20} />
      </button>
    </div>
  </div>
);
