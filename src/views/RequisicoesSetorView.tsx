import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Send, Trash2, ClipboardList, ChevronRight, MessageSquareText, Search, Check, RotateCcw } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { FiltroSolicitante, chaveSolicitante } from '../components/FiltroSolicitante';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { supabase } from '../lib/supabase';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { FluxoCompra } from '../components/FluxoCompra';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, SelecioneUnidade, AbaComContador } from '../components/ui';
import { todayBR } from '../lib/dates';
import {
  unidadesDeRequisicao, exemploItemRequisicao, UNIDADES_FRACIONARIAS, normalizarUnidade,
  embalagemDoProduto, rotuloEmbalagem, pluralEmbalagem, rotuloUnidade, EMBALAGENS_COMPRA,
} from '../lib/unidades';
import { formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { temEstoque } from '../lib/tipoProduto';
import { ehContratado } from '../lib/naturezaServico';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';
import { semelhancaDeItem } from '../lib/similaridadeItem';

// Requisição de compra pela área que precisa do item (migr. 283).
//
// Antes só `compras` e `logistica` conseguiam abrir requisição — e a policy de
// SELECT nem deixava o autor de outro setor ver o próprio pedido. Na empresa é
// o contrário: quem precisa pede, Compras recebe e toca a cotação com o
// Financeiro. Esta tela mora em Empresa porque é o único módulo que todo setor
// enxerga, e é a **única** porta de criação — Compras também pede por aqui.
//
// O escopo é o **setor**, não o usuário (migr. 285). A requisição pertence à
// área que precisa do item: o centro de custo é dela, o orçamento é dela, a
// necessidade é dela. Quem digitou é autor, não dono. Escopar por autor fazia
// dois colegas do mesmo setor pedirem a mesma coisa sem se enxergar, e sumia
// com o pedido quando quem abriu entrava de férias. Por isso a lista não
// filtra por `criado_por` — RLS entrega o que o setor pediu, dentro da filial,
// e a coluna Solicitante diz quem foi.
//
// Os campos seguem o que uma requisição de compra tem no mercado: quem pediu,
// de que setor, para qual centro de custo, por quê, para quando, e a lista de
// itens com quantidade e unidade. Solicitante e setor não são digitados: vêm
// do usuário autenticado (o banco os grava de novo, ignorando a tela).
//
// O item é **texto livre**, de propósito. Quem requisita descreve a
// necessidade — "papel A4 75g", "troca do compressor da câmara fria" — e não
// precisa saber se aquilo já existe no cadastro. Casar a descrição com o
// catálogo, ou cadastrar o que falta, é trabalho de Compras na cotação. O
// catálogo entra só como sugestão (datalist), nunca como camisa de força.

// Três tipos, como na empresa (migr. 358):
//
//   • Reposição — item do catálogo que acabou ou bateu o mínimo. Escolhe-se da
//     lista, **sem justificativa escrita**: o motivo é o saldo, e o sistema
//     grava saldo e mínimo do momento. É o que o comprador lê para decidir.
//   • Compra eventual — ainda não existe no catálogo. Descrição livre e
//     justificativa obrigatória: aqui o comprador não tem histórico nenhum, e o
//     texto é o que decide. Quem requisita NÃO cadastra produto (nem tem acesso
//     a Cadastros): o texto é amarrado ao catálogo por Compras na geração do
//     pedido (migr. 480), e o vínculo volta para a requisição — a compra
//     seguinte do mesmo item já nasce Reposição.
//     Serviço entra por aqui também (migr. 499): manutenção, frete, licença,
//     dedetização. Basta escolher a unidade SV na linha — o pedido tem duas
//     categorias de item, material e serviço, e quem compra amarra ao catálogo
//     de Serviços em vez do de Produtos. Por um tempo esta tela não convidou
//     para isso, e com razão: `gerar_pedido_de_cotacao` só sabia apontar para
//     `produtos`, então a requisição de serviço travava no Gerar Pedido sem
//     saída nenhuma. Agora tem.
//   • Material do estoque — já existe no almoxarifado. O Estoque libera a
//     saída; não passa por Compras.
//
// A separação é a do mercado. Antes tudo caía em "Compra" com justificativa
// obrigatória, e o resultado foi um envio de 18 itens de prateleira repetindo
// "nao temos ou acabou" — que era o texto do hint desta própria tela. Campo
// que se preenche para o botão liberar não informa ninguém.
type TipoReq = 'reposicao' | 'eventual' | 'estoque';

/** Os dois que viram requisição de compra. */
const VAI_PRA_COMPRAS = (t: TipoReq) => t === 'reposicao' || t === 'eventual';

// A lista saiu daqui: era minúscula enquanto o catálogo é maiúsculo, e a
// Reposição (que lê a unidade do produto) fez `un` e `UN` conviverem na mesma
// coluna. Agora vem de `src/lib/unidades.ts`, por filial — KG/L/M são de
// mercearia, e só o SuperMax vende assim.

// `justificativa` vazia = "usa a do cabeçalho". Cada linha vira uma requisição
// própria no banco (migr. 283), então cada uma pode ter o seu motivo — o
// cabeçalho é só o padrão de quem pede várias coisas pela mesma razão
// (migr. 354).
let seqLinha = 0;
// `embalagem`/`fator` vazios = pedido na unidade solta, que é o caso comum.
// Na eventual não há catálogo de onde tirar o fator (migr. 591): quem pede
// declara, e a declaração é o documento que Compras vai cotar.
const linhaVazia = () => ({
  uid: ++seqLinha, item: '', marca: '', qtd: '1', unidade: 'UN', justificativa: '',
  embalagem: '', fator: '',
});

const RequisicoesSetorViewInner = ({ showToast, profile, filial }: { showToast: any; profile: UserProfile; filial: FilialOp }) => {
  // Sem filtro por autor: o recorte é o setor, e quem faz esse recorte é a
  // RLS (migr. 285). Repetir o filtro aqui reintroduziria pela tela o mesmo
  // buraco que a migração fechou no banco.
  const { data, setData, isLoading } = useFetchData<any>(
    '/api/requisicoesview', { filial }, true,
  );
  const { data: reqEstoque, setData: setReqEstoque, isLoading: loadingEst } = useFetchData<any>(
    '/api/requisicoesestoqueview', { filial }, true,
  );
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });
  // Serviços contratados, para o aviso da linha SV (ver `noCatalogoParecidos`).
  // Sem filtro de filial no fetch: serviço sem unidade vale para todas.
  const { data: servicosCat } = useFetchData<any>('/api/servicosview');
  const { data: centrosCusto } = useFetchData<any>('/api/centroscustoview');

  const confirm = useConfirm();

  const [tipo, setTipo] = useState<TipoReq>('reposicao');
  const [estoqueForm, setEstoqueForm] = useState({ produto_id: '', qtd: '1', destino: '', centro_custo_id: '' });
  // Reposição: catálogo com multi-seleção. `Map<produto_id, qtd>` porque a
  // ordem não importa e a pergunta que a tela faz o tempo todo é "este já está
  // no carrinho?".
  const [repo, setRepo] = useState<Map<string, string>>(new Map());
  const [buscaCat, setBuscaCat] = useState('');
  const [soAbaixoMin, setSoAbaixoMin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [cab, setCab] = useState({
    urgencia: 'Normal', centro_custo: '', justificativa: '', data_necessidade: '',
  });
  const [itens, setItens] = useState([linhaVazia()]);
  const [saving, setSaving] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [detalhe, setDetalhe] = useState<string | null>(null);

  // O nome do item NÃO tem lista de sugestões, e isso é de propósito: compra
  // eventual é justamente o que o catálogo não tem. Oferecer os nomes do
  // cadastro empurrava o aluno a escolher um produto que já existe — e item
  // que já existe se pede por Reposição, com saldo e código. A marca é o
  // contrário: ela se repete entre produtos diferentes, então lá a lista
  // aproveita o que a empresa já compra.

  // Marcas que a empresa já compra. Mesma lógica do nome: o campo é livre
  // (a marca certa pode ser uma que nunca se comprou), a lista só evita que
  // "Foxton" vire "foxton" na segunda vez e que Compras leia duas coisas
  // diferentes onde há uma.
  const marcasConhecidas = useMemo(() => {
    const set = new Set<string>();
    for (const p of produtos as any[]) {
      const m = String(p?.marca ?? '').trim();
      if (m) set.add(m);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  // Catálogo para reposição: tudo que está ativo, inclusive com saldo zero —
  // saldo zero é justamente o que mais se repõe. `abaixoMin` é o ponto de
  // pedido, e ordena a lista: quem furou o mínimo aparece primeiro, porque é
  // essa a pergunta que a reposição responde.
  const catalogoRepo = useMemo(() => {
    const termo = buscaCat.trim().toLowerCase();
    return [...produtos]
      // Patrimônio não se repõe (migr. 440). Consumo sim — é a reposição de
      // resma e material de limpeza, que antes não tinha como ser cadastrada.
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo' && temEstoque(p.tipo))
      .map((p: any) => {
        const saldo = Number(p.estoque ?? 0);
        const minimo = Number(p.estoque_minimo ?? 0);
        return { ...p, saldo, minimo, abaixoMin: minimo > 0 && saldo <= minimo };
      })
      .filter((p: any) => !soAbaixoMin || p.abaixoMin)
      .filter((p: any) => !termo
        || String(p.nome ?? '').toLowerCase().includes(termo)
        || String(p.codigo ?? '').toLowerCase().includes(termo))
      .sort((a: any, b: any) =>
        Number(b.abaixoMin) - Number(a.abaixoMin)
        || String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR'));
  }, [produtos, buscaCat, soAbaixoMin]);

  // Compra eventual de item que JÁ está no catálogo (24/09). Em Compras, a
  // requisição de texto livre só vira pedido depois de ligada a um produto, e
  // o nome escrito raramente bate com o cadastrado — então quem pedia
  // "Detergente Ypê 500ml" com "DETERGENTE YPÊ NEUTRO 500ML" no catálogo
  // mandava Compras cadastrar uma duplicata. O aviso aparece aqui, onde a
  // decisão é barata: é o mesmo produto → vai para a Reposição, com código.
  //
  // A régua é `semelhancaDeItem`, a mesma do aviso de requisição duplicada:
  // conservadora de propósito (medida diferente nunca casa, e cada lado com
  // uma palavra própria também não). O aviso não trava nada — pedir por
  // Eventual continua valendo quando o item é outro.
  const catalogoAtivo = useMemo(
    () => (produtos as any[]).filter(p => (p.status ?? 'Ativo') !== 'Inativo' && temEstoque(p.tipo)),
    [produtos]);
  // Serviço não tem Reposição: ele é pedido sempre como texto e se liga ao
  // catálogo pelo NOME IDÊNTICO (migr. 628). Então o aviso aqui oferece trocar
  // o texto da linha pelo nome cadastrado — "Dedetização mensal" vira
  // "Dedetização", e Compras gera o pedido sem cadastrar o serviço de novo.
  const servicosContratados = useMemo(
    () => (servicosCat as any[]).filter(sv =>
      ehContratado(sv.natureza) && (sv.filial == null || sv.filial === filial)
      && (sv.status ?? 'Ativo') !== 'Inativo'),
    [servicosCat, filial]);
  const noCatalogoParecidos = (texto: string, servico = false) => {
    if (String(texto ?? '').trim().length < 4) return [];
    return (servico ? servicosContratados : catalogoAtivo)
      .map(p => ({ p, s: semelhancaDeItem(texto, p.nome) }))
      .filter(x => x.s !== 'nao')
      .sort((x, y) => (x.s === 'igual' ? 0 : 1) - (y.s === 'igual' ? 0 : 1))
      .slice(0, 3);
  };
  const moverParaReposicao = (i: number, produto: any) => {
    const row = itens[i];
    setRepo(m => new Map(m).set(produto.id, row?.qtd && row.qtd !== '0' ? row.qtd : '1'));
    setItens(rows => rows.length <= 1 ? [linhaVazia()] : rows.filter((_, idx) => idx !== i));
    setTipo('reposicao');
    setErros({});
    const sobram = itens.filter((r, idx) => idx !== i && r.item.trim()).length;
    showToast(
      `"${produto.nome}" foi marcado na Reposição.` +
      (sobram > 0 ? ` As outras ${sobram} linha(s) continuam em Compra eventual — envie cada tipo separado.` : ''),
      'success', true);
  };

  // O nicho entra por aqui e só por aqui: mercearia compra por peso e volume,
  // loja de roupa e de eletrônico não. O formulário em si é o mesmo nas três —
  // requisição de compra é documento corporativo único.
  const unidadesReq = useMemo(() => unidadesDeRequisicao(filial), [filial]);

  // Quantidade fracionária atravessa a cadeia de compra desde a migr. 439. Cada
  // linha decide sozinha: a unidade da linha (compra eventual) ou a do produto
  // (reposição e material de almoxarifado) é que diz se cabe vírgula. Meia caixa
  // não existe; meio quilo é o dia a dia da mercearia.
  const ehFracionaria = (u: string | null | undefined) =>
    UNIDADES_FRACIONARIAS.has(normalizarUnidade(u));

  const unidadeEstoqueSel = useMemo(() => {
    const p = produtos.find((x: any) => x.id === estoqueForm.produto_id);
    return p ? normalizarUnidade(p.unidade) : '';
  }, [produtos, estoqueForm.produto_id]);
  const estoqueFrac = ehFracionaria(unidadeEstoqueSel);

  const qtdAbaixoMin = useMemo(
    () => produtos.filter((p: any) => {
      const min = Number(p.estoque_minimo ?? 0);
      return (p.status ?? 'Ativo') !== 'Inativo' && min > 0 && Number(p.estoque ?? 0) <= min;
    }).length,
    [produtos],
  );

  // Só se pede do almoxarifado o que o almoxarifado tem.
  const produtosEmEstoque = useMemo(
    () => [...produtos]
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo'
        && temEstoque(p.tipo) && Number(p.estoque ?? 0) > 0)
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [produtos],
  );

  // Uma lista só, como o setor enxerga: "o que a gente pediu". O tipo vira
  // rótulo, e não duas telas que alguém teria de lembrar de visitar.
  const pedidos = useMemo(() => {
    const compras = data.map((r: any) => ({
      // `tipo_requisicao` é NULL nas linhas abertas antes da migr. 358 — elas
      // aparecem como 'Compra', sem fingir que sabemos o que eram.
      id: r.id, tipo: (r.tipo_requisicao === 'Reposição' ? 'reposicao' : 'eventual') as TipoReq,
      tipoLabel: r.tipo_requisicao ?? 'Compra',
      item: r.item, marca: r.marca ?? null, qtd: r.qtd, unidade: r.unidade,
      numero: numeroRequisicao(r),
      complemento: r.centro_custo, prazo: r.data_necessidade, urgencia: r.urgencia ?? 'Normal',
      abertura: r.data ?? (r.created_at ?? '').slice(0, 10), status: r.status,
      // `abertura` é só a data, e o rodapé do histórico quer data e hora.
      criadoEm: r.created_at, atualizadoEm: r.updated_at,
      justificativa: r.justificativa, solicitante: r.solicitante,
      saldo: r.saldo_no_pedido, minimo: r.minimo_no_pedido,
      // Migr. 589: `qtd` é sempre a medida de estoque; estes três dizem que a
      // conversa foi em fardo, e com que fator NAQUELE dia.
      qtdEmb: r.qtd_embalagens, embNome: r.embalagem_nome, embFator: r.embalagem_fator,
      // Devolvida pelo gerente (migr. 517): o motivo vem na própria requisição,
      // porque o solicitante não enxerga `aprovacoes_compras`.
      correcaoMotivo: r.correcao_motivo ?? null,
      criadoPor: r.criado_por ?? null,
      centroCusto: r.centro_custo ?? '',
    }));
    const materiais = reqEstoque.map((r: any) => ({
      id: r.id, tipo: 'estoque' as TipoReq, tipoLabel: 'Estoque', numero: null as string | null,
      item: produtos.find((p: any) => p.id === r.produto_id)?.nome ?? 'Produto',
      // Material sai do estoque da casa: a marca é a do produto cadastrado.
      marca: produtos.find((p: any) => p.id === r.produto_id)?.marca ?? null,
      // 'UN' fixo mentia para o queijo: `requisicoes_estoque` não guarda unidade
      // porque a unidade é a do produto pedido. Lê de lá.
      qtd: r.qtd,
      unidade: normalizarUnidade(produtos.find((p: any) => p.id === r.produto_id)?.unidade),
      complemento: r.destino, prazo: null, urgencia: 'Normal',
      abertura: (r.created_at ?? '').slice(0, 10), status: r.status,
      criadoEm: r.created_at, atualizadoEm: r.updated_at,
      justificativa: null, solicitante: r.solicitante,
      saldo: null as number | null, minimo: null as number | null,
      // Material sai do almoxarifado da casa: não se pede em fardo o que já
      // está aberto na prateleira. Nulos para a lista ter uma forma só.
      qtdEmb: null as number | null, embNome: null as string | null, embFator: null as number | null,
      // Devolvida (migr. 522, espelha a 517 de compra): o motivo vem na
      // própria requisição, porque o solicitante não enxerga `aprovacoes_estoque`.
      correcaoMotivo: r.correcao_motivo ?? null,
      criadoPor: r.criado_por ?? null,
      centroCusto: '',
      destino: r.destino ?? '',
    }));
    return [...compras, ...materiais].sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)));
  }, [data, reqEstoque, produtos]);

  const centrosOrdenados = useMemo(
    () => [...centrosCusto]
      .filter((c: any) => (c.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [centrosCusto],
  );

  // Requisição devolvida pelo gerente (migr. 517). Quem abriu corrige aqui e
  // reenvia — o mesmo documento volta para a fila de aprovação, sem virar
  // requisição nova. Antes disso o solicitante não tinha saída nenhuma: Negar
  // era terminal, e a policy não lhe dá UPDATE em `requisicoes`.
  const [corrigindo, setCorrigindo] = useState<any | null>(null);

  // Nada disto está gravado: um lote de dez linhas digitadas à mão, ou a
  // correção que o gerente devolveu, some inteiro se a PWA recarregar por
  // baixo. Enquanto houver formulário com conteúdo, a versão nova espera.
  const rascunhoAberto =
    (showForm && (repo.size > 0 || itens.some(r => r.item.trim() !== '' || r.marca.trim() !== '' || r.justificativa.trim() !== '')))
    || corrigindo != null;
  useTravaAtualizacao(rascunhoAberto, 'requisicao-rascunho', 'há uma requisição aberta sem enviar');
  const [corrForm, setCorrForm] = useState({
    item: '', marca: '', qtd: '1', unidade: '', justificativa: '',
    urgencia: 'Normal', centro_custo: '', data_necessidade: '',
  });
  // Reposição tem produto do catálogo: ali a marca é do cadastro, e a RPC
  // ignora o que a tela mandar (migr. 582). Só a eventual digita marca.
  const corrEhEventual = corrigindo?.tipo === 'eventual';
  // Material não tem item, unidade, urgência, centro de custo nem prazo — só
  // quantidade e destino (`requisicoes_estoque` não guarda os outros campos,
  // e corrigir o produto trocaria o documento por outro). Formulário próprio
  // em vez de forçar `corrForm` a fingir campos que não existem.
  const [corrFormEstoque, setCorrFormEstoque] = useState({ qtd: '1', destino: '' });
  const [reenviando, setReenviando] = useState(false);
  const corrFrac = UNIDADES_FRACIONARIAS.has(normalizarUnidade(corrForm.unidade));

  // Quem corrige a devolvida: quem a abriu — e mais ninguém do setor. Requisição
  // é documento do setor para LER; para escrever, a autoria é de quem escreveu.
  //
  // Gerente e Matriz entram junto porque a RPC os aceita (migr. 517) e porque
  // sem eles a fila trava quando o autor falta na aula seguinte: a requisição
  // fica 'Em correção' para sempre, e o colega que enxerga o documento não tem
  // como destravar. A tela escondia o botão até deles — o banco permitia e a
  // interface não oferecia.
  const podeCorrigir = (r: any) =>
    !r.criadoPor
    || r.criadoPor === profile?.id
    || profile?.role === 'admin'
    || profile?.role === 'ceo'
    || profile?.role === 'gerente'
    || isConselheiro(profile);

  const abrirCorrecao = (r: any) => {
    setCorrigindo(r);
    if (r.tipo === 'estoque') {
      setCorrFormEstoque({ qtd: qtdBR(r.qtd ?? 1), destino: r.complemento ?? '' });
      return;
    }
    const bruta = data.find((x: any) => x.id === r.id);
    setCorrForm({
      item:             r.item ?? '',
      marca:            r.marca ?? '',
      qtd:              qtdBR(r.qtd ?? 1),
      unidade:          normalizarUnidade(r.unidade) || '',
      justificativa:    r.justificativa ?? '',
      urgencia:         r.urgencia ?? 'Normal',
      centro_custo:     r.centroCusto ?? '',
      data_necessidade: bruta?.data_necessidade ?? r.prazo ?? '',
    });
  };

  const handleReenviarEstoque = async () => {
    if (!corrigindo || !supabase) return;
    const qtd = parseQtd(corrFormEstoque.qtd);
    if (!(qtd > 0)) { showToast('A quantidade tem de ser maior que zero.', 'error', true); return; }
    const original = (reqEstoque as any[]).find(r => r.id === corrigindo.id);
    if (!await confirmarDuplicataEstoque(original?.produto_id, corrigindo.id)) return;
    setReenviando(true);
    try {
      const { data: res, error } = await supabase.rpc('reenviar_requisicao_estoque_corrigida', {
        p_id:      corrigindo.id,
        p_qtd:     qtd,
        p_destino: corrFormEstoque.destino || null,
      });
      if (error) throw error;
      const atualizada: any = Array.isArray(res) ? res[0] : res;
      setReqEstoque((prev: any[]) => prev.map(d => d.id === corrigindo.id ? (atualizada ?? d) : d));
      showToast('Requisição corrigida e reenviada — está de volta na fila de quem decide.', 'success', true);
      setCorrigindo(null);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reenviar.', 'error', true);
    } finally {
      setReenviando(false);
    }
  };

  const handleReenviar = async () => {
    if (!corrigindo || !supabase) return;
    if (corrigindo.tipo === 'estoque') return handleReenviarEstoque();
    const qtd = parseQtd(corrForm.qtd);
    if (!corrForm.item.trim()) { showToast('Diga o que está sendo pedido.', 'error', true); return; }
    if (!(qtd > 0))            { showToast('A quantidade tem de ser maior que zero.', 'error', true); return; }
    // O `produto_id` da linha original viaja junto: numa Reposição corrigida
    // ele é o código, e sem ele a conferência cairia no casamento por texto —
    // que ignora de propósito quem TEM código, deixando passar exatamente a
    // irmã que a devolução costuma provocar.
    const originalCompra = (data as any[]).find(d => d.id === corrigindo.id);
    if (!await confirmarDuplicatas(
      [{ nome: corrForm.item, produtoId: originalCompra?.produto_id ?? null }],
      corrigindo.id,
    )) return;
    setReenviando(true);
    try {
      const { data: res, error } = await supabase.rpc('reenviar_requisicao_corrigida', {
        p_id:               corrigindo.id,
        p_item:             corrForm.item,
        // String vazia limpa a marca de propósito: voltar para "qualquer
        // marca" é decisão, e a RPC distingue isso de "não mexi" (NULL).
        p_marca:            corrEhEventual ? corrForm.marca.trim() : null,
        p_qtd:              qtd,
        p_unidade:          corrForm.unidade || null,
        p_justificativa:    corrForm.justificativa || null,
        p_urgencia:         corrForm.urgencia || null,
        p_centro_custo:     corrForm.centro_custo || null,
        p_data_necessidade: corrForm.data_necessidade || null,
      });
      if (error) throw error;
      const atualizada: any = Array.isArray(res) ? res[0] : res;
      setData((prev: any[]) => prev.map(d => d.id === corrigindo.id ? (atualizada ?? d) : d));
      showToast('Requisição corrigida e reenviada — está de volta na fila do gerente.', 'success', true);
      setCorrigindo(null);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reenviar.', 'error', true);
    } finally {
      setReenviando(false);
    }
  };

  // ── Abas por situação ─────────────────────────────────────────────────────
  //
  // A lista era uma só, em ordem de abertura, com tudo dentro: o que espera o
  // gerente, o que ele aprovou, o que virou pedido, o que ele negou e o que
  // voltou para conserto. Numa turma que abre requisição em lote isso passa de
  // cem linhas no primeiro dia — e a devolvida, que é a única que exige ação
  // AGORA, ficava enterrada no meio, indistinguível.
  //
  // "Atendidas" tem aba própria mesmo não tendo sido pedida: sem ela, a
  // requisição que virou pedido sumiria da tela do setor que a abriu — e é
  // justamente ali que o aluno vai procurar para saber se a compra andou.
  const ABAS = [
    // `cor` é o significado da fila (ver AbaComContador em ui.tsx): corrigir
    // pede ação, pendente espera o gerente, aprovada seguiu, atendida já é
    // pedido (encerrada), negada parou. Pendente é laranja (pedido do
    // professor); azul se confundia com o "Minhas planilhas" da mesma barra.
    { key: 'corrigir',  label: 'Para corrigir', status: ['Em correção'], cor: 'amarelo' },
    { key: 'pendentes', label: 'Pendentes',     status: ['Pendente'],    cor: 'laranja' },
    { key: 'aprovadas', label: 'Aprovadas',     status: ['Aprovado'],    cor: 'verde' },
    { key: 'atendidas', label: 'Atendidos',     status: ['Atendida'],    cor: 'cinza' },
    { key: 'negadas',   label: 'Negadas',       status: ['Negado'],      cor: 'vermelho' },
  ] as const;
  type AbaKey = typeof ABAS[number]['key'];

  const porAba = useMemo(() => {
    const mapa = Object.fromEntries(ABAS.map(a => [a.key, [] as any[]])) as Record<AbaKey, any[]>;
    const outras: any[] = [];
    for (const r of pedidos) {
      const aba = ABAS.find(a => (a.status as readonly string[]).includes(String(r.status)));
      if (aba) mapa[aba.key].push(r);
      // Status que nenhuma aba cobre (legado, ou fluxo do almoxarifado com
      // vocabulário próprio) não pode sumir da tela: cai em Pendentes, que é
      // onde alguém ainda olha.
      else outras.push(r);
    }
    mapa.pendentes = [...mapa.pendentes, ...outras];
    return mapa;
  }, [pedidos]);

  // Quantas devolvidas ESTE usuário pode consertar. É o que acende o ponto na
  // aba — o total de linhas a própria lista mostra.
  const minhasParaCorrigir = useMemo(
    () => porAba.corrigir.filter(r => podeCorrigir(r)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [porAba],
  );

  // Abre onde há trabalho. Só uma vez: depois disso quem manda é o clique.
  const [aba, setAba] = useState<AbaKey | null>(null);
  const abaAtiva: AbaKey = aba ?? (porAba.corrigir.length > 0 ? 'corrigir' : 'pendentes');
  // ── Filtro por solicitante (2026-09-01) ─────────────────────────
  //
  // Não confundir com o comentário lá em cima: o RECORTE continua sendo o do
  // setor, feito pela RLS. Isto aqui é leitura — o gerente do setor estreita a
  // lista que já é dele para conferir o que uma pessoa mandou, e quantas.
  const [solicitante, setSolicitante] = useState<string | null>(null);
  const casaSolicitante = (nome: unknown) =>
    solicitante === null || chaveSolicitante(nome) === solicitante;
  const visiveis = porAba[abaAtiva].filter(r => casaSolicitante(r.solicitante));

  const addLinha    = () => setItens(rows => [...rows, linhaVazia()]);
  const removeLinha = (i: number) => setItens(rows => rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i));
  const updateLinha = (i: number, patch: Partial<{ item: string; marca: string; qtd: string; unidade: string; justificativa: string; embalagem: string; fator: string }>) =>
    setItens(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  // Quais linhas estão com campo de motivo próprio aberto. Fica fora do estado
  // do item porque é visibilidade de UI, não dado da requisição: fechar o campo
  // apaga o texto, e é isso que "voltar a usar o motivo geral" quer dizer.
  // Chaveado por `uid` e não por índice — remover a linha 1 não pode transferir
  // o campo aberto para quem era a linha 2.
  const [justAberta, setJustAberta] = useState<Record<number, boolean>>({});
  const toggleJust = (i: number, uid: number) => {
    setJustAberta(m => ({ ...m, [uid]: !m[uid] }));
    if (justAberta[uid]) updateLinha(i, { justificativa: '' });
  };

  const closeForm = () => {
    setShowForm(false);
    setCab({ urgencia: 'Normal', centro_custo: '', justificativa: '', data_necessidade: '' });
    setItens([linhaVazia()]);
    setJustAberta({});
    setEstoqueForm({ produto_id: '', qtd: '1', destino: '', centro_custo_id: '' });
    setRepo(new Map());
    setRepoEmb(new Set());
    setBuscaCat('');
    setSoAbaixoMin(false);
    setErros({});
  };

  const toggleRepo = (id: string) => setRepo(m => {
    const n = new Map(m);
    if (n.has(id)) n.delete(id); else n.set(id, '1');
    return n;
  });
  const setQtdRepo = (id: string, qtd: string) => setRepo(m => new Map(m).set(id, qtd));

  // Em que medida a linha está pedindo (migr. 589): na unidade de estoque, ou
  // em embalagem fechada. Set à parte do `repo` de propósito — a quantidade
  // digitada é a mesma caixa de texto nos dois modos, e o que muda é só como o
  // número é lido. Desmarcar o item não limpa a escolha: quem remarca costuma
  // ser quem se enganou no clique.
  const [repoEmb, setRepoEmb] = useState<Set<string>>(new Set());
  const setModoRepo = (id: string, emFardo: boolean) => setRepoEmb(s => {
    const n = new Set(s);
    if (emFardo) n.add(id); else n.delete(id);
    return n;
  });

  // Material do almoxarifado: sai do que já existe, então o produto vem do
  // catálogo — e o Estoque é quem libera (migr. 284).
  const handleEnviarEstoque = async () => {
    if (!estoqueForm.produto_id) {
      setErros({ produto_id: 'Escolha o produto' });
      return;
    }
    if (!supabase) return;
    setSaving(true);
    try {
      const { data: saved, error } = await supabase.rpc('criar_requisicao_estoque', {
        p_produto_id:  estoqueForm.produto_id,
        p_solicitante: profile.nome,
        p_qtd:         parseQtd(estoqueForm.qtd) || 1,
        p_destino:     estoqueForm.destino.trim() || null,
        p_filial:      filial,
        // Migr. 442: o que sai do almoxarifado vira despesa no centro de custo
        // de quem pediu. Vazio é aceito — cai em "Não classificado" no DRE.
        p_centro_custo_id: estoqueForm.centro_custo_id || null,
      });
      if (error) { showToast(error.message, 'error', true); return; }
      if (saved) setReqEstoque((prev: any[]) => [saved, ...prev]);
      closeForm();
      showToast('Pedido de material enviado — o Estoque libera a saída.', 'success', true);
    } catch (err: any) {
      showToast(`Erro ao enviar: ${err?.message ?? err}`, 'error', true);
    } finally {
      setSaving(false);
    }
  };

  // Nenhuma requisição nasce sem motivo — mas o motivo pode vir do item ou do
  // cabeçalho. Se toda linha se explica sozinha, o campo geral pode ficar
  // vazio; basta uma linha sem motivo próprio para ele voltar a ser obrigatório.
  const cabJustObrigatoria = itens.some(r => !r.justificativa.trim());

  const validarReposicao = (): boolean => {
    const e: Record<string, string> = {};
    if (repo.size === 0) e.repo = 'Escolha ao menos um item do catálogo';
    if (!cab.data_necessidade) e.data_necessidade = 'Obrigatório';
    else if (cab.data_necessidade < todayBR()) e.data_necessidade = 'Não pode ser no passado';
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const validar = (): boolean => {
    const e: Record<string, string> = {};
    const cabJust = cab.justificativa.trim();
    if (cabJustObrigatoria && cabJust.length < 10) {
      e.justificativa = cabJust.length === 0 && itens.length > 1
        ? 'Explique o motivo geral, ou dê um motivo próprio a cada item'
        : 'Explique por que o item é necessário (mín. 10 caracteres)';
    }
    if (!cab.data_necessidade) e.data_necessidade = 'Obrigatório';
    else if (cab.data_necessidade < todayBR()) e.data_necessidade = 'Não pode ser no passado';
    itens.forEach((r, i) => {
      if (!r.item.trim()) e[`item_${i}`] = 'Descreva o item';
      const j = r.justificativa.trim();
      if (j.length > 0 && j.length < 10) e[`just_${i}`] = 'Mín. 10 caracteres';
      // Migr. 591: embalagem declarada tem de vir completa. A RPC recusa os
      // mesmos casos; aqui o aluno descobre antes de enviar seis linhas.
      if (r.embalagem) {
        const f = parseQtd(r.fator);
        if (r.unidade === 'SV') {
          e[`fator_${i}`] = 'Serviço não vem em embalagem fechada';
        } else if (f <= 1) {
          e[`fator_${i}`] = `Quantas ${r.unidade} em cada ${r.embalagem.toLowerCase()}? Mais de uma.`;
        } else if (!ehFracionaria(r.unidade) && f % 1 !== 0) {
          e[`fator_${i}`] = `A unidade ${r.unidade} não aceita meia`;
        }
      }
    });
    setErros(e);
    return Object.keys(e).length === 0;
  };

  // Já existe requisição VIVA para este item? (2026-08-24)
  //
  // A queixa do gerente foi "devolvo para correção e volta outra igual, como se
  // duplicasse". Não duplica: é documento novo. O que faltava era isto — nada
  // avisava que o setor já tinha um pedido vivo daquele item. Na turma ERP deu
  // "Controle DualSense" em quádruplo e "Notebook IdeaPad" em triplo, e em dois
  // casos quem reabriu não foi nem o autor do original: foi o COLEGA de setor,
  // que via a linha parada e não sabia que ela estava com alguém.
  //
  // Aviso, não trava: comprar duas vezes o mesmo item é legítimo (reposição de
  // consumo, lote adicional). Quem decide é quem está pedindo — mas decide
  // sabendo, e com o número do documento na mão.
  const normalizarItem = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const VIVAS = new Set(['Pendente', 'Aprovado', 'Em correção']);

  /**
   * As duas chaves, nesta ordem: CÓDIGO primeiro, texto só onde não há código.
   *
   * `produto_id` é o código — a etiqueta que o aluno lê ("023") é a face humana
   * dele, e comparar pelo id é comparar pelo código sem depender de grafia. A
   * Reposição sempre o traz (migr. 358: só o `produto_id` viaja) e a Eventual
   * passa a trazer assim que Compras amarra o item ao catálogo (migr. 480/494).
   *
   * Por texto continua valendo só onde código não existe: a Eventual recém
   * aberta, que por definição ainda não está no catálogo. E ali o casamento é
   * frouxo mesmo — "Sal Refinado 1kg" e "Sal Refinado 1kg Cisne" são o mesmo
   * sal para a pessoa e itens diferentes para a máquina. Apertar isso com
   * similaridade avisaria demais, e a turma aprenderia a clicar "sim" sem ler.
   */
  const vivasDoItem = (nome: string, produtoId?: string | null, excludeId?: string) => {
    const k = normalizarItem(nome);
    const vivas = (data as any[]).filter(d => d?.ativo !== false && VIVAS.has(String(d.status)) && d.id !== excludeId);
    if (produtoId) {
      const porCodigo = vivas.filter(d => d.produto_id === produtoId);
      // Achou pelo código: é o mesmo item, ponto. Não mistura com o palpite de
      // texto — juntar os dois faria a lista repetir a mesma requisição.
      if (porCodigo.length > 0) return porCodigo;
    }
    if (!k) return [];
    // Sem código dos dois lados: só o texto resta, e igualdade de string não
    // basta — "Sal Refinado 1kg" e "Sal Refinado 1kg Cisne" são o mesmo sal.
    // `semelhancaDeItem` (src/lib/similaridadeItem.ts) é conservadora de
    // propósito: medida divergente barra, e uma palavra em comum não conta.
    //
    // A linha que JÁ tem `produto_id` fica de fora quando o pedido novo não tem
    // nenhum — ali o texto da requisição é a necessidade escrita e o nome do
    // catálogo é outra coisa (migr. 480); comparar os dois casa por acidente.
    return vivas.filter(d => !d.produto_id && semelhancaDeItem(d.item, nome) !== 'nao');
  };

  /** Devolve true se pode seguir com o envio. `excludeId` tira o próprio
   * documento sendo reenviado da varredura — senão ele acha a si mesmo, que
   * segue 'Em correção' até a RPC de reenvio rodar. */
  const confirmarDuplicatas = async (
    linhasPedidas: { nome: string; produtoId?: string | null }[],
    excludeId?: string,
  ): Promise<boolean> => {
    const achados = linhasPedidas
      .map(l => ({ nome: l.nome, vivas: vivasDoItem(l.nome, l.produtoId, excludeId) }))
      .filter(x => x.vivas.length > 0);
    if (achados.length === 0) return true;

    const linhas = achados.map(({ nome, vivas }) => {
      const det = vivas.map((v: any) => {
        const rot = v.status === 'Em correção' ? 'DEVOLVIDA para correção' : v.status;
        const cod = v.produto_id
          ? produtos.find((p: any) => p.id === v.produto_id)?.codigo
          : null;
        // Quando o casamento veio do texto, o aluno precisa ver O QUE foi
        // escrito lá — é ele quem decide se é a mesma coisa, e decide melhor
        // lendo o nome do outro documento em vez de confiar no palpite.
        const grafia = !v.produto_id && semelhancaDeItem(v.item, nome) !== 'igual'
          ? `\n     escrito lá como: "${String(v.item ?? '').replace(/\s+/g, ' ').trim()}"`
          : '';
        return `   • ${numeroRequisicao(v)}${cod ? ` (cód. ${cod})` : ''}`
             + ` — ${rot}, de ${v.solicitante ?? 'alguém do setor'}${grafia}`;
      }).join('\n');
      return `"${String(nome).replace(/\s+/g, ' ').trim()}"\n${det}`;
    }).join('\n\n');

    const temDevolvida = achados.some(x => x.vivas.some((v: any) => v.status === 'Em correção'));

    return await confirm(
      `O seu setor já tem pedido em andamento para o mesmo item (ou muito parecido):`
      + `\n\n${linhas}\n\n`
      + (temDevolvida
          ? 'Uma delas foi DEVOLVIDA para correção — o caminho é corrigir aquele documento '
            + '(aba "Para corrigir"), não abrir outro: abrir de novo faz o gerente decidir '
            + 'duas vezes a mesma compra.\n\n'
          : '')
      + 'Abrir mesmo assim?');
  };

  // Mesma pergunta da abertura, do lado do material (item 17 do plano de
  // requisições): entre a devolução e a correção um colega pode ter aberto
  // pedido pro mesmo produto — e é exatamente esse intervalo que a devolução
  // cria. `requisicoes_estoque` não guarda texto livre, então o casamento é só
  // por `produto_id`, sem a régua de semelhança de texto.
  const vivasEstoqueDoProduto = (produtoId: string | null | undefined, excludeId?: string) => {
    if (!produtoId) return [];
    return (reqEstoque as any[]).filter(d =>
      d?.ativo !== false && VIVAS.has(String(d.status)) && d.produto_id === produtoId && d.id !== excludeId);
  };

  const confirmarDuplicataEstoque = async (produtoId: string | null | undefined, excludeId: string): Promise<boolean> => {
    const vivas = vivasEstoqueDoProduto(produtoId, excludeId);
    if (vivas.length === 0) return true;
    const nomeProduto = produtos.find((p: any) => p.id === produtoId)?.nome ?? 'este item';
    const linhas = vivas.map((v: any) => {
      const rot = v.status === 'Em correção' ? 'DEVOLVIDA para correção' : v.status;
      return `   • pedido de ${v.solicitante ?? 'alguém do setor'} — ${rot}`;
    }).join('\n');
    return await confirm(
      `O seu setor já tem pedido em andamento para "${nomeProduto}":\n\n${linhas}\n\nReenviar mesmo assim?`);
  };

  const handleEnviar = async () => {
    const ehRepo = tipo === 'reposicao';
    if (!(ehRepo ? validarReposicao() : validar()) || !supabase) return;

    // Na reposição o item É o produto do catálogo: manda o id, e a conferência
    // fica exata. Na eventual só existe o texto — é o que ela é.
    const linhasPedidas = ehRepo
      ? [...repo.keys()].map(id => ({
          nome: produtos.find((p: any) => p.id === id)?.nome ?? '',
          produtoId: id,
        }))
      : itens.map(r => ({ nome: r.item, produtoId: null }));
    if (!await confirmarDuplicatas(linhasPedidas)) return;

    setSaving(true);
    try {
      // Na reposição só o `produto_id` viaja: nome e unidade a RPC lê do
      // catálogo, e o saldo ela mesma fotografa (migr. 358). Mandar o nome
      // daqui seria deixar o navegador escrever o que o comprador vai ler.
      // MIGR 589: quem pede em embalagem fechada manda `qtd_embalagens` e mais
      // nada. O FATOR não viaja daqui — a RPC lê do cadastro e grava a
      // conversão junto, senão o navegador estaria dizendo quantas unidades
      // cabem num fardo (mesma lição da marca, migr. 582).
      const p_itens = ehRepo
        ? [...repo.entries()].map(([produto_id, qtd]) => {
            const n = parseQtd(qtd) || 1;
            const emb = embalagemDoProduto(produtos.find((p: any) => p.id === produto_id));
            return emb && repoEmb.has(produto_id)
              ? { produto_id, qtd_embalagens: n }
              : { produto_id, qtd: n };
          })
        : itens.map(r => ({
            item:    r.item.trim(),
            // MIGR 582: em branco é "qualquer marca" — a RPC grava NULL, e
            // Compras lê isso como liberdade de escolha, não como esquecimento.
            marca:   r.marca.trim(),
            unidade: r.unidade,
            // MIGR 591: com embalagem declarada, a quantidade digitada é o
            // número de FARDOS — a RPC multiplica pelo fator e grava as duas
            // leituras. Sem ela, segue sendo a quantidade na unidade.
            ...(r.embalagem
              ? { qtd_embalagens: parseQtd(r.qtd) || 1,
                  embalagem_nome: r.embalagem,
                  embalagem_fator: parseQtd(r.fator) }
              : { qtd: parseQtd(r.qtd) || 1 }),
            // Vazio = a RPC cai na justificativa do cabeçalho (migr. 354).
            justificativa: r.justificativa.trim() || null,
          }));

      const { data: saved, error } = await supabase.rpc('criar_requisicoes_compra_lote', {
        p_itens,
        p_tipo_requisicao:  ehRepo ? 'Reposição' : 'Eventual',
        p_solicitante:      profile.nome,
        p_urgencia:         cab.urgencia,
        p_centro_custo:     cab.centro_custo || null,
        p_filial:           filial,
        p_justificativa:    ehRepo ? null : (cab.justificativa.trim() || null),
        p_data_necessidade: cab.data_necessidade,
      });
      if (error) { showToast(error.message, 'error', true); return; }
      const rows: any[] = Array.isArray(saved) ? saved : [];
      if (rows.length) setData((prev: any[]) => [...rows, ...prev]);
      closeForm();
      showToast(
        rows.length > 1
          ? `${rows.length} itens enviados. O gerente da filial decide, e você acompanha o status nesta mesma tela.`
          : 'Requisição enviada. O gerente da filial decide, e você acompanha o status nesta mesma tela.',
        'success', true,
      );
    } catch (err: any) {
      showToast(`Erro ao enviar: ${err?.message ?? err}`, 'error', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    // A tela rola inteira, no <main> do app. Com `h-full` e rolagem própria, a
    // tabela (overflow-x-auto) encolhia para caber e rolava espremida abaixo
    // do cabeçalho — o mesmo defeito corrigido em Aprovações.
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <BotaoModeloPlanilha entidade="requisicoes" filial={filial} showToast={showToast} />
          {!showForm && (
            <NeuButtonAccent onClick={() => setShowForm(true)}>
              <Plus size={16} /> Nova Requisição
            </NeuButtonAccent>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-2xl border border-white/5 shrink-0"
          >
            <div className="p-5 flex flex-col gap-5">
              {/* Identificação — não se digita, se lê. Quem pediu é quem está logado. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Solicitante', val: profile.nome },
                  { label: 'Setor',       val: profile.setor === 'all' ? 'Matriz' : profile.setor },
                  { label: 'Unidade',     val: filial },
                  { label: 'Data',        val: todayBR().split('-').reverse().join('/') },
                ].map(({ label, val }) => (
                  <div key={label} className="neu-pressed p-3 rounded-xl">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">{label}</span>
                    <span className="text-xs text-gray-200 font-semibold capitalize">{val}</span>
                  </div>
                ))}
              </div>

              {/* O tipo é a primeira pergunta porque muda o destino do pedido:
                  material sai da prateleira (Estoque libera), compra vai para
                  a fila de cotação (gerente decide). */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">O que você precisa</span>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'reposicao' as TipoReq, label: 'Reposição',       hint: 'item do catálogo que acabou ou bateu o mínimo' },
                    { id: 'eventual'  as TipoReq, label: 'Compra eventual', hint: 'ainda não existe no catálogo — descreva com suas palavras' },
                    { id: 'estoque'   as TipoReq, label: 'Material do estoque', hint: 'já existe no almoxarifado — o Estoque libera' },
                  ]).map(op => (
                    <button
                      key={op.id}
                      onClick={() => { setTipo(op.id); setErros({}); }}
                      className={`flex-1 min-w-[180px] text-left py-2 px-3 rounded-xl border transition-colors ${
                        tipo === op.id
                          ? 'bg-accent/15 border-accent/30 text-accent'
                          : 'neu-button border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      <span className="block text-xs font-bold">{op.label}</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5">{op.hint}</span>
                    </button>
                  ))}
                </div>
                {/* A regra do campo obrigatório fica visível ANTES de o aluno
                    esbarrar nela — era o que faltava para ele entender que a
                    justificativa não é burocracia, é o que o comprador lê
                    quando não tem histórico nenhum. */}
                <p className="text-[11px] text-gray-500 leading-snug">
                  {tipo === 'reposicao'
                    ? 'Reposição não pede justificativa escrita: o motivo é o saldo, e o sistema grava o saldo e o mínimo do produto no momento do pedido.'
                    : tipo === 'eventual'
                      ? 'Compra eventual pede justificativa: Compras não tem histórico deste item para decidir sozinho.'
                      : 'Sai do almoxarifado, sem passar por Compras. Quando o Estoque liberar, o material vira despesa do centro de custo escolhido, pelo custo médio.'}
                </p>
                {/* A dúvida que aparecia em sala: "o item não está no catálogo,
                    tenho de cadastrar antes de pedir?". Não — e o setor
                    solicitante nem tem acesso a Cadastros. Quem dá código ao
                    item é quem compra, na geração do pedido (migr. 480). Dizer
                    isso aqui é mais barato do que deixar o aluno descobrir
                    esbarrando numa tela que ele não pode abrir. */}
                {tipo === 'eventual' && (
                  <div className="neu-inset rounded-xl p-3 border border-white/5">
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      <span className="font-bold text-gray-200">Você não precisa cadastrar o produto antes.</span>{' '}
                      Descreva o que precisa em português — "Bolsa feminina transversal Anacapri" já basta.
                      Quem compra é que amarra sua descrição a um item de catálogo quando o pedido for emitido,
                      e cadastra o que faltar. Da próxima vez que a unidade pedir o mesmo item, ele já aparece
                      na <span className="font-bold text-gray-300">Reposição</span>.
                    </p>
                    {/* Serviço deixou de ser beco sem saída (migr. 499): o pedido
                        tem duas categorias de item, e a unidade SV é a forma de
                        dizer qual é. Sem esta linha, "troca do compressor" era
                        pedido em UN e virava mercadoria de estoque — item com
                        saldo que nunca existiu. */}
                    <p className="text-[11px] text-gray-400 leading-relaxed mt-2">
                      <span className="font-bold text-gray-200">Precisa contratar um serviço?</span>{' '}
                      Manutenção, frete, licença, dedetização — escolha a unidade{' '}
                      <span className="font-bold text-gray-300">SV</span> na linha do item. Serviço não
                      entra no estoque: quando for executado, alguém atesta a execução e é isso que
                      libera o pagamento.
                    </p>
                  </div>
                )}
              </div>

              {tipo === 'estoque' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Produto *" error={erros.produto_id}>
                    <select
                      className={`neu-input py-2 px-3 rounded-xl text-sm ${erros.produto_id ? 'border border-red-500/40' : ''}`}
                      value={estoqueForm.produto_id}
                      onChange={e => { setEstoqueForm(f => ({ ...f, produto_id: e.target.value })); setErros({}); }}
                    >
                      <option value="">Selecione o produto em estoque…</option>
                      {produtosEmEstoque.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}{p.codigo ? ` (${p.codigo})` : ''} — saldo {qtdBR(p.estoque ?? 0)} {normalizarUnidade(p.unidade)}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {/* A unidade é a do produto escolhido, não uma escolha à
                      parte: quem pede queijo do almoxarifado pede em KG porque
                      é assim que o queijo está lá. */}
                  <FormField label={`Quantidade${unidadeEstoqueSel ? ` (${unidadeEstoqueSel})` : ''}`}>
                    <input
                      type="text" inputMode="decimal"
                      className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                      value={estoqueForm.qtd}
                      onChange={e => setEstoqueForm(f => ({ ...f, qtd: formatQtd(e.target.value, estoqueFrac) }))}
                      onKeyDown={handleQtdKeyDown(estoqueFrac)}
                    />
                  </FormField>

                  <FormField label="Destino / uso">
                    <input
                      className="neu-input py-2 px-3 rounded-xl text-sm"
                      placeholder="Ex.: loja, escritório, evento de sábado"
                      value={estoqueForm.destino}
                      onChange={e => setEstoqueForm(f => ({ ...f, destino: e.target.value }))}
                    />
                  </FormField>

                  {/* Migr. 442. Este campo é o que faz a resma aparecer no DRE:
                      o material sai do estoque valorizado pelo custo médio e
                      vira despesa no centro de custo escolhido aqui. Sem ele o
                      gasto existe, mas entra como "Não classificado". */}
                  <FormField label="Centro de custo">
                    <select
                      className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={estoqueForm.centro_custo_id}
                      onChange={e => setEstoqueForm(f => ({ ...f, centro_custo_id: e.target.value }))}
                    >
                      <option value="">Não informar</option>
                      {centrosOrdenados.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
              ) : (
              <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Necessário até *" error={erros.data_necessidade}>
                  <input
                    type="date"
                    className={`neu-input py-2 px-3 rounded-xl text-sm ${erros.data_necessidade ? 'border border-red-500/40' : ''}`}
                    value={cab.data_necessidade}
                    onChange={e => setCab(c => ({ ...c, data_necessidade: e.target.value }))}
                  />
                </FormField>

                <FormField label="Urgência">
                  <select
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={cab.urgencia}
                    onChange={e => setCab(c => ({ ...c, urgencia: e.target.value }))}
                  >
                    {['Normal', 'Alta', 'Urgente'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </FormField>

                <FormField label="Centro de custo">
                  <select
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={cab.centro_custo}
                    onChange={e => setCab(c => ({ ...c, centro_custo: e.target.value }))}
                  >
                    <option value="">Não informar</option>
                    {centrosOrdenados.map((c: any) => (
                      <option key={c.id} value={c.nome}>{c.nome}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              {tipo === 'reposicao' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Catálogo — marque o que precisa repor
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {repo.size > 0
                        ? <><strong className="text-accent">{repo.size}</strong> selecionado{repo.size === 1 ? '' : 's'}</>
                        : 'nenhum selecionado'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        className="neu-input py-2 pl-9 pr-3 rounded-xl text-sm w-full"
                        placeholder="Buscar por nome ou código…"
                        value={buscaCat}
                        onChange={e => setBuscaCat(e.target.value)}
                      />
                    </div>
                    {/* O ponto de pedido é a razão de existir da reposição —
                        merece ser um clique, não um filtro que se monta na mão. */}
                    <button
                      onClick={() => setSoAbaixoMin(v => !v)}
                      className={`py-2 px-3 rounded-xl text-[11px] font-bold border transition-colors ${
                        soAbaixoMin
                          ? 'bg-red-500/15 border-red-500/30 text-red-400'
                          : 'neu-button border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      No mínimo ou abaixo ({qtdAbaixoMin})
                    </button>
                  </div>

                  {erros.repo && <span className="text-[10px] text-red-500 font-semibold">{erros.repo}</span>}

                  {/* max-h menor abaixo de sm (plano mobile, item 1.7):
                      a caixa e rolagem-dentro-de-rolagem por natureza (e uma
                      lista com busca e checkbox, nao da pra virar select de
                      valor unico), entao a correcao possivel e encolher a
                      area presa pelo gesto, nao elimina-la. */}
                  <div className={`neu-pressed rounded-xl max-h-56 sm:max-h-72 overflow-y-auto main-scrollbar divide-y divide-white/5 ${erros.repo ? 'border border-red-500/40' : ''}`}>
                    {catalogoRepo.length === 0 ? (
                      <p className="text-xs text-gray-500 p-4 text-center">
                        {soAbaixoMin ? 'Nenhum item no mínimo agora.' : 'Nenhum produto encontrado.'}
                      </p>
                    ) : catalogoRepo.map((p: any) => {
                      const marcado = repo.has(p.id);
                      return (
                        <div key={p.id} className={`flex items-center gap-3 px-3 py-2 ${marcado ? 'bg-accent/5' : ''}`}>
                          <button
                            onClick={() => toggleRepo(p.id)}
                            className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                              marcado ? 'bg-accent border-accent' : 'border-white/20 hover:border-white/40'
                            }`}
                          >
                            {marcado && <Check size={11} className="text-black" />}
                          </button>
                          <button onClick={() => toggleRepo(p.id)} className="flex-1 min-w-0 text-left">
                            <span className="block text-xs font-semibold text-gray-200 truncate">{p.nome}</span>
                            <span className="block text-[10px] text-gray-500">
                              {p.codigo ? `${p.codigo} · ` : ''}saldo {qtdBR(p.saldo)}
                              {p.minimo > 0 ? ` · mínimo ${qtdBR(p.minimo)}` : ''}
                              {' '}{p.unidade ?? 'un'}
                              {/* Migr. 589: dizer como o item é comprado antes
                                  de marcar. Quem não vê o fardo aqui pede 20
                                  unidades quando queria 20 fardos. */}
                              {embalagemDoProduto(p) && (
                                <span className="text-gray-600"> · {rotuloEmbalagem(embalagemDoProduto(p), p.unidade)}</span>
                              )}
                            </span>
                          </button>
                          {p.abaixoMin && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 shrink-0">
                              No mínimo
                            </span>
                          )}
                          {marcado && (() => {
                            // Migr. 589: só oferece "em fardo" quem tem
                            // embalagem cadastrada. Sem ela o botão não aparece
                            // — e o cadastro é onde se resolve isso.
                            const emb = embalagemDoProduto(p);
                            const emFardo = !!emb && repoEmb.has(p.id);
                            // Em fardo a quantidade é inteira: fornecedor não
                            // abre fardo, e a RPC recusa 2,5 (mesma régua).
                            const frac = emFardo ? false : ehFracionaria(p.unidade);
                            const digitado = parseQtd(repo.get(p.id) ?? '1');
                            return (
                              <div className="flex items-center gap-2 shrink-0">
                                {emb && (
                                  <div className="neu-pressed rounded-lg p-0.5 flex text-[9px] font-bold uppercase tracking-wider">
                                    {[
                                      { modo: false, txt: normalizarUnidade(p.unidade) },
                                      { modo: true,  txt: emb.nome },
                                    ].map(op => (
                                      <button key={String(op.modo)}
                                        onClick={() => {
                                          setModoRepo(p.id, op.modo);
                                          // Trocar de medida remascara: "2,5" em
                                          // KG não sobrevive à virada para fardo.
                                          setQtdRepo(p.id, formatQtd(repo.get(p.id) ?? '1', op.modo ? false : ehFracionaria(p.unidade)));
                                        }}
                                        title={op.modo
                                          ? `Pedir em ${emb.nome.toLowerCase()} — ${rotuloEmbalagem(emb, p.unidade)}`
                                          : `Pedir na unidade solta (${rotuloUnidade(p.unidade)})`}
                                        className={`px-1.5 py-0.5 rounded transition-colors ${
                                          (op.modo === emFardo) ? 'bg-accent text-black' : 'text-gray-500 hover:text-gray-300'
                                        }`}>
                                        {op.txt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <div className="w-24 shrink-0">
                                  <input
                                    type="text" inputMode="decimal"
                                    className="neu-input py-1 px-2 rounded-lg text-xs w-full tabular-nums"
                                    value={repo.get(p.id) ?? '1'}
                                    onChange={e => setQtdRepo(p.id, formatQtd(e.target.value, frac))}
                                    onKeyDown={handleQtdKeyDown(frac)}
                                    // Sem artigo: "caixa" é feminino e "fardo"
                                    // masculino, e a lista tem os dois.
                                    title={emFardo
                                      ? `Quantidade a repor, em ${pluralEmbalagem(emb!.nome, 2).toLowerCase()}`
                                      : `Quantidade a repor (${normalizarUnidade(p.unidade)})`}
                                  />
                                  {/* A conta aparece ANTES de enviar: é ela que
                                      o aluno precisa aprender a fazer, e vê-la
                                      é o que evita pedir 20 unidades achando
                                      que pediu 20 fardos. */}
                                  {emFardo && digitado > 0 && (
                                    <span className="block text-[9px] text-accent/90 text-right mt-0.5 tabular-nums leading-tight">
                                      = {qtdBR(digitado * emb!.fator)} {normalizarUnidade(p.unidade)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-gray-500">
                    Cada item marcado vira uma requisição própria, com o saldo do momento anexado — é isso que Compras lê no lugar da justificativa.
                    {' '}Pedir em fardo é só a forma de pedir: o estoque continua contando na unidade do produto, e a conversão fica registrada no documento.
                  </span>
                </div>
              ) : (
              <>
              {/* O rótulo diz "geral" porque o campo é o padrão das linhas, não
                  a única fonte: quem tem motivos diferentes justifica item a
                  item lá embaixo (migr. 354). */}
              <FormField
                label={itens.length > 1
                  ? `Justificativa geral${cabJustObrigatoria ? ' *' : ''} — vale para os itens sem motivo próprio`
                  : 'Justificativa * — por que a empresa precisa disto'}
                error={erros.justificativa}
              >
                <textarea
                  className={`neu-input py-2 px-3 rounded-xl text-sm resize-none h-20 ${erros.justificativa ? 'border border-red-500/40' : ''}`}
                  placeholder="Ex.: o estoque de papel acaba na sexta e o setor emite 200 boletos por semana."
                  value={cab.justificativa}
                  onChange={e => setCab(c => ({ ...c, justificativa: e.target.value }))}
                />
              </FormField>

              {/* Itens: texto livre. O catálogo é sugestão, não obrigação. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Itens solicitados</span>
                  <button onClick={addLinha} className="neu-button py-1 px-3 rounded-lg text-[11px] font-bold text-accent flex items-center gap-1">
                    <Plus size={11} /> Adicionar item
                  </button>
                </div>

                {/* Vinha depois da lista, em cinza, e ninguém lia — mas é o fato
                    que explica por que cada linha pode ter motivo próprio. */}
                <p className="text-[11px] text-gray-400 leading-snug bg-white/[0.03] border border-white/5 rounded-lg py-2 px-3">
                  Cada item vira uma <strong className="text-gray-300">requisição própria</strong> — Compras cota e
                  fecha um a um, e o gerente aprova um a um. Por isso cada item pode ter o seu próprio motivo:
                  use <em>Motivo próprio</em> quando a razão de pedir for diferente da geral.
                </p>


                {/* MIGR 582. "Papel" não é um pedido: é um assunto. Quem vai
                    comprar precisa saber QUAL produto e de QUE marca, senão
                    volta perguntando — ou compra errado, que é pior. */}
                <p className="text-[11px] text-gray-400 leading-snug bg-white/[0.03] border border-white/5 rounded-lg py-2 px-3">
                  Escreva o <strong className="text-gray-300">nome do produto</strong> e a{' '}
                  <strong className="text-gray-300">marca</strong> como quem vai à loja comprar. Compras
                  não adivinha: quanto mais preciso o pedido, mais rápido a cotação volta com o item certo.
                  Se a marca for indiferente, deixe em branco — isso também é uma resposta. Item que já
                  existe no catálogo se pede por <strong className="text-gray-300">Reposição</strong>, não aqui.
                </p>

                {itens.map((row, i) => (
                  <div key={row.uid} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap md:flex-nowrap gap-2 items-start">
                      <div className="flex-1 min-w-[180px]">
                        <input
                          className={`neu-input py-2 px-3 rounded-xl text-sm w-full ${erros[`item_${i}`] ? 'border border-red-500/40' : ''}`}
                          placeholder={`Nome do produto — ${exemploItemRequisicao(filial)}`}
                          value={row.item}
                          onChange={e => updateLinha(i, { item: e.target.value })}
                        />
                        {erros[`item_${i}`] && (
                          <span className="text-[10px] text-red-500 font-semibold">{erros[`item_${i}`]}</span>
                        )}
                        {/* Já está no catálogo? Ver `noCatalogoParecidos`. */}
                        {(() => {
                          const servico = row.unidade === 'SV';
                          const parecidos = noCatalogoParecidos(row.item, servico);
                          if (parecidos.length === 0) return null;
                          // Serviço com o nome já idêntico ao do catálogo está
                          // certo como está — Compras reconhece sozinho.
                          if (servico && parecidos[0].s === 'igual') {
                            return (
                              <p className="mt-1 text-[10px] text-emerald-400/80">
                                Serviço do catálogo — Compras vai reconhecer pelo nome.
                              </p>
                            );
                          }
                          return (
                            <div className="mt-1.5 rounded-lg border border-amber-400/25 bg-amber-400/5 px-2.5 py-2">
                              <p className="text-[11px] text-amber-200/90 leading-snug">
                                {servico
                                  ? <>O catálogo já tem serviço parecido. Se for o mesmo, use o nome dele — Compras reconhece pelo nome e não cadastra de novo.</>
                                  : <>{parecidos[0].s === 'igual' ? 'Este produto já está no catálogo.' : 'O catálogo já tem item parecido.'}
                                      {' '}Se for o mesmo, peça por <strong>Reposição</strong> — sai com o código e Compras não cadastra de novo.</>}
                              </p>
                              <div className="flex flex-col gap-1 mt-1.5">
                                {parecidos.map(({ p }) => (
                                  <div key={p.id} className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-gray-300 truncate">
                                      {p.nome}
                                      {p.codigo && <span className="text-gray-500"> · {p.codigo}</span>}
                                    </span>
                                    <button type="button"
                                      onClick={() => servico ? updateLinha(i, { item: p.nome }) : moverParaReposicao(i, p)}
                                      className="shrink-0 text-[10px] font-bold text-accent underline hover:text-accent/80">
                                      {servico ? 'É este — usar o nome' : 'É este — pedir por Reposição'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="w-full md:w-44">
                        <input
                          list="sugestoes-marcas"
                          className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                          placeholder="Marca (opcional)"
                          value={row.marca}
                          onChange={e => updateLinha(i, { marca: e.target.value })}
                        />
                      </div>
                      {/* Quantidade: de FARDOS quando a linha declara
                          embalagem, de unidades quando não (migr. 591). Fardo
                          não se parte, então lá a máscara não aceita vírgula. */}
                      <input
                        type="text" inputMode="decimal"
                        title={row.embalagem
                          ? `Quantidade a pedir, em ${pluralEmbalagem(row.embalagem, 2).toLowerCase()}`
                          : `Quantidade a pedir (${normalizarUnidade(row.unidade)})`}
                        className="neu-input py-2 px-3 rounded-xl text-sm w-20 tabular-nums"
                        value={row.qtd}
                        onChange={e => updateLinha(i, { qtd: formatQtd(e.target.value, !row.embalagem && ehFracionaria(row.unidade)) })}
                        onKeyDown={handleQtdKeyDown(!row.embalagem && ehFracionaria(row.unidade))}
                      />
                      <select
                        className="neu-input py-2 px-3 rounded-xl text-sm w-24"
                        value={row.unidade}
                        onChange={e => {
                          // Trocar a unidade remascara a quantidade da linha —
                          // "12,5" digitado em KG não pode virar 125 em UN.
                          const u = e.target.value;
                          // Serviço não vem em embalagem: escolher SV desfaz a
                          // declaração em vez de deixá-la barrar o envio.
                          const emb = u === 'SV' ? '' : row.embalagem;
                          updateLinha(i, {
                            unidade: u, embalagem: emb, fator: emb ? row.fator : '',
                            qtd: formatQtd(row.qtd, !emb && ehFracionaria(u)),
                          });
                        }}
                      >
                        {unidadesReq.map(u => <option key={u} value={u}>{rotuloUnidade(u)}</option>)}
                      </select>
                      {/* A embalagem que o fornecedor vende. Vazia = unidade
                          solta, que é a maioria — por isso o select nasce em
                          "avulso" e o fator só aparece quando há o que
                          multiplicar. Antes disso, o aluno escrevia o fardo no
                          NOME do item ("sacola 50x60 — fardo com 500") e
                          Compras cotava adivinhando. */}
                      {row.unidade !== 'SV' && (
                        <div className="w-full md:w-auto flex gap-2 items-start">
                          <select
                            className="neu-input py-2 px-2 rounded-xl text-xs w-28 shrink-0"
                            value={row.embalagem}
                            title="Como o fornecedor vende este item"
                            onChange={e => {
                              const emb = e.target.value;
                              updateLinha(i, {
                                embalagem: emb,
                                fator: emb ? row.fator : '',
                                qtd: formatQtd(row.qtd, !emb && ehFracionaria(row.unidade)),
                              });
                            }}
                          >
                            <option value="">Avulso</option>
                            {EMBALAGENS_COMPRA.map(e => <option key={e} value={e}>{e}</option>)}
                          </select>
                          {row.embalagem && (
                            <div className="w-24 shrink-0">
                              <input
                                type="text" inputMode="decimal"
                                className={`neu-input py-2 px-2 rounded-xl text-xs w-full tabular-nums ${erros[`fator_${i}`] ? 'border border-red-500/40' : ''}`}
                                placeholder={`${normalizarUnidade(row.unidade)} por ${row.embalagem.toLowerCase()}`}
                                title={`Quantas ${normalizarUnidade(row.unidade)} vêm em um ${row.embalagem.toLowerCase()}`}
                                value={row.fator}
                                onChange={e => updateLinha(i, { fator: formatQtd(e.target.value, ehFracionaria(row.unidade)) })}
                                onKeyDown={handleQtdKeyDown(ehFracionaria(row.unidade))}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => toggleJust(i, row.uid)}
                        title={justAberta[row.uid] ? 'Voltar a usar a justificativa geral' : 'Dar um motivo só para este item'}
                        className={`py-2 px-2.5 rounded-xl border transition-colors mt-0.5 ${
                          justAberta[row.uid]
                            ? 'bg-accent/15 border-accent/30 text-accent'
                            : 'neu-button border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        <MessageSquareText size={13} />
                      </button>
                      <button
                        onClick={() => removeLinha(i)}
                        disabled={itens.length <= 1}
                        title="Remover item"
                        className="action-btn-delete disabled:opacity-30 mt-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* A conta à vista, antes de enviar (migr. 591) — e o erro
                        da declaração incompleta no mesmo lugar. */}
                    {row.embalagem && (erros[`fator_${i}`] ? (
                      <span className="text-[10px] text-red-500 font-semibold">{erros[`fator_${i}`]}</span>
                    ) : parseQtd(row.fator) > 1 && parseQtd(row.qtd) > 0 ? (
                      <span className="text-[10px] text-accent/90 tabular-nums">
                        {qtdBR(row.qtd)} {pluralEmbalagem(row.embalagem, parseQtd(row.qtd))} × {qtdBR(row.fator)} ={' '}
                        <span className="font-bold">{qtdBR(parseQtd(row.qtd) * parseQtd(row.fator))} {normalizarUnidade(row.unidade)}</span>
                      </span>
                    ) : null)}

                    {justAberta[row.uid] && (
                      <div className="pl-3 border-l-2 border-accent/30 ml-1">
                        <textarea
                          className={`neu-input py-2 px-3 rounded-xl text-xs resize-none h-14 w-full ${erros[`just_${i}`] ? 'border border-red-500/40' : ''}`}
                          placeholder={`Motivo só deste item${row.item.trim() ? ` (${row.item.trim()})` : ''} — substitui a justificativa geral`}
                          value={row.justificativa}
                          onChange={e => updateLinha(i, { justificativa: e.target.value })}
                        />
                        {erros[`just_${i}`] && (
                          <span className="text-[10px] text-red-500 font-semibold">{erros[`just_${i}`]}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              </>
              )}
              </>
              )}

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-gray-400">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={tipo === 'estoque' ? handleEnviarEstoque : handleEnviar} isLoading={saving}>
                  <Send size={15} />
                  {tipo === 'estoque'
                    ? 'Enviar para o Estoque'
                    : tipo === 'reposicao'
                      ? (repo.size > 1 ? `Repor ${repo.size} itens` : 'Enviar reposição')
                      : itens.length > 1 ? `Enviar ${itens.length} itens` : 'Enviar para Compras'}
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Formulário aberto tampa a lista: as abas ("Para corrigir", "Pendentes")
          são para acompanhar o que já foi pedido, e ficavam disputando a tela
          com o pedido que está sendo escrito — inclusive rolando para fora dele. */}
      {showForm ? null : (isLoading || loadingEst) ? <LoadingSpinner /> : pedidos.length === 0 ? (
        <EmptyState message="O seu setor ainda não abriu nenhum pedido" />
      ) : (
      <>
      {/* Abas de fila no padrão AbaComContador (o mesmo de Cotações). O ponto
          âmbar diz "tem algo SEU aqui para consertar"; o que é, a lista mostra. */}
      <div className="flex gap-3 flex-wrap shrink-0" role="tablist">
        {ABAS.map(a => {
          const chama = a.key === 'corrigir' && minhasParaCorrigir > 0;
          return (
            <AbaComContador key={a.key} label={a.label} cor={a.cor}
              n={porAba[a.key].filter(r => casaSolicitante(r.solicitante)).length}
              ativa={a.key === abaAtiva} onClick={() => setAba(a.key)}
              icon={a.key === 'corrigir' ? RotateCcw : undefined} alerta={chama}
              title={chama ? `${minhasParaCorrigir} requisição(ões) sua(s) esperando correção` : undefined} />
          );
        })}
      </div>
      {/* Quem pediu — a contagem ao lado do nome é da aba aberta. */}
      <FiltroSolicitante
        valor={solicitante}
        onChange={setSolicitante}
        nomes={porAba[abaAtiva].map(r => r.solicitante)}
      />
      {visiveis.length === 0 ? (
        <EmptyState message={solicitante !== null
          ? `Nada de ${solicitante} nesta aba. Troque o solicitante ou volte para "Todos".`
          : abaAtiva === 'corrigir'
          ? 'Nada devolvido para correção — o que o gerente pediu para consertar aparece aqui.'
          : 'Nenhuma requisição nesta situação.'} />
      ) : (
        <div className="neu-flat rounded-2xl border border-white/5 overflow-x-auto">
          {/* Sem min-w fixo: Item, Qtd, Urgencia, Situacao e Acao ficam
              sempre visiveis (mesma regua de RequisicoesView, em Compras);
              o resto entra a partir de sm/md/lg. Item 1.1/1.2 do plano de
              mobile (docs/plano-mobile-requisicoes.md) - em 375px a tabela
              le sem rolagem horizontal, e a acao fica ao alcance. */}
          <table className="tabela w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">Item</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left hidden lg:table-cell">Tipo</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left hidden md:table-cell">Solicitante</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">Qtd</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left hidden lg:table-cell">Necessario ate</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">Urgencia</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left hidden sm:table-cell">Aberto em</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">Situacao</th>
                <th className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">Historico</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(r => (
                <React.Fragment key={`${r.tipo}-${r.id}`}>
                  <tr
                    className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => setDetalhe(detalhe === r.id ? null : r.id)}
                  >
                    <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                      <span className="flex items-center gap-2">
                        {/* A seta existe porque "clique na linha" só funciona
                            para quem já sabe que a linha abre. */}
                        <ChevronRight size={13}
                          className={`text-gray-500 shrink-0 transition-transform ${detalhe === r.id ? 'rotate-90' : ''}`} />
                        <ClipboardList size={13} className="text-gray-600 shrink-0" />
                        {r.item}
                      </span>
                      {r.marca && (
                        <span className="block text-[10px] text-gray-400 ml-[21px]">
                          <span className="text-gray-500 font-bold uppercase tracking-widest">Marca:</span>{' '}
                          <span className="text-gray-300 font-bold">{r.marca}</span>
                        </span>
                      )}
                      {r.numero && (
                        <span className="block font-credencial text-[10px] text-gray-500 ml-[21px]">{r.numero}</span>
                      )}
                      {r.complemento && (
                        <span className="text-[10px] text-gray-500 ml-[21px]">{r.complemento}</span>
                      )}
                      {/* A coluna Tipo some abaixo de lg (plano mobile,
                          item 1.1) -- o badge migra para debaixo do item, so
                          ate o breakpoint em que a coluna propria assume. */}
                      <span className={`lg:hidden inline-block mt-1 ml-[21px] px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        r.tipo === 'estoque'   ? 'bg-blue-500/15 text-blue-400'
                        : r.tipo === 'reposicao' ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-purple-500/15 text-purple-400'
                      }`}>
                        {r.tipoLabel}
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        r.tipo === 'estoque'   ? 'bg-blue-500/15 text-blue-400'
                        : r.tipo === 'reposicao' ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-purple-500/15 text-purple-400'
                      }`}>
                        {r.tipoLabel}
                      </span>
                    </td>
                    {/* Quem pediu. Vira informação útil justamente porque a
                        lista é do setor: sem esta coluna, "quem foi?" viraria
                        pergunta de corredor. */}
                    <td className="py-3 px-4 text-xs text-gray-300 capitalize hidden md:table-cell">
                      {r.solicitante ?? '—'}
                    </td>
                    {/* Migr. 589: o que foi PEDIDO em cima, o que isso dá em
                        estoque embaixo. Trocar a ordem esconderia a conta que
                        o aluno acabou de fazer. */}
                    <td className="py-3 px-4 text-xs font-mono text-gray-300">
                      {r.embNome && r.qtdEmb != null ? (
                        <>
                          {qtdBR(r.qtdEmb)} {pluralEmbalagem(r.embNome, Number(r.qtdEmb))}
                          <span className="block text-[10px] text-gray-500 leading-tight">
                            {qtdBR(r.qtd)} {r.unidade ?? ''}
                          </span>
                        </>
                      ) : <>{qtdBR(r.qtd)} {r.unidade ?? ''}</>}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-400 hidden lg:table-cell">{r.prazo ?? '—'}</td>
                    <td className="py-3 px-4"><UrgenciaBadge urgencia={r.urgencia} /></td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-500 hidden sm:table-cell">{r.abertura || '—'}</td>
                    {/* "Em correção" descreve o estado do documento, não o que
                        se espera de quem lê — e quem lê é justamente quem tem de
                        agir. O valor no banco continua 'Em correção' (guardas,
                        RPCs e cotações falam essa língua); aqui o rótulo fala a
                        língua do aluno. */}
                    <td className="py-3 px-4">
                      {r.status === 'Em correção' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-300 whitespace-nowrap">
                          <RotateCcw size={11} />
                          Devolvida — corrigir
                        </span>
                      ) : (
                        <StatusBadge status={r.status} />
                      )}
                    </td>
                    {/* O aluno que pediu acompanha o próprio documento sem ter
                        de perguntar ao professor por que ele parou. */}
                    <td className="py-3 px-4 text-right">
                      {/* O botão vivia só dentro da linha expandida, no fim do
                          painel de detalhe. Quem foi avisado de que a requisição
                          voltou abria a tela, via "Em correção" e não achava o
                          que fazer — a ação existia, escondida atrás de um
                          clique que nada anunciava. Agora ela está onde o olho
                          já está: na linha, ao lado do histórico. */}
                      {r.status === 'Em correção' && podeCorrigir(r) && (
                        <button
                          onClick={e => { e.stopPropagation(); abrirCorrecao(r); }}
                          className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-amber-400 inline-flex items-center gap-1.5 mr-2 align-middle"
                        >
                          <RotateCcw size={11} /> Corrigir
                        </button>
                      )}
                      <span className="inline-flex align-middle" onClick={e => e.stopPropagation()}>
                        <MenuMais>
                          {fechar => (
                            <HistoricoOperacoes variante="menu" onAbrir={fechar}
                              entidade={r.tipo === 'estoque' ? 'requisicoes_estoque' : 'requisicoes'}
                              entidadeId={r.id}
                              titulo={r.numero ? `${r.numero} · ${r.item}` : r.item}
                              criadoEm={r.criadoEm}
                              atualizadoEm={r.atualizadoEm}
                            />
                          )}
                        </MenuMais>
                      </span>
                    </td>
                  </tr>
                  {detalhe === r.id && (
                    <tr className="border-b border-white/5">
                      <td colSpan={9} className="py-3 px-4">
                        {/* Só para requisição de compra: material do
                            almoxarifado tem outro caminho, e reusar esta régua
                            ali faria a tela mentir sobre o fluxo. */}
                        {VAI_PRA_COMPRAS(r.tipo) && (
                          <>
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">
                              Onde está
                            </span>
                            <FluxoCompra etapa={etapaDaRequisicao(r.status)} />
                            <p className="text-[10px] text-gray-600 mt-1.5">
                              A última etapa é do Estoque e não aparece aqui — a sua lista mostra o que o setor pediu,
                              não o que o almoxarifado conferiu.
                            </p>
                          </>
                        )}
                        {/* Na reposição isto ocupa o lugar da justificativa: é
                            o que o comprador lê para decidir, e não depende de
                            ninguém ter escrito bem. */}
                        {r.saldo != null && (
                          <div className="mt-3">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">
                              Saldo quando foi pedido
                            </span>
                            <span className="text-xs text-gray-300">
                              <strong className={Number(r.minimo) > 0 && Number(r.saldo) <= Number(r.minimo) ? 'text-red-400' : 'text-gray-200'}>
                                {r.saldo}
                              </strong>
                              {r.minimo != null && Number(r.minimo) > 0 && <> em estoque, para um mínimo de <strong className="text-gray-200">{r.minimo}</strong></>}
                              {' '}{r.unidade ?? ''}
                            </span>
                          </div>
                        )}
                        {r.justificativa && (
                          <div className={VAI_PRA_COMPRAS(r.tipo) ? 'mt-3' : ''}>
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">Justificativa</span>
                            <span className="text-xs text-gray-300">{r.justificativa}</span>
                          </div>
                        )}
                        {/* O que o gerente mandou consertar, e o botao de faze-lo
                            (migr. 517). Fica no fim porque e a ultima coisa que
                            se le antes de agir — e so aparece para quem pode
                            agir: quem abriu o documento. */}
                        {r.status === 'Em correção' && (
                          <div className="mt-3 neu-pressed rounded-xl p-3 border border-amber-400/20">
                            <span className="text-[10px] text-amber-300/90 uppercase tracking-widest font-bold block mb-1">
                              {r.tipo === 'estoque' ? 'Devolveram para você corrigir' : 'O gerente devolveu para você corrigir'}
                            </span>
                            <span className="text-xs text-gray-200">
                              {r.correcaoMotivo || 'Sem motivo registrado.'}
                            </span>
                            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                              <span className="text-[11px] text-gray-500 leading-snug">
                                Não foi negada — nada foi decidido. Corrija e reenvie: é o mesmo documento que
                                volta para a fila de quem decide.
                              </span>
                              {podeCorrigir(r) ? (
                                <button onClick={() => abrirCorrecao(r)}
                                  className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-amber-400 flex items-center gap-2 shrink-0">
                                  <RotateCcw size={12} /> Corrigir e reenviar
                                </button>
                              ) : (
                                <span className="text-[11px] text-gray-500 shrink-0 text-right">
                                  Quem corrige é <span className="text-gray-300 font-bold">{r.solicitante || 'quem abriu'}</span>.
                                  <span className="block text-gray-600">O gerente destrava se faltar.</span>
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      {/* Marcas conhecidas: fica na raiz da tela porque dois formulários a
          usam — o de abrir requisição e o de corrigir a devolvida —, e o
          segundo abre com o primeiro fechado. */}
      <datalist id="sugestoes-marcas">
        {marcasConhecidas.map(m => <option key={m} value={m} />)}
      </datalist>

      {/* Correcao da requisicao devolvida (migr. 517, material na 522).
          Compra: item, quantidade, unidade, prazo, urgencia, centro de custo
          e justificativa — o que foi PEDIDO. Material: so quantidade e
          destino, porque e so isso que `requisicoes_estoque` guarda. Nos
          dois, tipo/produto do catalogo/setor ficam de fora, na tela e na
          RPC: corrigir e consertar o pedido, nao troca-lo por outro documento. */}
      <AnimatePresence>
        {corrigindo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !reenviando && setCorrigindo(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }} onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-sm font-bold text-gray-300 mb-1">
                Corrigir e reenviar
                {corrigindo.numero
                  ? <span className="text-accent ml-2 font-credencial text-xs">{corrigindo.numero}</span>
                  : <span className="text-accent ml-2 text-xs">{corrigindo.item}</span>}
              </h3>
              <div className="neu-pressed rounded-xl p-3 border border-amber-400/20 my-4">
                <span className="text-[10px] text-amber-300/90 uppercase tracking-widest font-bold block mb-1">
                  {corrigindo.tipo === 'estoque' ? 'O que pediram para consertar' : 'O que o gerente pediu para consertar'}
                </span>
                <span className="text-xs text-gray-200">{corrigindo.correcaoMotivo || '—'}</span>
              </div>

              {corrigindo.tipo === 'estoque' ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Quantidade *">
                      <input type="text" inputMode="decimal"
                        className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums w-full"
                        value={corrFormEstoque.qtd}
                        onChange={e => setCorrFormEstoque(f => ({ ...f, qtd: formatQtd(e.target.value, ehFracionaria(corrigindo.unidade)) }))}
                        onKeyDown={handleQtdKeyDown(ehFracionaria(corrigindo.unidade))} />
                    </FormField>
                    <FormField label="Destino">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                        value={corrFormEstoque.destino}
                        onChange={e => setCorrFormEstoque(f => ({ ...f, destino: e.target.value }))} />
                    </FormField>
                  </div>
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                {corrEhEventual && (
                  <FormField label="Marca">
                    <input list="sugestoes-marcas" className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                      value={corrForm.marca}
                      onChange={e => setCorrForm(f => ({ ...f, marca: e.target.value }))}
                      placeholder="Marca (opcional)" />
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      Se o gerente devolveu pedindo precisão, é aqui que ela entra: a marca é o que faz
                      Compras achar o produto certo. Em branco significa "qualquer marca".
                    </p>
                  </FormField>
                )}
                <FormField label="Item *">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                    value={corrForm.item}
                    onChange={e => setCorrForm(f => ({ ...f, item: e.target.value }))} />
                </FormField>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Quantidade *">
                    <input type="text" inputMode="decimal"
                      className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums w-full"
                      value={corrForm.qtd}
                      onChange={e => setCorrForm(f => ({ ...f, qtd: formatQtd(e.target.value, corrFrac) }))}
                      onKeyDown={handleQtdKeyDown(corrFrac)} />
                    {/* Aqui a quantidade é sempre a de estoque, mesmo no pedido
                        que nasceu em fardo — e o aluno precisa saber disso antes
                        de digitar. Mantendo múltiplo do fardo, o documento
                        continua contando em fardo (migr. 590); saindo do
                        múltiplo, ele passa a falar só em unidade, porque 610 não
                        são 20 fardos de 30. */}
                    {corrigindo?.embNome && corrigindo?.embFator ? (
                      <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                        Pedido em <span className="text-gray-400">{qtdBR(corrigindo.qtdEmb)} {pluralEmbalagem(corrigindo.embNome, Number(corrigindo.qtdEmb))} de {qtdBR(corrigindo.embFator)}</span>.
                        Digite em {normalizarUnidade(corrForm.unidade)}: múltiplo de {qtdBR(corrigindo.embFator)} continua contando em {corrigindo.embNome.toLowerCase()}.
                      </p>
                    ) : null}
                  </FormField>
                  <FormField label="Unidade">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                      value={corrForm.unidade}
                      onChange={e => setCorrForm(f => ({ ...f, unidade: e.target.value }))}>
                      {unidadesReq.map(u => <option key={u} value={u}>{rotuloUnidade(u)}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Necessário até">
                    <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                      value={corrForm.data_necessidade}
                      onChange={e => setCorrForm(f => ({ ...f, data_necessidade: e.target.value }))} />
                  </FormField>
                  <FormField label="Urgência">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                      value={corrForm.urgencia}
                      onChange={e => setCorrForm(f => ({ ...f, urgencia: e.target.value }))}>
                      {['Normal', 'Alta', 'Urgente'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </FormField>
                </div>
                <FormField label="Centro de custo">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm w-full"
                    value={corrForm.centro_custo}
                    onChange={e => setCorrForm(f => ({ ...f, centro_custo: e.target.value }))}>
                    <option value="">Não informar</option>
                    {centrosOrdenados.map((c: any) => (
                      <option key={c.id} value={c.nome}>{c.nome}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Justificativa">
                  <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-20 w-full"
                    value={corrForm.justificativa}
                    onChange={e => setCorrForm(f => ({ ...f, justificativa: e.target.value }))} />
                </FormField>
              </div>
              )}

              <p className="text-[11px] text-gray-500 leading-snug mt-3">
                {corrigindo.tipo === 'estoque'
                  ? 'O produto do catálogo não muda aqui — se o pedido era de outro item, o caminho é negar este e abrir um novo, para o histórico não misturar duas coisas num documento só.'
                  : 'O tipo da requisição, o produto do catálogo e o setor não mudam aqui — se o pedido era de outro item, o caminho é negar este e abrir um novo, para o histórico não misturar duas coisas num documento só.'}
              </p>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setCorrigindo(null)} disabled={reenviando}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleReenviar} isLoading={reenviando}>
                  Reenviar para quem decide
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const RequisicoesSetorView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A requisição que o seu setor abre" />;
  return <RequisicoesSetorViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
