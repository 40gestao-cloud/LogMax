import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Check, X, ShoppingBag, MessageSquare, Send, Loader2, Search, GitCompare, Award, RotateCcw, Ban, CornerUpLeft, Pencil } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho, TextoModal } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { todayBR } from '../lib/dates';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown, qtdBR } from '../lib/viewUtils';
import { normalizarUnidade } from '../lib/unidades';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { numeroCotacao, numeroPedido, numeroRequisicao } from '../lib/documentos';
import { ehContratado } from '../lib/naturezaServico';
import { supabase } from '../lib/supabase';
import { hasAnySetor, hasSetor, isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { useFornecedorDesempenho, SeloDesempenho } from '../components/FornecedorDesempenho';
import { useReservaTrabalho } from '../hooks/useReservaTrabalho';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';

// Status considerados "propostas vivas" para contagem de concorrentes.
// Cancelado/Negado são histórico — aparecem na comparação mas não contam.
// 'Em correção' (migr. 467) conta: a proposta voltou para quem a cadastrou,
// mas continua de pé — tratá-la como morta faria a requisição reaparecer como
// "sem nenhuma cotação" e o aluno cotaria de novo em cima da mesma coisa.
const STATUS_VIVOS = new Set(['Aguardando Financeiro', 'Em correção', 'Aprovado']);

// `date` do Postgres chega como 'YYYY-MM-DD' puro, sem hora: `new Date()` nele
// assume UTC e volta um dia no fuso do Acre. Vira dd/mm no texto, e a
// comparação entre prazo e necessidade é feita na string ISO, que já ordena.
const dataBR = (iso?: string | null) =>
  iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

// Proposta vencida: comparação na string ISO, que já ordena (mesma razão do
// dataBR acima). O Financeiro não aprova depois desta data (migr. 583), então
// ela precisa saltar aos olhos antes do clique, não depois do erro.
const propostaVencida = (validade?: string | null): boolean =>
  !!validade && String(validade).slice(0, 10) < todayBR();

// MIGR 584. As condições que o banco aceita (CHECK em `cotacoes`), na ordem
// em que um comprador pensa: da que aperta o caixa para a que o alivia. É o
// mesmo vocabulário do orçamento de venda, visto do lado de quem compra — e é
// idêntico nas três lojas, porque comprar é processo da rede.
const CONDICOES_PAGAMENTO = ['À vista', '15 dias', '30 dias', '30/60', '30/60/90'] as const;

// Quantos títulos cada condição abre. Serve só para o aviso da tela; quem
// gera de verdade é `condicao_pagamento_dias` no banco.
const parcelasDaCondicao = (c: string): number =>
  c === '30/60' ? 2 : c === '30/60/90' ? 3 : 1;

// Data ISO daqui a N dias, no fuso da operação. Mesma disciplina do dataBR
// acima: a aritmética é feita em UTC ao meio-dia para o dia não escorregar.
const emDias = (n: number): string => {
  const [y, m, d] = todayBR().split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
};

// Validade padrão da proposta. 15 dias é o costume do mercado para cotação de
// material — e o ponto pedagógico é que a data nasce preenchida em vez de
// virar campo em branco que ninguém entende para que serve.
const VALIDADE_PADRAO_DIAS = 15;

// notificar_setor: RPC já existente em 022_20260520_ti_e_notificacoes.sql.
async function notificarSetor(args: {
  setor: 'compras' | 'financeiro';
  tipo: 'aprovacao_pendente' | 'aprovado' | 'reprovado';
  titulo: string;
  mensagem?: string;
  link_view?: string;
  urgencia?: 'Baixa' | 'Média' | 'Alta';
  ref_id?: string;
  motivo?: string;
}) {
  if (!supabase) return;
  try {
    await supabase.rpc('notificar_setor', {
      p_setor:     args.setor,
      p_tipo:      args.tipo,
      p_titulo:    args.titulo,
      p_mensagem:  args.mensagem ?? null,
      p_link_view: args.link_view ?? null,
      p_urgencia:  args.urgencia ?? 'Média',
      p_ref_id:    args.ref_id ?? null,
      p_motivo:    args.motivo ?? null,
    });
  } catch {
    // Notificação é best-effort — não bloqueia o fluxo principal.
  }
}

// Congela as opções de um <select> enquanto ele está aberto.
//
// Esta tela ouve realtime de cinco tabelas e a turma inteira trabalha nela ao
// mesmo tempo: cada proposta salva por um colega e cada batimento de reserva
// (60s por aluno) provoca um re-render. Trocar o conteúdo dos <option> com o
// popup nativo aberto faz o Chrome repintar a lista embaixo do cursor.
//
// O congelamento é por REF, não por estado, de propósito: guardar num useState
// obrigaria um re-render no mousedown — isto é, no exato instante em que o
// popup está abrindo —, que é justamente o que se quer evitar. A ref não
// dispara render nenhum; ela só faz os renders que aconteceriam de qualquer
// jeito continuarem desenhando a lista que a pessoa está vendo.
function useOpcoesEstaveis<T>(valor: T) {
  const congelado = useRef<T | null>(null);
  const [, redesenhar] = useState(0);
  // Só congela se ainda não estiver congelado: tecla de navegação dentro do
  // popup aberto não pode re-fotografar a lista com dado novo.
  const congelar = () => { if (congelado.current === null) congelado.current = valor; };
  // Soltar pede UM render — com o popup já fechado, que é quando pintar de
  // novo não custa nada. Sem ele o DOM ficaria com a foto antiga até algum
  // outro estado mudar, e a lista voltaria desatualizada na próxima abertura.
  const soltar = () => {
    if (congelado.current === null) return;
    congelado.current = null;
    redesenhar(n => n + 1);
  };
  return {
    opcoes: congelado.current ?? valor,
    // Espalhar no <select>; o onChange do campo chama `soltar()`.
    handlers: { onMouseDown: congelar, onKeyDown: congelar, onBlur: soltar },
    soltar,
  };
}

// `mode` existe pelo mesmo motivo que existe em OrcamentosView: a tela é
// alcançável por duas portas de menu — Compras → Cotações e Financeiro →
// Aprovações de Cotação — e sem o modo as duas abriam exatamente a mesma
// coisa. Para colaborador passava despercebido (cada setor só enxerga a sua
// porta), mas admin, CEO e gerente veem as duas entradas e caíam no mesmo
// lugar, com o menu prometendo ferramentas diferentes.
//
// 'financeiro' é a fila de decisão: só o que está aguardando o Financeiro, sem
// o formulário de coleta. 'compras' (default) é a bancada de trabalho inteira.
const CotacoesViewInner = ({ showToast, profile, filial, mode }: { showToast: any; profile: UserProfile; filial: FilialOp; mode?: 'compras' | 'financeiro' }) => {
  const modoFinanceiro = mode === 'financeiro';
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);
  // Busca é feita client-side em `enriched` (nome do produto vem de requisicoes.item,
  // que é tabela diferente). useFetchData só sabe fazer ilike em colunas da própria
  // tabela, então qualquer searchColumns aqui filtra a coisa errada.
  // Realtime nas três listas. Esta tela é o encontro de dois setores: Compras
  // digita a proposta e o Financeiro decide, cada um na sua máquina. Sem
  // realtime, o Financeiro só via a cotação depois de recarregar — e a
  // requisição recém-aprovada pelo gerente não entrava no dropdown de nova
  // cotação, o que lia como "o sistema perdeu meu pedido".
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/cotacoesview', { filial }, true,
    { page }
  );
  const { data: requisicoes, setData: setRequisicoes } = useFetchData<any>('/api/requisicoesview', { filial }, true);
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  // Catálogo da unidade: é aqui que o comprador amarra o texto livre da
  // requisição a um item de verdade (migr. 480). Realtime porque o produto
  // pode estar sendo cadastrado noutra tela, agora, exatamente para este
  // pedido sair.
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial }, true);
  const produtosOrdenados = useMemo(
    () => [...produtos].sort((a: any, b: any) =>
      String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [produtos],
  );
  // Catálogo de SERVIÇOS (migr. 499). Serviço é a outra categoria de item do
  // pedido — manutenção, frete, licença, dedetização —, e sem ela a requisição
  // de unidade SV chegava aqui sem saída: o select de produto não tinha o que
  // mostrar e o único caminho era cadastrar "Manutenção do ar" como mercadoria.
  //
  // Sem filtro de filial no fetch, de propósito: `servicos.filial` é NULÁVEL, e
  // serviço sem unidade vale para todas (o que a holding contrata). Um `.eq`
  // aqui sumiria justamente com esses — o filtro é feito abaixo, com a mesma
  // régua que a RPC aplica.
  // Escopo de unidade: `auth_pode_filial()` deixa admin, CEO e conselheiro
  // passarem em todas as filiais, então a RLS sozinha não basta — quem opera
  // dentro de uma unidade via catálogo/cadastro de outra.
  const { data: servicos } = useFetchData<any>('/api/servicosview', filial ? { filial } : undefined, true);
  const servicosOrdenados = useMemo(
    () => servicos
      // Só o CONTRATADO (migr. 516). O catálogo de venda mora na mesma tabela,
      // e sem este filtro quem precisa comprar dedetização abre a lista e vê
      // "Troca de tela — R$ 150", que é o que a loja vende. A RPC recusa de
      // qualquer jeito; aqui é não oferecer o que vai ser recusado.
      .filter((s: any) => ehContratado(s.natureza))
      .filter((s: any) => (s.filial == null || s.filial === filial)
                       && (s.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) =>
        String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [servicos, filial],
  );

  // Pontualidade por fornecedor (migr. 421). Vive ao lado do preço porque é
  // aqui que a escolha é feita — no relatório, chegaria tarde.
  const { desempenho, desempenhoDisponivel } = useFornecedorDesempenho(filial);
  // Lista SEM paginação, só para agrupar propostas concorrentes por requisição.
  // `data` traz 50 linhas; usá-la para isso fazia o contador de propostas, o
  // modal de comparação e o cancelamento automático ignorarem toda proposta
  // que tivesse caído na página seguinte.
  const { data: todasCotacoes, setData: setTodasCotacoes } = useFetchData<any>('/api/cotacoesview', { filial }, true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  // Feedback do Financeiro é parágrafo, não frase: modal de leitura em vez do
  // alert() do navegador, que vinha cinza e com o domínio no título.
  const [feedbackAberto, setFeedbackAberto] = useState<string | null>(null);
  const [reabrindoCot, setReabrindoCot] = useState<string | null>(null);
  const podeReabrirDoc = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  // form.fornecedor_tipo permite os 2 selects (PF/PJ) compartilharem fornecedor_id
  // mantendo apenas um ativo de cada vez. Valores espelham pessoa_tipo do CRM.
  const [form, setForm] = useState({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' as '' | 'Empresa' | 'Pessoa Física' });
  const [extras, setExtras] = useState({ valor_unitario: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });
  // `useFormValidation` só cobre `form` (requisição e fornecedor) — era por
  // isso que valor e validade passavam em branco. Estes campos têm régua
  // própria: valor precisa ser positivo, validade precisa existir e estar viva.
  const [errosExtras, setErrosExtras] = useState<{ valor_total?: string; validade?: string }>({});
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Trava de trabalho (migr. 537) — chave é requisição+fornecedor, não a
  // requisição inteira: dois alunos cotando fornecedores DIFERENTES para o
  // mesmo item seguem em paralelo (é a comparação de preço que a tela existe
  // para fazer); a chave composta só impede os dois cotando o MESMO
  // fornecedor, que é trabalho repetido.
  const chaveReserva = form.requisicao_id && form.fornecedor_id
    ? `${form.requisicao_id}:${form.fornecedor_id}` : null;
  const reserva = useReservaTrabalho('cotacao', chaveReserva, filial);

  // Quem mais está cotando cada fornecedor NESTA requisição — para travar as
  // opções do select antes do clique, não só depois. Consulta simples (não é
  // o hook de cima, que só cuida da chave ATIVA) e realtime por requisição.
  const [reservasDaReq, setReservasDaReq] = useState<Record<string, { usuario_id: string; usuario_nome: string }>>({});
  useEffect(() => {
    if (!supabase || !form.requisicao_id) { setReservasDaReq({}); return; }
    let cancelado = false;
    const carregar = async () => {
      // `expira_em > agora` é obrigatório: a reserva morre pelo relógio, e
      // relógio não emite evento. Sem este filtro, quem fechou o notebook
      // deixaria o fornecedor travado na tela dos colegas para sempre — e
      // travado é mentira, porque o banco liberaria a reserva na hora.
      const { data } = await supabase!.from('trabalho_reservas')
        .select('chave, usuario_id, usuario_nome')
        .eq('escopo', 'cotacao')
        .like('chave', `${form.requisicao_id}:%`)
        .gt('expira_em', new Date().toISOString());
      if (cancelado) return;
      const mapa: Record<string, { usuario_id: string; usuario_nome: string }> = {};
      for (const r of data ?? []) {
        const fornId = String(r.chave).slice(form.requisicao_id.length + 1);
        mapa[fornId] = { usuario_id: r.usuario_id, usuario_nome: r.usuario_nome };
      }
      setReservasDaReq(mapa);
    };
    void carregar();
    const canalId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const ch = supabase.channel(`cotacao_reservas_${canalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trabalho_reservas' }, () => { void carregar(); })
      .subscribe();
    // Releitura periódica pela mesma razão do filtro acima: o cadeado do
    // colega tem de sumir sozinho quando o prazo vence, sem F5.
    const relogio = window.setInterval(() => { void carregar(); }, 30_000);
    return () => { cancelado = true; window.clearInterval(relogio); ch.unsubscribe(); };
  }, [form.requisicao_id]);

  // A requisição do formulário aberto. O `data_necessidade` dela é o alvo do
  // prazo que o fornecedor promete — sem ele na tela, a data da proposta era
  // digitada no escuro e lia como repetição do campo da requisição.
  const reqSelecionada = useMemo(
    () => requisicoes.find((r: any) => r.id === form.requisicao_id),
    [requisicoes, form.requisicao_id],
  );
  // Quantidade da requisição — é ela que transforma preço unitário em proposta.
  // O fornecedor cota "R$ 4,50 a unidade"; quem digitava só o total fazia a
  // conta de cabeça e errava (e a comparação entre propostas de quantidades
  // iguais deixava de bater). Sem requisição escolhida ainda não há por quanto
  // multiplicar: aí o total volta a ser digitado direto.
  const qtdReq = Number(reqSelecionada?.qtd ?? 0);
  const temQtd = Number.isFinite(qtdReq) && qtdReq > 0;
  const unidadeReq = normalizarUnidade(reqSelecionada?.unidade);

  // As duas direções da mesma conta. Unitário é o que o fornecedor informa;
  // total continua editável porque frete e desconto entram lá — e nesse caso o
  // unitário passa a ser o preço médio real, não o de tabela.
  const setUnitario = (v: string) => setExtras(x => {
    const unit = formatBRL(v);
    return { ...x, valor_unitario: unit, valor_total: temQtd ? formatBRL(parseBRL(unit) * qtdReq) : x.valor_total };
  });
  const setTotal = (v: string) => setExtras(x => {
    const total = formatBRL(v);
    return { ...x, valor_total: total, valor_unitario: temQtd ? formatBRL(parseBRL(total) / qtdReq) : x.valor_unitario };
  });

  // MIGR 582: a requisição eventual agora diz a marca pedida. Ela entra
  // preenchida na proposta porque o caso comum é cotar o que foi pedido — e
  // continua editável, porque o fornecedor pode oferecer outra e é isso que a
  // comparação entre propostas precisa mostrar.
  useEffect(() => {
    const pedida = String(reqSelecionada?.marca ?? '').trim();
    if (!pedida) return;
    setExtras(x => (x.marca ? x : { ...x, marca: pedida }));
  }, [reqSelecionada]);

  // Trocar de requisição troca a quantidade: o total tem de acompanhar, senão
  // fica o valor da requisição anterior parecendo conferido.
  useEffect(() => {
    if (!temQtd) return;
    setExtras(x => (x.valor_unitario ? { ...x, valor_total: formatBRL(parseBRL(x.valor_unitario) * qtdReq) } : x));
  }, [qtdReq, temQtd]);

  // Prazo prometido depois da data em que o item é necessário: não é erro de
  // preenchimento (o fornecedor pode mesmo não dar conta), é informação de
  // decisão — o preço menor não compensa a entrega atrasada.
  const prazoEstoura = !!(reqSelecionada?.data_necessidade && extras.prazo_entrega
    && extras.prazo_entrega > reqSelecionada.data_necessidade);

  // Fornecedor habitual do produto (migr. 488) entra pré-selecionado: o cadastro
  // deixou de exigir a escolha, mas quando ela existe não faz sentido pedir de
  // novo. Continua trocável — cotar é justamente comparar.
  useEffect(() => {
    if (!form.requisicao_id || form.fornecedor_id) return;
    const prodId = reqSelecionada?.produto_id;
    if (!prodId) return;
    const sugerido = produtos.find((p: any) => p.id === prodId)?.fornecedor_id;
    if (!sugerido) return;
    const forn = fornecedores.find((f: any) => f.id === sugerido);
    if (!forn) return;
    setForm(f => ({
      ...f,
      fornecedor_id: forn.id,
      fornecedor_tipo: (forn.pessoa_tipo ?? 'Empresa') === 'Pessoa Física' ? 'Pessoa Física' : 'Empresa',
    }));
  }, [form.requisicao_id, form.fornecedor_id, reqSelecionada, produtos, fornecedores]);

  // Marca da proposta (migr. 526). Só na compra EVENTUAL: ali o produto ainda
  // não existe e a marca é o que o fornecedor está oferecendo — dois
  // fornecedores podem propor marcas diferentes para o mesmo pedido, e é isso
  // que a comparação de propostas precisa mostrar. Na reposição a marca é do
  // produto do catálogo, e o gatilho do banco zera este campo.
  // `!!reqSelecionada` e não só `form.requisicao_id`: entre escolher a
  // requisição e a lista chegar, `reqSelecionada` é undefined — e tratar isso
  // como eventual mostraria o campo de marca numa reposição, para o gatilho
  // apagar o que foi digitado.
  const ehEventual = !!reqSelecionada && !reqSelecionada.produto_id;
  const produtoDaReq = useMemo(
    () => produtos.find((p: any) => p.id === reqSelecionada?.produto_id),
    [produtos, reqSelecionada]);
  // Sugestão a partir do que a unidade já cadastrou — não fecha a lista (nem
  // toda compra eventual é de marca que já existe), só evita "Foxton" virar
  // "foxton" na segunda vez.
  const marcasConhecidas = useMemo(() => {
    const set = new Set<string>();
    for (const p of produtos as any[]) {
      const m = String(p?.marca ?? '').trim();
      if (m) set.add(m);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  // Decisão Financeiro: modal de aprovar/reprovar/devolver.
  const [decisao, setDecisao] = useState<{ cot: any; tipo: 'aprovar' | 'reprovar' | 'devolver' } | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [decidindo, setDecidindo] = useState(false);

  // Correção (migr. 467): quem cadastrou arruma o que o decisor apontou.
  // Fornecedor e requisição ficam de fora — trocar fornecedor é outra
  // proposta, não correção desta.
  const [correcao, setCorrecao] = useState<any | null>(null);
  const [correcaoForm, setCorrecaoForm] = useState({ valor_unitario: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });

  // Mesma régua do formulário de nova cotação: a quantidade é da requisição, e
  // é ela que liga unitário e total. Aqui a requisição não muda (trocar de
  // requisição seria outra proposta), então a quantidade é fixa enquanto o
  // modal está aberto. `req` vem do enriched; a busca na lista é a rede para a
  // proposta cujo join ainda não chegou.
  const qtdCorrecao = useMemo(() => {
    if (!correcao) return 0;
    const req = correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id);
    const n = Number(req?.qtd ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [correcao, requisicoes]);
  const unidadeCorrecao = useMemo(() => {
    if (!correcao) return '';
    const req = correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id);
    return normalizarUnidade(req?.unidade);
  }, [correcao, requisicoes]);

  const setCorrecaoUnitario = (v: string) => setCorrecaoForm(x => {
    const unit = formatBRL(v);
    return { ...x, valor_unitario: unit, valor_total: qtdCorrecao ? formatBRL(parseBRL(unit) * qtdCorrecao) : x.valor_total };
  });
  const setCorrecaoTotal = (v: string) => setCorrecaoForm(x => {
    const total = formatBRL(v);
    return { ...x, valor_total: total, valor_unitario: qtdCorrecao ? formatBRL(parseBRL(total) / qtdCorrecao) : x.valor_unitario };
  });
  const [reenviando, setReenviando] = useState(false);

  // RBAC: Compras (e Logística, que opera junto no módulo de Compras — igual
  // recebimentos/movimentações) cria/envia/gera pedido; Financeiro / gerente
  // da filial / admin/CEO aprova.
  // Gerente vê/faz tudo da própria filial — inclui aprovar cotação —, e o
  // RLS já libera via auth_gerente_da (migr. 20260713i). Antes o frontend
  // exigia gerente COM setor financeiro pra decidir, o que travava gerentes
  // "puros" que a régua canônica manda liberar.
  const isCompras    = hasAnySetor(profile, 'compras', 'logistica') || profile.role === 'gerente';
  const isFinanceiro = hasSetor(profile, 'financeiro');
  const podeDecidir  =
    profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile) ||
    profile.role === 'gerente' || isFinanceiro;

  // Alçada de aprovação por valor (migr. 204). Buscada 1x por filial.
  // Regra: valor <= limite → Financeiro decide; valor > limite → Gerente
  // da filial decide. Admin/CEO sempre podem (override total).
  const [alcadaLimite, setAlcadaLimite] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('alcadas_compra')
      .select('valor_limite_financeiro')
      .eq('filial', filial)
      .eq('ativo', true)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return;
        if (error) {
          // Migração 204 pendente → degrada pro fluxo antigo (todos podem).
          console.warn('[Cotacoes] alçada indisponível:', error.message);
          setAlcadaLimite(null);
          return;
        }
        setAlcadaLimite(row ? Number(row.valor_limite_financeiro ?? 0) : null);
      });
    return () => { cancelled = true; };
  }, [filial]);

  // Quem decide esta cotação. REGRA ÚNICA: o valor manda.
  //
  // Antes havia dois sistemas em paralelo — a alçada por valor e uma régua por
  // role — com um terceiro caminho de fallback quando `alcadas_compra` não
  // respondia (`return podeDecidir`, que liberava praticamente todo mundo).
  // Três respostas possíveis para "quem aprova isto?" é o que faz um controle
  // deixar de ser controle. Agora: alçada não configurada = limite infinito =
  // Financeiro decide. Um caminho só.
  const limiteEfetivo = alcadaLimite ?? Number.POSITIVE_INFINITY;

  const podeDecidirCotacao = (cot: any): boolean => {
    // Admin/CEO/conselheiro: override total. É a saída quando não há outro
    // aprovador possível na filial.
    if (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile)) return true;
    // Segregação de funções: quem cadastrou a proposta não a aprova.
    if (cot.criado_por && cot.criado_por === profile.id) return false;
    return Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? isFinanceiro               // dentro da alçada → Financeiro
      : profile.role === 'gerente'; // acima da alçada → Gerente da filial
  };

  // Quem corrige a proposta devolvida: quem a cadastrou, ou Compras/Logística
  // da filial (o colaborador pode ter sido desligado no meio). Mesma régua da
  // RPC `reenviar_cotacao_corrigida` — o guard de verdade está lá.
  const podeCorrigir = (cot: any): boolean =>
    cot.criado_por === profile.id || hasAnySetor(profile, 'compras', 'logistica');

  const alcadaLabel = (cot: any): { label: string; color: string } => (
    Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? { label: 'Financeiro',  color: 'text-cyan-300 border-cyan-400/20' }
      : { label: 'Gerente/CEO', color: 'text-amber-300 border-amber-400/20' }
  );

  // IDs de cotações que já têm pedido gerado.
  const [cotacoesComPedido, setCotacoesComPedido] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('pedidos').select('cotacao_id').eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const ids = new Set<string>(
          (rows ?? [])
            .map((p: any) => p.cotacao_id)
            .filter((id: any): id is string => Boolean(id))
        );
        setCotacoesComPedido(ids);
      });
    return () => { cancelled = true; };
  }, [data]);

  const requisicoesAprovadas = useMemo(
    () => requisicoes.filter((r: any) => r.status === 'Aprovado'),
    [requisicoes]);

  // O que está parado esperando alguém desta tela. Conta sobre `todasCotacoes`
  // (sem paginação): trabalho na página 2 é trabalho igual, e um contador que
  // só enxerga a página 1 mente para menos.
  const aguardandoFinanceiro = todasCotacoes.filter((c: any) => c.status === 'Aguardando Financeiro').length;
  const aprovadasSemPedido = todasCotacoes.filter(
    (c: any) => c.status === 'Aprovado' && !cotacoesComPedido.has(c.id)).length;
  // Requisição aprovada segue 'Aprovado' até virar pedido, então ter cotação
  // viva não a tira da lista — contar todas inflaria a fila com trabalho já
  // feito. Só entra quem ainda não recebeu nenhuma proposta em pé.
  const comCotacaoViva = new Set(
    todasCotacoes
      .filter((c: any) => STATUS_VIVOS.has(c.status))
      .map((c: any) => c.requisicao_id));
  const semNenhumaCotacao = requisicoesAprovadas.filter((r: any) => !comCotacaoViva.has(r.id)).length;
  // Devolvida para correção é trabalho parado na mão de Compras — sem esta
  // linha a proposta sai da fila do Financeiro e não entra em fila nenhuma.
  const emCorrecao = todasCotacoes.filter((c: any) => c.status === 'Em correção').length;
  const filaDaTela = modoFinanceiro
    ? [{ label: 'cotação(ões) aguardando sua decisão', count: aguardandoFinanceiro, hint: 'aprovar libera Compras a gerar o pedido' }]
    : [
        { label: 'requisição(ões) aprovada(s) sem cotação', count: semNenhumaCotacao, hint: 'use "Nova cotação" para pedir preço ao fornecedor' },
        { label: 'cotação(ões) devolvida(s) para correção', count: emCorrecao, hint: 'clique em "Corrigir" na linha para ajustar e reenviar' },
        { label: 'cotação(ões) aprovada(s) sem pedido', count: aprovadasSemPedido, hint: 'clique em "Gerar pedido" na linha da cotação' },
      ];

  // Requisições aprovadas da filial selecionada, ordenadas por item.
  const requisicoesAprovadaOrdenadas = useMemo(() =>
    [...requisicoesAprovadas].sort((a, b) => String(a.item ?? '').localeCompare(String(b.item ?? ''), 'pt-BR', { sensitivity: 'base' })),
    [requisicoesAprovadas]
  );

  // Fornecedores divididos em PJ / PF, cada lista agrupada por filial.
  // CRMView grava pessoa_tipo como 'Empresa' / 'Pessoa Física' (não 'PJ'/'PF') —
  // filtramos pelos valores reais do banco e tratamos NULL como Empresa.
  const agruparFornecedoresPorFilial = (tipo: 'Empresa' | 'Pessoa Física') => {
    const filtrados = fornecedores.filter((f: any) => (f.pessoa_tipo ?? 'Empresa') === tipo);
    return groupCadastrosParaSelect(filtrados).map(g => ({
      // groupCadastrosParaSelect retorna label "Empresa — TechMax". Aqui só queremos
      // a filial (pessoa_tipo já está separada na nossa caixa).
      label: g.label.replace(/^(Empresa|Pessoa Física)\s*—\s*/, ''),
      items: g.items,
    }));
  };
  const fornecedoresPJ = useMemo(() => agruparFornecedoresPorFilial('Empresa'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps
  const fornecedoresPF = useMemo(() => agruparFornecedoresPorFilial('Pessoa Física'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = data.map((c: any) => ({
    ...c,
    req: requisicoes.find((r: any) => r.id === c.requisicao_id),
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  // Agrupa cotações por requisição para mostrar propostas concorrentes.
  // Boa prática de compras: coletar >=3 propostas por requisição antes de
  // aprovar. Trata Cancelado/Negado como propostas históricas — aparecem
  // no modal de comparação, mas não contam pro aviso soft.
  const propostasPorRequisicao = useMemo(() => {
    const map = new Map<string, any[]>();
    todasCotacoes.forEach((c: any) => {
      if (!c.requisicao_id) return;
      const arr = map.get(c.requisicao_id) ?? [];
      arr.push({
        ...c,
        req: requisicoes.find((r: any) => r.id === c.requisicao_id),
        forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
      });
      map.set(c.requisicao_id, arr);
    });
    return map;
  }, [todasCotacoes, requisicoes, fornecedores]);
  const contarVivos = (reqId: string) =>
    (propostasPorRequisicao.get(reqId) ?? []).filter((c: any) => STATUS_VIVOS.has(c.status)).length;

  // Fornecedores que JÁ têm proposta viva nesta requisição (migr. 538). É
  // situação diferente do cadeado da 537: aquele é "alguém está digitando
  // agora" e passa em 3 minutos; este é definitivo — o banco recusa o INSERT.
  // Mostrar antes do clique evita o aluno preencher a proposta inteira para
  // levar o erro no Salvar.
  const fornecedoresJaCotados = useMemo(() => {
    const map = new Map<string, string>();
    if (!form.requisicao_id) return map;
    for (const c of propostasPorRequisicao.get(form.requisicao_id) ?? []) {
      if (c.fornecedor_id && STATUS_VIVOS.has(c.status)) {
        map.set(c.fornecedor_id, numeroCotacao(c));
      }
    }
    return map;
  }, [propostasPorRequisicao, form.requisicao_id]);

  // A lista de "Nova cotação" não pode ser só "toda requisição aprovada":
  // cotar não é ato único (a régua é 3 propostas), então a requisição
  // continua 'Aprovado' depois da 1ª proposta e voltava para o dropdown
  // exatamente igual às que ninguém tocou. O aluno relia a lista inteira sem
  // ter como saber o que ainda faltava.
  //
  // Em vez de sumir com o item — o que impediria a 2ª e a 3ª proposta —, o
  // dropdown separa em dois grupos e diz quantas propostas já foram. Quem já
  // teve cotação aprovada sai de circulação (`disabled`): o próximo passo
  // dela é gerar o pedido, não cotar de novo.
  const requisicoesParaCotar = useMemo(() => {
    const anotadas = requisicoesAprovadaOrdenadas.map((r: any) => {
      const propostas = propostasPorRequisicao.get(r.id) ?? [];
      return {
        r,
        vivas: propostas.filter((c: any) => STATUS_VIVOS.has(c.status)).length,
        aprovada: propostas.some((c: any) => c.status === 'Aprovado'),
      };
    });
    return {
      pendentes: anotadas.filter(a => a.vivas === 0),
      cotadas:   anotadas.filter(a => a.vivas > 0),
    };
  }, [requisicoesAprovadaOrdenadas, propostasPorRequisicao]);

  // Snapshots estáveis para os três selects do formulário (ver
  // `useOpcoesEstaveis`). Fornecedor leva junto as duas travas porque elas é
  // que mudam o texto do <option> — congelar só o array de nomes deixaria o
  // rótulo "🔒 fulano está cotando" aparecendo e sumindo com o popup aberto.
  const selReq = useOpcoesEstaveis(requisicoesParaCotar);
  const opcoesPJ = useMemo(
    () => ({ grupos: fornecedoresPJ, jaCotados: fornecedoresJaCotados, reservas: reservasDaReq }),
    [fornecedoresPJ, fornecedoresJaCotados, reservasDaReq]);
  const opcoesPF = useMemo(
    () => ({ grupos: fornecedoresPF, jaCotados: fornecedoresJaCotados, reservas: reservasDaReq }),
    [fornecedoresPF, fornecedoresJaCotados, reservasDaReq]);
  const selPJ = useOpcoesEstaveis(opcoesPJ);
  const selPF = useOpcoesEstaveis(opcoesPF);

  // Modal de comparação — chave = requisicao_id.
  const [comparando, setComparando] = useState<string | null>(null);
  const propostasDoModal = useMemo(() => {
    if (!comparando) return [];
    const lista = propostasPorRequisicao.get(comparando) ?? [];
    // Menor preço primeiro (proposta candidata a vencedora).
    return [...lista].sort((a, b) => Number(a.valor_total ?? 0) - Number(b.valor_total ?? 0));
  }, [comparando, propostasPorRequisicao]);
  const menorPrecoDoModal = useMemo(() => {
    const vivos = propostasDoModal.filter((c: any) => STATUS_VIVOS.has(c.status));
    if (vivos.length === 0) return null;
    return Math.min(...vivos.map((c: any) => Number(c.valor_total ?? 0)));
  }, [propostasDoModal]);

  const enrichedFiltered = useMemo(() => {
    // Na porta do Financeiro a tela é caixa de entrada, não catálogo: mostra
    // só o que espera decisão dele — o mesmo status que alimenta o badge.
    const base = modoFinanceiro
      ? enriched.filter((c: any) => c.status === 'Aguardando Financeiro')
      : enriched;
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c: any) => {
      const item = String(c.req?.item ?? '').toLowerCase();
      const forn = String(c.forn?.nome ?? '').toLowerCase();
      const status = String(c.status ?? '').toLowerCase();
      const obs = String(c.observacao ?? '').toLowerCase();
      return item.includes(q) || forn.includes(q) || status.includes(q) || obs.includes(q);
    });
  }, [enriched, debouncedSearch, modoFinanceiro]);

  // Esta tela lê cotação por dois fetches: `data` é a página da tabela e
  // `todasCotacoes` (sem paginação) é o que alimenta os contadores da fila, o
  // agrupamento por requisição, o modal de comparação e — o que doía — o grupo
  // "Já cotadas" do dropdown de Nova Cotação. Escrever só em `data` deixava o
  // dropdown mentindo até o realtime chegar: a proposta acabava de ser salva e
  // a requisição continuava listada em "Ainda sem cotação". Toda escrita
  // otimista passa por aqui para as duas listas andarem juntas.
  const inserirCotacaoLocal = (nova: any) => {
    setData((prev: any[]) => [nova, ...prev]);
    setTodasCotacoes((prev: any[]) => [nova, ...prev]);
  };
  const atualizarCotacaoLocal = (fn: (c: any) => any) => {
    setData((prev: any[]) => prev.map(fn));
    setTodasCotacoes((prev: any[]) => prev.map(fn));
  };

  const closeForm = () => {
    setShowForm(false);
    setForm({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' });
    setExtras({ valor_unitario: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });
    setErrors({});
    setErrosExtras({});
  };

  // Compras cria a cotação → vai direto para 'Aguardando Financeiro' e notifica.
  const handleSave = async () => {
    if (!validate()) return;
    // MIGR 583. Preço e validade são a proposta: sem preço não há o que
    // comparar, e sem validade não se sabe até quando o que foi comparado
    // continua valendo. O banco recusa os dois casos — a tela avisa antes.
    const erros: { valor_total?: string; validade?: string } = {};
    if (!(parseBRL(extras.valor_total) > 0)) {
      erros.valor_total = 'Informe o valor da proposta.';
    }
    if (!extras.validade) {
      erros.validade = 'Diga até quando este preço vale.';
    } else if (extras.validade < todayBR()) {
      erros.validade = 'Esta data já passou — a proposta nasceria vencida.';
    }
    setErrosExtras(erros);
    if (Object.keys(erros).length > 0) {
      showToast('Confira o valor e a validade da proposta.', 'error');
      return;
    }
    // O select já vem com a opção travada, mas o banco é quem decide de
    // verdade: sem esta checagem no Salvar, o cadeado da tela é decoração.
    if (reserva.travado) {
      showToast(`${reserva.dono?.usuario_nome} já está cotando este fornecedor para esta requisição.`, 'error');
      return;
    }
    // Aviso soft: recomendado ter >=3 propostas por requisição antes do envio.
    // Bloqueio hard atrapalharia compra urgente; então só confirma.
    const vivosAtuais = contarVivos(form.requisicao_id);
    if (vivosAtuais < 2) {
      const ordinal = vivosAtuais === 0 ? '1ª' : '2ª';
      const ok = await confirm(
        `Esta será a ${ordinal} proposta para esta requisição. Boa prática de compras é coletar pelo menos 3 propostas antes de enviar ao Financeiro. Deseja enviar assim mesmo?`
      );
      if (!ok) return;
    }
    setIsSaving(true);
    showToast('Enviando cotação ao Financeiro...', 'info', false);
    try {
      const fornNome = fornecedores.find((f: any) => f.id === form.fornecedor_id)?.nome ?? 'fornecedor';
      const reqItem  = requisicoes.find((r: any) => r.id === form.requisicao_id)?.item ?? 'item';
      const valorNum = parseBRL(extras.valor_total);
      const saved = await dbInsert('/api/cotacoesview', {
        requisicao_id: form.requisicao_id,
        fornecedor_id: form.fornecedor_id,
        valor_total: valorNum,
        prazo_entrega: extras.prazo_entrega,
        validade: extras.validade || null,
        // Reposição manda null: o gatilho zeraria de qualquer jeito, e enviar
        // texto daria a impressão de que foi gravado.
        marca: ehEventual ? (extras.marca.trim() || null) : null,
        // O que veio junto do preço (migr. 583): frete, garantia, instalação.
        observacao: extras.observacao.trim() || null,
        // MIGR 584: é daqui que saem os vencimentos dos títulos quando a
        // proposta virar pedido.
        condicao_pagamento: extras.condicao_pagamento,
        status: 'Aguardando Financeiro',
        filial,
      });
      inserirCotacaoLocal(saved ?? { id: Date.now(), ...form, ...extras, status: 'Aguardando Financeiro' });
      closeForm();
      showToast('Cotação enviada. O Financeiro decide em Financeiro → Aprovações de cotação; enquanto isso dá para cadastrar outra proposta para a mesma requisição.', 'success', true);

      // Notifica setor financeiro.
      await notificarSetor({
        setor:     'financeiro',
        tipo:      'aprovacao_pendente',
        titulo:    'Nova cotação aguardando aprovação',
        mensagem:  `${reqItem} — ${fornNome} (R$ ${formatBRL(valorNum)})`,
        // Destino do FINANCEIRO. Apontava para 'compras-cotações', módulo que
        // SETOR_MODULES.financeiro não inclui — o clique no sino não abria nada.
        link_view: 'financeiro-aprovaçõesdecotação',
        urgencia:  'Média',
        ref_id:    (saved as any)?.id,
      });
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Cotacoes] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Financeiro decide (aprovar OU reprovar com feedback).
  const handleConfirmDecisao = async () => {
    if (!decisao) return;
    const { cot, tipo } = decisao;
    const feedback = feedbackInput.trim();

    if (tipo !== 'aprovar' && !feedback) {
      showToast(tipo === 'reprovar'
        ? 'Feedback é obrigatório para reprovar.'
        : 'Diga o que corrigir — é o que Compras lê para arrumar a proposta.', 'error', true);
      return;
    }

    // Devolver não é decisão sobre a compra, é devolver o papel para quem o
    // preencheu: a proposta continua viva, não cancela concorrente nenhuma e
    // ninguém vira aprovador dela por ter apontado o erro (migr. 467).
    if (tipo === 'devolver') {
      if (!supabase) return;
      setDecidindo(true);
      try {
        const { error } = await supabase.rpc('devolver_cotacao_para_correcao', {
          p_cotacao_id: cot.id,
          p_motivo:     feedback,
        });
        if (error) throw error;
        atualizarCotacaoLocal(c => c.id === cot.id
          ? { ...c, status: 'Em correção', feedback, aprovado_por: null, aprovado_em: null }
          : c);

        const reqItem  = cot.req?.item ?? requisicoes.find((r: any) => r.id === cot.requisicao_id)?.item ?? 'cotação';
        const fornNome = cot.forn?.nome ?? fornecedores.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? 'fornecedor';
        await notificarSetor({
          setor:     'compras',
          tipo:      'reprovado',
          titulo:    'Cotação devolvida para correção',
          mensagem:  `${reqItem} — ${fornNome}`,
          link_view: 'compras-cotações',
          urgencia:  'Alta',
          ref_id:    cot.id,
          motivo:    feedback,
        });

        showToast('Cotação devolvida. Compras corrige e reenvia — a proposta não foi recusada.', 'success', true);
        setDecisao(null);
        setFeedbackInput('');
      } catch (err: any) {
        showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
      } finally {
        setDecidindo(false);
      }
      return;
    }

    setDecidindo(true);
    try {
      const novoStatus = tipo === 'aprovar' ? 'Aprovado' : 'Negado';

      // Decisão e cancelamento das concorrentes numa transação só (migr. 334).
      // Eram um UPDATE mais um laço de UPDATEs com `catch {}` vazio: bastava um
      // falhar para a proposta concorrente seguir 'Aguardando Financeiro' e
      // aprovável — o Financeiro decidindo duas vezes a mesma compra. O banco
      // também varre todas as propostas, não só as da página carregada.
      if (!supabase) return;
      const { data: res, error } = await supabase.rpc('decidir_cotacao', {
        p_cotacao_id: cot.id,
        p_decisao:    novoStatus,
        p_feedback:   feedback || null,
      });
      if (error) throw error;

      const canceladas = Number((res as any)?.canceladas ?? 0);
      const updates: any = {
        status:       novoStatus,
        feedback:     feedback || null,
        aprovado_por: profile.id,
        aprovado_em:  new Date().toISOString(),
      };
      atualizarCotacaoLocal(c => {
        if (c.id === cot.id) return { ...c, ...updates };
        if (tipo === 'aprovar' && cot.requisicao_id &&
            c.requisicao_id === cot.requisicao_id && c.status === 'Aguardando Financeiro') {
          return { ...c, status: 'Cancelado' };
        }
        return c;
      });

      // Notifica Compras.
      const reqItem = cot.req?.item ?? requisicoes.find((r: any) => r.id === cot.requisicao_id)?.item ?? 'cotação';
      const fornNome = cot.forn?.nome ?? fornecedores.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? 'fornecedor';
      await notificarSetor({
        setor:     'compras',
        tipo:      tipo === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipo === 'aprovar'
                     ? 'Cotação aprovada pelo Financeiro'
                     : 'Cotação reprovada pelo Financeiro',
        mensagem:  `${reqItem} — ${fornNome}`,
        link_view: 'compras-cotações',
        urgencia:  tipo === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    cot.id,
        motivo:    tipo === 'reprovar' ? feedback : undefined,
      });

      showToast(tipo === 'aprovar'
        ? (canceladas > 0
            ? `Cotação aprovada e ${canceladas} proposta(s) concorrente(s) cancelada(s). Compras agora gera o pedido pelo botão "Gerar pedido", na linha da cotação.`
            : 'Cotação aprovada. Compras agora gera o pedido pelo botão "Gerar pedido", na linha da cotação.')
        : 'Cotação reprovada. Compras vê o motivo e cota de novo em Compras → Cotações.', 'success', true);
      setDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDecidindo(false);
    }
  };

  // Compras: cria o pedido depois que o Financeiro aprovou.
  //
  // Tudo acontece dentro da RPC `gerar_pedido_de_cotacao` (migr. 266): ela checa
  // duplicidade por cotação E por requisição, insere o pedido e baixa a
  // requisição para 'Atendida' no mesmo COMMIT. Antes isso era insert solto no
  // cliente com guard só por cotação — foi assim que uma requisição de 24
  // unidades virou 2 pedidos e 2 contas a pagar em produção.
  // Cotação esperando o vínculo com o catálogo, e o item escolhido no modal.
  //
  // `categoriaVinculo` é a pergunta que a migr. 499 tornou possível responder:
  // material ou serviço. Ela nasce lida da unidade que a requisição pediu (SV é
  // serviço), porque quem escreveu "Manutenção do ar-condicionado" já disse o
  // que era — o comprador só confirma.
  const [vinculando, setVinculando] = useState<any | null>(null);
  const [categoriaVinculo, setCategoriaVinculo] = useState<'produto' | 'servico'>('produto');
  const [produtoVinculo, setProdutoVinculo] = useState('');
  const [servicoVinculo, setServicoVinculo] = useState('');

  /** A requisição pediu serviço? A unidade SV é a declaração (src/lib/unidades.ts). */
  const pediuServico = (cot: any) =>
    String(cot?.req?.unidade ?? '').trim().toUpperCase() === 'SV';

  const handleGerarPedido = async (
    cotacao: any,
    vinculo?: { produtoId?: string; servicoId?: string },
  ) => {
    if (!supabase) return;
    // Compra eventual nasce de texto livre — quem pede não conhece o catálogo,
    // e isso é realista. O que não era realista é ninguém normalizar depois: o
    // item chegava na doca sem código e o conferente é que cadastrava. Em ERP
    // real o código existe ANTES do pedido, e quem amarra é o comprador.
    // A RPC recusa de qualquer jeito (migr. 480/499); isto aqui é só perguntar
    // antes, em vez de deixar o erro estourar depois do clique.
    const jaVinculada = !!(cotacao.req?.produto_id || cotacao.req?.servico_id);
    if (!jaVinculada && !vinculo?.produtoId && !vinculo?.servicoId) {
      setCategoriaVinculo(pediuServico(cotacao) ? 'servico' : 'produto');
      setProdutoVinculo('');
      setServicoVinculo('');
      setVinculando(cotacao);
      return;
    }
    setGenerating(cotacao.id);
    try {
      const { data: pedido, error } = await supabase.rpc('gerar_pedido_de_cotacao', {
        p_cotacao_id: cotacao.id,
        p_produto_id: vinculo?.produtoId ?? null,
        p_servico_id: vinculo?.servicoId ?? null,
      });
      if (error) throw new Error(error.message);
      setCotacoesComPedido(prev => new Set(prev).add(cotacao.id));
      // A requisição saiu de 'Aprovado' — tira do dropdown de Nova Cotação sem
      // esperar o próximo fetch.
      if (cotacao.requisicao_id) {
        setRequisicoes((prev: any[]) =>
          prev.map(r => r.id === cotacao.requisicao_id ? { ...r, status: 'Atendida' } : r));
      }
      const novo: any = Array.isArray(pedido) ? pedido[0] : pedido;
      setVinculando(null);
      setProdutoVinculo('');
      setServicoVinculo('');
      // Serviço não chega em caixa: o que fecha o pedido é o aceite da execução,
      // e é ele que libera o pagamento. Mandar o aluno avisar o Estoque de uma
      // dedetização seria mandá-lo esperar uma carga que não vem.
      // MIGR 584: dizer quantos títulos nasceram fecha o ciclo na cabeça de
      // quem comprou — a condição que ele negociou virou dívida com data.
      const nParc = parcelasDaCondicao(String(novo?.condicao_pagamento ?? ''));
      const contas = nParc > 1
        ? `com ${nParc} parcelas no contas a pagar (${novo.condicao_pagamento})`
        : 'com a conta a pagar';
      showToast(
        novo?.servico_id
          ? `${numeroPedido(novo)} gerado, ${contas}. Serviço não entra em estoque: quando for executado, registre o aceite em Estoque → Recebimentos — é ele que libera o pagamento.`
          : `${numeroPedido(novo)} gerado, ${contas}. Marque "em entrega" em Compras → Pedidos para avisar o Estoque.`,
        'success', true);
    } catch (err: any) {
      showToast(`Falha ao gerar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setGenerating(null);
    }
  };

  // Compras corrige o que foi devolvido e devolve para a fila do Financeiro.
  // A RPC guarda a régua (só quem cadastrou ou Compras da filial, e só em
  // 'Em correção'); aqui é só o formulário.
  const abrirCorrecao = (cot: any) => {
    setCorrecao(cot);
    // O unitário nasce da divisão porque o banco só guarda o total: é o preço
    // que a proposta devolvida de fato praticou, não o de tabela.
    const req = cot.req ?? requisicoes.find((r: any) => r.id === cot.requisicao_id);
    const qtd = Number(req?.qtd ?? 0);
    const total = Number(cot.valor_total ?? 0);
    setCorrecaoForm({
      valor_unitario: Number.isFinite(qtd) && qtd > 0 ? formatBRL(total / qtd) : '',
      valor_total:   formatBRL(total),
      prazo_entrega: cot.prazo_entrega ?? '',
      // Proposta devolvida costuma voltar com a validade já vencida — e o
      // banco recusa reenviar assim (migr. 583). Sugere a data nova em vez de
      // deixar o aluno bater no erro para descobrir.
      validade:      (cot.validade && String(cot.validade) >= todayBR())
                       ? cot.validade : emDias(VALIDADE_PADRAO_DIAS),
      marca:         cot.marca ?? '',
      observacao:    cot.observacao ?? '',
      condicao_pagamento: cot.condicao_pagamento ?? 'À vista',
    });
  };

  const handleReenviarCorrigida = async () => {
    if (!correcao || !supabase) return;
    const valorNum = parseBRL(correcaoForm.valor_total);
    if (!(valorNum > 0)) {
      showToast('Informe o valor da proposta.', 'error', true);
      return;
    }
    // Reenviar é revalidar: o banco recusa devolver ao Financeiro uma proposta
    // com a validade vencida (migr. 583), e o erro cru não diria o porquê.
    if (!correcaoForm.validade) {
      showToast('Diga até quando este preço vale.', 'error', true);
      return;
    }
    if (correcaoForm.validade < todayBR()) {
      showToast('A validade informada já passou. Confirme com o fornecedor até quando o preço vale.', 'error', true);
      return;
    }
    setReenviando(true);
    try {
      const { error } = await supabase.rpc('reenviar_cotacao_corrigida', {
        p_cotacao_id:    correcao.id,
        p_valor_total:   valorNum,
        p_prazo_entrega: correcaoForm.prazo_entrega || null,
        p_validade:      correcaoForm.validade || null,
        // Migr. 526: branco LIMPA. "Tirei a marca da proposta" é correção
        // legítima, e guardar o valor antigo diria que deu certo sem ter dado.
        p_marca:         correcaoForm.marca.trim() || null,
        p_observacao:    correcaoForm.observacao.trim() || null,
        p_condicao_pagamento: correcaoForm.condicao_pagamento || null,
      });
      if (error) throw error;
      atualizarCotacaoLocal(c => c.id === correcao.id
        ? { ...c, status: 'Aguardando Financeiro', feedback: null,
            valor_total: valorNum, prazo_entrega: correcaoForm.prazo_entrega || c.prazo_entrega,
            validade: correcaoForm.validade || null,
            marca: correcaoForm.marca.trim() || null,
            observacao: correcaoForm.observacao.trim() || null,
            condicao_pagamento: correcaoForm.condicao_pagamento }
        : c);

      const reqItem  = correcao.req?.item ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id)?.item ?? 'item';
      const fornNome = correcao.forn?.nome ?? fornecedores.find((f: any) => f.id === correcao.fornecedor_id)?.nome ?? 'fornecedor';
      await notificarSetor({
        setor:     'financeiro',
        tipo:      'aprovacao_pendente',
        titulo:    'Cotação corrigida voltou para decisão',
        mensagem:  `${reqItem} — ${fornNome} (R$ ${formatBRL(valorNum)})`,
        link_view: 'financeiro-aprovaçõesdecotação',
        urgencia:  'Média',
        ref_id:    correcao.id,
      });

      showToast('Cotação corrigida e reenviada — está de volta na fila do Financeiro.', 'success', true);
      setCorrecao(null);
    } catch (err: any) {
      showToast(`Erro ao reenviar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setReenviando(false);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!await confirm('Cancelar esta cotação?')) return;
    try {
      const updated = await dbUpdate('/api/cotacoesview', id, { status: 'Cancelado' });
      atualizarCotacaoLocal(c => c.id === id ? (updated ?? { ...c, status: 'Cancelado' }) : c);
      showToast('Cotação cancelada.', 'info', true);
    } catch (err: any) {
      showToast(`Erro ao cancelar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // Inativar cotação saiu (migr. 340): apagar a proposta some com o preço que o
  // fornecedor deu e com o motivo da recusa — o material da aula sobre compras.
  // Cancelar continua sendo o caminho normal; reabrir existe para o engano.
  const handleReabrirCot = async (cot: any) => {
    if (!supabase) return;
    if (!await confirm(
      `Reabrir a cotação ${numeroCotacao(cot)}?\n\n` +
      'Ela volta para "Aguardando Financeiro" e entra de novo na fila de decisão.')) return;
    setReabrindoCot(cot.id);
    try {
      const { error } = await supabase.rpc('reabrir_cotacao', { p_id: cot.id, p_motivo: null });
      if (error) throw error;
      showToast('Cotação reaberta — está de volta na fila do Financeiro.', 'success', true);
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reabrir.', 'error', true);
    } finally {
      setReabrindoCot(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      {/* Uma vez só, na raiz: o formulário de nova proposta e o modal de
          correção apontam os dois para este `list` (migr. 526). Dentro do
          formulário, ele sumia junto com ele e o modal ficava sem sugestão. */}
      <datalist id="marcas-conhecidas">
        {marcasConhecidas.map(m => <option key={m} value={m} />)}
      </datalist>
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {modoFinanceiro ? 'Aprovações de Cotação' : 'Cotações'} — {filial}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Cotações que o setor de Compras enviou e aguardam a sua decisão.'
              : 'Colete propostas de fornecedores; após aprovação do Financeiro, gere o pedido.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar..."
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {isCompras && !modoFinanceiro && (
            <NeuButtonAccent onClick={() => {
              const abrindo = !showForm;
              closeForm();
              setShowForm(abrindo);
              if (abrindo) setExtras(x => ({ ...x, validade: emDias(VALIDADE_PADRAO_DIAS) }));
            }}>
              <Plus size={16} /> Nova Cotação
            </NeuButtonAccent>
          )}
        </div>
      </div>

      <FilaDeTrabalho itens={filaDaTela} />

      <AnimatePresence>
        {showForm && isCompras && !modoFinanceiro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Cotação</h3>
              <p className="text-[11px] text-gray-500 -mt-2">
                Ao salvar, a cotação será enviada ao <span className="text-cyan-400 font-bold">Financeiro</span> para aprovação.
              </p>
              {requisicoesAprovadaOrdenadas.length === 0 ? (
                <p className="text-sm text-yellow-400/80 text-center py-4">Nenhuma requisição aprovada disponível. Aprove uma requisição primeiro.</p>
              ) : (
                <>
                  {/* Fila zerada some do FilaDeTrabalho, então sem esta linha a
                      tela ficava idêntica com tudo cotado e com nada cotado. */}
                  {requisicoesParaCotar.pendentes.length === 0 && (
                    <p className="text-[11px] text-emerald-400/80 -mt-2">
                      Todas as requisições aprovadas já têm proposta. Escolha uma de "Já cotadas" só se for
                      acrescentar outra proposta concorrente.
                    </p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Requisição *" error={errors.requisicao_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.requisicao_id ? 'border border-red-500/40' : ''}`}
                        {...selReq.handlers}
                        value={form.requisicao_id} onChange={e => { selReq.soltar(); setForm(f => ({ ...f, requisicao_id: e.target.value })); clearError('requisicao_id'); }}>
                        <option value="">Selecione...</option>
                        {selReq.opcoes.pendentes.length > 0 && (
                          <optgroup label={`Ainda sem cotação (${selReq.opcoes.pendentes.length})`}>
                            {selReq.opcoes.pendentes.map(({ r }) => (
                              <option key={r.id} value={r.id}>{r.item} (Qtd: {r.qtd})</option>
                            ))}
                          </optgroup>
                        )}
                        {selReq.opcoes.cotadas.length > 0 && (
                          <optgroup label={`Já cotadas (${selReq.opcoes.cotadas.length})`}>
                            {selReq.opcoes.cotadas.map(({ r, vivas, aprovada }) => (
                              <option key={r.id} value={r.id} disabled={aprovada}>
                                {r.item} (Qtd: {r.qtd}) — {vivas} proposta{vivas === 1 ? '' : 's'}
                                {aprovada ? ' · aprovada, gere o pedido' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PJ" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        {...selPJ.handlers}
                        value={form.fornecedor_tipo === 'Empresa' ? form.fornecedor_id : ''}
                        onChange={e => { selPJ.soltar(); setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Empresa' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PJ...</option>
                        {selPJ.opcoes.grupos.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => {
                              // Duas travas diferentes, e a ordem importa: a
                              // proposta que já existe é definitiva (o banco
                              // recusa, migr. 538); a reserva é transitória
                              // (passa em 3 min, migr. 537).
                              const jaCotado = selPJ.opcoes.jaCotados.get(f.id);
                              const res = selPJ.opcoes.reservas[f.id];
                              const travado = !!res && res.usuario_id !== profile.id;
                              const rotulo = jaCotado
                                ? `✓ ${f.nome} — já cotado nesta requisição (${jaCotado})`
                                : travado
                                  ? `🔒 ${f.nome} — ${res.usuario_nome} está cotando`
                                  : f.nome;
                              return (
                                <option key={f.id} value={f.id} disabled={!!jaCotado || travado}>
                                  {rotulo}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PF" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        {...selPF.handlers}
                        value={form.fornecedor_tipo === 'Pessoa Física' ? form.fornecedor_id : ''}
                        onChange={e => { selPF.soltar(); setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Pessoa Física' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PF...</option>
                        {selPF.opcoes.grupos.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => {
                              // Duas travas diferentes, e a ordem importa: a
                              // proposta que já existe é definitiva (o banco
                              // recusa, migr. 538); a reserva é transitória
                              // (passa em 3 min, migr. 537).
                              const jaCotado = selPF.opcoes.jaCotados.get(f.id);
                              const res = selPF.opcoes.reservas[f.id];
                              const travado = !!res && res.usuario_id !== profile.id;
                              const rotulo = jaCotado
                                ? `✓ ${f.nome} — já cotado nesta requisição (${jaCotado})`
                                : travado
                                  ? `🔒 ${f.nome} — ${res.usuario_nome} está cotando`
                                  : f.nome;
                              return (
                                <option key={f.id} value={f.id} disabled={!!jaCotado || travado}>
                                  {rotulo}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    {reserva.travado && (
                      <p className="text-[11px] text-yellow-400 md:col-span-3 -mt-2">
                        🔒 {reserva.dono?.usuario_nome} já está cotando este fornecedor para esta requisição agora.
                        Escolha outro fornecedor ou espere.
                      </p>
                    )}
                    {/* Histórico de quem foi escolhido, ainda no formulário: o
                        prazo prometido abaixo vale o que o fornecedor costuma
                        cumprir. */}
                    {desempenhoDisponivel && form.fornecedor_id && (
                      <div className="flex flex-col gap-1 justify-end pb-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                          Histórico de entrega
                        </span>
                        <SeloDesempenho d={desempenho[form.fornecedor_id]} />
                      </div>
                    )}
                    {/* Quantidade não é digitada aqui: ela é da requisição.
                        Mostrar em cinza tira a conta da cabeça do comprador e
                        deixa claro sobre quantas unidades o preço incide. */}
                    {reqSelecionada && (
                      <FormField label="Quantidade solicitada">
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                          {temQtd ? `${qtdBR(qtdReq)} ${unidadeReq}` : '—'}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Quem pediu definiu a medida. Cotar é dar preço para esta quantidade — não para outra.
                        </p>
                      </FormField>
                    )}
                    <FormField label={`Valor Unitário (R$${temQtd ? ` / ${unidadeReq}` : ''})`}>
                      <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.valor_unitario}
                        onChange={e => setUnitario(e.target.value)}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="0,00" />
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        {temQtd
                          ? `O preço de uma ${unidadeReq}. O total sai da multiplicação por ${qtdBR(qtdReq)}.`
                          : 'Escolha a requisição para o total ser calculado pela quantidade.'}
                      </p>
                    </FormField>
                    <FormField label="Valor Total (R$) *" error={errosExtras.valor_total}>
                      <input type="text" inputMode="numeric"
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errosExtras.valor_total ? 'border border-red-500/40' : ''}`}
                        value={extras.valor_total}
                        onChange={e => { setTotal(e.target.value); setErrosExtras(x => ({ ...x, valor_total: undefined })); }}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="0,00" />
                      {temQtd && (
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          {extras.valor_unitario
                            ? `${extras.valor_unitario} × ${qtdBR(qtdReq)} ${unidadeReq}. É este valor que vai ao Financeiro.`
                            : 'É este valor que vai ao Financeiro.'}
                          {' '}Frete ou desconto fechado entram aqui — o unitário se ajusta ao preço médio.
                        </p>
                      )}
                    </FormField>
                    <FormField label="Prazo de Entrega">
                      <input type="date" className={`neu-input py-2 px-3 rounded-xl text-sm ${prazoEstoura ? 'border border-red-500/40' : ''}`}
                        value={extras.prazo_entrega} onChange={e => setExtras(x => ({ ...x, prazo_entrega: e.target.value }))} />
                      {/* Duas datas parecidas viram uma só na cabeça de quem
                          preenche se o alvo não estiver à vista. A da
                          requisição é a DEMANDA (quando eu preciso); esta é a
                          OFERTA (quando o fornecedor promete). Comparar as duas
                          é metade do critério de compra — a outra é o preço. */}
                      {reqSelecionada?.data_necessidade ? (
                        <p className={`text-[10px] mt-1 leading-relaxed ${prazoEstoura ? 'text-red-400' : 'text-gray-500'}`}>
                          {prazoEstoura
                            ? `Entrega depois do necessário (${dataBR(reqSelecionada.data_necessidade)}). Dá para enviar assim mesmo — o Financeiro decide se o preço compensa o atraso.`
                            : `A requisição precisa do item até ${dataBR(reqSelecionada.data_necessidade)}.`}
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Quando o fornecedor promete entregar — não é a data em que a requisição precisa do item.
                        </p>
                      )}
                    </FormField>
                    <FormField label="Validade da Proposta *" error={errosExtras.validade}>
                      <input type="date" min={todayBR()}
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errosExtras.validade ? 'border border-red-500/40' : ''}`}
                        value={extras.validade}
                        onChange={e => { setExtras(x => ({ ...x, validade: e.target.value })); setErrosExtras(x => ({ ...x, validade: undefined })); }} />
                      {/* Preço de fornecedor vence. Depois desta data o
                          Financeiro não aprova (migr. 583) — a saída é devolver
                          para Compras revalidar, que é o que se faz na rua. */}
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        Até quando o fornecedor garante este preço. Passou disso, o Financeiro devolve para revalidar.
                      </p>
                    </FormField>
                    {/* MIGR 584. Prazo é negociação, não detalhe: duas
                        propostas de mesmo valor não são a mesma compra se uma
                        é à vista e a outra é 30/60/90. Daqui saem os
                        vencimentos dos títulos no contas a pagar. */}
                    <FormField label="Condição de pagamento *">
                      <select className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.condicao_pagamento}
                        onChange={e => setExtras(x => ({ ...x, condicao_pagamento: e.target.value }))}>
                        {CONDICOES_PAGAMENTO.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        {(() => {
                          const n = parcelasDaCondicao(extras.condicao_pagamento);
                          const base = extras.prazo_entrega
                            ? `a partir da entrega (${dataBR(extras.prazo_entrega)})`
                            : 'a partir da entrega prevista';
                          return extras.condicao_pagamento === 'À vista'
                            ? `Vira 1 título vencendo ${base}.`
                            : `Vira ${n} ${n > 1 ? 'títulos' : 'título'} no contas a pagar, contados ${base}.`;
                        })()}
                      </p>
                    </FormField>
                    {/* Marca (migr. 526). Na eventual é campo da proposta; na
                        reposição é o que o catálogo já diz, em cinza. */}
                    {form.requisicao_id && (ehEventual ? (
                      <FormField label="Marca oferecida">
                        <input list="marcas-conhecidas" className="neu-input py-2 px-3 rounded-xl text-sm"
                          value={extras.marca}
                          onChange={e => setExtras(x => ({ ...x, marca: e.target.value }))}
                          placeholder="Ex.: Foxton" />
                        {reqSelecionada?.marca && (
                          <p className="text-[10px] text-cyan-400/80 mt-1 leading-relaxed">
                            Marca pedida na requisição: <span className="font-bold">{reqSelecionada.marca}</span>.
                            Propor outra é legítimo — só deixe explícito aqui, porque é isso que o Financeiro compara.
                          </p>
                        )}
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Compra eventual: o item ainda não está no catálogo, e a marca faz parte do que
                          está sendo oferecido. Quem cadastrar o produto depois recebe esta marca já
                          preenchida — se esta for a proposta aprovada.
                        </p>
                      </FormField>
                    ) : (
                      <FormField label="Marca">
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                          {produtoDaReq?.marca || '—'}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Reposição: a marca é a do produto do catálogo. Proposta de outra marca não é a
                          mesma compra — é outro item, e pede outra requisição.
                        </p>
                      </FormField>
                    ))}
                    {/* MIGR 583. Proposta real não é só um número: vem com
                        frete, garantia, prazo de troca. Sem lugar para isso, o
                        aluno comparava dois preços fingindo que as condições
                        eram iguais — e é aqui que a diferença dos três nichos
                        aparece sem precisar de campo por nicho. */}
                    <FormField label="Condições / observações do fornecedor">
                      <textarea maxLength={240}
                        className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-[42px] md:col-span-2"
                        value={extras.observacao}
                        onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))}
                        placeholder="Ex.: frete incluso; garantia de 12 meses; troca em até 7 dias" />
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        O que veio junto do preço. Duas propostas com o mesmo valor podem não ser a mesma compra.
                      </p>
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                      <Send size={14} /> Enviar ao Financeiro
                    </NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : enrichedFiltered.length === 0 ? <EmptyState message="Nenhuma cotação encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Requisição</th>
                  <th className="pb-4 font-bold px-4 text-center">Qtd</th>
                  <th className="pb-4 font-bold px-4">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                  <th className="pb-4 font-bold px-4">Prazo Entrega</th>
                  <th className="pb-4 font-bold px-4">Validade</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Feedback</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enrichedFiltered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200 min-w-[13rem]">
                        {/* A cotação tem número próprio e cita a requisição de
                            onde nasceu: as duas pontas da conversa entre Compras
                            e Financeiro numa linha só. */}
                        <span className="block font-mono text-[10px] text-accent/70 tracking-wider">
                          {numeroCotacao(item)}
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{item.req?.item ?? '—'}</span>
                          {/* Migr. 526: sem isto, duas propostas de marcas
                              diferentes apareciam como o mesmo item. */}
                          {item.marca && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white/5 text-gray-300 border border-white/10">
                              {item.marca}
                            </span>
                          )}
                          {item.req && (
                            <span className="block font-mono text-[10px] text-gray-600 tracking-wider">
                              {numeroRequisicao(item.req)}
                            </span>
                          )}
                          {item.requisicao_id && (propostasPorRequisicao.get(item.requisicao_id) ?? []).length > 1 && (
                            <button
                              onClick={() => setComparando(item.requisicao_id)}
                              title="Comparar propostas concorrentes"
                              className="neu-button px-2 py-0.5 rounded-full text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/10 border border-cyan-400/20 flex items-center gap-1"
                            >
                              <GitCompare size={10} />
                              {(propostasPorRequisicao.get(item.requisicao_id) ?? []).length} propostas
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-300 text-center tabular-nums">{item.req?.qtd ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 min-w-[9rem]">
                        <div className="flex flex-col gap-0.5">
                          <span>{item.forn?.nome ?? '—'}</span>
                          {desempenhoDisponivel && item.fornecedor_id && (
                            <SeloDesempenho d={desempenho[item.fornecedor_id]} compacto />
                          )}
                          {item.observacao && (
                            <span className="text-[10px] text-gray-500 line-clamp-2" title={item.observacao}>
                              {item.observacao}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-0.5">
                          <span>R$ {formatBRL(Number(item.valor_total ?? 0))}</span>
                          {/* Preço sem prazo é meia informação: o Financeiro
                              decide com os dois na mesma célula. */}
                          {item.condicao_pagamento && (
                            <span className="text-[10px] text-gray-500 font-sans">{item.condicao_pagamento}</span>
                          )}
                          {item.status === 'Aguardando Financeiro' && (() => {
                            const a = alcadaLabel(item);
                            return (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-widest border ${a.color}`}
                                title={alcadaLimite !== null ? `Alçada: limite Financeiro R$ ${formatBRL(alcadaLimite)}` : 'Alçada não configurada'}>
                                {a.label}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      {/* Prazo em vermelho quando passa da data em que a
                          requisição precisa do item: é o que separa a proposta
                          barata da proposta útil. */}
                      <td className="py-3 px-4 text-xs text-gray-400">
                        {item.prazo_entrega ? (
                          <span className={item.req?.data_necessidade && item.prazo_entrega > item.req.data_necessidade
                            ? 'text-red-400' : ''}
                            title={item.req?.data_necessidade
                              ? `Necessário até ${dataBR(item.req.data_necessidade)}` : undefined}>
                            {dataBR(item.prazo_entrega)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono whitespace-nowrap">
                        {item.validade ? (
                          <span className={propostaVencida(item.validade) && STATUS_VIVOS.has(item.status)
                            ? 'text-red-400 font-bold' : 'text-gray-500'}
                            title={propostaVencida(item.validade) && STATUS_VIVOS.has(item.status)
                              ? 'Preço vencido: o Financeiro não aprova. Devolva para Compras revalidar.' : undefined}>
                            {dataBR(item.validade)}
                            {propostaVencida(item.validade) && STATUS_VIVOS.has(item.status) && ' · vencida'}
                          </span>
                        ) : <span className="text-gray-500">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-xs max-w-xs">
                        {item.feedback
                          ? <span className="text-gray-400 italic line-clamp-2" title={item.feedback}>“{item.feedback}”</span>
                          : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {/* Os botões rotulados desta célula empurravam as oito
                            colunas da esquerda e quebravam o nome do item em
                            duas linhas: três rótulos ("Aprovar", "Reprovar",
                            "Devolver") somam mais largura do que a coluna de
                            ações merece. Abaixo de 2xl eles viram só o ícone,
                            com o mesmo `title` — o texto volta quando há tela
                            para ele. `opacity-0` também saiu: em tablet, sem
                            hover, os botões nunca apareciam. */}
                        <div className="flex justify-end items-center gap-1.5 flex-nowrap whitespace-nowrap opacity-60 group-hover:opacity-100 transition-opacity">
                          <HistoricoOperacoes entidade="cotacoes" entidadeId={item.id} titulo={`${numeroCotacao(item)} · ${item.req?.item ?? 'Cotação'}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                          {/* Aguardando Financeiro: gerente do Financeiro decide */}
                          {item.status === 'Aguardando Financeiro' && podeDecidirCotacao(item) && (
                            <>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                title="Aprovar a proposta"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-emerald-400 hover:bg-emerald-400/10">
                                <Check size={12} /> <span className="hidden 2xl:inline">Aprovar</span>
                              </button>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                title="Reprovar a proposta"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-red-400 hover:bg-red-400/10">
                                <X size={12} /> <span className="hidden 2xl:inline">Reprovar</span>
                              </button>
                              {/* Erro de digitação não é recusa do fornecedor:
                                  devolve para quem cadastrou em vez de matar a
                                  proposta (migr. 467). */}
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'devolver' }); setFeedbackInput(''); }}
                                title="Devolver para Compras corrigir — a proposta continua viva"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-amber-400 hover:bg-amber-400/10">
                                <CornerUpLeft size={12} /> <span className="hidden 2xl:inline">Devolver</span>
                              </button>
                            </>
                          )}
                          {/* Devolvida: quem cadastrou corrige e reenvia */}
                          {item.status === 'Em correção' && podeCorrigir(item) && (
                            <button onClick={() => abrirCorrecao(item)}
                              title="Corrigir e reenviar ao Financeiro"
                              className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-amber-400 hover:bg-amber-400/10 border border-amber-400/15">
                              <Pencil size={12} /> <span className="hidden 2xl:inline">Corrigir</span>
                            </button>
                          )}
                          {item.status === 'Em correção' && item.feedback && (
                            <button onClick={() => setFeedbackAberto(item.feedback)}
                              title="Ver o que pediram para corrigir"
                              className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-amber-400">
                              <MessageSquare size={12} />
                            </button>
                          )}
                          {/* Compras: cancelar enquanto a proposta está viva e
                              sem decisão — inclui a devolvida, senão a que
                              nasceu errada ficaria presa em correção. */}
                          {['Aguardando Financeiro', 'Em correção'].includes(item.status) && isCompras && (
                            <button onClick={() => handleCancelar(item.id)} title="Cancelar envio"
                              className="action-btn-warning">
                              <Ban size={12} />
                            </button>
                          )}
                          {/* Aprovado e ainda sem pedido → Compras gera */}
                          {item.status === 'Aprovado' && !cotacoesComPedido.has(item.id) && isCompras && (
                            <button onClick={() => handleGerarPedido(item)} disabled={generating === item.id}
                              title="Gerar o pedido de compra desta cotação"
                              className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-yellow-400 hover:bg-yellow-400/10 border border-yellow-400/15 disabled:opacity-50">
                              {generating === item.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingBag size={12} />}
                              <span className="hidden 2xl:inline">Gerar Pedido</span>
                            </button>
                          )}
                          {/* Negado com feedback longo: botão pra ver o motivo completo */}
                          {item.status === 'Negado' && item.feedback && (
                            <button onClick={() => setFeedbackAberto(item.feedback)}
                              title="Ver feedback completo"
                              className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-cyan-400">
                              <MessageSquare size={12} />
                            </button>
                          )}
                          {profile.role === 'admin' && (
                            <ExcluirAdmin endpoint="/api/cotacoesview" id={item.id}
                              rotulo={numeroCotacao(item)} showToast={showToast}
                              alternativa="cancele a cotação — ela sai da fila e o preço do fornecedor fica registrado."
                              onExcluido={() => reload()} />
                          )}
                          {/* Reabrir — só a direção, e só no que já saiu da fila */}
                          {podeReabrirDoc && ['Negado', 'Cancelado'].includes(item.status) && (
                            <button onClick={() => handleReabrirCot(item)} disabled={reabrindoCot === item.id}
                              title="Reabrir — volta para a fila do Financeiro"
                              className="action-btn-warning">
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}

      {/* Modal de comparação de propostas concorrentes (mesma requisição) */}
      <AnimatePresence>
        {comparando && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setComparando(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-gray-300">
                    Comparar propostas
                    <span className="text-accent ml-2">
                      — {requisicoes.find((r: any) => r.id === comparando)?.item ?? 'requisição'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {propostasDoModal.length} proposta(s) registrada(s). A menor entre as vivas está destacada —
                    confira a coluna de entrega antes de decidir só pelo preço.
                    {/* O alvo do prazo fica no cabeçalho da comparação, não só
                        na linha: é aqui que a escolha é feita. */}
                    {(() => {
                      const dn = requisicoes.find((r: any) => r.id === comparando)?.data_necessidade;
                      return dn ? <> Necessário até <span className="text-gray-300 font-bold">{dataBR(dn)}</span> — prazo em vermelho não chega a tempo.</> : null;
                    })()}
                  </p>
                </div>
                <button onClick={() => setComparando(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>

              {/* Modal tem altura travada em 85vh: aqui o scroll interno é o
                  certo, diferente da lista da página. */}
              <div className="overflow-auto main-scrollbar flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      <th className="pb-3 font-bold px-3">Fornecedor</th>
                      {/* Migr. 526: comparar preço sem ver a marca é comparar
                          coisas diferentes como se fossem a mesma. */}
                      <th className="pb-3 font-bold px-3">Marca</th>
                      <th className="pb-3 font-bold px-3 text-right">Valor</th>
                      <th className="pb-3 font-bold px-3">Pagamento</th>
                      <th className="pb-3 font-bold px-3">Entrega no prazo</th>
                      <th className="pb-3 font-bold px-3">Prazo</th>
                      <th className="pb-3 font-bold px-3">Validade</th>
                      <th className="pb-3 font-bold px-3 text-center">Status</th>
                      {podeDecidir && <th className="pb-3 font-bold px-3 text-right">Ação</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {propostasDoModal.map((c: any) => {
                      const isVivo = STATUS_VIVOS.has(c.status);
                      const isMenor = isVivo && menorPrecoDoModal !== null && Number(c.valor_total ?? 0) === menorPrecoDoModal;
                      return (
                        <tr key={c.id}
                          className={`border-b border-white/5 ${isMenor ? 'bg-emerald-400/5' : ''} ${!isVivo ? 'opacity-50' : ''}`}>
                          <td className="py-2.5 px-3 text-xs text-gray-200">
                            <div className="flex items-center gap-1.5">
                              {isMenor && <span title="Menor preço"><Award size={12} className="text-emerald-400 shrink-0" /></span>}
                              {c.forn?.nome ?? '—'}
                            </div>
                            {/* O menor preço pode ser o mais caro: frete e
                                garantia entram aqui, e é isto que separa duas
                                propostas de mesmo valor (migr. 583). */}
                            {c.observacao && (
                              <span className="block text-[10px] text-gray-500 mt-0.5 max-w-[16rem]">{c.observacao}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-300">
                            {c.marca || <span className="text-gray-600">—</span>}
                          </td>
                          <td className={`py-2.5 px-3 text-xs font-mono text-right tabular-nums ${isMenor ? 'text-emerald-300 font-bold' : 'text-gray-200'}`}>
                            R$ {formatBRL(Number(c.valor_total ?? 0))}
                          </td>
                          {/* O menor preço à vista pode custar mais caro que o
                              maior em 30/60/90 — quem paga a diferença é o
                              caixa da unidade. */}
                          <td className="py-2.5 px-3 text-xs text-gray-300">
                            {c.condicao_pagamento || <span className="text-gray-600">—</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            {desempenhoDisponivel && c.fornecedor_id
                              ? <SeloDesempenho d={desempenho[c.fornecedor_id]} />
                              : <span className="text-[10px] text-gray-600">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">
                            {c.prazo_entrega ? (
                              <span className={c.req?.data_necessidade && c.prazo_entrega > c.req.data_necessidade
                                ? 'text-red-400' : ''}>
                                {dataBR(c.prazo_entrega)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs font-mono">
                            {c.validade ? (
                              <span className={propostaVencida(c.validade) && STATUS_VIVOS.has(c.status)
                                ? 'text-red-400 font-bold' : 'text-gray-500'}>
                                {dataBR(c.validade)}
                                {propostaVencida(c.validade) && STATUS_VIVOS.has(c.status) && ' · vencida'}
                              </span>
                            ) : <span className="text-gray-500">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center"><StatusBadge status={c.status} /></td>
                          {podeDecidir && (
                            <td className="py-2.5 px-3 text-right">
                              {c.status === 'Aguardando Financeiro' && podeDecidirCotacao(c) && (
                                <button
                                  onClick={() => {
                                    setComparando(null);
                                    setDecisao({ cot: c, tipo: 'aprovar' });
                                    setFeedbackInput('');
                                  }}
                                  className="neu-button py-1 px-2.5 rounded-lg text-[11px] font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors inline-flex items-center gap-1"
                                >
                                  <Check size={10} /> Aprovar
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-4 shrink-0">
                <button onClick={() => setComparando(null)}
                  className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">
                  Fechar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de decisão do Financeiro */}
      <AnimatePresence>
        {decisao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !decidindo && setDecisao(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  {decisao.tipo === 'aprovar' ? 'Aprovar cotação'
                    : decisao.tipo === 'reprovar' ? 'Reprovar cotação'
                    : 'Devolver para correção'}
                  <span className="text-accent ml-2">— {decisao.cot.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !decidindo && setDecisao(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                {decisao.tipo === 'aprovar'
                  ? 'Aprovar enviará a cotação para o setor de Compras para gerar o pedido. Cotações concorrentes da mesma requisição serão automaticamente canceladas.'
                  : decisao.tipo === 'reprovar'
                  ? 'Informe o motivo da reprovação. O setor de Compras será notificado para ajustar e criar uma nova cotação.'
                  : 'A proposta volta para quem a cadastrou, que corrige e reenvia — nada é recusado e nenhuma concorrente é cancelada. Use quando o problema é o preenchimento (valor digitado errado, prazo em branco), não a oferta do fornecedor.'}
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cot-feedback" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {decisao.tipo === 'reprovar' ? 'Motivo da reprovação *'
                    : decisao.tipo === 'devolver' ? 'O que corrigir *'
                    : 'Observação (opcional)'}
                </label>
                <textarea id="cot-feedback" rows={3}
                  value={feedbackInput} onChange={e => setFeedbackInput(e.target.value)}
                  placeholder={decisao.tipo === 'reprovar'
                    ? 'Ex.: valor acima do orçamento previsto para este trimestre.'
                    : decisao.tipo === 'devolver'
                    ? 'Ex.: o valor está R$ 1.200,00 e a proposta do fornecedor é R$ 120,00 — confira a vírgula.'
                    : 'Ex.: prazo conforme combinado, fornecedor confiável.'}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setDecisao(null)} disabled={decidindo}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleConfirmDecisao} disabled={decidindo}>
                  {decidindo
                    ? 'Salvando...'
                    : decisao.tipo === 'aprovar' ? 'Confirmar aprovação'
                    : decisao.tipo === 'reprovar' ? 'Confirmar reprovação'
                    : 'Devolver para correção'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de correção — Compras arruma o que foi devolvido */}
      <AnimatePresence>
        {correcao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !reenviando && setCorrecao(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  Corrigir e reenviar
                  <span className="text-accent ml-2">— {correcao.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !reenviando && setCorrecao(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              {correcao.feedback && (
                <div className="neu-inset rounded-xl p-3 mb-4 border border-amber-400/15">
                  <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">O que pediram para corrigir</p>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{correcao.feedback}</p>
                </div>
              )}

              <p className="text-xs text-gray-500 mb-4">
                Fornecedor e requisição não mudam aqui: trocar de fornecedor é outra proposta, não
                correção desta. Ao reenviar, a cotação volta para a fila do Financeiro.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {qtdCorrecao > 0 && (
                  <FormField label="Quantidade solicitada">
                    <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                      {`${qtdBR(qtdCorrecao)} ${unidadeCorrecao}`}
                    </div>
                  </FormField>
                )}
                <FormField label={`Valor Unitário (R$${qtdCorrecao > 0 ? ` / ${unidadeCorrecao}` : ''})`}>
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.valor_unitario}
                    onChange={e => setCorrecaoUnitario(e.target.value)}
                    onKeyDown={handleMoneyKeyDown}
                    placeholder="0,00" />
                </FormField>
                <FormField label="Valor Total (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.valor_total}
                    onChange={e => setCorrecaoTotal(e.target.value)}
                    onKeyDown={handleMoneyKeyDown}
                    placeholder="0,00" />
                  {qtdCorrecao > 0 && (
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      É este valor que volta ao Financeiro. Frete ou desconto fechado entram aqui — o
                      unitário se ajusta ao preço médio.
                    </p>
                  )}
                </FormField>
                <FormField label="Prazo de Entrega">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.prazo_entrega}
                    onChange={e => setCorrecaoForm(x => ({ ...x, prazo_entrega: e.target.value }))} />
                </FormField>
                <FormField label="Validade da Proposta *">
                  <input type="date" min={todayBR()}
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.validade}
                    onChange={e => setCorrecaoForm(x => ({ ...x, validade: e.target.value }))} />
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    Reenviar é revalidar: confirme com o fornecedor até quando o preço vale.
                  </p>
                </FormField>
                {/* Migr. 526: só na eventual. Na reposição o campo nem existe
                    na proposta — a marca é do produto do catálogo. */}
                {!correcao.req?.produto_id && (
                  <FormField label="Marca oferecida">
                    <input list="marcas-conhecidas" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={correcaoForm.marca}
                      onChange={e => setCorrecaoForm(x => ({ ...x, marca: e.target.value }))}
                      placeholder="Ex.: Foxton" />
                  </FormField>
                )}
                <FormField label="Condição de pagamento *">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.condicao_pagamento}
                    onChange={e => setCorrecaoForm(x => ({ ...x, condicao_pagamento: e.target.value }))}>
                    {CONDICOES_PAGAMENTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormField>
                <div className="sm:col-span-3">
                  <FormField label="Condições / observações do fornecedor">
                    <textarea maxLength={240}
                      className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-[42px] w-full"
                      value={correcaoForm.observacao}
                      onChange={e => setCorrecaoForm(x => ({ ...x, observacao: e.target.value }))}
                      placeholder="Ex.: frete incluso; garantia de 12 meses" />
                  </FormField>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setCorrecao(null)} disabled={reenviando}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleReenviarCorrigida} isLoading={reenviando}>
                  <Send size={14} /> Reenviar ao Financeiro
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Vínculo com o catálogo (migr. 480) ──────────────────────────────
          O item chega aqui como a frase que o setor escreveu na requisição.
          Quem compra é que sabe — e é quem tem de dizer — qual item de catálogo
          é aquilo, porque é o código que entra no pedido. Feito isto, o pedido
          nasce amarrado, o Recebimento abre com o produto travado e ninguém
          cadastra nada na doca.

          Só aparece na compra Eventual: Reposição já veio do catálogo. */}
      <AnimatePresence>
        {vinculando && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !generating && setVinculando(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  Qual item do catálogo?
                  <span className="text-accent ml-2">— {vinculando.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !generating && setVinculando(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <div className="neu-inset rounded-xl p-3 mb-4 border border-white/5">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">O que a requisição pediu</p>
                <p className="text-xs text-gray-200">
                  {String(vinculando.req?.item ?? 'item').replace(/\s+/g, ' ').trim()}
                  {vinculando.req?.qtd != null && (
                    <span className="text-gray-500"> · {vinculando.req.qtd} {vinculando.req.unidade ?? ''}</span>
                  )}
                </p>
              </div>

              {/* A CATEGORIA do item (migr. 499) — a mesma separação que o SAP
                  faz entre item M de material e item D de serviço. Não é um
                  detalhe de cadastro: ela decide se aquilo tem saldo, se o
                  recebimento é entrada ou aceite, e se o custo vira estoque ou
                  despesa do período. Por isso é a primeira pergunta, e não um
                  filtro escondido dentro do select. */}
              <div className="flex gap-2 mb-4">
                {([
                  { key: 'produto' as const, rotulo: 'Material',
                    hint: 'entra no estoque' },
                  { key: 'servico' as const, rotulo: 'Serviço',
                    hint: 'não tem saldo — é aceite' },
                ]).map(op => (
                  <button key={op.key} type="button"
                    onClick={() => setCategoriaVinculo(op.key)}
                    className={`flex-1 py-2 px-3 rounded-xl text-left transition-colors border ${
                      categoriaVinculo === op.key
                        ? 'neu-pressed border-accent/40'
                        : 'neu-button border-transparent'}`}>
                    <span className={`block text-xs font-bold ${
                      categoriaVinculo === op.key ? 'text-accent' : 'text-gray-300'}`}>
                      {op.rotulo}
                    </span>
                    <span className="block text-[10px] text-gray-500 leading-tight mt-0.5">{op.hint}</span>
                  </button>
                ))}
              </div>

              {/* A unidade que o setor escolheu já responde a pergunta — dizer
                  isso em voz alta evita o clique errado, que é o que criava
                  "Manutenção do ar-condicionado" como mercadoria de estoque. */}
              {pediuServico(vinculando) && categoriaVinculo === 'produto' && (
                <p className="text-[11px] text-amber-300/90 leading-snug mb-3">
                  A requisição pediu na unidade <span className="font-bold">SV</span>, que é serviço.
                  Cadastrar isto como material faria o item ganhar saldo de estoque que nunca vai
                  existir — e o custo dele sumiria do resultado, esperando uma venda que não vem.
                </p>
              )}

              {categoriaVinculo === 'produto' ? (
              <FormField label="Produto do catálogo *">
                <select className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                  value={produtoVinculo}
                  onChange={e => setProdutoVinculo(e.target.value)}>
                  <option value="">
                    {produtosOrdenados.length === 0
                      ? 'Nenhum produto cadastrado nesta unidade'
                      : 'Selecione o produto...'}
                  </option>
                  {produtosOrdenados.map((pr: any) => (
                    <option key={pr.id} value={pr.id}>{pr.nome}</option>
                  ))}
                </select>
              </FormField>
              ) : (
              <FormField label="Serviço do catálogo *">
                <select className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                  value={servicoVinculo}
                  onChange={e => setServicoVinculo(e.target.value)}>
                  <option value="">
                    {servicosOrdenados.length === 0
                      ? 'Nenhum serviço cadastrado'
                      : 'Selecione o serviço...'}
                  </option>
                  {servicosOrdenados.map((sv: any) => (
                    <option key={sv.id} value={sv.id}>
                      {sv.nome}{sv.filial ? '' : ' — todas as unidades'}
                    </option>
                  ))}
                </select>
              </FormField>
              )}

              {categoriaVinculo === 'produto' ? (
              <p className="text-[11px] text-gray-500 leading-snug mt-3">
                O setor pede em português; quem compra amarra ao catálogo, porque é o código que
                entra no pedido. Feito isso, a carga chega com o item já definido e o Recebimento
                só confere — ninguém cadastra produto na doca.
                {/* Compra eventual é, por definição, o item que ainda não está no
                    catálogo — então este select vazio é o caso NORMAL dela, não o
                    excepcional. Mandar "cadastre e volte aqui" sem dizer onde o
                    vínculo se faz era o que obrigava a procurar o produto neste
                    mesmo select depois. Com a migr. 494 o cadastro já amarra, e
                    quem vai por lá não passa mais por este modal. */}
                <span className="block mt-1.5 text-gray-400">
                  Não está na lista? Vá em <span className="font-bold">Cadastros &gt; Produtos &gt; Novo</span> e,
                  no campo <span className="font-bold">Origem deste cadastro</span>, escolha esta requisição —
                  o produto já nasce amarrado a ela e este passo aqui deixa de aparecer.
                </span>
              </p>
              ) : (
              <p className="text-[11px] text-gray-500 leading-snug mt-3">
                Serviço contratado não vira mercadoria: não tem saldo, não tem lote e não tem
                validade. O “recebimento” dele é o <span className="text-gray-300 font-semibold">aceite</span> —
                alguém confirma que foi executado —, e é o aceite que libera o pagamento. O custo
                entra no resultado como despesa do período, no grupo do centro de custo que a
                requisição informou.
                <span className="block mt-1.5 text-gray-400">
                  Não está na lista? Cadastre em <span className="font-bold">Cadastros &gt; Serviços &gt; Novo</span>,
                  marcando a natureza <span className="font-bold">Contratado de terceiro</span>, e volte aqui.
                  Esta lista não mostra o que a unidade PRESTA: aquilo é o que ela vende ao cliente, não o
                  que ela compra.
                </span>
              </p>
              )}

              <p className="text-[11px] text-emerald-400/80 leading-snug mt-3">
                A requisição guarda esse vínculo: a próxima compra do mesmo item já nasce como
                Reposição, escolhida do catálogo, sem passar por aqui.
              </p>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setVinculando(null)} disabled={!!generating}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent
                  onClick={() => handleGerarPedido(vinculando, categoriaVinculo === 'servico'
                    ? { servicoId: servicoVinculo }
                    : { produtoId: produtoVinculo })}
                  isLoading={generating === vinculando.id}
                  disabled={categoriaVinculo === 'servico' ? !servicoVinculo : !produtoVinculo}>
                  <ShoppingBag size={14} /> Gerar Pedido
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {feedbackAberto && (
        <TextoModal titulo="Feedback do Financeiro" texto={feedbackAberto}
          onClose={() => setFeedbackAberto(null)} />
      )}
    </motion.div>
  );
};

export const CotacoesView = ({ showToast, profile, mode }: { showToast: any; profile: UserProfile; mode?: 'compras' | 'financeiro' }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A cotação com fornecedores" />;
  return <CotacoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} mode={mode} />;
};
