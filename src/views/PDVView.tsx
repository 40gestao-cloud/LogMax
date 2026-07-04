import { isConselheiro } from '../lib/rbac';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trash2, Plus, Minus, ShoppingCart, CheckCircle2, X, Loader2, User, AlertTriangle, Lock, CreditCard, Smartphone, QrCode, FileDown, Scale, Ticket, Maximize2, Minimize2, Package, ArrowLeft, Store } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useCaixaAberto } from '../hooks/useCaixaAberto';
import { useAuth } from '../hooks/useAuth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { LoadingSpinner, FilialBadge, ProdutoThumb } from '../components/ui';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { playBeep, playKaching, playPlim } from '../utils/audioUtils';
import { FILIAL_COLOR } from '../lib/filiais';
import type { Produto, Cliente } from '../types/domain';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { downloadCatalogoEan13Pdf } from '../lib/barcode';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { PDVViewSupermax } from './PDVViewSupermax';

// Unidades operacionais do PDV. Matriz é administrativa, não vende — fica fora.
// Cada filial tem caixa próprio em `controle_caixa`; PDV só opera com o caixa
// daquela unidade aberto. Colaborador é travado na própria filial; admin/CEO/
// gerente podem alternar entre as três.
const FILIAIS_PDV = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialPDV = typeof FILIAIS_PDV[number];

// Unidades em que a venda é por peso/volume — o PDV pede peso em vez de
// incrementar +1. Operador digita "1,250" pra 1 kg e 250 g.
const UNIDADES_FRACIONARIAS = new Set(['KG', 'L', 'M', 'M²', 'M³']);
const isProdutoFracionario = (p: any): boolean =>
  UNIDADES_FRACIONARIAS.has(String(p?.unidade ?? 'UN').toUpperCase());

const formatQtd = (qtd: number, unidade: string): string => {
  const u = (unidade || 'UN').toUpperCase();
  if (UNIDADES_FRACIONARIAS.has(u)) {
    return qtd.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return String(Math.round(qtd));
};

const podeAlternarFilial = (profile: any): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile) || profile?.role === 'gerente';

interface CartItem {
  produto_id: string;
  nome_produto: string;
  preco_unitario: number;
  qtd: number;
  subtotal: number;
  estoque: number;
  unidade: string;
}

const FORMAS = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX', 'Fiado', 'MaxBank Benefícios'];
// Formas elegíveis pra cobrir o resto quando "MaxBank Benefícios" não cobre tudo.
// Fiado fora — mistura crédito a prazo com débito imediato fica confuso pra v1.
const FORMA_RESTO_OPTIONS = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX'] as const;

const FILIAL_META: Record<FilialPDV, { logo: string; desc: string; logoBg?: string }> = {
  SuperMax: { logo: '/icon-supermax.png', desc: 'Supermercado', logoBg: '#ffffff' },
  MaxLook:  { logo: '/icon-maxlook.png',  desc: 'Roupas, Calçados e Acessórios Femininos e Masculinos' },
  TechMax:  { logo: '/icon-techmax.png',  desc: 'Eletrônicos e Assistência Técnica' },
};

export const PDVView = ({ showToast, profile }: any) => {
  const podeAlternar = podeAlternarFilial(profile);
  const filialDoOperador: FilialPDV | null =
    (FILIAIS_PDV as readonly string[]).includes(profile?.filial)
      ? (profile.filial as FilialPDV)
      : null;
  const [filialEscolhida, setFilialEscolhida] = useState<FilialPDV | null>(
    podeAlternar ? null : (filialDoOperador ?? null)
  );

  if (!podeAlternar && !filialDoOperador) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
        <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
          <Lock size={28} className="text-gray-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-300">Sem filial operacional</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-xs">
            Seu perfil está em <span className="text-gray-300 font-bold">{profile?.filial ?? '—'}</span>, que não opera PDV.
          </p>
        </div>
      </div>
    );
  }

  if (filialEscolhida) {
    return (
      <PDVViewInner
        showToast={showToast}
        profile={profile}
        filialInicial={filialEscolhida}
        onVoltar={podeAlternar ? () => setFilialEscolhida(null) : undefined}
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex flex-col items-center justify-center gap-8 py-12 px-4">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-black text-accent tracking-tight">Ponto de Venda</h2>
        <p className="text-sm text-gray-400 mt-2">Selecione o PDV que deseja operar.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {FILIAIS_PDV.map(f => {
          const cor = FILIAL_COLOR[f];
          const meta = FILIAL_META[f];
          return (
            <motion.button
              key={f}
              onClick={() => setFilialEscolhida(f)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className={`neu-button rounded-2xl p-6 flex flex-col items-center gap-4 text-center transition-all border-2 ${cor.border} hover:border-accent`}
            >
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center overflow-hidden"
                style={meta.logoBg ? { background: meta.logoBg } : undefined}>
                <img src={meta.logo} alt={f} className={meta.logoBg ? 'w-[88px] h-[88px] object-contain' : 'w-20 h-20 object-contain rounded-2xl'} />
              </div>
              <div>
                <p className={`text-lg font-black ${cor.text}`}>{f}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{meta.desc}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
};

const PDVViewInner = ({ showToast, profile, filialInicial, onVoltar }: {
  showToast: any;
  profile: any;
  filialInicial: FilialPDV;
  onVoltar?: () => void;
}) => {
  const { user } = useAuth();
  const podeAlternar = podeAlternarFilial(profile);
  const [filialFiltro] = useState<FilialPDV>(filialInicial);
  const { caixa, isLoading: caixaLoading, refresh: refreshCaixa } = useCaixaAberto(filialFiltro);
  // Realtime enabled: any other cashier's sale triggers a produtos update via the stock trigger
  const { data: produtos, isLoading: loadingProd } = useFetchData<Produto>('/api/produtosview', undefined, true);
  const { data: clientes } = useFetchData<Cliente>('/api/crmview');

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
  // Benefícios em aguardo (Fase 5): pendente em MaxPOS com código curto pro colaborador
  const [beneficiosPendente, setBeneficiosPendente] = useState<{
    id: string;
    codigo: string;
    valor_beneficios: number;
    valor_resto: number;
    forma_resto: string;
  } | null>(null);
  // Forma usada pra cobrir o restante quando benefícios não dão conta de tudo.
  const [formaResto, setFormaResto] = useState<string>('Dinheiro');
  // Cupom: código digitado + resultado da última validação no servidor. O
  // valor de `desconto` no aplicado é authoritativo (servidor recalcula no
  // RPC `criar_venda_pdv`); aqui só usamos pra UI e pra mandar pro RPC.
  const [cupomCodigo, setCupomCodigo] = useState('');
  const [cupomAplicado, setCupomAplicado] = useState<{ codigo: string; desconto: number; descricao: string | null; tipo: string } | null>(null);
  const [cupomErro, setCupomErro] = useState<string | null>(null);
  const [cupomLoading, setCupomLoading] = useState(false);
  // Modal de peso pra produtos vendidos em KG/L. `editIndex` !== null indica
  // edição de item já no carrinho (em vez de inserção). Peso entra como
  // string mascarada (vírgula decimal) e é parseado no confirmar.
  const [pesoPrompt, setPesoPrompt] = useState<{
    produto: any;
    pesoInput: string;
    editIndex: number | null;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(true);
  const [mobileTab, setMobileTab] = useState<'produtos' | 'carrinho'>('produtos');
  const vendaSnapshotRef = useRef<{
    cart: CartItem[]; subtotal: number; descontoNum: number; totalFinal: number; clienteId: string;
    cupomCodigo: string | null; cupomDesconto: number;
  } | null>(null);

  // Quando o usuário troca de forma de pagamento, sempre volta parcelas para 1
  // (evita ficar com 6x setado e mudar para Dinheiro).
  useEffect(() => {
    if (formaPagamento !== 'Cartão Crédito') setParcelas(1);
  }, [formaPagamento]);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [fullscreen]);

  // Keep cart estoque values fresh when realtime pushes produto updates from other cashiers
  useEffect(() => {
    if (produtos.length === 0) return;
    setCart(prev => prev.map(cartItem => {
      const fresh = produtos.find((p: any) => p.id === cartItem.produto_id);
      if (!fresh) return cartItem;
      return { ...cartItem, estoque: Number(fresh.estoque ?? 0) };
    }));
  }, [produtos]);

  // Patrimônio (tipo='patrimonio') é classificado em Compras e gerenciado pelo
  // Financeiro — não pode vir pra venda. Default ausente = estoque_venda (legado).
  const produtosAtivos = produtos.filter((p: any) =>
    (p.status === 'Ativo' || !p.status) && p.tipo !== 'patrimonio'
  );
  // Filial filter primeiro, depois busca textual. Critério: igual exato a `filial`
  // (campo na tabela `produtos`). Produto com filial='Matriz' ou ausente fica
  // fora — PDV opera só nas 3 unidades operacionais.
  const produtosPorFilial = produtosAtivos.filter((p: any) => p.filial === filialFiltro);
  const searchLower = search.toLowerCase();
  const filtered = produtosPorFilial.filter((p: any) =>
    [p.nome, p.codigo, p.ean].some((v: any) => v?.toString().toLowerCase().includes(searchLower))
  );

  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  const descontoNum = parseBRL(desconto);
  // Cupom só vale se o subtotal ainda comporta o desconto (clamp por segurança).
  const cupomDesconto = Math.min(cupomAplicado?.desconto ?? 0, Math.max(0, subtotal - descontoNum));
  const totalFinal = Math.max(0, subtotal - descontoNum - cupomDesconto);
  // Desconto total enviado ao RPC = manual + cupom (o servidor valida cada
  // parte; manual continua livre, cupom é re-checado contra o código).
  const descontoTotal = descontoNum + cupomDesconto;

  // Quanto do carrinho aceita benefícios? Soma subtotais dos itens elegíveis.
  // Desconto é aplicado proporcionalmente: clampamos pelo totalFinal pra
  // não permitir benefícios > total efetivo a pagar.
  const subtotalElegivelBenef = cart.reduce((s, i) => {
    const p = produtos.find((p: any) => p.id === i.produto_id);
    return s + (p?.elegivel_beneficios ? i.subtotal : 0);
  }, 0);
  const valorBeneficios = Math.min(subtotalElegivelBenef, totalFinal);
  const valorResto = Math.max(0, totalFinal - valorBeneficios);

  const addToCart = useCallback((produto: any) => {
    // Produto fracionário (KG/L/...) abre modal de peso. O bloqueio de
    // estoque <= 0 ainda se aplica — vendedor não pode pesar do que não tem.
    if (isProdutoFracionario(produto)) {
      if ((produto.estoque ?? 999) <= 0) {
        showToast?.('Produto sem estoque.', 'error', true);
        return;
      }
      const existingIdx = cart.findIndex(i => i.produto_id === produto.id);
      setPesoPrompt({
        produto,
        pesoInput: existingIdx >= 0 ? formatQtd(cart[existingIdx].qtd, produto.unidade) : '',
        editIndex: existingIdx >= 0 ? existingIdx : null,
      });
      return;
    }
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
      return [...prev, { produto_id: produto.id, nome_produto: produto.nome, preco_unitario: preco, qtd: 1, subtotal: preco, estoque: produto.estoque ?? 999, unidade: produto.unidade ?? 'UN' }];
    });
  }, [showToast, cart]);

  const changeQty = (produto_id: string, delta: number) => {
    setCart(prev => prev
      .map(i => {
        if (i.produto_id !== produto_id) return i;
        // Item fracionário não usa +/- — só o modal de peso edita.
        if (UNIDADES_FRACIONARIAS.has(i.unidade.toUpperCase())) return i;
        const newQty = i.qtd + delta;
        if (newQty <= 0) return null as any;
        if (newQty > i.estoque) { showToast?.('Quantidade máxima em estoque atingida.', 'error', true); return i; }
        return { ...i, qtd: newQty, subtotal: newQty * i.preco_unitario };
      })
      .filter(Boolean)
    );
  };

  // Aceita peso digitado: até 3 decimais, vírgula ou ponto. Limpa caracteres
  // estranhos e arredonda pra 3 casas. Não muda o estado do carrinho aqui —
  // só formata o que o usuário está digitando.
  const handlePesoChange = (raw: string) => {
    const limpo = raw.replace(/[^\d.,]/g, '').replace('.', ',');
    setPesoPrompt(p => p ? { ...p, pesoInput: limpo } : p);
  };

  const confirmarPeso = () => {
    if (!pesoPrompt) return;
    const peso = parseFloat(pesoPrompt.pesoInput.replace(',', '.'));
    if (!Number.isFinite(peso) || peso <= 0) {
      showToast?.('Informe um peso válido.', 'error', true);
      return;
    }
    const pesoArred = Math.round(peso * 1000) / 1000;
    const { produto, editIndex } = pesoPrompt;
    const estoque = Number(produto.estoque ?? 999);
    if (pesoArred > estoque) {
      showToast?.(`Estoque insuficiente: disponível ${formatQtd(estoque, produto.unidade)} ${produto.unidade}.`, 'error', true);
      return;
    }
    const preco = Number(produto.preco) || 0;
    const subtotal = Math.round(pesoArred * preco * 100) / 100;
    setCart(prev => {
      if (editIndex !== null && prev[editIndex]) {
        const copy = [...prev];
        copy[editIndex] = { ...copy[editIndex], qtd: pesoArred, subtotal };
        return copy;
      }
      return [...prev, {
        produto_id:     produto.id,
        nome_produto:   produto.nome,
        preco_unitario: preco,
        qtd:            pesoArred,
        subtotal,
        estoque,
        unidade:        produto.unidade ?? 'KG',
      }];
    });
    playBeep();
    setPesoPrompt(null);
    searchRef.current?.focus();
  };

  const cancelarPeso = () => setPesoPrompt(null);

  // Lógica de busca por código (EAN/código interno) ou termo livre. Usada
  // pelo Enter manual no input e pelo listener global do scanner. Recebe o
  // código por argumento (não lê `search`) porque o scanner pode disparar
  // mesmo com o foco fora do input.
  const processBarcode = useCallback((codeRaw: string) => {
    const termo = codeRaw.trim();
    if (!termo) return;
    const termoLower = termo.toLowerCase();
    // Scanner respeita o filtro de filial — assim o operador não bipa por
    // engano um item de outra empresa quando está com filtro ativo.
    let match = produtosPorFilial.find((p: any) =>
      String(p.ean ?? '').trim() === termo ||
      String(p.codigo ?? '').trim().toLowerCase() === termoLower
    );
    if (!match) {
      const partial = produtosPorFilial.filter((p: any) =>
        [p.nome, p.codigo, p.ean].some((v: any) => v?.toString().toLowerCase().includes(termoLower))
      );
      if (partial.length === 1) match = partial[0];
    }
    if (!match) {
      showToast?.(`Produto não encontrado em ${filialFiltro}: ${termo}`, 'error', true);
    } else {
      addToCart(match);
    }
    setSearch('');
    searchRef.current?.focus();
  }, [produtosPorFilial, filialFiltro, addToCart, showToast]);

  const handleSearchEnter = () => processBarcode(search);

  // Mantém a função processBarcode mais recente acessível ao listener global
  // sem que seja necessário rebindar o evento a cada render.
  const processBarcodeRef = useRef(processBarcode);
  useEffect(() => { processBarcodeRef.current = processBarcode; }, [processBarcode]);

  const pixPendenteRef = useRef(pixPendente);
  useEffect(() => { pixPendenteRef.current = pixPendente; }, [pixPendente]);

  // Refs adicionais para o gate do scanner: enquanto o PDV está
  // processando o fechamento ou mostrando confirmação da última venda,
  // o listener global não deve disparar (operador pode estar digitando
  // num input de modal, ou Enter ia ativar o botão "Fechar Venda").
  const isClosingRef = useRef(isClosing);
  useEffect(() => { isClosingRef.current = isClosing; }, [isClosing]);
  const lastVendaRef = useRef(lastVenda);
  useEffect(() => { lastVendaRef.current = lastVenda; }, [lastVenda]);
  const pesoPromptRef = useRef(pesoPrompt);
  useEffect(() => { pesoPromptRef.current = pesoPrompt; }, [pesoPrompt]);

  // Leitor de código de barras (hardware): teclas chegam em <50ms entre si e
  // terminam com Enter. Listener global em fase de CAPTURE para que mesmo
  // quando o foco está num botão (Tema, forma de pagamento, card de produto),
  // a leitura seja processada e o Enter não active o botão focado.
  useEffect(() => {
    const SCANNER_MAX_INTERVAL_MS = 50;
    let chars = '';
    let lastTs = 0;

    const onKey = (e: KeyboardEvent) => {
      // Gate: scanner desativado durante modais/estados em que o Enter
      // tem outro propósito (overlay Pix, finalização em curso, banner
      // de "venda concluída" antes do operador clicar OK).
      const blocked =
        pixPendenteRef.current !== null ||
        isClosingRef.current ||
        lastVendaRef.current !== null ||
        pesoPromptRef.current !== null;

      const now = performance.now();
      const fast = now - lastTs < SCANNER_MAX_INTERVAL_MS;

      if (e.key === 'Enter') {
        if (chars.length >= 4 && fast && !blocked) {
          e.preventDefault();
          e.stopPropagation();
          const code = chars;
          chars = '';
          lastTs = 0;
          processBarcodeRef.current(code);
          return;
        }
        chars = '';
        lastTs = 0;
        return;
      }

      if (e.key.length !== 1) return;
      if (blocked) { chars = ''; lastTs = 0; return; }
      if (!fast) chars = '';
      chars += e.key;
      lastTs = now;
    };

    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Limpeza de Pix órfãos ao montar o PDV. Substitui o cron de servidor
  // (impossível no plano Hobby do Vercel: limite de 1 execução/dia).
  // Qualquer operador que abre o PDV faz a limpeza — efeito coletivo.
  //
  // Duas janelas de idade:
  //   • > 5 min do PRÓPRIO operador: sessão anterior do mesmo usuário
  //     (fechou aba no meio do checkout). Margem curta porque sabemos
  //     que é dele; cliente real confirma em < 1 min.
  //   • > 1h de QUALQUER operador: pendente abandonado de outro caixa
  //     que não voltou ao PDV. Margem longa pra não pisar em fluxo
  //     legítimo em andamento noutro terminal.
  useEffect(() => {
    if (!supabase || !user?.id) return;
    let cancelled = false;
    (async () => {
      const cutoff5min = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const cutoff1h   = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const [own, others] = await Promise.all([
        supabase.from('pix_pendentes').select('id')
          .eq('operador_id', user.id)
          .eq('status', 'aguardando')
          .lt('created_at', cutoff5min),
        supabase.from('pix_pendentes').select('id')
          .eq('status', 'aguardando')
          .lt('created_at', cutoff1h),
      ]);
      if (cancelled) return;
      // Set dedupe: pendente do próprio operador com > 1h aparece nos dois.
      const ids = Array.from(new Set([
        ...((own.data ?? []).map((o: any) => o.id)),
        ...((others.data ?? []).map((o: any) => o.id)),
      ]));
      if (ids.length === 0) return;
      await supabase
        .from('pix_pendentes')
        .update({ status: 'cancelado' })
        .in('id', ids);
      showToast?.(
        `${ids.length} pagamento${ids.length > 1 ? 's' : ''} Pix antigo${ids.length > 1 ? 's' : ''} cancelado${ids.length > 1 ? 's' : ''}.`,
        'info',
        true,
      );
    })();
    return () => { cancelled = true; };
  }, [user?.id, showToast]);

  const removeFromCart = (produto_id: string) => setCart(prev => prev.filter(i => i.produto_id !== produto_id));
  const clearCart = () => { setCart([]); setDesconto(''); setFormaPagamento('Dinheiro'); setParcelas(1); setClienteId(''); setLastVenda(null); setNetworkError(false); setCupomCodigo(''); setCupomAplicado(null); setCupomErro(null); };

  // Cupom: re-valida server-side (RPC `validar_cupom`) a cada mudança
  // estável do código, do subtotal ou da filial. Subtotal entra porque
  // cupom pode ter compra mínima; filial porque cupom pode ser exclusivo
  // de uma unidade. Erro/sucesso vão pra UI; a aplicação real do desconto
  // só persiste após o caixa fechar a venda (RPC re-valida sob lock).
  const cupomCodigoDebounced = useDebouncedValue(cupomCodigo.trim().toUpperCase(), 350);
  useEffect(() => {
    if (!cupomCodigoDebounced) { setCupomAplicado(null); setCupomErro(null); return; }
    if (subtotal <= 0)         { setCupomAplicado(null); setCupomErro(null); return; }
    if (!supabase) return;
    let cancelled = false;
    setCupomLoading(true);
    supabase.rpc('validar_cupom', {
      p_codigo:   cupomCodigoDebounced,
      p_filial:   filialFiltro,
      p_subtotal: subtotal - descontoNum,
    }).then(({ data, error }) => {
      if (cancelled) return;
      setCupomLoading(false);
      if (error) { setCupomErro('Erro ao validar cupom.'); setCupomAplicado(null); return; }
      if (data?.valido) {
        setCupomAplicado({
          codigo:    data.codigo,
          desconto:  Number(data.desconto ?? 0),
          descricao: data.descricao ?? null,
          tipo:      data.tipo,
        });
        setCupomErro(null);
      } else {
        setCupomAplicado(null);
        setCupomErro(data?.motivo ?? 'Cupom inválido.');
      }
    });
    return () => { cancelled = true; };
  }, [cupomCodigoDebounced, filialFiltro, subtotal, descontoNum]);

  const valorPorParcela = parcelas > 1 ? totalFinal / parcelas : totalFinal;

  // Chama o RPC transacional. Usado tanto pelo fluxo síncrono (Dinheiro/Cartão/Fiado)
  // quanto pelo callback do realtime após confirmação do Pix. Recebe snapshot para
  // que o fluxo Pix possa usar o estado capturado no momento da geração do QR.
  const finalizarVenda = async (snap: {
    cart: CartItem[]; subtotal: number; descontoNum: number; totalFinal: number; clienteId: string;
    cupomCodigo?: string | null; cupomDesconto?: number;
  }, forma: string, parcelasEfetivas: number) => {
    if (!supabase) throw new Error('Supabase indisponível.');
    const itensPayload = snap.cart.map(item => ({
      produto_id:    item.produto_id,
      nome_produto:  item.nome_produto,
      qtd:           item.qtd,
      preco_unitario: item.preco_unitario,
      subtotal:      item.subtotal,
    }));
    // Filial da venda = filial atualmente selecionada no PDV. O filtro
    // garante que só produtos dessa unidade entram no carrinho, então
    // a venda é sempre coesa por filial.
    // Desconto enviado ao RPC = manual + cupom. O servidor re-valida o
    // cupom sob lock pessimista e exige que o desconto do cupom bata
    // com o cálculo dele.
    const cupomCod = snap.cupomCodigo ?? null;
    const cupomDesc = snap.cupomDesconto ?? 0;
    const descontoEnviado = snap.descontoNum + cupomDesc;
    const { data: vendaId, error: rpcErr } = await supabase.rpc('criar_venda_pdv', {
      p_cliente_id:      snap.clienteId || null,
      p_total:           snap.subtotal,
      p_desconto:        descontoEnviado,
      p_total_final:     snap.totalFinal,
      p_forma_pagamento: forma,
      p_parcelas:        forma === 'Cartão Crédito' ? parcelasEfetivas : 1,
      p_itens:           itensPayload,
      p_filial:          filialFiltro,
      p_cupom_codigo:    cupomCod,
      p_cupom_desconto:  cupomDesc,
    });
    if (rpcErr || !vendaId) throw new Error(rpcErr?.message ?? 'Falha ao registrar venda.');

    // Pix já tocou o "Plim" no callback do realtime (confirmação do cliente);
    // demais formas tocam "ka-ching" agora que a venda foi efetivamente persistida.
    if (forma !== 'PIX') playKaching();

    const shortId = String(vendaId).slice(-6).toUpperCase();
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
        const today = todayBR();
        const { data: caixaAtual } = await supabase
          .from('controle_caixa')
          .select('id, status')
          .eq('data', today)
          .eq('filial', filialFiltro)
          .eq('status', 'Aberto')
          .eq('ativo', true)
          .limit(1);
        if (!caixaAtual || caixaAtual.length === 0) {
          showToast?.(`O caixa de ${filialFiltro} foi fechado. Abra um novo em Financeiro → Controle de Caixa antes de continuar.`, 'error', true);
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

      // Fluxo MaxBank Benefícios (Fase 5): cria pendente em beneficios_pendentes
      // com código curto. Colaborador digita no MaxBank stand-alone, autoriza →
      // RPC debita saldo dele e marca pendente como pago. PDV via realtime
      // chama criar_venda_pdv. Suporta pagamento misto: se valor_resto > 0,
      // resto cobre na formaResto escolhida.
      if (formaPagamento === 'MaxBank Benefícios') {
        if (valorBeneficios <= 0) {
          showToast?.('Nenhum item do carrinho aceita benefícios.', 'error', true);
          setIsClosing(false);
          return;
        }
        const itensElegiveisSnap = cart
          .filter(i => {
            const p = produtos.find((p: any) => p.id === i.produto_id);
            return !!p?.elegivel_beneficios;
          })
          .map(i => ({ nome: i.nome_produto, qtd: i.qtd, subtotal: i.subtotal }));

        const { data: pendente, error: insErr } = await supabase
          .from('beneficios_pendentes')
          .insert({
            valor_beneficios: valorBeneficios,
            valor_resto:      valorResto,
            forma_resto:      valorResto > 0 ? formaResto : null,
            filial_pdv:       filialFiltro,
            produtos:         itensElegiveisSnap,
            cliente_id:       clienteId || null,
            operador_id:      user?.id ?? null,
          })
          .select('id, codigo_curto, valor_beneficios, valor_resto, forma_resto')
          .single();
        if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao gerar pendente de benefícios.');

        vendaSnapshotRef.current = {
          cart: [...cart],
          subtotal,
          descontoNum,
          totalFinal,
          clienteId,
          cupomCodigo:   cupomAplicado?.codigo ?? null,
          cupomDesconto: cupomDesconto,
        };
        setBeneficiosPendente({
          id:               pendente.id,
          codigo:           pendente.codigo_curto,
          valor_beneficios: Number(pendente.valor_beneficios),
          valor_resto:      Number(pendente.valor_resto),
          forma_resto:      pendente.forma_resto ?? '',
        });
        return;
      }

      // Fluxo Pix: cria pendente, mostra QR e aguarda confirmação do simulador
      // via realtime. A venda só é persistida no RPC quando o cliente confirma.
      if (formaPagamento === 'PIX') {
        const { data: pendente, error: insErr } = await supabase
          .from('pix_pendentes')
          .insert({
            valor: totalFinal,
            cliente_id: clienteId || null,
            status: 'aguardando',
            operador_id: user?.id ?? null,
          })
          .select('id, valor')
          .single();
        if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao gerar Pix.');

        vendaSnapshotRef.current = {
          cart: [...cart],
          subtotal,
          descontoNum,
          totalFinal,
          clienteId,
          cupomCodigo:   cupomAplicado?.codigo ?? null,
          cupomDesconto: cupomDesconto,
        };
        setPixPendente({ id: pendente.id, valor: Number(pendente.valor) });
        // isClosing fica true enquanto o overlay está aberto (botão "Fechar Venda" desabilitado)
        return;
      }

      await finalizarVenda(
        {
          cart, subtotal, descontoNum, totalFinal, clienteId,
          cupomCodigo:   cupomAplicado?.codigo ?? null,
          cupomDesconto: cupomDesconto,
        },
        formaPagamento,
        parcelas,
      );
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      const isNetworkError =
        err instanceof TypeError ||
        !navigator.onLine ||
        /fetch|network|failed to fetch/i.test(msg);

      if (isNetworkError) {
        setNetworkError(true);
        setIsClosing(false);
        return;
      }

      // P0001 + 'Estoque insuficiente' vem do RPC criar_venda_pdv quando o
      // lock pessimista detecta concorrência. Mensagem já é amigável.
      // Atualiza o carrinho com o saldo real para o operador reagir.
      if (/estoque insuficiente/i.test(msg)) {
        showToast?.(msg, 'error', true);
        if (supabase) {
          const prodIds = cart.map(i => i.produto_id);
          const { data: freshProd } = await supabase
            .from('produtos')
            .select('id, estoque')
            .in('id', prodIds);
          if (freshProd) {
            setCart(prev => prev.map(cartItem => {
              const fp = freshProd.find((p: any) => p.id === cartItem.produto_id);
              return fp ? { ...cartItem, estoque: Number(fp.estoque ?? 0) } : cartItem;
            }));
          }
        }
        setIsClosing(false);
        return;
      }

      showToast?.(`Erro ao fechar venda: ${err?.message ?? 'verifique o console'}`, 'error', true);
      setIsClosing(false);
    }
  };

  // Realtime + polling 2s: escuta a linha do pendente Pix.
  useEffect(() => {
    if (!pixPendente || !supabase) return;
    let handled = false;

    const onPago = async () => {
      if (handled) return;
      handled = true;
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
    };

    const channel = supabase
      .channel(`pix_pendente_${pixPendente.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pix_pendentes', filter: `id=eq.${pixPendente.id}` },
        (payload: any) => { if (payload?.new?.status === 'pago') onPago(); },
      )
      .subscribe();

    const timer = setInterval(async () => {
      if (handled) return;
      const { data } = await supabase
        .from('pix_pendentes')
        .select('status')
        .eq('id', pixPendente.id)
        .maybeSingle();
      if (data?.status === 'pago') onPago();
    }, 2000);

    return () => { handled = true; supabase.removeChannel(channel); clearInterval(timer); };
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

  // Realtime: pendente de benefícios. Quando colaborador confirma no MaxBank,
  // RPC dele debita o saldo + faz UPDATE pago aqui. Recebemos via realtime e
  // chamamos criar_venda_pdv com forma combinada (Benefícios + resto).
  useEffect(() => {
    if (!beneficiosPendente || !supabase) return;
    const channel = supabase
      .channel(`beneficios_pendente_${beneficiosPendente.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'beneficios_pendentes', filter: `id=eq.${beneficiosPendente.id}` },
        async (payload: any) => {
          const novoStatus = payload?.new?.status;
          if (novoStatus !== 'pago') return;
          const snap = vendaSnapshotRef.current;
          if (!snap) return;
          try {
            playPlim();
            const formaCombinada = beneficiosPendente.valor_resto > 0
              ? `MaxBank Benefícios + ${beneficiosPendente.forma_resto}`
              : 'MaxBank Benefícios';
            await finalizarVenda(snap, formaCombinada, 1);
            vendaSnapshotRef.current = null;
            setBeneficiosPendente(null);
          } catch (err: any) {
            showToast?.(`Pagamento confirmado mas falhou ao gerar venda: ${err?.message ?? '—'}`, 'error', true);
            setBeneficiosPendente(null);
            setIsClosing(false);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [beneficiosPendente, showToast]);

  const cancelarBeneficios = async () => {
    if (!beneficiosPendente || !supabase) return;
    await supabase.from('beneficios_pendentes')
      .update({ status: 'cancelado' })
      .eq('id', beneficiosPendente.id);
    vendaSnapshotRef.current = null;
    setBeneficiosPendente(null);
    setIsClosing(false);
  };

  // Troca de filial sempre limpa o carrinho — itens são por unidade, não dá
  // pra carregar um produto da SuperMax e fechar como venda da MaxLook.

  if (loadingProd || caixaLoading) return <LoadingSpinner />;

  // Colaborador sem filial operacional (ex: profile.filial='Matriz') não opera PDV.
  // Admin/CEO/gerente caem em SuperMax como padrão, então nunca caem aqui.
  if (!podeAlternar && !(FILIAIS_PDV as readonly string[]).includes(profile?.filial)) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-gray-600" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-gray-300">Sem filial operacional</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          Seu perfil está em <span className="text-gray-300 font-bold">{profile?.filial ?? '—'}</span>, que não opera PDV. Peça ao admin pra te associar a SuperMax, MaxLook ou TechMax.
        </p>
      </div>
    </div>
  );

  if (!caixa) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-gray-600" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-gray-300">Caixa de {filialFiltro} não aberto</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-xs">
          O caixa de hoje da unidade <span className="text-gray-300 font-bold">{filialFiltro}</span> ainda não foi aberto. Vá até{' '}
          <span className="text-accent font-bold">Financeiro → Controle de Caixa</span>{' '}
          para abrir.
        </p>
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        <button onClick={refreshCaixa}
          className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors">
          Verificar novamente
        </button>
        {onVoltar && (
          <button onClick={onVoltar}
            className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-accent transition-colors flex items-center gap-2">
            <ArrowLeft size={14} /> Trocar PDV
          </button>
        )}
      </div>
    </div>
  );

  // Dispatch: SuperMax tem PDV proprio (UX estilo supermercado MaxPOS).
  // Demais filiais (MaxLook, TechMax) continuam no PDV generico abaixo.
  // Todos os hooks acima ja rodaram — esta condicional so afeta o JSX retornado.
  if (filialFiltro === 'SuperMax') {
    return (
      <PDVViewSupermax
        showToast={showToast}
        profile={profile}
        onSwitchFilial={onVoltar ? () => onVoltar() : undefined}
        caixa={caixa}
        caixaLoading={caixaLoading}
        refreshCaixa={refreshCaixa}
      />
    );
  }

  const filialCor = FILIAL_COLOR[filialFiltro];
  const rootClass = fullscreen ? 'fixed inset-0 z-[100] bg-[var(--color-bg-base)] overflow-hidden' : 'h-full';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex flex-col ${rootClass}`}
      style={{ overscrollBehavior: 'none', touchAction: 'pan-y' }}>
      {/* Header com identidade da filial */}
      <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 shrink-0 border-b border-white/5"
        style={{ background: 'color-mix(in srgb, var(--color-bg-base) 95%, transparent)' }}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onVoltar && (
            <button onClick={onVoltar}
              className="neu-button p-2 rounded-lg text-gray-400 hover:text-accent shrink-0"
              title="Trocar PDV">
              <ArrowLeft size={16} />
            </button>
          )}
          <h2 className={`text-lg sm:text-2xl font-black tracking-tight ${filialCor.text}`}>{filialFiltro}</h2>
          <span className="text-[10px] sm:text-xs text-gray-500 hidden sm:inline">Ponto de Venda</span>
        </div>
        <div className="flex items-center gap-2">
          {onVoltar && (
            <button onClick={onVoltar}
              className="neu-button py-1.5 px-3 rounded-lg text-[10px] font-bold text-gray-400 hover:text-accent hidden sm:flex items-center gap-1.5"
              title="Trocar PDV">
              <Store size={12} /> Trocar PDV
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await downloadCatalogoEan13Pdf({
                  produtos: filtered.map((p: any) => ({ nome: p.nome, ean: p.ean, codigo: p.codigo, preco: Number(p.preco || 0) })),
                  titulo: `Catálogo PDV — ${filialFiltro}`,
                  filename: `logmax-catalogo-pdv-${filialFiltro.toLowerCase()}`,
                });
              } catch (err: any) {
                showToast(err?.message ?? 'Erro ao gerar PDF', 'error', true);
              }
            }}
            disabled={filtered.length === 0}
            className="neu-button p-2 rounded-lg text-gray-400 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title="Baixar catálogo PDF">
            <FileDown size={14} />
          </button>
          <button onClick={() => setFullscreen(f => !f)}
            className="neu-button p-2 rounded-lg text-gray-400 hover:text-accent"
            title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Abas mobile: Produtos / Carrinho */}
      <div className="flex lg:hidden shrink-0 border-b border-white/5">
        <button
          onClick={() => setMobileTab('produtos')}
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${mobileTab === 'produtos' ? `${filialCor.text} border-b-2` : 'text-gray-500'}`}
          style={mobileTab === 'produtos' ? { borderColor: 'var(--color-accent)' } : {}}>
          <Package size={13} /> Produtos ({filtered.length})
        </button>
        <button
          onClick={() => setMobileTab('carrinho')}
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors relative ${mobileTab === 'carrinho' ? `${filialCor.text} border-b-2` : 'text-gray-500'}`}
          style={mobileTab === 'carrinho' ? { borderColor: 'var(--color-accent)' } : {}}>
          <ShoppingCart size={13} /> Carrinho
          {cart.length > 0 && (
            <span className="min-w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black px-1"
              style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>{cart.length}</span>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5 flex-1 min-h-0 p-3 sm:p-5">

        {/* LEFT — busca + grade de produtos (hidden on mobile when carrinho tab active) */}
        <div className={`lg:col-span-7 flex-col gap-3 sm:gap-4 min-h-0 ${mobileTab === 'produtos' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="relative shrink-0">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar por nome, código ou bipar..."
              className="neu-input py-2.5 sm:py-3 pl-10 pr-4 rounded-2xl text-sm w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearchEnter(); } }}
            />
          </div>

          <AnimatePresence>
            {lastVenda && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center justify-between p-3 sm:p-4 rounded-2xl shrink-0"
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

          <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 overflow-y-auto main-scrollbar pr-1 pb-4 flex-1 min-h-0"
            style={{ overscrollBehavior: 'contain' }}>
            {filtered.length === 0 ? (
              <div className="col-span-3 flex items-center justify-center py-12 text-gray-500 text-sm text-center">
                {search
                  ? 'Nenhum produto encontrado.'
                  : `Nenhum produto ativo cadastrado para ${filialFiltro}.`}
              </div>
            ) : (
              filtered.map((p: any) => {
                const inCart = cart.find(i => i.produto_id === p.id);
                const semEstoque = (p.estoque ?? 999) <= 0;
                const fracionario = isProdutoFracionario(p);
                const unidade = String(p.unidade ?? 'UN').toUpperCase();
                return (
                  <motion.button
                    key={p.id}
                    onClick={() => {
                      if (semEstoque) return;
                      addToCart(p);
                      if (window.innerWidth < 1024 && cart.length === 0) setMobileTab('carrinho');
                    }}
                    whileTap={!semEstoque ? { scale: 0.97 } : {}}
                    disabled={semEstoque}
                    className="neu-button rounded-xl sm:rounded-2xl p-2 sm:p-3 flex flex-col gap-1.5 sm:gap-2 text-left transition-all border border-transparent relative"
                    style={inCart ? { borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)' } : semEstoque ? { opacity: 0.4 } : {}}
                  >
                    {inCart && (
                      <span className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 px-1.5 h-5 min-w-5 rounded-full flex items-center justify-center text-[10px] font-black z-10"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                        {fracionario ? formatQtd(inCart.qtd, inCart.unidade) : inCart.qtd}
                      </span>
                    )}
                    {fracionario && (
                      <span className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 px-1 sm:px-1.5 py-0.5 rounded-md flex items-center gap-1 text-[8px] sm:text-[9px] font-black z-10 uppercase tracking-wider"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
                        <Scale size={8} /> {unidade}
                      </span>
                    )}
                    <div className="flex gap-2 sm:gap-3 items-start">
                      <ProdutoThumb url={p.imagem_url} size="sm" alt={p.nome} />
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5 sm:gap-1">
                        {p.filial && <FilialBadge filial={p.filial} />}
                        <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">{p.codigo || '—'}</span>
                        <span className="text-xs sm:text-sm font-bold text-gray-200 leading-tight line-clamp-2">{p.nome}</span>
                      </div>
                    </div>
                    <div className="flex items-end justify-between mt-auto pt-0.5 sm:pt-1">
                      <span className="text-sm sm:text-base font-black text-accent">
                        {Number(p.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        {fracionario && <span className="text-[9px] sm:text-[10px] font-bold text-gray-500"> /{unidade}</span>}
                      </span>
                      <span className={`text-[9px] sm:text-[10px] font-bold ${semEstoque ? 'text-red-500' : 'text-gray-500'} hidden sm:inline`}>
                        {semEstoque
                          ? 'Sem estoque'
                          : `Saldo: ${fracionario ? `${formatQtd(Number(p.estoque ?? 0), unidade)} ${unidade}` : (p.estoque ?? '∞')}`}
                      </span>
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — carrinho + pagamento (hidden on mobile when produtos tab active) */}
        <div className={`lg:col-span-5 flex-col gap-3 sm:gap-4 min-h-0 ${mobileTab === 'carrinho' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="neu-flat rounded-2xl sm:rounded-3xl p-3 sm:p-5 flex flex-col gap-3 flex-1 min-h-0 border border-white/5">
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
            <div className="flex flex-col gap-2 overflow-y-auto main-scrollbar flex-1 min-h-0"
              style={{ overscrollBehavior: 'contain' }}>
              {cart.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-gray-600 text-center">Clique em um produto<br />para adicionar ao carrinho</p>
                </div>
              ) : (
                <AnimatePresence>
                  {cart.map((item, idx) => {
                    const fracionario = UNIDADES_FRACIONARIAS.has(item.unidade.toUpperCase());
                    const unidadeLabel = fracionario ? item.unidade.toUpperCase() : 'un.';
                    return (
                      <motion.div key={item.produto_id}
                        initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                        className="flex items-center gap-2 p-3 neu-pressed rounded-xl">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-200 truncate">{item.nome_produto}</p>
                          <p className="text-[10px] text-gray-500">
                            {item.preco_unitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} /{unidadeLabel}
                          </p>
                        </div>
                        {fracionario ? (
                          // Pesar/editar peso — substitui +/- pra itens KG/L.
                          <button
                            onClick={() => {
                              const produto = produtos.find((p: any) => p.id === item.produto_id);
                              if (!produto) return;
                              setPesoPrompt({
                                produto,
                                pesoInput: formatQtd(item.qtd, item.unidade),
                                editIndex: idx,
                              });
                            }}
                            className="flex items-center gap-1.5 neu-button rounded-lg px-2 py-1 text-[11px] font-bold text-gray-300 hover:text-accent transition-colors shrink-0"
                            title="Editar peso">
                            <Scale size={11} />
                            <span className="tabular-nums">{formatQtd(item.qtd, item.unidade)} {item.unidade.toUpperCase()}</span>
                          </button>
                        ) : (
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
                        )}
                        <div className="w-20 text-right shrink-0">
                          <p className="text-xs font-bold text-accent">{item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                        </div>
                        <button onClick={() => removeFromCart(item.produto_id)}
                          className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors shrink-0">
                          <Trash2 size={11} />
                        </button>
                      </motion.div>
                    );
                  })}
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
                  inputMode="numeric"
                  value={desconto}
                  onChange={e => setDesconto(formatBRL(e.target.value))}
                  onKeyDown={handleMoneyKeyDown}
                  placeholder="0,00"
                  className="neu-input py-1.5 px-3 rounded-xl text-xs text-right w-28 font-mono tabular-nums"
                />
              </div>
              {/* Cupom — digitação acima/abaixo de 0 dispara revalidação no servidor */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    <Ticket size={11} className={cupomAplicado ? 'text-accent' : 'text-gray-500'} />
                    Cupom
                  </span>
                  <div className="relative">
                    <input
                      type="text"
                      value={cupomCodigo}
                      onChange={e => setCupomCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32))}
                      placeholder="código"
                      className={`neu-input py-1.5 px-3 rounded-xl text-xs text-right w-28 font-mono tabular-nums uppercase tracking-wider ${
                        cupomAplicado ? 'text-accent font-bold' : cupomErro ? 'text-red-400' : ''
                      }`}
                    />
                    {cupomLoading && (
                      <Loader2 size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin text-gray-500" />
                    )}
                  </div>
                </div>
                {cupomAplicado && (
                  <div className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-accent">
                      −{cupomDesconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      {cupomAplicado.descricao && <span className="text-gray-500 ml-1.5 truncate inline-block max-w-[140px] align-bottom">· {cupomAplicado.descricao}</span>}
                    </span>
                    <button
                      onClick={() => { setCupomCodigo(''); setCupomAplicado(null); setCupomErro(null); }}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                      title="Remover cupom"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
                {cupomErro && !cupomLoading && cupomCodigoDebounced && (
                  <p className="text-[10px] text-red-400 leading-tight">{cupomErro}</p>
                )}
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
              <span id="pdv-forma-pagto-label" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Forma de pagamento</span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="pdv-forma-pagto-label">
                {FORMAS.map(f => (
                  <button key={f} onClick={() => setFormaPagamento(f)}
                    role="radio" aria-checked={formaPagamento === f}
                    className="py-2 px-2 rounded-xl text-[10px] font-bold transition-all border"
                    style={formaPagamento === f
                      ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-accent)' }
                      : { background: 'transparent', borderColor: 'rgba(255,255,255,0.05)', color: '#6b7280' }
                    }>
                    {f === 'MaxBank Benefícios' ? 'Benefícios' : f}
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
                      {groupCadastrosParaSelect(clientes).map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}

              <AnimatePresence>
                {formaPagamento === 'MaxBank Benefícios' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden">
                    <div className="flex flex-col gap-2 p-3 rounded-xl mt-1"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-400">Cobertura por benefícios</span>
                        <span className="font-bold text-accent tabular-nums">
                          {valorBeneficios.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </div>
                      {valorResto > 0 ? (
                        <>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-gray-400">Restante</span>
                            <span className="font-bold text-gray-200 tabular-nums">
                              {valorResto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <label htmlFor="pdv-forma-resto" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest shrink-0">Resto em</label>
                            <select
                              id="pdv-forma-resto"
                              value={formaResto}
                              onChange={e => setFormaResto(e.target.value)}
                              className="neu-input py-1.5 px-2 rounded-lg text-xs flex-1 bg-transparent border-none outline-none">
                              {FORMA_RESTO_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </div>
                        </>
                      ) : (
                        <p className="text-[10px] text-emerald-400 font-bold">Benefícios cobrem o carrinho inteiro.</p>
                      )}
                      {valorBeneficios <= 0 && (
                        <p className="text-[10px] text-red-400 font-bold">Nenhum item elegível a benefícios no carrinho.</p>
                      )}
                    </div>
                  </motion.div>
                )}
                {formaPagamento === 'Cartão Crédito' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden">
                    <div className="flex items-center gap-2 p-2 rounded-xl mt-1" style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                      <CreditCard size={12} className="text-accent shrink-0" />
                      <label htmlFor="pdv-parcelas" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest shrink-0">Parcelas</label>
                      <select
                        id="pdv-parcelas"
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
                  className="w-full rounded-2xl flex flex-col gap-3 p-3 sm:p-4 shrink-0 mt-1"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-red-500">Erro de conexão</p>
                      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        Verifique no <span className="font-bold text-gray-300">Histórico de Vendas</span> se a venda já foi registrada.
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
                  className="w-full py-3 sm:py-4 rounded-2xl text-sm font-black flex items-center justify-center gap-2 transition-all shrink-0 mt-1"
                  style={{
                    background: cart.length === 0 || isClosing ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)' : 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
                    color: cart.length === 0 || isClosing ? '#4b5563' : 'var(--color-accent-text)',
                    boxShadow: cart.length > 0 && !isClosing ? '0 4px 20px color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'none',
                    cursor: cart.length === 0 || isClosing ? 'not-allowed' : 'pointer',
                  }}>
                  {isClosing ? <><Loader2 size={16} className="animate-spin" /> Processando...</> : <><CheckCircle2 size={16} /> Fechar Venda · {totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</>}
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

      {/* Modal de peso — produtos KG/L pedem o peso em vez de incrementar +1 */}
      <AnimatePresence>
        {pesoPrompt && (() => {
          const u = String(pesoPrompt.produto.unidade ?? 'KG').toUpperCase();
          const preco = Number(pesoPrompt.produto.preco) || 0;
          const pesoNum = parseFloat(pesoPrompt.pesoInput.replace(',', '.'));
          const previewTotal = Number.isFinite(pesoNum) && pesoNum > 0 ? pesoNum * preco : 0;
          return (
            <motion.div
              key="peso-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
              onClick={cancelarPeso}
            >
              <motion.div
                initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
                transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                className="neu-flat rounded-3xl w-full max-w-sm p-6 flex flex-col gap-4 border border-white/5"
                style={{ background: 'var(--color-bg-base)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-2">
                  <Scale size={18} className="text-accent" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
                    {pesoPrompt.editIndex !== null ? 'Editar peso' : 'Informar peso'}
                  </span>
                </div>

                <div>
                  <p className="text-sm font-bold text-gray-100 leading-tight">{pesoPrompt.produto.nome}</p>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} / {u}
                    {' · '}saldo {formatQtd(Number(pesoPrompt.produto.estoque ?? 0), u)} {u}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="pdv-peso-input" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Peso ({u})
                  </label>
                  <div className="relative">
                    <input
                      id="pdv-peso-input"
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={pesoPrompt.pesoInput}
                      onChange={e => handlePesoChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); confirmarPeso(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelarPeso(); }
                      }}
                      placeholder="0,000"
                      className="neu-input py-3 pl-4 pr-16 rounded-2xl text-2xl font-black tabular-nums w-full text-right"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500">{u}</span>
                  </div>
                  <p className="text-[10px] text-gray-600">Use vírgula para decimais (ex.: 1,250 = 1 kg e 250 g).</p>
                </div>

                <div className="flex justify-between items-center p-3 rounded-2xl border border-white/5"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total</span>
                  <span className="text-xl font-black text-accent tabular-nums">
                    {previewTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={cancelarPeso}
                    className="flex-1 py-3 rounded-xl text-xs font-bold text-gray-400 neu-button transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarPeso}
                    disabled={!pesoPrompt.pesoInput.trim()}
                    className="flex-1 py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
                      color: 'var(--color-accent-text)',
                    }}>
                    <CheckCircle2 size={14} /> {pesoPrompt.editIndex !== null ? 'Atualizar' : 'Adicionar'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Overlay MaxBank Benefícios — código de 6 dígitos pro colaborador digitar */}
      <AnimatePresence>
        {beneficiosPendente && (
          <motion.div
            key="beneficios-overlay"
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
                  <Smartphone size={18} className="text-accent" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent animate-ping" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Aguardando colaborador</span>
              </div>

              <div className="text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cobertura por benefícios</p>
                <p className="text-3xl font-black text-gray-100 tabular-nums tracking-tight mt-1">
                  {beneficiosPendente.valor_beneficios.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>

              <div className="rounded-2xl border border-white/5 px-6 py-5 flex flex-col items-center gap-1"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Código no MaxBank</span>
                <span className="text-4xl font-black tracking-[0.4em] text-accent tabular-nums font-mono">
                  {beneficiosPendente.codigo}
                </span>
              </div>

              {beneficiosPendente.valor_resto > 0 && (
                <div className="text-center text-[11px] text-gray-400 leading-relaxed max-w-[18rem]">
                  Após confirmar, receba o restante de{' '}
                  <span className="font-bold text-gray-200 tabular-nums">
                    {beneficiosPendente.valor_resto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>{' '}
                  em <span className="font-bold text-gray-200">{beneficiosPendente.forma_resto}</span>.
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-gray-500 text-center max-w-[18rem]">
                <Smartphone size={12} className="shrink-0 text-accent" />
                <span>Peça ao colaborador para abrir o <span className="font-bold text-gray-300">MaxBank → Pagar no PDV</span> e digitar este código.</span>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-gray-600 font-mono">
                <Loader2 size={10} className="animate-spin" />
                <span>Escutando confirmação em tempo real…</span>
              </div>

              <button
                onClick={cancelarBeneficios}
                className="mt-1 w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                style={{ border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', background: 'rgba(239,68,68,0.05)' }}
              >
                <X size={12} /> Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
