import { isConselheiro } from '../lib/rbac';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Trash2, Plus, Minus, ShoppingCart, CheckCircle2, X, Loader2, User, AlertTriangle, Lock, CreditCard, Smartphone, QrCode, FileDown, Scale, Ticket, Maximize2, Minimize2, Package, ArrowLeft, Store, Undo2, Wrench, Info } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { codigoCobranca } from '../lib/cobranca';
import { useFetchData } from '../hooks/useSupabaseData';
import { useCaixaAberto } from '../hooks/useCaixaAberto';
import { useVarrerPendentesOrfaos } from '../hooks/usePendentesOrfaos';
import { useFullscreenNativo } from '../hooks/useFullscreenNativo';
import { useAuth } from '../hooks/useAuth';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { LoadingSpinner, FilialBadge, ProdutoThumb } from '../components/ui';
import { supabase } from '../lib/supabase';
import { UNIDADES_FRACIONARIAS } from '../lib/unidades';
import { ehVendavel } from '../lib/tipoProduto';
import { todayBR } from '../lib/dates';
import { playBeep, playKaching, playPlim } from '../utils/audioUtils';
import { FILIAL_COLOR } from '../lib/filiais';
import type { Produto, Cliente } from '../types/domain';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { consultarCreditoCliente, bloqueioFiado, type CreditoCliente } from '../lib/credito';
import { downloadCatalogoEan13Pdf } from '../lib/barcode';
import { rotuloVariante } from '../lib/atributosProduto';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { buildPixQrValue, buildCartaoQrValue } from '../lib/pixQr';
import { PDVViewSupermax } from './PDVViewSupermax';
import { PDVFecharCaixa } from '../components/PDVFecharCaixa';
import { ProdutoDetalheModal } from '../components/ProdutoDetalheModal';
import { normalizarBusca, produtoCasa, buscarProdutos } from '../lib/produtoBusca';

// Unidades operacionais do PDV. Matriz é administrativa, não vende — fica fora.
// Cada filial tem caixa próprio em `controle_caixa`; PDV só opera com o caixa
// daquela unidade aberto. Colaborador é travado na própria filial; admin/CEO/
// gerente podem alternar entre as três.
const FILIAIS_PDV = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialPDV = typeof FILIAIS_PDV[number];

// Unidades em que a venda é por peso/volume — o PDV pede peso em vez de
// incrementar +1. Operador digita "1,250" pra 1 kg e 250 g.
// Vem de src/lib/unidades.ts — mesma régua do cadastro e da requisição.
const isProdutoFracionario = (p: any): boolean =>
  UNIDADES_FRACIONARIAS.has(String(p?.unidade ?? 'UN').toUpperCase());

const formatQtd = (qtd: number, unidade: string): string => {
  const u = (unidade || 'UN').toUpperCase();
  if (UNIDADES_FRACIONARIAS.has(u)) {
    return qtd.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return String(Math.round(qtd));
};

// Só admin, CEO e Conselheiro alternam entre filiais (modo Matriz). Gerente
// fica travado na própria unidade, igual colaborador — gerente não cobre
// outras filiais (regra de negócio).
const podeAlternarFilial = (profile: any): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

// Devolução é ato de alçada (migr. 459): mexe em estoque, dinheiro e cobrança
// na mesma transação. Espelha o guard de `criar_devolucao_venda` —
// `auth_is_admin() OR auth_gerente_da(filial)`. A tela só evita o erro seco; a
// regra que vale é a do banco.
const podeDevolver = (profile: any, filial: string): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile)
  || (profile?.role === 'gerente' && profile?.filial === filial);

interface CartItem {
  produto_id: string;
  nome_produto: string;
  preco_unitario: number;
  qtd: number;
  subtotal: number;
  estoque: number;
  unidade: string;
}

// MaxLook/TechMax não aceitam MaxBank Benefícios — só faz sentido no
// SuperMax (supermercado tem itens elegíveis, roupa e eletrônico não).
const FORMAS = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX', 'Fiado'];

// `subtitulo` aparece no header do PDV aberto (personalidade da unidade);
// `layout` define o estilo do card na grade; `accentBar` é a cor decorativa da
// barra sob a logo — mantém accent dourado no texto pra coesão com o resto do app.
//
// Não tem mais lista fixa de `chips`: até 2026-08-13 cada filial declarava as
// categorias à mão aqui e o filtro comparava por substring contra
// `produtos.categoria`. Nenhuma turma cadastrou com esses nomes — "Roupas" não
// existia em nenhuma categoria da MaxLook, então a aba abria vazia; TechMax
// tinha 4 de 5 chips mortos pelo mesmo motivo. Agora os chips saem do próprio
// cadastro (categoriasChips), então gaveta vazia deixou de ser possível.
const FILIAL_META: Record<FilialPDV, {
  logo: string;
  desc: string;
  logoBg?: string;
  subtitulo?: string;
  layout?: 'fashion' | 'tech';
  accentBar?: string;
}> = {
  SuperMax: { logo: '/icon-supermax.png', desc: 'Supermercado', logoBg: '#ffffff' },
  MaxLook:  {
    logo: '/icon-maxlook.png',
    desc: 'Roupas, Calçados e Acessórios Femininos e Masculinos',
    subtitulo: 'Boutique',
    layout: 'fashion',
    accentBar: '#D4AF37',
  },
  TechMax:  {
    logo: '/icon-techmax.png',
    desc: 'Eletrônicos e Assistência Técnica',
    subtitulo: 'Loja & Assistência',
    layout: 'tech',
    accentBar: '#F97316',
  },
};

// Chave de agrupamento de categoria: sem acento, sem caixa, sem espaço nas
// pontas. Colapsa as variantes que a turma digitou ("Acessorios"/"Acessórios",
// "LIMPEZA " com espaço à direita) numa gaveta só.
const chaveCategoria = (c: unknown): string => normalizarBusca(c).trim();

export const PDVView = ({ showToast, profile, filialAtiva }: any) => {
  const podeAlternar = podeAlternarFilial(profile);
  const filialDoOperador: FilialPDV | null =
    (FILIAIS_PDV as readonly string[]).includes(profile?.filial)
      ? (profile.filial as FilialPDV)
      : null;

  // Se há um hub de filial ativo na sessão (admin/CEO/gerente operando em modo filial),
  // usa essa filial diretamente — sem mostrar o seletor das 3.
  const filialDeSessao: FilialPDV | null =
    (FILIAIS_PDV as readonly string[]).includes(filialAtiva)
      ? (filialAtiva as FilialPDV)
      : null;

  const filialResolvida = filialDeSessao ?? filialDoOperador;

  const [filialEscolhida, setFilialEscolhida] = useState<FilialPDV | null>(
    filialResolvida ?? (podeAlternar ? null : null)
  );

  // Sincroniza quando o hub muda fora do PDV (ex.: usuário troca filial pela topbar).
  const filialAtivaRef = React.useRef(filialAtiva);
  if (filialAtivaRef.current !== filialAtiva) {
    filialAtivaRef.current = filialAtiva;
    const nova = (FILIAIS_PDV as readonly string[]).includes(filialAtiva)
      ? (filialAtiva as FilialPDV)
      : null;
    if (nova !== filialEscolhida) setFilialEscolhida(nova);
  }

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
    // Só mostra botão Voltar se pode alternar E não está preso por hub de sessão.
    const podVoltar = podeAlternar && !filialDeSessao;
    return (
      <PDVViewInner
        showToast={showToast}
        profile={profile}
        filialInicial={filialEscolhida}
        onVoltar={podVoltar ? () => setFilialEscolhida(null) : undefined}
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
                <p className="text-lg font-black text-accent">{f}</p>
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
  // Realtime enabled: any other cashier's sale triggers a produtos update via the stock trigger.
  // Filtrado por filial na própria query — não só no client — pra não trafegar
  // produtos de outras unidades pro browser do operador.
  const { data: produtos, isLoading: loadingProd } = useFetchData<Produto>('/api/produtosview', { filial: filialFiltro }, true);
  const { data: clientes } = useFetchData<Cliente>('/api/crmview', { filial: filialFiltro });

  const [search, setSearch] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null);
  // Ficha do produto aberta pelo botão de informação do card — a tela que o
  // vendedor vira pro cliente. O clique no card continua sendo "adicionar".
  const [detalheProduto, setDetalheProduto] = useState<any | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // Nicho-específico (Fase 2, sem migração — grava em vendas.observacao pós-RPC).
  // MaxLook: vendedor associado à venda (comissão de moda). TechMax: IMEI/Serial
  // do aparelho vendido (celular/notebook — garantia).
  const [vendedorId, setVendedorId] = useState<string>('');
  const [imeiSerial, setImeiSerial] = useState<string>('');
  // TechMax: alterna entre venda de balcão e abertura de OS (assistência
  // técnica). Sem tabela nova — grava tag "OS" + defeito relatado em
  // vendas.observacao junto do IMEI/Serial já existente.
  const [tipoAtendimento, setTipoAtendimento] = useState<'Venda' | 'OS'>('Venda');
  const [defeitoRelatado, setDefeitoRelatado] = useState<string>('');
  // MaxLook: modal de Troca/Devolução — busca uma venda concluída da
  // filial pelos 6 últimos caracteres do id (mesmo formato do recibo),
  // deixa escolher item(ns) + quantidade e chama `criar_devolucao_venda` —
  // uma porta só para a devolução, seja pelo caixa ou pela tela (migr. 459).
  const [devolucao, setDevolucao] = useState<{
    busca: string;
    buscando: boolean;
    erro: string | null;
    venda: {
      id: string;
      shortId: string;
      formaPagamento: string;
      itens: Array<{ produto_id: string; nome_produto: string; qtd: number; preco_unitario: number; jaDevolvido: number }>;
    } | null;
    qtds: Record<string, string>;
    motivo: string;
    processando: boolean;
  } | null>(null);
  // Lista de vendedores da filial (só carrega quando MaxLook — moda usa comissão).
  const [vendedores, setVendedores] = useState<Array<{ id: string; nome: string }>>([]);
  useEffect(() => {
    if (filialFiltro !== 'MaxLook' || !supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, nome, setor, setores_extras, filial')
        .eq('filial', 'MaxLook');
      if (cancelled || !data) return;
      // Considera vendedor quem tem setor='vendas' OU está em setores_extras.
      const filtrados = data
        .filter((u: any) => u.setor === 'vendas' || (Array.isArray(u.setores_extras) && u.setores_extras.includes('vendas')))
        .map((u: any) => ({ id: u.id, nome: u.nome ?? 'Sem nome' }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setVendedores(filtrados);
    })();
    return () => { cancelled = true; };
  }, [filialFiltro]);
  const [desconto, setDesconto] = useState('');
  // Desconto em % é conversa de balcão ("tira 10%"), mas a venda é gravada
  // sempre em reais: `vendas.desconto` é numeric e o RPC confere que
  // total − desconto = total_final. O percentual vive só aqui, como forma de
  // digitar — o que sai daqui para o banco já é o valor convertido.
  const [descontoModo, setDescontoModo] = useState<'valor' | 'pct'>('valor');
  const [descontoPct, setDescontoPct] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [parcelas, setParcelas] = useState(1);
  const [clienteId, setClienteId] = useState('');
  // Crédito do cliente escolhido no Fiado (migr. 416). Só para MOSTRAR: quem
  // barra a venda é a trigger em `vendas`, e o fechamento reconsulta.
  const [credito, setCredito] = useState<CreditoCliente | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!clienteId || formaPagamento !== 'Fiado') { setCredito(null); return; }
    consultarCreditoCliente(clienteId).then(c => { if (vivo) setCredito(c); });
    return () => { vivo = false; };
  }, [clienteId, formaPagamento]);
  const [isClosing, setIsClosing] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [lastVenda, setLastVenda] = useState<{ id: string; total: number } | null>(null);
  // Tela de agradecimento full-screen (portado do simulador MaxPOS).
  // Aparece logo após venda concluída e fecha com ENTER ou click.
  const [thankYouOpen, setThankYouOpen] = useState(false);
  // Pix em aguardo: payload na DB + snapshot do carrinho para chamar o RPC após confirmação
  const [pixPendente, setPixPendente] = useState<{ id: string; valor: number } | null>(null);
  // Cliente pagou (Pix confirmado / cartão autorizado) mas `criar_venda_pdv`
  // falhou — quase sempre estoque, porque nada reserva o item entre gerar a
  // cobrança e o cliente confirmar. Era só um toast: sumia em segundos e
  // levava junto a única evidência de que havia dinheiro recebido sem venda.
  // Agora é modal bloqueante com retry, como no PDV da SuperMax.
  const [falhaPosPagamento, setFalhaPosPagamento] = useState<{
    forma: string;
    parcelas: number;
    valor: number;
    erro: string;
    tentando: boolean;
  } | null>(null);
  // Cartão (maquininha MaxPay) em aguardo: pendente em cartao_pendentes; PDV
  // finaliza venda via realtime/polling quando MaxBank autoriza. Mesmo padrão
  // usado no SuperMax, adaptado pra MaxLook/TechMax.
  const [cartaoModal, setCartaoModal] = useState<{
    id: string;
    valor: number;
    metodo: 'debito' | 'credito';
    parcelas: number;
  } | null>(null);
  // Dinheiro: valor recebido do cliente pra cálculo do troco. Só client-side
  // (não persiste — troco é operacional, não fiscal). Aceita R$ formatado.
  const [dinheiroRecebido, setDinheiroRecebido] = useState<string>('');
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
  // Tela cheia do navegador, não só o overlay sobre a shell: sem isto a barra
  // de endereço e a barra de tarefas continuavam à vista no caixa.
  useFullscreenNativo(fullscreen, useCallback(() => setFullscreen(false), []));
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
      // Esc com a ficha do produto aberta fecha só a ficha (o próprio modal
      // trata). Sem esta guarda, um Esc fazia as duas coisas: fechava a ficha
      // e derrubava o PDV do modo tela cheia.
      if (e.key === 'Escape' && fullscreen && !detalheProduto) {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen, detalheProduto]);

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

  // Só mercadoria para revenda entra no PDV. A pergunta é AFIRMATIVA de
  // propósito (migr. 440): a versão anterior era `tipo !== 'patrimonio'`, e
  // blacklist faz tipo novo nascer vendável — material de uso e consumo
  // (resma, água, limpeza) teria entrado no caixa por omissão. O banco repete
  // a regra em `fn_item_venda_so_mercadoria`, então a tela é conveniência, não
  // a trava.
  const produtosAtivos = produtos.filter((p: any) =>
    (p.status === 'Ativo' || !p.status) && ehVendavel(p.tipo)
  );
  // Filial filter primeiro, depois busca textual. Critério: igual exato a `filial`
  // (campo na tabela `produtos`). Produto com filial='Matriz' ou ausente fica
  // fora — PDV opera só nas 3 unidades operacionais.
  const produtosPorFilial = produtosAtivos.filter((p: any) => p.filial === filialFiltro);

  // Chips de categoria derivados do que está cadastrado nesta filial — um chip
  // só existe se tem produto atrás dele. `chave` agrupa variantes de acento e
  // espaço; `label` é a primeira grafia encontrada (mostra o que a turma digitou).
  const categoriasChips = React.useMemo(() => {
    const mapa = new Map<string, { chave: string; label: string; total: number }>();
    for (const p of produtosPorFilial) {
      const label = String((p as any).categoria ?? '').trim();
      if (!label) continue;
      const chave = chaveCategoria(label);
      const atual = mapa.get(chave);
      if (atual) atual.total += 1;
      else mapa.set(chave, { chave, label, total: 1 });
    }
    return [...mapa.values()].sort((a, b) =>
      b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
  }, [produtosPorFilial]);

  // O filtro guarda a CHAVE normalizada, não o rótulo — senão "Acessorios" e
  // "Acessórios" voltariam a ser gavetas diferentes.
  const categoriaLabel = categoriasChips.find(c => c.chave === categoriaFiltro)?.label ?? categoriaFiltro;
  const produtosPorCategoria = produtosPorFilial.filter((p: any) => {
    if (!categoriaFiltro) return true;
    return chaveCategoria(p.categoria) === categoriaFiltro;
  });
  // Busca textual por PREFIXO e acento-insensível (lib/produtoBusca.ts). Antes
  // era `.includes()` sem normalizar: "ca" trazia ma[ca]rrão junto com café, e
  // "café" digitado não achava "CAFE" cadastrado. Busca vazia mantém a ordem
  // original da grade — buscarProdutos só reordena quando há termo.
  const filtered = buscarProdutos(produtosPorCategoria, search, produtosPorCategoria.length);

  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  // Aceita "10", "10,5" e "10.5"; acima de 100% o desconto seria maior que a
  // venda, e o RPC recusaria com total_final negativo.
  const descontoPctNum = Math.min(100, Math.max(0, Number(String(descontoPct).replace(',', '.')) || 0));
  // Arredonda em centavos (subtotal × pct já está em centavos), senão sobra
  // fração de centavo e o RPC recusa a venda por total − desconto ≠ total_final.
  const descontoNum = descontoModo === 'pct'
    ? Math.min(subtotal, Math.round(subtotal * descontoPctNum) / 100)
    : parseBRL(desconto);
  // Cupom só vale se o subtotal ainda comporta o desconto (clamp por segurança).
  const cupomDesconto = Math.min(cupomAplicado?.desconto ?? 0, Math.max(0, subtotal - descontoNum));
  const totalFinal = Math.max(0, subtotal - descontoNum - cupomDesconto);

  // Dinheiro: cálculo local de troco. Zero quando cliente ainda não digitou
  // ou digitou menos que o total (nesse caso o UI mostra "Falta R$ X").
  const dinheiroRecebidoNum = parseBRL(dinheiroRecebido);
  const troco = Math.max(0, dinheiroRecebidoNum - totalFinal);
  const faltaDinheiro = Math.max(0, totalFinal - dinheiroRecebidoNum);

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
      // Prefixo em vez de substring: com o `.includes()` antigo, um termo curto
      // casava vários produtos, virava ambíguo e caía no "não encontrado".
      const partial = produtosPorFilial.filter((p: any) =>
        produtoCasa(p, normalizarBusca(termo), termo)
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

  // Último caixa aberto conhecido — segura a árvore de render de pé se o hook
  // devolver null por um instante (hiccup de rede/RLS) no meio de uma
  // cobrança. Ver caixaAtivo, antes do RENDER.
  const ultimoCaixaRef = useRef(caixa);

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

  // Varredura de cobranças abandonadas (Pix e cartão) desta filial. Regras e
  // janelas no hook — compartilhado com o PDV da SuperMax pra que as três
  // lojas varram a própria casa com o mesmo critério.
  useVarrerPendentesOrfaos(filialFiltro, user?.id, showToast);

  const removeFromCart = (produto_id: string) => setCart(prev => prev.filter(i => i.produto_id !== produto_id));
  const clearCart = () => { setCart([]); setDesconto(''); setDescontoPct(''); setFormaPagamento('Dinheiro'); setParcelas(1); setClienteId(''); setLastVenda(null); setNetworkError(false); setCupomCodigo(''); setCupomAplicado(null); setCupomErro(null); };

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

    // Info nicho grava em vendas.observacao (a RPC não recebe observação hoje).
    // MaxLook: nome do vendedor associado. TechMax: tag OS + defeito relatado
    // (quando aberto como OS) + IMEI/Serial do aparelho.
    // Falha aqui não desfaz a venda — a operação principal já persistiu.
    const partes: string[] = [];
    if (filialFiltro === 'MaxLook' && vendedorId) {
      const v = vendedores.find(x => x.id === vendedorId);
      if (v) partes.push(`Vendedor: ${v.nome}`);
    }
    if (filialFiltro === 'TechMax') {
      if (tipoAtendimento === 'OS') partes.push('OS');
      if (imeiSerial.trim()) partes.push(`IMEI/Serial: ${imeiSerial.trim()}`);
      if (tipoAtendimento === 'OS' && defeitoRelatado.trim()) partes.push(`Defeito: ${defeitoRelatado.trim()}`);
    }
    if (partes.length > 0) {
      await supabase.from('vendas').update({ observacao: partes.join(' · ') }).eq('id', vendaId);
    }

    // Pix já tocou o "Plim" no callback do realtime (confirmação do cliente);
    // demais formas tocam "ka-ching" agora que a venda foi efetivamente persistida.
    if (forma !== 'PIX') playKaching();

    const shortId = String(vendaId).slice(-6).toUpperCase();
    setLastVenda({ id: shortId, total: snap.totalFinal });
    setThankYouOpen(true);
    setCart([]);
    setDesconto('');
    setDescontoPct('');
    setFormaPagamento('Dinheiro');
    setParcelas(1);
    setClienteId('');
    setImeiSerial('');
    setDefeitoRelatado('');
    setDinheiroRecebido('');
    // Vendedor e tipo de atendimento não são limpos — sessão persiste entre vendas.
    setIsClosing(false);
    searchRef.current?.focus();
  };

  const handleFecharVenda = async () => {
    if (networkError) return;
    if (cart.length === 0) { showToast?.('Carrinho vazio.', 'error', true); return; }
    if (formaPagamento === 'Fiado' && !clienteId) { showToast?.('Selecione o cliente para venda Fiado.', 'error', true); return; }
    // Crédito reconsultado na hora de fechar, não o do state: entre escolher o
    // cliente e bater o total, outro caixa pode ter vendido fiado pra ele. A
    // trigger da migr. 416 recusaria a venda de qualquer jeito — isto só troca
    // um erro de banco por uma frase que diz o que fazer.
    if (formaPagamento === 'Fiado') {
      const motivo = bloqueioFiado(await consultarCreditoCliente(clienteId), totalFinal);
      if (motivo) { showToast?.(motivo, 'error', true); return; }
    }
    if (filialFiltro === 'TechMax' && tipoAtendimento === 'OS' && !defeitoRelatado.trim()) {
      showToast?.('Descreva o defeito relatado para abrir a OS.', 'error', true);
      return;
    }
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

      // Dinheiro: exige valor recebido >= total. Troco é operacional (não
      // persiste). Se cliente ainda não digitou, avisa e volta.
      if (formaPagamento === 'Dinheiro') {
        if (dinheiroRecebidoNum < totalFinal - 0.001) {
          showToast?.(`Valor recebido insuficiente. Falta ${faltaDinheiro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, 'error', true);
          setIsClosing(false);
          return;
        }
      }

      // Fluxo Cartão Débito/Crédito: cria pendente em cartao_pendentes e abre
      // overlay tipo maquininha. Cliente escaneia QR no MaxBank e autoriza —
      // realtime finaliza venda. Mesmo padrão do SuperMax (Fase 6 MaxBank).
      if (formaPagamento === 'Cartão Débito' || formaPagamento === 'Cartão Crédito') {
        const metodo: 'debito' | 'credito' = formaPagamento === 'Cartão Débito' ? 'debito' : 'credito';
        const parcelasEfetivas = metodo === 'credito' ? parcelas : 1;
        // Cancela pendentes antigos do mesmo operador (>30s) — evita QR fantasma
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
            valor:       totalFinal,
            metodo,
            parcelas:    parcelasEfetivas,
            status:      'aguardando',
            operador_id: user?.id ?? null,
            filial:      filialFiltro,
          })
          .select('id, valor, metodo, parcelas')
          .single();
        if (insErr || !pendente) throw new Error(insErr?.message ?? 'Falha ao criar cobrança de cartão.');

        vendaSnapshotRef.current = {
          cart: [...cart],
          subtotal,
          descontoNum,
          totalFinal,
          clienteId,
          cupomCodigo:   cupomAplicado?.codigo ?? null,
          cupomDesconto: cupomDesconto,
        };
        setCartaoModal({
          id:       pendente.id,
          valor:    Number(pendente.valor),
          metodo:   pendente.metodo,
          parcelas: pendente.parcelas,
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
            // Filial do CAIXA aberto, não a do perfil — admin/CEO operam esta
            // unidade pelo hub com perfil 'Matriz' (migr. 414).
            filial: filialFiltro,
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
        setFalhaPosPagamento({
          forma: 'PIX',
          parcelas: 1,
          valor: snap.totalFinal,
          erro: err?.message ?? 'Erro desconhecido.',
          tentando: false,
        });
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

  // Realtime + polling 2s: pendente de cartão. Quando MaxBank autoriza,
  // finaliza venda via criar_venda_pdv com o snapshot capturado. Mesmo
  // padrão do PDVViewSupermax (redundância realtime+polling porque WS às
  // vezes atrasa em plans free do Supabase).
  useEffect(() => {
    if (!cartaoModal || !supabase) return;
    let handled = false;

    const onAutorizado = async () => {
      if (handled) return;
      handled = true;
      const snap = vendaSnapshotRef.current;
      if (!snap) return;
      try {
        playPlim();
        const formaCanon = cartaoModal.metodo === 'debito' ? 'Cartão Débito' : 'Cartão Crédito';
        await finalizarVenda(snap, formaCanon, cartaoModal.parcelas);
        vendaSnapshotRef.current = null;
        setCartaoModal(null);
      } catch (err: any) {
        setFalhaPosPagamento({
          forma: cartaoModal.metodo === 'debito' ? 'Cartão Débito' : 'Cartão Crédito',
          parcelas: cartaoModal.parcelas,
          valor: snap.totalFinal,
          erro: err?.message ?? 'Erro desconhecido.',
          tentando: false,
        });
        setCartaoModal(null);
        setIsClosing(false);
      }
    };

    const channel = supabase
      .channel(`cartao_pendente_${cartaoModal.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cartao_pendentes', filter: `id=eq.${cartaoModal.id}` },
        (payload: any) => { if (payload?.new?.status === 'autorizado') onAutorizado(); },
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

  // Retry do registro depois que o dinheiro já entrou. O snapshot do carrinho
  // continua em memória (só é limpo no sucesso), então basta rechamar o RPC —
  // se o problema era estoque de outro caixa, repor resolve sem refazer a venda.
  const tentarRegistrarNovamente = async () => {
    const snap = vendaSnapshotRef.current;
    if (!falhaPosPagamento) return;
    if (!snap) {
      setFalhaPosPagamento(f => f ? { ...f, erro: 'Carrinho da venda não está mais em memória — registre a venda manualmente.' } : f);
      return;
    }
    setFalhaPosPagamento(f => f ? { ...f, tentando: true } : f);
    try {
      await finalizarVenda(snap, falhaPosPagamento.forma, falhaPosPagamento.parcelas);
      vendaSnapshotRef.current = null;
      setFalhaPosPagamento(null);
    } catch (err: any) {
      setFalhaPosPagamento(f => f ? { ...f, tentando: false, erro: err?.message ?? 'Erro desconhecido.' } : f);
    }
  };

  const cancelarCartao = async () => {
    if (!cartaoModal || !supabase) return;
    await supabase.from('cartao_pendentes')
      .update({ status: 'cancelado' })
      .eq('id', cartaoModal.id);
    vendaSnapshotRef.current = null;
    setCartaoModal(null);
    setIsClosing(false);
  };

  // Troca/Devolução (MaxLook): busca a venda concluída da filial pelos 6
  // últimos caracteres do id (mesmo formato exibido no recibo/toast de
  // sucesso) e traz os itens vendidos + quanto já foi devolvido de cada um.
  const buscarVendaParaDevolucao = async () => {
    if (!devolucao || !supabase) return;
    const termo = devolucao.busca.trim().toUpperCase();
    if (!termo) return;
    setDevolucao(d => d ? { ...d, buscando: true, erro: null, venda: null, qtds: {} } : d);
    try {
      const { data: recentes, error } = await supabase
        .from('vendas')
        .select('id, forma_pagamento, filial, status')
        .eq('filial', filialFiltro)
        .eq('status', 'Concluída')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      const match = (recentes ?? []).find((v: any) => String(v.id).slice(-6).toUpperCase() === termo);
      if (!match) {
        setDevolucao(d => d ? { ...d, buscando: false, erro: 'Venda não encontrada. Confira os 6 últimos caracteres do id (no recibo).' } : d);
        return;
      }

      // `v_venda_saldo_devolucao` e a MESMA fonte que `criar_devolucao_venda`
      // usa para recusar excesso (migr. 459). Antes a tela somava
      // `devolucoes_pdv` e a RPC olhava `itens_devolucao`: duas contas do mesmo
      // saldo, que divergiam assim que a devolucao entrasse pela outra porta.
      const { data: saldos, error: saldoErr } = await supabase
        .from('v_venda_saldo_devolucao')
        .select('produto_id, nome_produto, qtd_vendida, qtd_devolvida, preco_unitario')
        .eq('venda_id', match.id);
      if (saldoErr) throw saldoErr;

      const itensAgrupados = new Map<string, { produto_id: string; nome_produto: string; qtd: number; preco_unitario: number; jaDevolvido: number }>();
      for (const it of saldos ?? []) {
        const pid = it.produto_id as string;
        const existente = itensAgrupados.get(pid);
        if (existente) {
          existente.qtd += Number(it.qtd_vendida ?? 0);
          existente.jaDevolvido += Number(it.qtd_devolvida ?? 0);
        } else {
          itensAgrupados.set(pid, {
            produto_id: pid,
            nome_produto: it.nome_produto,
            qtd: Number(it.qtd_vendida ?? 0),
            preco_unitario: Number(it.preco_unitario ?? 0),
            jaDevolvido: Number(it.qtd_devolvida ?? 0),
          });
        }
      }

      setDevolucao(d => d ? {
        ...d,
        buscando: false,
        erro: null,
        venda: {
          id: match.id,
          shortId: termo,
          formaPagamento: match.forma_pagamento,
          itens: Array.from(itensAgrupados.values()),
        },
      } : d);
    } catch (err: any) {
      setDevolucao(d => d ? { ...d, buscando: false, erro: err?.message ?? 'Erro ao buscar venda.' } : d);
    }
  };

  const confirmarDevolucao = async () => {
    if (!devolucao?.venda || !supabase) return;
    const itensSelecionados = devolucao.venda.itens
      .map(it => ({ ...it, qtdDevolver: parseFloat((devolucao.qtds[it.produto_id] ?? '').replace(',', '.')) || 0 }))
      .filter(it => it.qtdDevolver > 0);
    if (itensSelecionados.length === 0) {
      showToast?.('Selecione a quantidade de ao menos um item.', 'error', true);
      return;
    }
    for (const it of itensSelecionados) {
      const disponivel = it.qtd - it.jaDevolvido;
      if (it.qtdDevolver > disponivel + 0.001) {
        showToast?.(`"${it.nome_produto}": só é possível devolver até ${disponivel}.`, 'error', true);
        return;
      }
    }
    setDevolucao(d => d ? { ...d, processando: true } : d);
    try {
      const payload = itensSelecionados.map(it => ({
        produto_id: it.produto_id,
        nome_produto: it.nome_produto,
        qtd: it.qtdDevolver,
        preco_unitario: it.preco_unitario,
        subtotal: Math.round(it.qtdDevolver * it.preco_unitario * 100) / 100,
      }));
      // Migr. 459: uma porta so. Esta RPC grava em `devolucoes`/`itens_devolucao`
      // - entra no DRE, devolve a unidade com IMEI ao estoque (446) e encerra a
      // cobranca -, e lanca a sangria quando o dinheiro sai da gaveta (450).
      //
      // A forma do estorno sai da forma de pagamento em vez de virar pergunta
      // no caixa: venda a prazo se desfaz cancelando a pendencia; venda ja paga
      // devolve dinheiro. E a mesma leitura que a porta antiga fazia para
      // decidir `requer_ajuste_financeiro`, agora com consequencia real.
      const aPrazo = ['Fiado', 'Cartão Crédito'].includes(devolucao.venda.formaPagamento);
      const { data, error } = await supabase.rpc('criar_devolucao_venda', {
        p_venda_id: devolucao.venda.id,
        p_itens: payload,
        p_motivo: devolucao.motivo.trim() || 'Devolução no caixa',
        p_forma_estorno: aPrazo ? 'cancela_pendencias' : 'devolve_caixa',
        p_filial: filialFiltro,
      });
      if (error) throw error;
      const valorTotal = payload.reduce((acc, it) => acc + Number(it.subtotal ?? 0), 0);
      showToast?.(`Devolução ${String(data ?? '').slice(-6).toUpperCase()} registrada — ${valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de volta ao estoque.`, 'success', true);
      showToast?.(aPrazo
        ? 'A cobrança em aberto desta venda foi baixada automaticamente.'
        : 'A saída do dinheiro entrou como sangria no caixa do dia.', 'info', true);
      setDevolucao(null);
    } catch (err: any) {
      showToast?.(`Erro ao registrar devolução: ${err?.message ?? '—'}`, 'error', true);
      setDevolucao(d => d ? { ...d, processando: false } : d);
    }
  };

  // Troca de filial sempre limpa o carrinho — itens são por unidade, não dá
  // pra carregar um produto da SuperMax e fechar como venda da MaxLook.

  // Cobrança pendente (QR do Pix na tela, maquininha aguardando) — os dois
  // overlays moram dentro da árvore principal, então qualquer early return
  // daqui pra baixo arranca a operação da frente do cliente. Era o que
  // acontecia: `produtos` está na publicação realtime e cada venda da turma
  // disparava um refetch que ligava loadingProd → PDV virava spinner (a tela
  // "piscando") e o QR sumia no meio do pagamento.
  const cobrancaEmCurso = !!pixPendente || !!cartaoModal;
  if (caixa) ultimoCaixaRef.current = caixa;
  const caixaAtivo = caixa ?? (cobrancaEmCurso ? ultimoCaixaRef.current : null);

  if ((loadingProd || caixaLoading) && !cobrancaEmCurso) return <LoadingSpinner />;

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

  // Dispatch: SuperMax tem PDV proprio (UX estilo supermercado MaxPOS).
  // Demais filiais (MaxLook, TechMax) continuam no PDV generico abaixo.
  // Todos os hooks acima ja rodaram — esta condicional so afeta o JSX retornado.
  // Fica ANTES das guardas de caixa: o filho tem os próprios estados de
  // carregando / caixa fechado (e a própria proteção de cobrança em curso).
  // Quando o dispatch vinha depois, uma guarda do pai desmontava o SuperMax
  // inteiro — inclusive o QR do Pix que o filho tinha na tela.
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

  if (!caixaAtivo) return (
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

  // Operador já solicitou fechamento — bloqueia venda até Financeiro confirmar.
  // Financeiro pode "reabrir" em ControleCaixaView se precisar corrigir.
  if (caixaAtivo.status === 'Aguardando Confirmação' && !cobrancaEmCurso) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className="w-16 h-16 neu-pressed rounded-2xl flex items-center justify-center">
        <Lock size={28} className="text-yellow-400" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-gray-300">Aguardando confirmação do Financeiro</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-md">
          Você encerrou o caixa de <span className="text-gray-300 font-bold">{filialFiltro}</span> às {caixaAtivo.fechado_em ? new Date(caixaAtivo.fechado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' }) : '—'}.
          O Financeiro vai revisar os valores em <span className="text-accent font-bold">Controle de Caixa</span> e confirmar.
          Novas vendas só depois de reabrir o caixa.
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

  const filialMeta = FILIAL_META[filialFiltro];
  const rootClass = fullscreen ? 'fixed inset-0 z-[100] bg-[var(--color-bg-base)] overflow-hidden' : 'h-full';

  // Paleta do PDV por filial (Fase 1). MaxLook e TechMax rodam em tema claro
  // escopado — variáveis CSS injetadas no wrapper controlam accent + bg base,
  // e a classe `pdv-filial-light` (em index.css) faz o remap de text-gray/bg-black
  // pra funcionar sobre branco sem tocar em cada JSX.
  const paletaFilial: Record<FilialPDV, {
    bg: string;
    accent: string;
    accentHover: string;
    accentText: string;
    lightMode: boolean;
  } | null> = {
    SuperMax: null, // não passa por aqui (vai pro PDVViewSupermax)
    // MaxLook: boutique warm — bege claro tipo showroom + preto + dourado.
    MaxLook: {
      bg: '#F7F3EC',
      accent: '#B8941F',
      accentHover: '#9C7C15',
      accentText: '#FFFFFF',
      lightMode: true,
    },
    // TechMax: tech clean — branco puro + preto + laranja (Apple Store).
    TechMax: {
      bg: '#FFFFFF',
      accent: '#EA580C',
      accentHover: '#C2410C',
      accentText: '#FFFFFF',
      lightMode: true,
    },
  };
  const paleta = paletaFilial[filialFiltro];
  const rootStyle: React.CSSProperties = paleta?.lightMode
    ? {
        overscrollBehavior: 'none',
        touchAction: 'pan-y',
        // Sobrescreve o accent do app só dentro do PDV. Não afeta sidebar/topbar
        // porque esses ficam fora do wrapper.
        ['--color-bg-base' as any]: paleta.bg,
        ['--color-accent' as any]: paleta.accent,
        ['--color-accent-hover' as any]: paleta.accentHover,
        ['--color-accent-text' as any]: paleta.accentText,
        background: paleta.bg,
      }
    : { overscrollBehavior: 'none', touchAction: 'pan-y' };
  const rootExtraClass = paleta?.lightMode ? 'pdv-filial-light' : '';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className={`flex flex-col ${rootClass} ${rootExtraClass}`}
      style={rootStyle}>
      {/* Header com identidade da filial — sempre em fundo preto, pra manter
          contraste marca (logo) e servir de âncora visual no topo do PDV. */}
      <div className={`flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3 shrink-0 relative ${paleta?.lightMode ? 'pdv-filial-header' : 'border-b border-white/5'}`}
        style={paleta?.lightMode
          ? { background: '#0A0A0A', borderBottom: `1px solid ${filialMeta.accentBar ?? '#333'}30` }
          : { background: 'color-mix(in srgb, var(--color-bg-base) 95%, transparent)' }}>
        {filialMeta.accentBar && (
          <span className="absolute bottom-0 left-0 h-0.5 w-24"
            style={{ background: filialMeta.accentBar, boxShadow: `0 0 12px ${filialMeta.accentBar}80` }} />
        )}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onVoltar && (
            <button onClick={onVoltar}
              className="neu-button p-2 rounded-lg text-gray-400 hover:text-accent shrink-0"
              title="Trocar PDV">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${filialMeta.accentBar ?? '#ffffff20'}40` }}>
            <img src={filialMeta.logo} alt={filialFiltro} className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <h2 className="text-base sm:text-xl font-black tracking-tight text-accent truncate">{filialFiltro}</h2>
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 truncate">
              {filialMeta.subtitulo ?? 'Ponto de Venda'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* MaxLook: seletor de vendedor associado à venda (comissão). Grava
              em vendas.observacao como "Vendedor: {nome}". Sessão persiste. */}
          {filialFiltro === 'MaxLook' && vendedores.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 py-1 pl-2 pr-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${filialMeta.accentBar ?? '#ffffff20'}40` }}>
              <User size={12} style={{ color: filialMeta.accentBar }} />
              <select
                value={vendedorId}
                onChange={e => setVendedorId(e.target.value)}
                className="bg-transparent text-[11px] font-bold outline-none border-none cursor-pointer"
                style={{ color: '#f5f5f5' }}
                title="Vendedor(a) associado(a) a esta venda">
                {/* Fundo das options vem da regra global em index.css: cravar
                    '#0a0a0a' aqui deixava o popup preto no tema claro. */}
                <option value="">Sem vendedor</option>
                {vendedores.map(v => (
                  <option key={v.id} value={v.id}>{v.nome}</option>
                ))}
              </select>
            </div>
          )}
          {/* MaxLook: abre o modal de Troca/Devolução. Só para quem pode
              autorizar (migr. 459) — o operador de caixa chama o gerente, como
              na loja. Esconder é melhor que deixar clicar e tomar 42501. */}
          {filialFiltro === 'MaxLook' && podeDevolver(profile, filialFiltro) && (
            <button
              onClick={() => setDevolucao({ busca: '', buscando: false, erro: null, venda: null, qtds: {}, motivo: '', processando: false })}
              className="neu-button py-1.5 px-3 rounded-lg text-[10px] font-bold text-gray-400 hover:text-accent hidden sm:flex items-center gap-1.5"
              title="Troca / Devolução">
              <Undo2 size={12} /> Troca/Devolução
            </button>
          )}
          {/* TechMax: alterna entre venda de balcão e abertura de OS — muda o
              rótulo do botão de fechamento e passa a exigir defeito relatado. */}
          {filialFiltro === 'TechMax' && (
            <div className="hidden md:flex items-center rounded-lg overflow-hidden border"
              style={{ borderColor: `${filialMeta.accentBar ?? '#ffffff20'}40` }}>
              {(['Venda', 'OS'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTipoAtendimento(t)}
                  className="py-1.5 px-3 text-[10px] font-bold transition-colors"
                  style={tipoAtendimento === t
                    ? { background: filialMeta.accentBar, color: '#0A0A0A' }
                    : { background: 'transparent', color: '#a3a3a3' }}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {onVoltar && (
            <button onClick={onVoltar}
              className="neu-button py-1.5 px-3 rounded-lg text-[10px] font-bold text-gray-400 hover:text-accent hidden sm:flex items-center gap-1.5"
              title="Trocar PDV">
              <Store size={12} /> Trocar PDV
            </button>
          )}
          {caixaAtivo.status === 'Aberto' && (
            <PDVFecharCaixa
              caixa={{ id: caixaAtivo.id, valor_abertura: caixaAtivo.valor_abertura, filial: caixaAtivo.filial, data: caixaAtivo.data }}
              showToast={showToast}
              onFechamentoSolicitado={refreshCaixa}
              className="py-1.5 px-3 text-[10px] hidden sm:flex"
            />
          )}
          <button
            onClick={async () => {
              try {
                await downloadCatalogoEan13Pdf({
                  produtos: filtered.map((p: any) => ({ nome: p.nome, ean: p.ean, codigo: p.codigo, preco: Number(p.preco || 0), variante: rotuloVariante(p) })),
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
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${mobileTab === 'produtos' ? 'text-accent border-b-2' : 'text-gray-500'}`}
          style={mobileTab === 'produtos' ? { borderColor: 'var(--color-accent)' } : {}}>
          <Package size={13} /> Produtos ({filtered.length})
        </button>
        <button
          onClick={() => setMobileTab('carrinho')}
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors relative ${mobileTab === 'carrinho' ? 'text-accent border-b-2' : 'text-gray-500'}`}
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
              placeholder={filialMeta.layout === 'tech' ? 'Buscar modelo, código ou bipar...' : 'Buscar por nome, código ou bipar...'}
              className="neu-input py-2.5 sm:py-3 pl-10 pr-4 rounded-2xl text-sm w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearchEnter(); } }}
            />
          </div>

          {/* Chips de categoria — montados a partir das categorias que existem no
              cadastro desta filial (com contagem). Com uma categoria só o filtro
              não separa nada, então nem aparece. */}
          {categoriasChips.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 shrink-0 -mx-1 px-1 main-scrollbar-h"
              style={{ scrollbarWidth: 'thin' }}>
              <button
                onClick={() => setCategoriaFiltro(null)}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[10px] sm:text-[11px] font-black uppercase tracking-wider transition-all border-2"
                style={categoriaFiltro === null
                  ? {
                      background: 'var(--color-accent)',
                      color: 'var(--color-accent-text)',
                      borderColor: 'var(--color-accent)',
                      boxShadow: '0 2px 8px color-mix(in srgb, var(--color-accent) 35%, transparent)',
                    }
                  : {
                      background: '#ffffff',
                      color: '#262626',
                      borderColor: 'rgba(0,0,0,0.20)',
                    }}>
                Todos <span className="tabular-nums font-black opacity-60">{produtosPorFilial.length}</span>
              </button>
              {categoriasChips.map(chip => {
                const ativo = categoriaFiltro === chip.chave;
                return (
                  <button
                    key={chip.chave}
                    onClick={() => setCategoriaFiltro(ativo ? null : chip.chave)}
                    className="shrink-0 px-3.5 py-1.5 rounded-full text-[10px] sm:text-[11px] font-black uppercase tracking-wider transition-all border-2 flex items-center gap-1.5"
                    style={ativo
                      ? {
                          background: 'var(--color-accent)',
                          color: 'var(--color-accent-text)',
                          borderColor: 'var(--color-accent)',
                          boxShadow: '0 2px 8px color-mix(in srgb, var(--color-accent) 35%, transparent)',
                        }
                      : {
                          background: '#ffffff',
                          color: '#262626',
                          borderColor: 'rgba(0,0,0,0.20)',
                        }}>
                    {chip.label}
                    {/* Contagem: o operador vê o tamanho da gaveta antes de abrir. */}
                    <span className="tabular-nums font-black opacity-60">{chip.total}</span>
                  </button>
                );
              })}
            </div>
          )}

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

          <div className={`grid gap-2 sm:gap-3 overflow-y-auto main-scrollbar pr-1 pb-4 flex-1 min-h-0 ${
              filialMeta.layout === 'tech'
                ? 'grid-cols-1 xl:grid-cols-2'
                : 'grid-cols-2 sm:grid-cols-2 xl:grid-cols-3'
            }`}
            style={{ overscrollBehavior: 'contain' }}>
            {filtered.length === 0 ? (
              <div className={`${filialMeta.layout === 'tech' ? 'xl:col-span-2' : 'col-span-3'} flex flex-col items-center justify-center py-16 gap-3 text-center`}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.04)', border: '1px dashed rgba(0,0,0,0.18)' }}>
                  <Package size={26} strokeWidth={1.5} style={{ color: '#a3a3a3' }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#262626' }}>
                    {search || categoriaFiltro ? 'Nenhum produto encontrado' : `Sem produtos em ${filialFiltro}`}
                  </p>
                  <p className="text-xs mt-1 max-w-[18rem]" style={{ color: '#737373' }}>
                    {categoriaFiltro
                      ? <>Nenhum item em <b>{categoriaLabel}</b>. Tente outra categoria ou <button className="underline font-bold" onClick={() => setCategoriaFiltro(null)}>ver todos</button>.</>
                      : search
                        ? 'Ajuste o termo, bipe outro código ou limpe a busca.'
                        : 'Cadastre produtos em Cadastros → Produtos pra começar a vender aqui.'}
                  </p>
                </div>
              </div>
            ) : (
              filtered.map((p: any) => {
                const inCart = cart.find(i => i.produto_id === p.id);
                const semEstoque = (p.estoque ?? 999) <= 0;
                const fracionario = isProdutoFracionario(p);
                const unidade = String(p.unidade ?? 'UN').toUpperCase();
                const onClick = () => {
                  if (semEstoque) return;
                  addToCart(p);
                  if (window.innerWidth < 1024 && cart.length === 0) setMobileTab('carrinho');
                };
                const cardStyle = inCart
                  ? { borderColor: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }
                  : semEstoque ? { opacity: 0.4 } : {};

                // TechMax: layout horizontal denso — thumb esquerda, specs à direita.
                // Ficha técnica: badge de marca em destaque + categoria como subline.
                if (filialMeta.layout === 'tech') {
                  const ultimasUnidades = !semEstoque && typeof p.estoque === 'number' && p.estoque > 0 && p.estoque <= 2;
                  return (
                    <motion.button
                      key={p.id}
                      onClick={onClick}
                      whileTap={!semEstoque ? { scale: 0.98 } : {}}
                      disabled={semEstoque}
                      className="neu-button rounded-xl p-2.5 sm:p-3 flex items-center gap-3 text-left transition-all border border-transparent relative"
                      style={cardStyle}
                    >
                      {inCart && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 h-5 min-w-5 rounded-full flex items-center justify-center text-[10px] font-black z-10"
                          style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                          {fracionario ? formatQtd(inCart.qtd, inCart.unidade) : inCart.qtd}
                        </span>
                      )}
                      {/* Ficha técnica. stopPropagation porque o card inteiro é
                          o botão de adicionar — sem isso, consultar venderia. */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Ver ficha de ${p.nome}`}
                        onClick={e => { e.stopPropagation(); setDetalheProduto(p); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetalheProduto(p); }
                        }}
                        className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center z-10 cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.92)', color: filialMeta.accentBar, border: `1px solid ${filialMeta.accentBar}55` }}>
                        <Info size={13} strokeWidth={2.5} />
                      </span>
                      <ProdutoThumb url={p.imagem_url} size="md" alt={p.nome} />
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.marca ? (
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md"
                              style={{ background: filialMeta.accentBar, color: '#ffffff' }}>
                              {p.marca}
                            </span>
                          ) : (
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                              style={{ background: `${filialMeta.accentBar}22`, color: filialMeta.accentBar, border: `1px solid ${filialMeta.accentBar}80` }}>
                              {p.codigo || 'SKU'}
                            </span>
                          )}
                          {ultimasUnidades && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                              style={{ background: '#DC262620', color: '#DC2626', border: '1px solid #DC262660' }}>
                              Últimas {p.estoque}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-gray-100 leading-tight line-clamp-2">{p.nome}</span>
                        <div className="flex items-center gap-2 text-[9px] font-bold text-gray-500 truncate">
                          {p.categoria && <span className="uppercase tracking-wider truncate">{p.categoria}</span>}
                          {p.codigo && p.marca && (
                            <span className="uppercase tracking-wider text-gray-600">· {p.codigo}</span>
                          )}
                        </div>
                        <div className="flex items-end justify-between mt-0.5">
                          <span className="text-base font-black text-accent tabular-nums">
                            {Number(p.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                          <span className={`text-[10px] font-bold ${semEstoque ? 'text-red-500' : 'text-gray-500'}`}>
                            {semEstoque ? 'Sem estoque' : `Estoque: ${p.estoque ?? '∞'}`}
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  );
                }

                // MaxLook: card de vitrine — foto quadrada em cima, marca dourada,
                // categoria, nome e preço. Até 2026-08-13 era só-texto: o card não
                // renderizava `imagem_url` (moda se vende pela peça, e as fotos já
                // estavam cadastradas), nem preço, nem estoque — o operador clicava
                // sem saber quanto custava.
                if (filialMeta.layout === 'fashion') {
                  const inCartFashion = inCart;
                  const ultimaPeca = !semEstoque && typeof p.estoque === 'number' && p.estoque > 0 && p.estoque <= 2;
                  return (
                    <motion.button
                      key={p.id}
                      onClick={onClick}
                      whileTap={!semEstoque ? { scale: 0.98 } : {}}
                      disabled={semEstoque}
                      className="rounded-xl p-2 flex flex-col gap-1.5 text-left transition-all border relative bg-white hover:shadow-md disabled:opacity-40"
                      style={{
                        borderColor: inCartFashion ? filialMeta.accentBar : 'rgba(0,0,0,0.08)',
                        background: inCartFashion ? `${filialMeta.accentBar}15` : 'white',
                        boxShadow: inCartFashion ? undefined : '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                    >
                      {inCartFashion && (
                        <span className="absolute top-3 right-3 px-1.5 h-5 min-w-5 rounded-full flex items-center justify-center text-[10px] font-black z-10"
                          style={{ background: filialMeta.accentBar, color: '#0A0A0A' }}>
                          {fracionario ? formatQtd(inCart.qtd, inCart.unidade) : inCart.qtd}
                        </span>
                      )}
                      {/* Ficha técnica. stopPropagation porque o card inteiro é
                          o botão de adicionar — sem isso, consultar venderia. */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Ver ficha de ${p.nome}`}
                        onClick={e => { e.stopPropagation(); setDetalheProduto(p); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetalheProduto(p); }
                        }}
                        className="absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center z-10 cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.92)', color: filialMeta.accentBar, border: `1px solid ${filialMeta.accentBar}55` }}>
                        <Info size={13} strokeWidth={2.5} />
                      </span>
                      <div className="w-full aspect-square rounded-lg overflow-hidden flex items-center justify-center relative"
                        style={{ background: '#F4F1EA', border: '1px solid rgba(0,0,0,0.05)' }}>
                        {p.imagem_url ? (
                          <img src={p.imagem_url} alt={p.nome} loading="lazy"
                            className="w-full h-full object-cover" />
                        ) : (
                          <Package size={26} strokeWidth={1.5} style={{ color: '#C4BCA8' }} />
                        )}
                        {ultimaPeca && (
                          <span className="absolute bottom-1 left-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                            style={{ background: '#0A0A0AD9', color: '#ffffff' }}>
                            {p.estoque === 1 ? 'Última peça' : `Últimas ${p.estoque}`}
                          </span>
                        )}
                        {semEstoque && (
                          <span className="absolute bottom-1 left-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                            style={{ background: '#DC2626', color: '#ffffff' }}>
                            Esgotado
                          </span>
                        )}
                      </div>
                      {p.marca && (
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] truncate"
                          style={{ color: filialMeta.accentBar }}>
                          {p.marca}
                        </span>
                      )}
                      {p.categoria && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 truncate -mt-0.5">
                          {p.categoria}
                        </span>
                      )}
                      <span className="text-sm font-bold text-gray-900 leading-tight line-clamp-1 truncate">{p.nome}</span>
                      <span className="text-base font-black tabular-nums mt-auto" style={{ color: filialMeta.accentBar }}>
                        {Number(p.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </motion.button>
                  );
                }

                // Fallback (não chega aqui hoje — SuperMax vai pro PDVViewSupermax).
                return (
                  <motion.button
                    key={p.id}
                    onClick={onClick}
                    whileTap={!semEstoque ? { scale: 0.97 } : {}}
                    disabled={semEstoque}
                    className="neu-button rounded-xl sm:rounded-2xl p-2 sm:p-3 flex flex-col gap-1.5 sm:gap-2 text-left transition-all border border-transparent relative"
                    style={cardStyle}
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
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400 flex items-center gap-1.5">
                    Desconto
                    {/* Trocar de modo zera o outro campo: manter os dois
                        preenchidos deixaria um valor visível que não está
                        sendo cobrado. */}
                    <span className="inline-flex rounded-lg overflow-hidden border border-white/10">
                      {(['valor', 'pct'] as const).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setDescontoModo(m); setDesconto(''); setDescontoPct(''); }}
                          className={`px-2 py-0.5 text-[10px] font-bold transition-colors ${
                            descontoModo === m ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {m === 'valor' ? 'R$' : '%'}
                        </button>
                      ))}
                    </span>
                  </span>
                  {descontoModo === 'valor' ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={desconto}
                      onChange={e => setDesconto(formatBRL(e.target.value))}
                      onKeyDown={handleMoneyKeyDown}
                      placeholder="0,00"
                      className="neu-input py-1.5 px-3 rounded-xl text-xs text-right w-28 font-mono tabular-nums"
                    />
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={descontoPct}
                      onChange={e => setDescontoPct(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
                      placeholder="0"
                      className="neu-input py-1.5 px-3 rounded-xl text-xs text-right w-28 font-mono tabular-nums"
                    />
                  )}
                </div>
                {/* O percentual não vai para o banco — mostrar o valor que ele
                    virou é o que deixa o operador conferir antes de fechar. */}
                {descontoModo === 'pct' && descontoNum > 0 && (
                  <p className="text-[10px] text-gray-500 text-right font-mono">
                    {descontoPctNum.toLocaleString('pt-BR')}% de {subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} = −{descontoNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                )}
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
              <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-white/10">
                <span className="text-sm font-black uppercase tracking-widest text-gray-200">Total</span>
                <span className="text-2xl font-black text-accent font-mono tabular-nums">
                  {totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </div>

            {/* Pagamento */}
            <div className="flex flex-col gap-2 pt-3 border-t border-white/5 shrink-0">
              <span id="pdv-forma-pagto-label" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Forma de pagamento</span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="pdv-forma-pagto-label">
                {FORMAS.map(f => {
                  const ativo = formaPagamento === f;
                  return (
                    <button key={f} onClick={() => setFormaPagamento(f)}
                      role="radio" aria-checked={ativo}
                      className="py-2.5 px-2 rounded-xl text-[11px] font-black transition-all border-2 uppercase tracking-wider"
                      style={ativo
                        ? {
                            background: 'var(--color-accent)',
                            borderColor: 'var(--color-accent)',
                            color: 'var(--color-accent-text)',
                            boxShadow: '0 2px 8px color-mix(in srgb, var(--color-accent) 30%, transparent)',
                          }
                        : {
                            background: '#ffffff',
                            borderColor: 'rgba(0,0,0,0.18)',
                            color: '#404040',
                          }
                      }>
                      {f}
                    </button>
                  );
                })}
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
                  {/* Situação de crédito (migr. 416). Aparece só quando há algo
                      a dizer: sem limite cadastrado e sem dívida, não há painel
                      — o caixa não precisa de um retângulo dizendo "tudo bem". */}
                  {credito && (credito.limite !== null || credito.devedor > 0) && (() => {
                    const estoura = bloqueioFiado(credito, totalFinal) !== null;
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 px-2 py-1.5 rounded-lg text-[10px]"
                        style={{
                          background: estoura ? 'rgba(220,38,38,0.08)' : 'rgba(0,0,0,0.04)',
                          border: `1px solid ${estoura ? 'rgba(220,38,38,0.35)' : 'rgba(0,0,0,0.10)'}`,
                        }}>
                        {credito.vencidos > 0 && (
                          <span className="font-black uppercase tracking-wider text-red-600">
                            {credito.vencidos} título(s) vencido(s)
                          </span>
                        )}
                        <span className="text-gray-600">
                          Em aberto: <strong className="tabular-nums text-gray-800">R$ {formatBRL(credito.devedor)}</strong>
                        </span>
                        {credito.limite !== null && (
                          <>
                            <span className="text-gray-600">
                              Limite: <strong className="tabular-nums text-gray-800">R$ {formatBRL(credito.limite)}</strong>
                            </span>
                            <span className={estoura ? 'text-red-600 font-bold' : 'text-gray-600'}>
                              Disponível: <strong className="tabular-nums">R$ {formatBRL(credito.disponivel ?? 0)}</strong>
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </motion.div>
              )}

              <AnimatePresence>
                {formaPagamento === 'Dinheiro' && cart.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden">
                    <div className="flex flex-col gap-2 p-3 rounded-xl mt-1"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                      <div className="flex items-center gap-2">
                        <label htmlFor="pdv-dinheiro-recebido" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest shrink-0">Valor recebido</label>
                        <input
                          id="pdv-dinheiro-recebido"
                          type="text"
                          inputMode="numeric"
                          value={dinheiroRecebido}
                          onChange={e => setDinheiroRecebido(formatBRL(parseBRL(e.target.value)))}
                          onKeyDown={handleMoneyKeyDown}
                          placeholder={formatBRL(totalFinal)}
                          className="neu-input py-1.5 px-2 rounded-lg text-xs flex-1 text-right tabular-nums font-bold outline-none"
                        />
                        <span className="text-[10px] font-bold text-gray-500">R$</span>
                      </div>
                      {dinheiroRecebido && dinheiroRecebidoNum > 0 && (
                        <div className="flex justify-between items-center pt-1 border-t border-white/5">
                          {faltaDinheiro > 0.001 ? (
                            <>
                              <span className="text-[11px] font-bold text-red-400 uppercase tracking-widest">Falta</span>
                              <span className="text-base font-black text-red-400 tabular-nums">
                                {faltaDinheiro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </span>
                            </>
                          ) : troco > 0.001 ? (
                            <>
                              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">Troco</span>
                              <span className="text-lg font-black text-emerald-400 tabular-nums">
                                {troco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] font-bold text-accent uppercase tracking-widest w-full text-center">Valor exato</span>
                          )}
                        </div>
                      )}
                      <div className="flex gap-1 pt-1">
                        {[totalFinal, 50, 100, 200].map((v, idx) => (
                          <button key={idx}
                            type="button"
                            onClick={() => setDinheiroRecebido(formatBRL(v))}
                            className="flex-1 py-1 px-1 rounded-md text-[10px] font-bold border transition-all"
                            style={{ background: 'transparent', borderColor: 'rgba(0,0,0,0.14)', color: '#525252' }}>
                            {idx === 0 ? 'Exato' : `R$ ${v}`}
                          </button>
                        ))}
                      </div>
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

            {/* TechMax: IMEI/Serial do aparelho (opcional, vale pros dois modos).
                Grava em vendas.observacao — usado pra garantia e assistência. */}
            {filialFiltro === 'TechMax' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 p-2 rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                  <QrCode size={12} className="text-accent shrink-0" />
                  <label htmlFor="pdv-imei" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest shrink-0">
                    IMEI/Serial
                  </label>
                  <input
                    id="pdv-imei"
                    type="text"
                    inputMode="numeric"
                    value={imeiSerial}
                    onChange={e => setImeiSerial(e.target.value)}
                    placeholder="Opcional — garantia"
                    className="neu-input py-1.5 px-2 rounded-lg text-xs flex-1 bg-transparent border-none outline-none tabular-nums"
                    maxLength={40}
                  />
                </div>
                {/* Modo OS: defeito relatado é obrigatório — vira parte do
                    diagnóstico da assistência, grava junto na observação. */}
                {tipoAtendimento === 'OS' && (
                  <div className="flex items-start gap-2 p-2 rounded-xl"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                    <Wrench size={12} className="text-accent shrink-0 mt-1.5" />
                    <div className="flex-1">
                      <label htmlFor="pdv-defeito" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">
                        Defeito relatado
                      </label>
                      <textarea
                        id="pdv-defeito"
                        value={defeitoRelatado}
                        onChange={e => setDefeitoRelatado(e.target.value)}
                        placeholder="Ex.: tela trincada, não liga, bateria viciada..."
                        rows={2}
                        maxLength={200}
                        className="neu-input py-1.5 px-2 rounded-lg text-xs w-full bg-transparent border-none outline-none resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

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
                  className="w-full py-4 sm:py-5 rounded-2xl text-base sm:text-lg font-black flex items-center justify-center gap-2 transition-all shrink-0 mt-1 uppercase tracking-wider"
                  style={{
                    background: cart.length === 0 || isClosing ? '#d4d4d4' : '#0A0A0A',
                    color: cart.length === 0 || isClosing ? '#737373' : '#FFFFFF',
                    boxShadow: cart.length > 0 && !isClosing
                      ? '0 8px 24px rgba(0,0,0,0.20), 0 0 0 3px color-mix(in srgb, var(--color-accent) 25%, transparent)'
                      : 'none',
                    border: cart.length > 0 && !isClosing ? '2px solid var(--color-accent)' : '2px solid transparent',
                    cursor: cart.length === 0 || isClosing ? 'not-allowed' : 'pointer',
                  }}>
                  {isClosing
                    ? <><Loader2 size={18} className="animate-spin" /> Processando...</>
                    : <><CheckCircle2 size={18} style={{ color: cart.length === 0 ? '#737373' : 'var(--color-accent)' }} /> {filialFiltro === 'TechMax' && tipoAtendimento === 'OS' ? 'Abrir OS' : 'Fechar Venda'} · {totalFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</>}
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
                {/* O mesmo número que a MaxPay mostra quando duas cobranças do
                    mesmo valor coexistem. Sem ele, o aluno não sabe qual é a
                    dele e o operador escolhe no chute. */}
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-2">
                  Cobrança nº <span className="font-mono text-accent tracking-normal">{codigoCobranca(pixPendente.id)}</span>
                </p>
              </div>

              {/* QR sempre preto-sobre-branco com quiet zone — exigência dos scanners,
                  independente do tema da app. */}
              <div className="p-4 rounded-3xl border border-white/5"
                style={{ background: '#ffffff' }}>
                <QRCodeSVG
                  value={buildPixQrValue(pixPendente.id)}
                  size={208}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-gray-500 text-center max-w-[18rem]">
                <Smartphone size={12} className="shrink-0 text-accent" />
                <span>
                  Cliente escaneia este código no <span className="font-bold text-gray-300">MaxBank</span> ou no
                  simulador de pagamento. Pela <span className="font-bold text-gray-300">maquininha MaxPay</span>, o
                  operador cobra informando <span className="font-bold text-gray-300">este mesmo valor</span> — é por
                  ele que ela acha a cobrança. Se houver outra cobrança do mesmo valor, ela pergunta qual:
                  informe o <span className="font-bold text-gray-300">nº acima</span>.
                </span>
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

      {/* Ficha do produto — abre pelo botão de informação do card, nunca pelo
          clique do card (esse continua adicionando ao carrinho). */}
      <AnimatePresence>
        {detalheProduto && (
          <ProdutoDetalheModal
            // key pelo produto: trocar de ficha remonta o modal em vez de
            // herdar o índice da foto anterior (produto com 3 fotos → produto
            // com 1 deixaria a miniatura selecionada apontando pro vazio).
            key={detalheProduto.id}
            produto={detalheProduto}
            filial={filialFiltro}
            accent={filialMeta.accentBar ?? 'var(--color-accent)'}
            substantivo={filialMeta.layout === 'fashion' ? 'peça' : 'unidade'}
            onClose={() => setDetalheProduto(null)}
            onAdd={addToCart}
          />
        )}
      </AnimatePresence>

      {/* Dinheiro entrou, venda não foi registrada. Bloqueante de propósito:
          é a única evidência de que o cliente pagou e o sistema não gravou,
          e some se o operador não decidir o que fazer. */}
      <AnimatePresence>
        {falhaPosPagamento && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
          >
            <div className="w-full max-w-md rounded-2xl overflow-hidden bg-white shadow-2xl"
              style={{ border: '2px solid #DC2626' }}>
              <div className="px-5 py-4 flex items-center gap-3" style={{ background: '#DC2626' }}>
                <AlertTriangle size={22} className="text-white shrink-0" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">
                    Pagamento recebido · venda não registrada
                  </p>
                  <p className="text-lg font-black text-white leading-tight">
                    {falhaPosPagamento.forma} · {falhaPosPagamento.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm font-bold" style={{ color: '#262626' }}>
                  O cliente pagou, mas o sistema não conseguiu gravar a venda. Não cobre de novo.
                </p>
                <div className="rounded-lg p-3 text-xs font-mono break-words"
                  style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>
                  {falhaPosPagamento.erro}
                </div>
                <p className="text-xs" style={{ color: '#737373' }}>
                  Causa mais comum: outro caixa vendeu a última unidade enquanto o pagamento era
                  confirmado. Reponha o estoque e tente de novo — o carrinho continua guardado.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={tentarRegistrarNovamente}
                    disabled={falhaPosPagamento.tentando}
                    className="flex-1 py-3 rounded-xl font-black text-sm text-white disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ background: '#DC2626' }}>
                    {falhaPosPagamento.tentando
                      ? <><Loader2 size={16} className="animate-spin" /> Tentando...</>
                      : 'Tentar registrar de novo'}
                  </button>
                  <button
                    onClick={() => setFalhaPosPagamento(null)}
                    disabled={falhaPosPagamento.tentando}
                    className="px-4 py-3 rounded-xl font-black text-sm disabled:opacity-60"
                    style={{ background: '#F5F5F5', color: '#262626', border: '1px solid rgba(0,0,0,0.12)' }}>
                    Resolver depois
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Troca/Devolução (MaxLook) — busca venda concluída pelos 6
          últimos caracteres do id, escolhe item(ns)+qtd e chama
          `criar_devolucao_venda`, a mesma RPC da tela de Devoluções
          (migr. 459). */}
      <AnimatePresence>
        {devolucao && (
          <motion.div
            key="devolucao-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
            onClick={() => !devolucao.processando && setDevolucao(null)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="neu-flat rounded-3xl w-full max-w-md p-6 flex flex-col gap-4 border border-white/5 max-h-[85vh] overflow-y-auto"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Undo2 size={18} className="text-accent" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Troca / Devolução</span>
                </div>
                <button onClick={() => !devolucao.processando && setDevolucao(null)}
                  className="neu-button p-1.5 rounded-lg text-gray-400 hover:text-accent">
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="devolucao-busca" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Código da venda (6 últimos caracteres — vide recibo)
                </label>
                <div className="flex gap-2">
                  <input
                    id="devolucao-busca"
                    type="text"
                    autoFocus
                    value={devolucao.busca}
                    onChange={e => setDevolucao(d => d ? { ...d, busca: e.target.value.toUpperCase() } : d)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarVendaParaDevolucao(); } }}
                    placeholder="Ex.: A1B2C3"
                    maxLength={6}
                    className="neu-input py-2.5 px-3 rounded-xl text-sm font-bold tracking-widest uppercase flex-1"
                  />
                  <button
                    onClick={buscarVendaParaDevolucao}
                    disabled={!devolucao.busca.trim() || devolucao.buscando}
                    className="neu-button px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                    {devolucao.buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    Buscar
                  </button>
                </div>
                {devolucao.erro && <p className="text-[11px] text-red-500 mt-1">{devolucao.erro}</p>}
              </div>

              {devolucao.venda && (
                <>
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Venda #{devolucao.venda.shortId} · {devolucao.venda.formaPagamento}
                    </p>
                    {devolucao.venda.itens.map(it => {
                      const disponivel = it.qtd - it.jaDevolvido;
                      return (
                        <div key={it.produto_id} className="flex items-center gap-2 p-2 rounded-xl border border-white/5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-200 truncate">{it.nome_produto}</p>
                            <p className="text-[10px] text-gray-500">
                              vendido {it.qtd} · disponível p/ devolver {disponivel}
                            </p>
                          </div>
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={disponivel <= 0}
                            value={devolucao.qtds[it.produto_id] ?? ''}
                            onChange={e => {
                              const v = e.target.value.replace(/[^\d.,]/g, '');
                              setDevolucao(d => d ? { ...d, qtds: { ...d.qtds, [it.produto_id]: v } } : d);
                            }}
                            placeholder="0"
                            className="neu-input py-1.5 px-2 rounded-lg text-xs w-16 text-right tabular-nums disabled:opacity-30"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="devolucao-motivo" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Motivo (opcional)
                    </label>
                    <textarea
                      id="devolucao-motivo"
                      value={devolucao.motivo}
                      onChange={e => setDevolucao(d => d ? { ...d, motivo: e.target.value } : d)}
                      placeholder="Ex.: tamanho errado, peça com defeito..."
                      rows={2}
                      maxLength={200}
                      className="neu-input py-2 px-3 rounded-xl text-xs w-full resize-none"
                    />
                  </div>

                  {devolucao.venda.formaPagamento === 'Fiado' || devolucao.venda.formaPagamento === 'Cartão Crédito' ? (
                    <p className="text-[10px] text-amber-500 flex items-start gap-1.5">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      Venda {devolucao.venda.formaPagamento} — após confirmar, ajuste manualmente em Financeiro → Contas a Receber.
                    </p>
                  ) : null}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setDevolucao(null)}
                      disabled={devolucao.processando}
                      className="flex-1 py-3 rounded-xl text-xs font-bold text-gray-400 neu-button transition-colors disabled:opacity-40">
                      Cancelar
                    </button>
                    <button
                      onClick={confirmarDevolucao}
                      disabled={devolucao.processando}
                      className="flex-1 py-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))', color: 'var(--color-accent-text)' }}>
                      {devolucao.processando
                        ? <><Loader2 size={14} className="animate-spin" /> Processando...</>
                        : <><Undo2 size={14} /> Confirmar devolução</>}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay Cartão (maquininha MaxPay) — cliente escaneia QR no MaxBank */}
      <AnimatePresence>
        {cartaoModal && (
          <motion.div
            key="cartao-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
          >
            <motion.div
              initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="rounded-3xl w-full max-w-sm p-6 flex flex-col items-center gap-4 relative"
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', color: '#0a0a0a' }}
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <CreditCard size={18} style={{ color: 'var(--color-accent)' }} />
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full animate-ping"
                    style={{ background: 'var(--color-accent)' }} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-accent)' }}>
                  Aguardando cartão
                </span>
              </div>

              <div className="text-center">
                <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#737373' }}>
                  Cartão {cartaoModal.metodo === 'debito' ? 'Débito' : 'Crédito'}
                  {cartaoModal.parcelas > 1 && ` — ${cartaoModal.parcelas}x`}
                </p>
                <p className="text-3xl font-black tabular-nums tracking-tight mt-1" style={{ color: '#0a0a0a' }}>
                  {cartaoModal.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
                <p className="text-[10px] uppercase tracking-widest font-bold mt-2" style={{ color: '#737373' }}>
                  Cobrança nº <span className="font-mono tracking-normal" style={{ color: 'var(--color-accent)' }}>{codigoCobranca(cartaoModal.id)}</span>
                </p>
              </div>

              <div className="rounded-2xl px-4 py-4 flex flex-col items-center gap-2"
                style={{ background: '#ffffff', border: '2px solid #0a0a0a' }}>
                <QRCodeSVG
                  value={buildCartaoQrValue(cartaoModal.id)}
                  size={180}
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                  level="M"
                />
              </div>

              <div className="flex items-center gap-2 text-[11px] text-center max-w-[18rem]" style={{ color: '#525252' }}>
                <Smartphone size={12} className="shrink-0" style={{ color: 'var(--color-accent)' }} />
                <span>
                  Cliente abre o <span className="font-bold" style={{ color: '#0a0a0a' }}>MaxBank → Escanear QR</span> e autoriza o pagamento.
                  Se a MaxPay perguntar qual cobrança é, informe o <span className="font-bold" style={{ color: '#0a0a0a' }}>nº acima</span>.
                </span>
              </div>

              <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: '#737373' }}>
                <Loader2 size={10} className="animate-spin" />
                <span>Escutando autorização em tempo real…</span>
              </div>

              <button
                onClick={cancelarCartao}
                className="mt-1 w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                style={{ border: '1px solid rgba(220,38,38,0.35)', color: '#dc2626', background: 'rgba(220,38,38,0.06)' }}
              >
                <X size={12} /> Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tela de agradecimento full-screen (padrão MaxPOS trainer). Aparece
          logo apos venda; ENTER ou click fecha e volta pro PDV. Cor + logo
          seguem a paleta da filial (dourado MaxLook, laranja TechMax). */}
      <AnimatePresence>
        {thankYouOpen && (
          <motion.div
            key="thankyou-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[310] flex items-center justify-center"
            style={{ background: paleta?.lightMode ? 'rgba(255,255,255,0.98)' : 'rgba(0,0,0,0.92)' }}
            onClick={() => setThankYouOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                setThankYouOpen(false);
              } else { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && thankYouOpen) el.focus(); }}
          >
            <div className="flex flex-col items-center justify-center text-center px-8 py-6 max-h-screen w-full">
              <img
                src={filialMeta.logo}
                alt={filialFiltro}
                className="object-contain drop-shadow-2xl"
                style={{ maxHeight: '60vh', maxWidth: '70vw', width: 'auto', height: 'auto' }}
                draggable={false}
              />
              <div className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-wide shrink-0"
                style={{ color: paleta?.lightMode ? '#0A0A0A' : '#f5f5f5' }}>
                {filialFiltro === 'MaxLook'
                  ? 'Obrigada pela sua visita'
                  : filialFiltro === 'TechMax'
                  ? 'Obrigado pela preferência'
                  : 'Agradecemos a sua preferência'}
              </div>
              <div className="mt-5 px-6 py-3 rounded-full text-sm md:text-base font-black uppercase tracking-[0.3em] animate-pulse shrink-0"
                style={{
                  background: filialMeta.accentBar ?? 'var(--color-accent)',
                  color: paleta?.accentText ?? '#ffffff',
                }}>
                Pressione ENTER ou clique para continuar
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
