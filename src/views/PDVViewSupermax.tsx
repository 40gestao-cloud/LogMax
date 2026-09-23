import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { ehVendavel } from '../lib/tipoProduto';
import type { CaixaAberto } from '../hooks/useCaixaAberto';
import { PDVFecharCaixa } from '../components/PDVFecharCaixa';
import { useAuth } from '../hooks/useAuth';
import { useAbrirCaixa } from '../hooks/useAbrirCaixa';
import { useVarrerPendentesOrfaos } from '../hooks/usePendentesOrfaos';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { supabase, criarClienteEfemero } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { consultarCreditoCliente, bloqueioFiado } from '../lib/credito';
import { playScannerBeep, playKaching } from '../utils/audioUtils';
import { normalizarBusca as norm, produtoCasa, buscarProdutos, separarQtdETermo } from '../lib/produtoBusca';
import { UNIDADES_FRACIONARIAS, normalizarUnidade } from '../lib/unidades';
import { trapTab, devolverTabAoPdv } from '../lib/focoPdv';
// Quantidade na tela: 2 e não "2,000"; 0,350 mantém o peso.
import { fmtQtdArmada as fmtQtd } from '../lib/pdv/quantidade';
import { montarVendaPdv } from '../lib/pdv/venda';
import { cancelarAguardandoAntigas, inserirPixPendente, inserirCartaoPendente, cancelarCobranca } from '../lib/pdv/cobranca';
import { usePagamentoPendente } from '../hooks/usePagamentoPendente';
import { YELLOW, YELLOW_DARK, NAVY_DARK, MONEY, RED } from '../components/pdv/coresMaxPos';
import { ManualPdv } from '../components/pdv/ManualPdv';
import { ConsultaPrecoModal } from '../components/pdv/ConsultaPrecoModal';
import { ReimpressaoModal, type VendaReimpressao } from '../components/pdv/ReimpressaoModal';
import { ReciboVendaModal, type VendaConcluida } from '../components/pdv/ReciboVendaModal';
import { AgradecimentoTela } from '../components/pdv/AgradecimentoTela';
import { CpfNotaModal } from '../components/pdv/CpfNotaModal';
import { ValeModal } from '../components/pdv/ValeModal';
import { ParcelasModal } from '../components/pdv/ParcelasModal';
import { ClientePickerModal } from '../components/pdv/ClientePickerModal';
import { BuscaProdutoModal } from '../components/pdv/BuscaProdutoModal';
import { CartaoPickerModal } from '../components/pdv/CartaoPickerModal';
import { PagadorPickerModal } from '../components/pdv/PagadorPickerModal';
import { PixAguardandoModal } from '../components/pdv/PixAguardandoModal';
import { CartaoAguardandoModal } from '../components/pdv/CartaoAguardandoModal';
import { DinheiroModal } from '../components/pdv/DinheiroModal';
import { TrocoTela } from '../components/pdv/TrocoTela';
import { DescontoAutorizacaoModal } from '../components/pdv/DescontoAutorizacaoModal';
import { GancheiraOcupadaModal } from '../components/pdv/GancheiraOcupadaModal';
import { CancelarVendaModal } from '../components/pdv/CancelarVendaModal';
import { DescontoModal } from '../components/pdv/DescontoModal';
import { MovimentoCaixaModal } from '../components/pdv/MovimentoCaixaModal';
import { OperacaoCaixaModal } from '../components/pdv/OperacaoCaixaModal';
import { PagamentoModal, type FormaPagamentoSupermax } from '../components/pdv/PagamentoModal';
import { Header } from '../components/pdv/CabecalhoPdv';
import { CupomItens, type ItemCupom } from '../components/pdv/CupomItens';
import { LinhaCodigo } from '../components/pdv/LinhaCodigo';
import { RodapeAtalhos } from '../components/pdv/RodapeAtalhos';
import { AberturaCaixaCard } from '../components/pdv/AberturaCaixaCard';
import { mascararDocumento } from '../lib/pdv/documento';
import {
  totaisComDesconto, restanteAPagar, valorDevido as calcValorDevido, mistoAtivo, trocoDoRecebido,
  valorEditado, formaDoMisto, trocoTotal, dinheiroNaGaveta as calcDinheiroNaGaveta,
  parcelasDaVenda, creditoDoMisto, ehLinhaEletronica, valorEletronicoPago, type LinhaPagamento,
} from '../lib/pdv/pagamento';
import { DescartarPagoModal } from '../components/pdv/DescartarPagoModal';

// PDV do LogMax em modo SuperMax — réplica visual e UX do MaxPOS.
// Camada de dados continua sendo LogMax: /api/produtosview, RPC criar_venda_pdv,
// controle_caixa, pix_pendentes. Cores e layout: amarelo/navy/verde MaxPOS.


type CartItem = ItemCupom;

type FormaPagamento = FormaPagamentoSupermax;

// O que fazer quando o MaxBank autorizar a maquininha: fechar a venda inteira
// ('venda', cartão como forma única) ou devolver o valor como uma linha da
// lista do pagamento misto ('linha').
type DestinoCartao = 'venda' | 'linha';


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
  const [lastVenda, setLastVenda]       = useState<VendaConcluida | null>(null);
  const [codeMsg, setCodeMsg]           = useState<{ type: 'err'; text: string } | null>(null);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [cashModalOpen, setCashModalOpen]       = useState(false);
  const [cashReceived, setCashReceived]         = useState('');
  const [changeModal, setChangeModal]           = useState<{ amount: number } | null>(null);
  // `destino` diz o que fazer quando o MaxBank confirmar: 'venda' fecha a
  // venda inteira (forma única), 'linha' devolve o valor como um pagamento
  // da lista do misto. Vale pra PIX e pra Cartão.
  const [pixModal, setPixModal]                 = useState<{ id: string; valor: number; destino: DestinoCartao } | null>(null);
  const [cartaoModal, setCartaoModal]           = useState<{ id: string; valor: number; metodo: 'debito' | 'credito'; parcelas: number; destino: DestinoCartao } | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearch, setClientSearch]         = useState('');
  const [confirmCancel, setConfirmCancel]       = useState(false);
  // Pergunta antes de descartar linha de PIX/Cartão já paga (lixeira, Esc,
  // VOLTAR, X). `confirmar` é o descarte que o operador pediu.
  const [descarte, setDescarte]                 = useState<{ acao: string; linhas: LinhaPagamento[]; confirmar: () => void } | null>(null);

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

  // Picker de cartão (F2 no payment modal) — Crédito/Débito.
  const [cardPickerOpen, setCardPickerOpen] = useState(false);

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

  // Consulta de preço (F7) — read-only, não adiciona ao carrinho.
  const [priceQueryOpen, setPriceQueryOpen] = useState(false);

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

  // Ofertas valendo hoje na unidade (view `v_promocao_vigente`).
  //
  // MIGR 578: isto deixou de ser enfeite. A promoção virou REGRA DE PREÇO — o
  // cadastro guarda o preço de tabela e não é mais sobrescrito —, então é daqui
  // que sai o preço que o caixa cobra. O "de" continua vindo junto, para o
  // de/por na linha e a economia no rodapé do cupom.
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

  // Abertura de caixa: a regra vive em `useAbrirCaixa` porque as três
  // unidades têm de abrir do mesmo jeito. Aqui fica só a aparência de caixa
  // de mercado.
  const abertura = useAbrirCaixa({
    filial,
    userId: user?.id,
    operadorNome: profile?.nome ?? user?.email ?? 'Operador',
    showToast,
    refreshCaixa,
  });

  // Parcelamento Cartão Crédito (1x-12x) — só pergunta quando Crédito é
  // forma única; em misto cai no ELSE genérico da RPC e parcelas é ignorado.
  const [parcelasModalOpen, setParcelasModalOpen] = useState(false);

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

  // Seleção de item no carrinho por ↑↓ (Del apaga selecionado). -1 = último item.
  const [selectedCartIdx, setSelectedCartIdx] = useState<number>(-1);

  // Reimpressão (Ctrl+R) — últimas N vendas concluídas da filial nesta sessão.
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintList, setReprintList] = useState<VendaReimpressao[]>([]);
  const [reprintLoading, setReprintLoading] = useState(false);
  const sessionStartRef = useRef<string>(new Date().toISOString());

  const [cupomSeq]   = useState(() => String(Date.now()).slice(-6));
  const [nowTick, setNowTick] = useState(0);
  const codeInputRef   = useRef<HTMLInputElement>(null);
  const codeNativeRef  = useRef('');
  // Raiz do PDV: escopo do Tab. Ver `devolverTabAoPdv` em lib/focoPdv.
  const rootRef        = useRef<HTMLDivElement>(null);
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
  // MIGR 578: o bipe lê a oferta por ref, não pelo state. O item é montado
  // dentro do callback do leitor — com o state, uma oferta carregada depois do
  // primeiro render entraria no carrinho pelo preço de tabela.
  const ofertasRef           = useRef<Map<string, { de: number; por: number }>>(new Map());
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
        // Falha aqui não cobra preço errado: sem a oferta o carrinho monta pelo
        // preço de tabela e `criar_venda_pdv` recusa a venda dizendo qual é o
        // preço de hoje. Erra para o lado seguro — chateia o operador, não o
        // cliente.
        console.warn('[PDV] Não foi possível carregar as ofertas vigentes:', error.message);
        return;
      }
      const mapa = new Map<string, { de: number; por: number }>();
      for (const o of data ?? []) {
        mapa.set(String(o.produto_id), { de: Number(o.preco_de ?? 0), por: Number(o.preco_por ?? 0) });
      }
      ofertasRef.current = mapa;
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
  const { descontoAplicado, totalFinal } = totaisComDesconto(subtotal, desconto);
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
  const restante   = restanteAPagar(totalFinal, pagamentos);
  const fmt = (n: number) => formatBRL(n);

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
      // MIGR 578: o preço cobrado é o EFETIVO — a oferta valendo hoje, se
      // houver; senão o preço de tabela. O cadastro deixou de ser sobrescrito
      // pela aprovação da promoção, então ler `produto.preco` cru aqui cobraria
      // o preço cheio de um item em oferta (e a venda seria recusada no banco,
      // que confere contra `preco_efetivo`).
      const precoTabela = Number(produto?.preco) || 0;
      const preco   = ofertasRef.current.get(String(id))?.por ?? precoTabela;
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

  // Descarte de linhas do pagamento: sem PIX/Cartão já pago, segue direto;
  // com, pergunta antes — o dinheiro já saiu do cliente e nada aqui estorna.
  const pedirDescarte = (acao: string, linhas: LinhaPagamento[], confirmar: () => void) => {
    if (valorEletronicoPago(linhas) <= 0.001) { confirmar(); return; }
    setDescarte({ acao, linhas, confirmar });
  };

  const iniciarEdicaoPagamento = (idx: number) => {
    const p = pagamentos[idx];
    // PIX/Cartão: o valor é o que o MaxBank confirmou. Editar deixava subir a
    // linha até zerar o restante e fechar a venda sem o dinheiro ter entrado.
    if (!p || ehLinhaEletronica(p)) return;
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
      const valor = valorEditado(totalFinal, prev, idx, novo);
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
  // Usado após aplicar desconto pra operador apertar Enter direto. O desconto
  // também abre de dentro do pagamento — aí o foco volta pro campo dele.
  const focusFecharVendaPDV = () => {
    requestAnimationFrame(() => {
      if (document.querySelector('[data-pdv-pagamento]')) { parcialInputRef.current?.focus(); return; }
      const btn = document.querySelector<HTMLButtonElement>('[data-action="fechar-venda-pdv"]');
      if (btn && !btn.disabled) btn.focus();
    });
  };

  // Fechou um modal que pode ter aberto por cima do pagamento (desconto,
  // gerente, cancelar venda)? Com o pagamento na tela o foco volta pro campo
  // dele, e não pro CÓDIGO escondido atrás — lá os atalhos do modal morriam.
  const devolverFoco = () => {
    requestAnimationFrame(() => {
      if (document.querySelector('[data-pdv-pagamento]')) parcialInputRef.current?.focus();
      else codeInputRef.current?.focus();
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
      setReprintList((data ?? []) as VendaReimpressao[]);
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

      // TAB — o foco NUNCA sai da operação.
      //
      // Dentro do PDV o Tab já é preso pelo `trapTab` do escopo (o modal
      // aberto, ou a raiz). O que faltava era o caso em que o foco JÁ ESTÁ
      // FORA: com o foco em `document.body` — clique numa área não focável,
      // modal que fechou levando o elemento focado, primeiro Tab antes do
      // autofocus — o onKeyDown do React não dispara, porque o target não está
      // na subárvore. Aí o Tab caía na sidebar e na topbar do app (que
      // continuam no DOM, tabuláveis e invisíveis sob o `fixed inset-0`) e, em
      // seguida, na barra do navegador. Num caixa isso é básico: o Tab é da
      // operação, não da janela.
      //
      // Este listener é de `window` em captura, o único lugar que vê a tecla
      // sem foco dentro do PDV. Vale em qualquer modo, com ou sem modal: com
      // modal aberto a reentrada devolve o foco ao PDV e o trap do próprio
      // modal reassume no toque seguinte.
      if (e.key === 'Tab') {
        devolverTabAoPdv(e, rootRef.current, anyModal ? null : codeInputRef.current);
        return;
      }

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
    const { data: vendaId, error: rpcErr } = await supabase.rpc('criar_venda_pdv', montarVendaPdv({
      clienteId:  cid,
      subtotal,
      desconto:   descontoAplicado,
      totalFinal,
      forma,
      parcelas,
      itens:      cart,
      filial,
      dinheiroEmEspecie,
      cpfNota:    cpfNota || null,
    }));
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
      itens: cart.map(i => ({
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
      //
      // `scope: 'local'` NÃO É DETALHE. O padrão do supabase-js é 'global', que
      // revoga TODAS as sessões daquele usuário — em toda máquina, em todo
      // navegador. Como aqui quem acabou de entrar foi o gerente (ou o
      // professor, que também autoriza), sair em escopo global derrubava a
      // sessão dele na PRÓPRIA máquina dele, do outro lado da sala.
      //
      // E derrubava de um jeito difícil de ligar à causa: o access token
      // continua com assinatura válida, então o app segue lendo pelo PostgREST
      // como se nada fosse; só os endpoints em /api quebram, porque eles
      // conferem a sessão no GoTrue e recebem "Session not found" — que a tela
      // de Usuários mostra como "Token inválido". Nada aponta para o PDV.
      //
      // 'local' descarta só a sessão deste cliente efêmero, que é o que se quer:
      // ele nasceu com `persistSession: false` e nunca chegou ao localStorage.
      await cliente.auth.signOut({ scope: 'local' }).catch(() => {});
      setDescAuthLoading(false);
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

  const finalizarVendaMisto = async () => {
    if (pagamentos.length === 0) return;
    // Captura tudo do estado ANTES do await — clearAll() vai zerar.
    const forma = formaDoMisto(pagamentos);
    const trocoFinal = trocoTotal(pagamentos);
    const houveDinheiro = pagamentos.some(p => p.forma === 'Dinheiro');
    const parcelas = parcelasDaVenda(pagamentos);
    // Parte da venda paga em crédito. A RPC de venda marca o misto inteiro
    // como recebido no dia; o crédito só é repassado pela operadora depois,
    // e é isso que `pdv_registrar_credito_misto` corrige (migr. 415).
    const { valor: creditoValor, parcelas: creditoParcelas } = creditoDoMisto(pagamentos);
    try {
      setIsClosing(true);
      setPaymentError(null);
      // SEM revalidação de caixa aqui — o caixa já foi validado em
      // handlePayChoice. O tempo entre cash modal e FECHAR VENDA é de
      // segundos; revalidar gera falso-negativo silencioso (toast some
      // atrás do overlay fullscreen z-100) e mata a venda.
      const vendaId = await finalizarVenda(forma, undefined, parcelas, calcDinheiroNaGaveta(pagamentos));
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
    const valorDevido = calcValorDevido(parcial, restante);
    if (valorDevido <= 0 && pagamentos.length > 0) return;

    // Fiado e Vale precisam de etapa assíncrona (picker de cliente / voucher)
    // e a RPC criar_venda_pdv cria a conta_receber pelo valor cheio — então só
    // funcionam como pagamento único, na venda inteira.
    if (forma === 'Fiado' || forma === 'Vale-Alimentação') {
      if (mistoAtivo(pagamentos.length, parcial, restante)) {
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
      setValeDigitos('');
      setValeModal({ valor: parseFloat(restante.toFixed(2)) });
      return;
    }

    // PIX — cria pendente, realtime confirma quando o MaxBank autoriza. Em
    // misto (4 clientes dividindo a conta, por exemplo) vira uma linha e o
    // operador volta ao modal, igual o Cartão já faz — 'destino' decide.
    if (forma === 'PIX') {
      const isMistoActive = mistoAtivo(pagamentos.length, parcial, restante);
      setPaymentModalOpen(false);
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        showToast?.(`Caixa de ${filial} foi fechado. Abra em Financeiro → Controle de Caixa.`, 'error', true);
        await refreshCaixa();
        return;
      }
      try {
        if (!supabase) throw new Error('Supabase indisponível.');
        setIsClosing(true);
        // Cancela pendentes 'aguardando' antigos do mesmo operador (> 30s)
        // para evitar que MaxPay/MaxBank confunda com cobrança nova.
        await cancelarAguardandoAntigas('pix_pendentes', user?.id);
        const pendente = await inserirPixPendente({
          valor: parseFloat(valorDevido.toFixed(2)), clienteId: null, operadorId: user?.id ?? null, filial,
        });
        setPixModal({ ...pendente, destino: isMistoActive ? 'linha' : 'venda' });
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
      setParcelasModalOpen(true);
      return;
    }

    // Só Cartão Débito chega aqui: Dinheiro, PIX e Fiado retornaram acima.
    const isMistoActive = mistoAtivo(pagamentos.length, parcial, restante);
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
      await cancelarAguardandoAntigas('cartao_pendentes', user?.id);
      const pendente = await inserirCartaoPendente({
        valor, metodo, parcelas, operadorId: user?.id ?? null, filial,
      });
      setCartaoModal({ ...pendente, destino });
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
    const valorDevido = calcValorDevido(parcial, restante);
    const isMistoActive = mistoAtivo(pagamentos.length, parcial, restante);
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
    const valorDevido = calcValorDevido(parcial, restante);
    const trocoDessaForma = trocoDoRecebido(recebido, valorDevido);
    if (trocoDessaForma === null) {
      showToast?.(`Valor recebido (R$ ${formatBRL(recebido)}) menor que devido (R$ ${formatBRL(valorDevido)}).`, 'error', true);
      return;
    }
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
    setPixError(null);
    setPixProcessing(false);
  }, [pixModal?.id]);

  // Registra a venda (ou soma a linha do misto) quando o pix vira 'pago'.
  // Chamado pelo realtime/polling (via `usePagamentoPendente`, uma vez por
  // aviso) ou pelo botão "Tentar Novamente". Devolve `false` na falha: a
  // espera solta a trava e o próximo polling tenta de novo sozinho.
  const processarPagamentoPix = useCallback(async (): Promise<boolean> => {
    if (!pixModal) return true;
    setPixError(null);
    setPixProcessing(true);
    try {
      const aberto = await caixaAindaAberto();
      if (!aberto) {
        throw new Error(`Caixa de ${filial} foi fechado. Reabra em Financeiro → Controle de Caixa e clique em "Tentar Novamente". O PIX já foi pago no MaxBank — NÃO cancele aqui.`);
      }
      // Misto: a confirmação vira uma linha de pagamento e o operador volta
      // ao modal pra lançar o resto — a venda só fecha no FECHAR VENDA.
      if (pixModal.destino === 'linha') {
        setPagamentos(prev => [...prev, { forma: 'PIX', valor: pixModal.valor }]);
        setParcialValor('');
        setPixModal(null);
        setPaymentModalOpen(true);
        focusFecharVenda();
        return true;
      }
      await finalizarVendaRef.current('PIX');
      setPixModal(null);
      setReciboModalOpen(true);
      return true;
    } catch (err: any) {
      setPixError(err?.message ?? String(err));
      return false;
    } finally {
      setPixProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixModal, filial]);

  // PIX realtime + polling — finaliza venda quando MaxBank/MaxPay confirma
  usePagamentoPendente(
    pixModal && { tabela: 'pix_pendentes', id: pixModal.id, canal: `smx_pix_${pixModal.id}` },
    processarPagamentoPix,
  );

  // Cartão (maquininha) realtime + polling — finaliza venda quando MaxBank autoriza
  usePagamentoPendente(
    cartaoModal && { tabela: 'cartao_pendentes', id: cartaoModal.id, canal: `smx_cartao_${cartaoModal.id}` },
    async () => {
      if (!cartaoModal) return;
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
    },
  );

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
    // Pix que ia virar linha do misto: desistir dele não pode abandonar a
    // venda pela metade — o operador volta pro modal com o que já lançou.
    const voltaProMisto = pixModal.destino === 'linha';
    try {
      const error = await cancelarCobranca('pix_pendentes', pixId);
      if (error) throw error;
    } catch (err: any) {
      showToast?.(`Falha ao cancelar PIX (${err?.message ?? '—'}). Verifique em pix_pendentes.`, 'error', true);
    } finally {
      setConfirmPixCancel(false);
      setPixModal(null);
      if (voltaProMisto) setPaymentModalOpen(true);
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
      const error = await cancelarCobranca('cartao_pendentes', cartaoId);
      if (error) throw error;
    } catch (err: any) {
      showToast?.(`Falha ao cancelar cartão (${err?.message ?? '—'}).`, 'error', true);
    } finally {
      setConfirmCartaoCancel(false);
      setCartaoModal(null);
      if (voltaProMisto) setPaymentModalOpen(true);
    }
  };

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

  // Fechou um seletor aberto por cima do pagamento (cartão, PIX/Vale/Fiado,
  // parcelas, dinheiro, CPF, cliente)? O elemento focado sumiu com ele e o
  // foco caía no body — fora do modal, onde F1/F2/F3, setas e Esc não chegam.
  // Só age se o foco estiver mesmo fora: não rouba o FECHAR VENDA focado.
  const subModalDoPagamento = cardPickerOpen || payerPickerOpen || parcelasModalOpen || cashModalOpen
    || discountModalOpen || !!descAuth || cpfModalOpen || clientPickerOpen || confirmCancel || !!descarte;
  useEffect(() => {
    if (!paymentModalOpen || subModalDoPagamento) return;
    const id = setTimeout(() => {
      const raiz = document.querySelector('[data-pdv-pagamento]');
      if (raiz && !raiz.contains(document.activeElement)) parcialInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [paymentModalOpen, subModalDoPagamento]);

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

  // Teclado do campo CÓDIGO (a tela é LinhaCodigo). Enter lê; setas andam nas
  // sugestões ou, com o campo vazio, nos itens do carrinho; Esc desiste.
  const onCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
  };

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
        <AberturaCaixaCard filial={filial} abertura={abertura} onVerificar={() => refreshCaixa()} />
      </div>
    );
  }

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex flex-col ${rootClass}`}
      style={{ fontFamily: 'Arial, Helvetica, sans-serif', background: '#f3f4f6' }}
      onKeyDown={(e) => {
        // Trava TAB dentro do PDV: ao chegar no último focável, volta pro
        // primeiro; ao Shift+Tab no primeiro, vai pro último. Operador nunca
        // escapa pra barra do navegador nem pra outros apps da página.
        //
        // Este handler cobre o foco DENTRO do PDV. O foco fora dele (body,
        // sidebar atrás do overlay) não dispara onKeyDown nenhum e é tratado
        // por `devolverTabAoPdv` no listener global de captura.
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
      <CupomItens
        cart={cart}
        selectedCartIdx={selectedCartIdx}
        ofertaDoItem={ofertaDoItem}
        onRemover={removeFromCart}
        lastAdded={lastAdded}
        totalItens={totalItens}
        subtotal={subtotal}
        descontoAplicado={descontoAplicado}
        economiaOfertas={economiaOfertas}
      />

      {/* Barra TOTAL A PAGAR */}
      <div className="px-6 py-4 flex items-center justify-between border-t-2 shrink-0 bg-gray-100" style={{ borderColor: YELLOW_DARK }}>
        <span className="text-3xl font-bold tracking-wide text-gray-700">TOTAL A PAGAR</span>
        <span className="text-7xl font-bold tabular-nums leading-none" style={{ color: NAVY_DARK }}>
          R$ {fmt(totalFinal)}
        </span>
      </div>

      {/* Linha CÓDIGO */}
      <LinhaCodigo
        erro={codeMsg && codeMsg.type === 'err' ? codeMsg.text : null}
        qtdArmada={qtdArmada}
        inputRef={codeInputRef}
        code={code}
        onDigitar={registrarDigitacao}
        onKeyDown={onCodeKeyDown}
        suggestions={suggestions}
        suggestionIdx={suggestionIdx}
        onSugestaoIdx={setSuggestionIdx}
        onEscolherSugestao={(p) => { addToCart(p); setCode(''); setSuggestionIdx(-1); codeInputRef.current?.focus(); }}
        temItens={cart.length > 0}
        vendaSuspensa={vendaSuspensa ? { itens: vendaSuspensa.cart.length, suspensaEm: vendaSuspensa.suspensaEm } : null}
        onSuspender={suspenderVenda}
        onRecuperar={recuperarVendaSuspensa}
        onCancelarVenda={cancelSale}
        onFecharVenda={openPayment}
        processando={isClosing}
      />

      {/* Rodapé amarelo F-keys */}
      <RodapeAtalhos />

      {/* === MODAIS === */}

      {/* Forma de pagamento — nav por teclado: ↑↓←→ ou Tab/Shift+Tab, F1/F2/F3 atalho, Enter confirma o botão focado */}
      {paymentModalOpen && (
        <PagamentoModal
          totalFinal={totalFinal}
          subtotal={subtotal}
          descontoAplicado={descontoAplicado}
          restante={restante}
          pagamentos={pagamentos}
          parcialValor={parcialValor}
          onParcial={setParcialValor}
          parcialInputRef={parcialInputRef}
          erro={paymentError}
          processando={isClosing}
          payChoiceIdx={payChoiceIdx}
          setPayChoiceIdx={setPayChoiceIdx}
          payBtnRefs={payBtnRefs}
          editPagIdx={editPagIdx}
          editPagValor={editPagValor}
          onEditPagValor={setEditPagValor}
          onIniciarEdicao={iniciarEdicaoPagamento}
          onConfirmarEdicao={confirmarEdicaoPagamento}
          onCancelarEdicao={() => { setEditPagIdx(null); setEditPagValor(''); }}
          onRemoverPagamento={(idx) => {
            const linha = pagamentos[idx];
            if (!linha) return;
            pedirDescarte('Remover este pagamento', [linha], () => {
              setPagamentos(prev => prev.filter((_, i) => i !== idx));
              setEditPagIdx(null);
              setEditPagValor('');
            });
          }}
          onLimparPagamentos={() => pedirDescarte('Descartar os pagamentos', pagamentos, () => { setPagamentos([]); setParcialValor(''); })}
          onEscolherForma={handlePayChoice}
          onAbrirCartao={() => setCardPickerOpen(true)}
          onAbrirOutras={() => setPayerPickerOpen(true)}
          cpfNota={cpfNota}
          clienteVinculado={clienteVinculado}
          onDesconto={() => { setDiscountKind('percent'); setDiscountValue(''); setDiscountModalOpen(true); }}
          onCpf={() => { setCpfInput(cpfNota ? mascararDocumento(cpfNota) : ''); setCpfModalOpen(true); }}
          onVincularCliente={() => { setClientSearch(''); setClientPickerModo('vincular'); setClientPickerOpen(true); }}
          onDesvincularCliente={() => setClienteVinculado(null)}
          onVoltar={() => pedirDescarte('Voltar e descartar os pagamentos', pagamentos, () => {
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
            devolverFoco();
          })}
          onCancelarVenda={cancelSale}
          onFecharVenda={finalizarVendaMisto}
          // O X fechava deixando as linhas no estado, e reabrir o pagamento
          // (F5) as zera — PIX/Cartão pago sumia sem aviso por esse caminho.
          onFechar={() => pedirDescarte('Fechar e descartar os pagamentos', pagamentos, () => {
            if (valorEletronicoPago(pagamentos) > 0.001) { setPagamentos([]); setParcialValor(''); }
            setPaymentModalOpen(false);
            devolverFoco();
          })}
        />
      )}

      {/* Dinheiro com cálculo de troco — em misto, valorDevido = parcial */}
      {cashModalOpen && (
        <DinheiroModal
          valorDevido={calcValorDevido(parseBRL(parcialValor), restante)}
          totalFinal={totalFinal}
          recebidoTexto={cashReceived}
          onRecebido={setCashReceived}
          inputRef={cashInputRef}
          processando={isClosing}
          onConfirmar={handleCashConfirm}
          onVoltar={() => setCashModalOpen(false)}
        />
      )}

      {/* Troco / Pagamento exato em tela cheia — Enter fecha + abre agradecimento */}
      {changeModal && (
        <TrocoTela valor={changeModal.amount} onContinuar={() => { setChangeModal(null); setReciboModalOpen(true); }} />
      )}

      {/* Manual do PDV — passo a passo + tabela de atalhos */}
      {helpOpen && <ManualPdv onClose={() => { setHelpOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }} />}

      {/* Recibo — resumo da venda com opção de baixar PDF antes do agradecimento */}
      {reciboModalOpen && lastVenda && (
        <ReciboVendaModal
          venda={lastVenda}
          filial={filial}
          operador={operadorNome}
          onContinuar={() => { setReciboModalOpen(false); setThankYouOpen(true); }}
        />
      )}

      {/* Agradecimento — tela final supermercado (só fecha com Enter) */}
      {thankYouOpen && (
        <AgradecimentoTela
          onContinuar={() => { setThankYouOpen(false); setLastVenda(null); setTimeout(() => codeInputRef.current?.focus(), 50); }}
        />
      )}

      {/* Cliente picker (Fiado) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {clientPickerOpen && (
        <ClientePickerModal
          titulo={clientPickerModo === 'fiado' ? 'Fiado · Selecione o cliente' : 'Vincular cliente à venda'}
          clientes={clientes as any[]}
          busca={clientSearch}
          onBusca={setClientSearch}
          onEscolher={escolherCliente}
          onClose={() => setClientPickerOpen(false)}
        />
      )}

      {/* PIX aguardando — Esc pede confirmação (não cancela direto) */}
      {pixModal && (
        <PixAguardandoModal
          cobranca={pixModal}
          linha={pixModal.destino === 'linha'}
          erro={pixError}
          processando={pixProcessing}
          onTentarDeNovo={processarPagamentoPix}
          confirmando={confirmPixCancel}
          onConfirmando={setConfirmPixCancel}
          onCancelar={cancelarPix}
        />
      )}

      {/* Cartão (Maquininha) aguardando — MaxPay/MaxBank autoriza */}
      {cartaoModal && (
        <CartaoAguardandoModal
          cobranca={cartaoModal}
          linha={cartaoModal.destino === 'linha'}
          confirmando={confirmCartaoCancel}
          onConfirmando={setConfirmCartaoCancel}
          onCancelar={cancelarCartao}
        />
      )}

      {/* Confirmar cancelar venda — ← → escolher · Enter confirma · Esc volta */}
      {/* Autorização do gerente para o desconto (padrão "desconto supervisionado"
          dos PDVs de supermercado: o operador pede, o gerente libera). */}
      {descAuth && (
        <DescontoAutorizacaoModal
          valor={descAuth.valor}
          filial={filial}
          motivo={descAuthMotivo}
          onMotivo={setDescAuthMotivo}
          obs={descAuthObs}
          onObs={setDescAuthObs}
          email={descAuthEmail}
          onEmail={setDescAuthEmail}
          senha={descAuthSenha}
          onSenha={setDescAuthSenha}
          carregando={descAuthLoading}
          onAutorizar={confirmarAutorizacaoDesconto}
          onCancelar={() => { setDescAuth(null); setDescAuthSenha(''); devolverFoco(); }}
        />
      )}

      {/* Gancheira ocupada — suspender de novo descarta a venda que está lá. */}
      {confirmSuspender && (
        <GancheiraOcupadaModal
          suspensa={vendaSuspensa ? { itens: vendaSuspensa.cart.length, suspensaEm: vendaSuspensa.suspensaEm } : null}
          onSuspender={doSuspenderVenda}
          onVoltar={() => { setConfirmSuspender(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}

      {confirmCancel && (
        <CancelarVendaModal
          itens={cart.length}
          valorPago={valorEletronicoPago(pagamentos)}
          onCancelarVenda={reallyCancelSale}
          onVoltar={() => { setConfirmCancel(false); devolverFoco(); }}
        />
      )}

      {descarte && (
        <DescartarPagoModal
          acao={descarte.acao}
          valor={valorEletronicoPago(descarte.linhas)}
          detalhe={formaDoMisto(descarte.linhas.filter(ehLinhaEletronica)).replace(/^Misto: /, '')}
          onConfirmar={() => { const { confirmar } = descarte; setDescarte(null); confirmar(); devolverFoco(); }}
          onVoltar={() => { setDescarte(null); devolverFoco(); }}
        />
      )}

      {/* Busca de produto (F8) — ↑↓ navega · Enter adiciona · Esc fecha */}
      {searchModalOpen && (
        <BuscaProdutoModal
          termo={searchTerm}
          onTermo={setSearchTerm}
          produtos={filteredSearch}
          qtd={qtdDoF8}
          onEscolher={(p) => {
            addToCart(p, buscaF8.temMultiplicador ? buscaF8.qtd : undefined);
            setSearchModalOpen(false);
            codeInputRef.current?.focus();
          }}
          onClose={() => { setSearchModalOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}

      {/* Consulta de preço (F7) — read-only, não adiciona ao carrinho */}
      {priceQueryOpen && (
        <ConsultaPrecoModal
          produtos={produtosDisponiveis}
          onClose={() => { setPriceQueryOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}

      {/* Picker de cartão (F2 no payment modal) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {cardPickerOpen && (
        <CartaoPickerModal
          onEscolher={(forma) => { setCardPickerOpen(false); handlePayChoice(forma); }}
          onVoltar={() => setCardPickerOpen(false)}
        />
      )}

      {/* Reimpressão (Ctrl+R) — últimas 10 vendas concluídas da filial nesta sessão */}
      {reprintOpen && (
        <ReimpressaoModal
          lista={reprintList}
          carregando={reprintLoading}
          onEscolher={confirmReprint}
          onClose={() => { setReprintOpen(false); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}

      {/* CPF / CNPJ na nota — mesmo modal do MaxPOS. Vazio + confirmar remove. */}
      {cpfModalOpen && (
        <CpfNotaModal
          valor={cpfInput}
          onChange={setCpfInput}
          onConfirmar={confirmarCpf}
          onCancelar={() => setCpfModalOpen(false)}
        />
      )}

      {/* Vale-Alimentação — a maquininha do voucher pede os 4 últimos dígitos.
          Simulação, igual ao MaxPOS: qualquer combinação de 4 autoriza. */}
      {valeModal && (
        <ValeModal
          valor={valeModal.valor}
          digitos={valeDigitos}
          onDigitos={setValeDigitos}
          processando={isClosing}
          onConfirmar={confirmarVale}
          onCancelar={() => { setValeModal(null); setValeDigitos(''); setPaymentModalOpen(true); }}
        />
      )}

      {/* Picker PIX/Fiado (F3 no payment modal) — ↑↓ navega · Enter seleciona · Esc fecha */}
      {payerPickerOpen && (
        <PagadorPickerModal
          misto={mistoAtivo(pagamentos.length, parseBRL(parcialValor), restante)}
          onEscolher={(forma) => { setPayerPickerOpen(false); handlePayChoice(forma); }}
          onVoltar={() => setPayerPickerOpen(false)}
        />
      )}

      {/* Parcelas Cartão Crédito (1x-12x) — só forma única; misto não pergunta */}
      {parcelasModalOpen && (
        <ParcelasModal
          valorDevido={calcValorDevido(parseBRL(parcialValor), restante)}
          onEscolher={confirmarParcelas}
          onVoltar={() => setParcelasModalOpen(false)}
        />
      )}

      {/* Desconto (F6) — % ou R$ aplicado no total · Enter aplica · Esc cancela */}
      {discountModalOpen && (
        <DescontoModal
          subtotal={subtotal}
          tipo={discountKind}
          onTipo={setDiscountKind}
          valorTexto={discountValue}
          onValorTexto={setDiscountValue}
          temDesconto={desconto > 0}
          onPedirAutorizacao={(valor) => {
            if (valor <= 0) { showToast?.('Informe um desconto maior que zero.', 'error', true); return; }
            // Não aplica aqui: em supermercado o desconto sai com a senha do
            // gerente. O modal seguinte pede a autorização e o motivo.
            setDiscountModalOpen(false);
            setDescAuth({ valor });
          }}
          onRemover={() => { setDesconto(0); setDescontoAutorizacao(null); setDiscountModalOpen(false); devolverFoco(); }}
          onFechar={() => { setDiscountModalOpen(false); devolverFoco(); }}
        />
      )}

      {/* Suprimento (F11) / Sangria (F12) — Enter confirma · Esc fecha */}
      {cashMoveModal && (
        <MovimentoCaixaModal
          tipo={cashMoveModal.tipo}
          valorTexto={cashMoveValor}
          onValorTexto={setCashMoveValor}
          motivo={cashMoveMotivo}
          onMotivo={setCashMoveMotivo}
          processando={isClosing}
          onConfirmar={handleCashMoveConfirm}
          onFechar={() => { setCashMoveModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}

      {/* Modal fechar/suspender caixa pelo operador (F3) */}
      {caixaOpModal && (
        <OperacaoCaixaModal
          modo={caixaOpModal}
          onModo={setCaixaOpModal}
          valorTexto={caixaOpValor}
          onValorTexto={setCaixaOpValor}
          obs={caixaOpObs}
          onObs={setCaixaOpObs}
          processando={isClosing}
          onConfirmar={handleCaixaOpConfirm}
          onFechar={() => { setCaixaOpModal(null); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
        />
      )}


    </motion.div>
  );
};
