import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, CheckCircle2, ChevronDown, Trash2, X, Lock, PackageX } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { numeroPedido } from '../lib/documentos';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { UNIDADES_FRACIONARIAS, normalizarUnidade, embalagemDoProduto } from '../lib/unidades';
import { QuantidadeEmbalagem, qtdEmEstoque } from '../components/QuantidadeEmbalagem';
import { ehPerecivel, validadeDias, vencimentoPrevisto, armazenagemDe, ARMAZENAGEM_ESTILO } from '../lib/perecivel';
import { requerImei, ATRIBUTOS_PRODUTO } from '../lib/atributosProduto';
import { gerarImeis } from '../lib/imei';
import { proximoNumeroNfDeMaior } from '../lib/notaFiscal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';

// Saldo por pedido vem da view v_pedido_saldo (migr. 202) — soma qtd_recebida
// de recebimentos ativos e devolve quanto ainda cabe. Bloqueia recebimento
// que ultrapasse o pedido (defesa em INSERT + Confirmar).
type SaldoPedido = { qtd_pedida: number; qtd_recebida_total: number; qtd_saldo: number };

// O cadastro rápido saiu daqui (2026-08-17). Ele existia porque compra de item
// novo é a regra — o pedido nasce da requisição com `item_descricao` em texto
// livre e nunca aponta para `produtos` —, mas resolvia o impasse criando
// meio-produto: sem categoria, sem marca, sem tipo, sem ficha do nicho. Ninguém
// voltava para completar, e o catálogo enchia de item pela metade que depois
// não entra no PDV nem no DRE direito.
//
// O caminho passa a ser o processo: o item comprado aparece como sugestão em
// Cadastros > Produtos (com fornecedor e custo do pedido já preenchidos), o
// aluno cadastra por inteiro lá e volta para confirmar a entrada. Uma volta a
// mais, e o cadastro sai certo — que é a aula.

/** ISO (YYYY-MM-DD) para dd/mm/aaaa. Data de recebimento é data, não timestamp. */
const fmtDataBR = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

// Motivos de devolução ao fornecedor (migr. 423). Lista fechada de propósito:
// texto livre aqui viraria "problema" em 90% das linhas, e o que Compras
// precisa levar para o fornecedor é a categoria.
const MOTIVOS_DEVOLUCAO = ['Avaria', 'Item errado', 'Quantidade a maior', 'Fora da validade', 'Outro'] as const;

const RecebimentosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/recebimentosview', { filial }, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['status', 'observacao', 'pedido_id'] }
  );
  // pedidos filtrados pela filial; produtos da mesma filial para atualizar estoque.
  // Realtime nos dois: quem avisa que a carga está a caminho é Compras, marcando
  // o pedido "Em entrega" noutra tela. Sem realtime o almoxarifado recarregava a
  // página no escuro, à espera de um pedido que já estava lá.
  //
  // O comentário acima dizia "nos dois" desde sempre e o `true` só estava em
  // pedidos. Sozinho na tela não aparecia: sair para Cadastros desmonta a view
  // e o retorno refaz o fetch. Com a turma inteira junto, aparecia — o aluno
  // que cadastra o produto não é o mesmo que confirma a entrada, e quem estava
  // com o Confirmar aberto continuava vendo o catálogo de um minuto atrás, sem
  // nada na tela sugerindo F5.
  const { data: pedidos } = useFetchData<any>('/api/pedidosview', { filial }, true);
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial }, true);
  // Catálogo de serviços (migr. 499) — só para dar NOME ao que está sendo
  // aceito. Sem filtro de filial no fetch porque `servicos.filial` é nulável e
  // serviço sem unidade vale para todas; aqui a busca é por id, então não há
  // lista a escopar.
  const { data: servicos } = useFetchData<any>('/api/servicosview', { filial }, true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ pedido_id: '' });
  // `produto_id` saiu daqui: a coluna não existe em `recebimentos`, então o
  // campo "Produto recebido" deste form era descartado no INSERT — o usuário
  // escolhia o produto e tinha de escolher de novo no Confirmar. A escolha
  // agora vive só onde de fato move estoque (o painel Confirmar).
  // `data` era `todayBR()` fixo e a tela não tinha campo: carga que chegou
  // sexta e foi lançada segunda entrava como segunda — e `recebido_em`, que é a
  // régua de pontualidade do fornecedor, media o clique (migr. 490).
  // A nota fiscal veio junto porque ela é o documento que acompanha a carga:
  // a doca registra número/série/emissão, o financeiro é quem confere o VALOR
  // contra o pedido (migr. 491). Preço não passa pelo almoxarifado.
  const [extras, setExtras] = useState({
    qtd_recebida: '', observacao: '', data: todayBR(),
    // Série é constante (1) na imensa maioria das empresas — não é sorteio,
    // por isso não tem botão Gerar como o número tem. Continua editável para
    // a exceção rara.
    nf_numero: '', nf_serie: '1', nf_emissao: '',
  });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [confirmProduto, setConfirmProduto] = useState('');
  // Lote e validade da carga (migr. 424). Opcionais: parafuso não vence, e
  // exigir data em tudo faria a turma digitar lixo para passar da tela.
  const [confirmLote, setConfirmLote] = useState('');
  // Um IMEI/serial por linha (migr. 444). Só aparece para produto marcado como
  // "cada unidade tem IMEI/Serial" — é aqui que o número existe: a caixa está
  // aberta na frente do conferente. Depois vira caça ao aparelho na prateleira.
  const [confirmImeis, setConfirmImeis] = useState('');
  const [confirmValidade, setConfirmValidade] = useState('');
  // O status final NÃO é mais escolhido (migr. 489): sai do saldo do pedido. O
  // que sobrou de decisão humana é encerrar a entrega faltando mercadoria — ato
  // deliberado, com motivo, e não o default de um select.
  const [encerrarComSaldo, setEncerrarComSaldo] = useState(false);
  const [motivoEncerramento, setMotivoEncerramento] = useState('');
  // Nota fiscal da carga (migr. 491). Vive no painel de Confirmar porque é ali
  // que a mercadoria entra: sem nota não entra, e é o documento que o
  // financeiro vai confrontar com o pedido.
  const [confirmNf, setConfirmNf] = useState({ numero: '', serie: '', emissao: '' });
  // Recebimento confirmado ANTES da 491 não tem nota, e a conta dele não passa
  // na conferência. Nota que chega depois da mercadoria é rotina — este modal é
  // a porta para informá-la sem desfazer nada.
  const [notaAtrasada, setNotaAtrasada] = useState<any | null>(null);
  const [notaForm, setNotaForm] = useState({ numero: '', serie: '', emissao: '' });
  const [notaSalvando, setNotaSalvando] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  // Guard sincrônico — `disabled={confirmSaving}` depende de state React
  // (assíncrono); um double-click rápido entra em handleConfirmar 2× antes
  // do re-render. Este ref tranca o item já em processo imediatamente.
  const confirmingRef = useRef<string | null>(null);
  // Mesmo guard para o Registrar.
  const savingRef = useRef(false);

  const pedidosAtivos = pedidos.filter((p: any) => !['Cancelado', 'Recebido'].includes(p.status));

  // Resumo agregado — três números que a página de 50 linhas não sabe dizer:
  // quantos estão esperando confirmação, o maior número de NF já gasto na
  // unidade e quais pedidos já têm carga lançada por confirmar. Um "nada a
  // fazer" calculado sobre a página 1 é pior que contador nenhum.
  //
  // Isto era uma SEGUNDA leitura de `recebimentos`, a tabela inteira sem
  // paginação, ao lado da página. Com realtime na tela, cada escrita de
  // qualquer aluno da sala fazia TODA máquina refazer as duas — 638 leituras
  // para 93 escritas em 15 minutos de aula em 22/09, e o pool de 10 conexões
  // do PostgREST cheio por oito minutos (`PGRST003`), com a sala inteira
  // olhando tela pendurada. Agora é uma consulta agregada (RPC
  // `resumo_recebimentos`, migr. 618) que não cresce com a tabela.
  //
  // Recarrega junto com a lista: `data` ganha identidade nova a cada leitura
  // do `useFetchData`, inclusive as disparadas por realtime, então seguir
  // `data` dispensa uma segunda assinatura — e mudança de status não muda o
  // tamanho da lista, por isso aqui é `data` e não `data.length`.
  const [resumo, setResumo] = useState<{
    aguardando: number; maxNf: number; pedidosAConfirmar: Set<string>;
  }>({ aguardando: 0, maxNf: 0, pedidosAConfirmar: new Set() });
  const reloadResumo = useCallback(async () => {
    if (!supabase) return;
    const { data: r, error } = await supabase.rpc('resumo_recebimentos', { p_filial: filial });
    if (error) {
      // RPC ausente (migração 618 pendente) — degrada para contador zerado e
      // botão "Gerar" começando em 000000001, do mesmo jeito que unidade nova.
      console.warn('[Recebimentos] resumo indisponível:', error.message);
      return;
    }
    setResumo({
      aguardando: Number(r?.aguardando_confirmacao ?? 0),
      maxNf: Number(r?.max_nf ?? 0),
      pedidosAConfirmar: new Set<string>(
        Array.isArray(r?.pedidos_a_confirmar) ? r.pedidos_a_confirmar.map(String) : []),
    });
  }, [filial]);
  useEffect(() => { reloadResumo(); }, [reloadResumo, data]);

  const aguardandoConfirmacao = resumo.aguardando;

  // Devoluções ao fornecedor por recebimento (migr. 423). Guarda quanto já
  // saiu de volta, para o teto do formulário e para o selo na linha.
  const [devolvido, setDevolvido] = useState<Record<string, number>>({});
  const [devolvendo, setDevolvendo] = useState<any | null>(null);
  // Turma com a migr. 423 pendente: o botão some em vez de abrir um modal que
  // termina em erro de PostgREST. O deploy do front chega antes do SQL.
  const [devolucaoDisponivel, setDevolucaoDisponivel] = useState(true);
  const reloadDevolucoes = useCallback(async () => {
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from('devolucoes_fornecedor')
      .select('recebimento_id, qtd')
      .eq('filial', filial)
      .eq('ativo', true);
    if (error) {
      // Migração pendente nesta turma: o botão some e o resto da tela segue.
      console.warn('[Recebimentos] devoluções indisponíveis:', error.message);
      setDevolvido({});
      setDevolucaoDisponivel(false);
      return;
    }
    setDevolucaoDisponivel(true);
    const map: Record<string, number> = {};
    (rows ?? []).forEach((d: any) => {
      map[d.recebimento_id] = (map[d.recebimento_id] ?? 0) + Number(d.qtd ?? 0);
    });
    setDevolvido(map);
  }, [filial]);
  useEffect(() => { reloadDevolucoes(); }, [reloadDevolucoes, data.length]);

  // Cache de saldo por pedido — recarrega quando a lista de pedidos ou de
  // recebimentos muda (usuário registra/inativa/confirma → saldo mexe).
  const [saldos, setSaldos] = useState<Record<string, SaldoPedido>>({});
  const reloadSaldos = useCallback(async () => {
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from('v_pedido_saldo')
      .select('pedido_id, qtd_pedida, qtd_recebida_total, qtd_saldo')
      .eq('filial', filial);
    if (error) {
      // View pode não existir ainda (migração 202 pendente) — degrada
      // silenciosamente para o comportamento antigo (sem validação).
      console.warn('[Recebimentos] saldo indisponível:', error.message);
      return;
    }
    const map: Record<string, SaldoPedido> = {};
    (rows ?? []).forEach((r: any) => {
      map[r.pedido_id] = {
        qtd_pedida: Number(r.qtd_pedida ?? 0),
        qtd_recebida_total: Number(r.qtd_recebida_total ?? 0),
        qtd_saldo: Number(r.qtd_saldo ?? 0),
      };
    });
    setSaldos(map);
  }, [filial]);
  useEffect(() => { reloadSaldos(); }, [reloadSaldos, pedidos.length, data.length]);

  // `recebido_em` é carimbado só na virada para 'Recebido' (migr. 421), então
  // "em entrega e sem essa data" pega o pedido parcialmente recebido — que a
  // régua ainda anterior ("nenhum recebimento ainda") deixava sumir da fila com
  // saldo em aberto — mas pega também o pedido cuja carga JÁ foi toda lançada e
  // só espera a conferência. Esse não está esperando carga: está esperando a
  // linha de baixo desta mesma faixa. Contado nas duas, virava um número que o
  // botão Registrar não sabia atender — o select de Pedido o mostra esgotado,
  // porque o banco recusaria a entrada (`fn_recebimento_nao_estoura_pedido`).
  //
  // A régua passa a ser o saldo (migr. 530), a mesma que a view
  // `v_pedidos_a_receber` dá à bolinha da barra lateral: badge e faixa
  // discordando sobre a mesma fila é bolinha que vira mentira.
  //
  // Saldo ainda não carregado conta: a faixa é aviso, e esconder fila por causa
  // de uma resposta em trânsito é pior que mostrá-la um segundo a mais.
  const pedidosAReceber = pedidos.filter((p: any) => {
    if (p.status !== 'Em Entrega' || p.recebido_em) return false;
    const s = saldos[p.id];
    return !s || s.qtd_saldo > 0.0005;
  }).length;

  // Retorna quanto o item atual pode chegar a receber, sem estourar o pedido.
  // saldo já EXCLUI o próprio recebimento (a view soma todos ativos, então
  // subtraímos o que já está lá pra devolvê-lo ao teto).
  const maxPermitido = (pedidoId: string, qtdAtualDoItem = 0): number => {
    const s = saldos[pedidoId];
    // Falha FECHADA. Era `return Infinity` — se a view v_pedido_saldo não
    // respondesse, o teto sumia e dava para receber qualquer quantidade contra
    // o pedido. Um erro de rede não pode virar permissão.
    if (!s) return NaN;
    return s.qtd_saldo + qtdAtualDoItem;
  };
  const semSaldoConhecido = (max: number) => Number.isNaN(max);
  // Com quantidade fracionária (migr. 439) a comparação exata trai: 12,5 lido do
  // banco e 12,5 digitado podem diferir na última casa do float e o teto acusa
  // excesso de nada. A escala do banco é 3 casas, então meia milésima de
  // tolerância é menor que qualquer valor representável ali.
  const excedeSaldo = (qtd: number, max: number) => qtd > max + 0.0005;

  /**
   * Status final da conferência, deduzido do saldo — a MESMA conta que a
   * trigger `fn_recebimento_status_pelo_saldo` faz (migr. 489). Aqui é só
   * espelho: quem decide é o banco, e o valor gravado volta no retorno do
   * update. Devolve também o que falta, porque é o número que a tela precisa
   * dizer em português.
   */
  const conferenciaDo = (item: any) => {
    const s = saldos[item.pedido_id];
    if (!s || !(s.qtd_pedida > 0)) {
      return { conhecido: false, fecha: false, falta: 0 };
    }
    // A view já conta este recebimento: a linha existe desde o Registrar.
    return { conhecido: true, fecha: s.qtd_saldo <= 0.0005, falta: Math.max(s.qtd_saldo, 0) };
  };
  const produtosOrdenados = useMemo(() => {
    // Normaliza nome: remove diacríticos, faz trim e baixa caixa.
    // Sem normalizar, `localeCompare` deixa itens com leading whitespace
    // (ou caracteres invisíveis tipo BOM) num bloco antes do A.
    const chave = (p: any) =>
      String(p.nome ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
    return [...produtos].sort((a: any, b: any) => chave(a).localeCompare(chave(b), 'pt-BR'));
  }, [produtos]);
  // Catálogo vazio da unidade: não é erro de carregamento, é turma que ainda
  // não cadastrou produto. Quem confirma recebimento precisa ver a diferença.
  const catalogoVazio = produtosOrdenados.length === 0;
  // Lote e validade só existem onde a mercadoria estraga. A régua é a FICHA do
  // nicho, não o nome da filial (mesmo critério de `temGrade` em Produtos): se
  // um dia outra unidade ganhar `perecivel`, os campos aparecem lá sem ninguém
  // mexer aqui. Hoje isso é só a mercearia.
  //
  // Não era cosmético: `ehPerecivel` é sempre falso fora do SuperMax, porque a
  // ficha nem tem o campo — o bloco ficava na tela dizendo "Só para perecível"
  // em toda linha da TechMax. E Lote era pior que inútil: ele só é gravado
  // JUNTO com a validade (o insert em vencimentos_estoque exige a data), então
  // lote digitado sem data era descartado em silêncio.
  const filialTemValidade = useMemo(
    () => (ATRIBUTOS_PRODUTO[filial] ?? []).some(d => d.key === 'perecivel'),
    [filial],
  );
  // Search agora é server-side; o enriched é só para juntar dados do pedido.
  const enriched = data.map((r: any) => ({ ...r, ped: pedidos.find((p: any) => p.id === r.pedido_id) }));

  const closeForm = () => {
    setShowForm(false); setForm({ pedido_id: '' });
    setExtras({ qtd_recebida: '', observacao: '', data: todayBR(), nf_numero: '', nf_serie: '1', nf_emissao: '' });
    setErrors({});
  };


  // Descrição do item do pedido — pré-preenche o nome no cadastro rápido.
  const descricaoDoPedido = (pedidoId: string): string => {
    const p = pedidos.find((x: any) => x.id === pedidoId);
    return p?.item_descricao ?? p?.req?.item ?? '';
  };

  // Produto que o pedido comprou (migr. 396). Vem da requisição de Reposição,
  // que nasce do catálogo — a compra Eventual não tem, e continua deixando o
  // almoxarife escolher. Enquanto o pedido não carregava isso, o select de
  // "Produto recebido" listava o catálogo inteiro e dava pra receber o pedido
  // de arroz dando entrada em notebook: a quantidade era criticada contra o
  // saldo, o produto contra nada.
  const produtoDoPedido = (pedidoId: string): string | null =>
    pedidos.find((x: any) => x.id === pedidoId)?.produto_id ?? null;

  // Serviço contratado (migr. 499). A categoria do item do pedido — material ou
  // serviço — é o que decide o que esta tela faz: material ENTRA no estoque,
  // serviço é ACEITE da execução. Serviço não tem saldo, lote, validade nem
  // número de série, e o banco recusa movimentação contra ele (trigger
  // `trg_mov_servico_nao_tem_saldo`); a tela nem tenta.
  const servicoDoPedido = (pedidoId: string): string | null =>
    pedidos.find((x: any) => x.id === pedidoId)?.servico_id ?? null;
  const ehServico = (pedidoId: string): boolean => !!servicoDoPedido(pedidoId);
  const nomeDoServico = (pedidoId: string): string | null => {
    const sid = servicoDoPedido(pedidoId);
    return sid ? servicos.find((s: any) => s.id === sid)?.nome ?? null : null;
  };

  /** O que chegou, em palavras. Produto do catálogo quando o pedido o carrega;
   *  senão a descrição que a requisição escreveu. Espaço em branco colapsado —
   *  as descrições vêm de planilha e trazem TAB no meio. */
  const nomeDoItem = (pedidoId: string): string => {
    const pid = produtoDoPedido(pedidoId);
    const doCatalogo = pid ? produtos.find((x: any) => x.id === pid)?.nome : null;
    return String(doCatalogo ?? nomeDoServico(pedidoId) ?? descricaoDoPedido(pedidoId) ?? '')
      .replace(/\s+/g, ' ').trim();
  };

  /**
   * Produto do painel de confirmação: vem do pedido (reposição) ou do select
   * (compra eventual). A ficha de perecível é lida daqui.
   */
  const produtoDoPainel = (item: any) => {
    const pid = produtoDoPedido(item.pedido_id) ?? confirmProduto;
    return pid ? produtos.find((x: any) => x.id === pid) ?? null : null;
  };

  // Unidade do produto do pedido selecionado. Manda no campo de quantidade:
  // recebimento de granel aceita fração, de caixa não (migr. 439). Pedido sem
  // produto vinculado (item livre) cai em vazio e o campo trata como discreto —
  // não há catálogo para dizer o contrário.
  const unidadePedidoSel = useMemo(() => {
    const pid = produtoDoPedido(form.pedido_id);
    const p = pid ? produtos.find((x: any) => x.id === pid) : null;
    return p ? normalizarUnidade(p.unidade) : '';
  }, [pedidos, produtos, form.pedido_id]);

  // Migr. 589: a carga chega em fardo, o estoque conta em unidade. Contar 20
  // fardos de 30 na mão e digitar 600 é onde nasce o inventário errado — e o
  // erro só aparece semanas depois, no balanço.
  const embPedidoSel = useMemo(() => {
    const pid = produtoDoPedido(form.pedido_id);
    return embalagemDoProduto(pid ? produtos.find((x: any) => x.id === pid) : null);
  }, [pedidos, produtos, form.pedido_id]);
  const [recebEmEmb, setRecebEmEmb] = useState(false);
  // Trocar de pedido troca de produto: o modo do pedido anterior não pode
  // sobreviver e multiplicar a quantidade pelo fardo errado.
  // Produto com embalagem de compra começa contando nela: é como a carga chega.
  useEffect(() => { setRecebEmEmb(!!embPedidoSel); }, [form.pedido_id, embPedidoSel?.nome, embPedidoSel?.fator]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!validate()) return;
    // Guard sincrônico, como no Confirmar: `isLoading={isSaving}` só desabilita
    // depois do re-render, e o duplo clique entra aqui duas vezes antes disso —
    // dois recebimentos da mesma carga, ou o 23505 da nota repetida.
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      // O que entra no estoque é sempre a unidade — o fardo é só a forma de
      // contar na doca (migr. 589).
      const qtd = qtdEmEstoque(extras.qtd_recebida, embPedidoSel, recebEmEmb);
      if (qtd <= 0) { showToast('Informe uma quantidade válida.', 'error', true); return; }
      const maxAceito = maxPermitido(form.pedido_id, 0);
      if (semSaldoConhecido(maxAceito)) {
        showToast('Não foi possível ler o saldo do pedido. Recarregue a tela antes de registrar.', 'error', true);
        return;
      }
      if (excedeSaldo(qtd, maxAceito)) {
        showToast(`Excede o saldo do pedido — máximo ${qtdBR(maxAceito)} ${unidadePedidoSel || 'un'}.`, 'error', true);
        return;
      }
      // `filial` é obrigatório: a coluna é NOT NULL DEFAULT 'SuperMax', então
      // sem isto todo recebimento da TechMax/MaxLook era gravado como SuperMax.
      const payload = {
        pedido_id: form.pedido_id, qtd_recebida: qtd, observacao: extras.observacao,
        status: 'Pendente', data: extras.data || todayBR(), filial,
        // Opcionais no Registrar (a nota pode chegar depois da carga) e
        // obrigatórios no Confirmar — quem cobra é a trigger da migr. 491.
        nf_numero:  extras.nf_numero.trim()  || null,
        nf_serie:   extras.nf_serie.trim()   || null,
        nf_emissao: extras.nf_emissao        || null,
      };
      const s = await dbInsert('/api/recebimentosview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      await reloadSaldos();
      showToast(ehServico(form.pedido_id)
        ? 'Registrado — o serviço ainda NÃO está aceito. Clique em Confirmar na linha para atestar a execução e liberar o pagamento.'
        : 'Recebimento registrado — o estoque ainda NÃO mudou. Clique em Confirmar na linha para dar entrada e liberar o pagamento.',
        'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  };

  // O texto antigo — "sairá da lista mas o histórico fica preservado" —
  // prometia o oposto do que acontecia num recebimento já conferido: a
  // movimentação de Entrada continuava ativa e o saldo, inflado. Quem barra
  // agora é o banco (migr. 546); aqui a linha só para de convidar.
  const handleDelete = async (id: string, status?: string) => {
    const conferido = status === 'Concluído' || status === 'Parcial';
    if (conferido) {
      await confirm(
        'Este recebimento já foi conferido: a mercadoria entrou no estoque e a conta do fornecedor '
        + 'foi liberada.\n\nEle não se exclui. Se a carga voltou para o fornecedor, use "Devolver ao '
        + 'fornecedor" na própria linha — é o que baixa o estoque, encolhe o lote e abate a conta a pagar.');
      return;
    }
    if (!await confirm('Inativar este recebimento? Nada entrou no estoque ainda — ele sai da lista e o histórico fica preservado.')) return;
    try {
      await dbDelete('/api/recebimentosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      await reloadSaldos();
      showToast('Recebimento inativado.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Recebimentos] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  const handleConfirmar = async (item: any) => {
    // Serviço (migr. 499): não há produto a escolher porque não há nada a
    // guardar. O que se confirma aqui é que a execução aconteceu — é a folha de
    // medição do ERP de verdade —, e o efeito é liberar o pagamento.
    const servico = ehServico(item.pedido_id);
    if (!servico && !confirmProduto) { showToast('Selecione o produto recebido.', 'error', true); return; }
    const qtdItem = parseQtd(item.qtd_recebida);
    if (!(qtdItem > 0)) { showToast('Quantidade inválida no recebimento.', 'error', true); return; }
    // Defesa em profundidade — bloqueia se o pedido foi editado depois do
    // registro e agora o total ficou acima do pedido.
    const maxAceito = maxPermitido(item.pedido_id, qtdItem);
    if (semSaldoConhecido(maxAceito)) {
      showToast('Não foi possível ler o saldo do pedido. Recarregue a tela antes de confirmar.', 'error', true);
      return;
    }
    if (excedeSaldo(qtdItem, maxAceito)) {
      showToast(`Recebimento excede o saldo do pedido — máximo ${qtdBR(maxAceito)}. Ajuste antes de confirmar.`, 'error', true);
      return;
    }
    // Perecível entrando sem data é o buraco que a migr. 424 abriu a tela para
    // fechar: sem lote não há fila de vencimento, não há remarcação e a perda
    // por validade — a segunda maior sangria de uma mercearia — continua
    // invisível. Avisa e deixa seguir: travar o almoxarifado por causa de um
    // campo do cadastro seria devolver a ele um problema de Cadastros.
    if (!confirmNf.numero.trim()) {
      showToast(servico
        ? 'Informe o número da nota fiscal do serviço — sem ela o financeiro não tem o que conferir e a conta fica impagável.'
        : 'Informe o número da nota fiscal que veio com a carga — sem ela a mercadoria não entra no estoque.',
        'error', true);
      return;
    }
    const conf = conferenciaDo(item);
    // Encerrar faltando mercadoria é decisão, não default: sem motivo o banco
    // recusa (migr. 489), e barrar aqui evita a ida perdida ao servidor.
    if (!conf.fecha && encerrarComSaldo && !motivoEncerramento.trim()) {
      showToast('Escreva o que aconteceu com o que falta antes de encerrar a entrega.', 'error', true);
      return;
    }
    const prodConfirm = servico ? null : produtos.find((p: any) => p.id === confirmProduto);
    if (ehPerecivel(prodConfirm) && !confirmValidade) {
      const segue = await confirm(
        `"${prodConfirm?.nome ?? 'Este produto'}" é perecível e está entrando sem data de validade.\n\n`
        + 'Sem ela o lote não é criado: o item não aparece na fila de Validades, ninguém é avisado '
        + 'antes de vencer e a perda não entra em lugar nenhum.\n\nConfirmar mesmo assim?');
      if (!segue) return;
    }

    // Aparelho com número de série: um IMEI por unidade recebida (migr. 444).
    // Divergência entre a contagem e a quantidade avisa e deixa seguir — a
    // carga pode ter chegado com 8 de 10, e é isso que "Parcial" quer dizer.
    const imeisInformados = confirmImeis
      .split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
    if (requerImei(prodConfirm)) {
      if (imeisInformados.length === 0) {
        const segue = await confirm(
          `"${prodConfirm?.nome ?? 'Este produto'}" tem número de série por unidade e nenhum foi informado.\n\n`
          + 'Sem os números, a loja não sabe qual aparelho vendeu para quem: garantia, recall e '
          + 'procedência ficam sem resposta.\n\nConfirmar mesmo assim?');
        if (!segue) return;
      } else if (imeisInformados.length !== Math.floor(qtdItem)) {
        const segue = await confirm(
          `Você informou ${imeisInformados.length} número(s) para ${qtdBR(qtdItem)} unidade(s) recebida(s).\n\n`
          + 'Confirmar assim mesmo?');
        if (!segue) return;
      }
    }

    // Guard sincrônico contra double-click (vide ref acima).
    if (confirmingRef.current === item.id) return;
    confirmingRef.current = item.id;
    setConfirmSaving(true);
    try {
      const today = todayBR();
      // Movimentação PRIMEIRO — se falhar, status fica Pendente e o botão "Confirmar" reaparesce para retry.
      // Só atualiza o status após a movimentação estar salva no banco.
      // A entrada acontece sempre: a mercadoria que chegou entrou, seja a
      // entrega completa ou não. O que o saldo decide é se o PEDIDO fecha.
      //
      // Serviço não passa por aqui: não há saldo a mover. O banco recusaria de
      // qualquer jeito (migr. 499), mas mandar o insert só para ver o erro
      // voltar seria transformar a régua certa em mensagem vermelha na cara de
      // quem fez tudo certo.
      if (!servico) {
        try {
          await dbInsert('/api/movimentacoesestoqueview', {
            produto_id:     confirmProduto,
            tipo:           'Entrada',
            qtd:            parseQtd(item.qtd_recebida),
            origem:         numeroPedido(item.ped ?? { id: item.pedido_id }),
            destino:        'Almoxarifado',
            data:           today,
            recebimento_id: item.id,
            filial,
          });
        } catch (movErr: any) {
          // 23505 = violação de UNIQUE: este recebimento já gerou movimento
          // (race em outra aba/clique). Idempotência: tratamos como sucesso.
          const msg = String(movErr?.message ?? '');
          const isDuplicate = msg.includes('uq_mov_estoque_por_recebimento')
                            || msg.includes('23505')
                            || /duplicate key value/i.test(msg);
          if (!isDuplicate) throw movErr;
        }
      }
      // Lote com validade (migr. 424). Depois da entrada e fora do caminho
      // crítico: se falhar, o estoque já subiu e o lote pode ser registrado
      // depois em Estoque → Validades — travar a confirmação por causa disto
      // seria pior que o problema.
      if (!servico && confirmValidade && confirmProduto) {
        try {
          await dbInsert('/api/vencimentosestoqueview', {
            produto_id:     confirmProduto,
            lote:           confirmLote.trim() || null,
            vencimento:     confirmValidade,
            qtd:            parseQtd(item.qtd_recebida),
            status:         'OK',
            recebimento_id: item.id,
            filial,
          });
        } catch (loteErr: any) {
          console.warn('[Recebimentos] lote não registrado:', loteErr?.message);
          showToast('Entrada confirmada, mas o lote/validade não foi gravado. Registre em Estoque → Validades.', 'info', true);
        }
      }

      // Unidades com número de série (migr. 444). Fora do caminho crítico, como
      // o lote: se a RPC recusar um IMEI repetido, o estoque já subiu e o
      // conferente corrige o número — travar a entrada da carga por causa de um
      // dígito seria devolver ao almoxarifado um problema de digitação.
      if (imeisInformados.length > 0 && requerImei(prodConfirm) && supabase) {
        const { error: imeiErr } = await supabase.rpc('registrar_unidades_recebidas', {
          p_recebimento_id: item.id,
          p_produto_id:     confirmProduto,
          p_filial:         filial,
          p_imeis:          imeisInformados,
        });
        if (imeiErr) {
          showToast(`Entrada confirmada, mas os IMEIs não foram gravados: ${imeiErr.message}`, 'error', true);
        }
      }

      // Manda a INTENÇÃO ('Concluído') e a decisão de encerrar; quem grava o
      // status é a trigger da migr. 489, a partir do saldo. `salvo.status` é o
      // que de fato ficou no banco — usar o palpite do cliente aqui era como o
      // bug começava.
      const salvo = await dbUpdate<any>('/api/recebimentosview', item.id, {
        status: 'Concluído',
        encerrado_com_saldo: !conf.fecha && encerrarComSaldo,
        motivo_encerramento: !conf.fecha && encerrarComSaldo ? motivoEncerramento.trim() : null,
        nf_numero:  confirmNf.numero.trim(),
        nf_serie:   confirmNf.serie.trim() || null,
        nf_emissao: confirmNf.emissao || null,
      });
      const statusFinal = salvo?.status ?? (conf.fecha ? 'Concluído' : 'Parcial');
      setData((prev: any[]) => prev.map(r => r.id === item.id ? { ...r, ...(salvo ?? { status: statusFinal }) } : r));
      await reloadSaldos();

      // Quem fecha o pedido é o banco (migr. 531). Aqui havia um segundo update
      // em `pedidos`, guardado por um `pedidos.find()` num array em memória e
      // com o erro engolido por um `catch` vazio: array desatualizado, ou RLS
      // recusando (`recebimentos` aceita setor 'estoque', `pedidos` não), e o
      // pedido ficava aberto para sempre sem ninguém saber. O status novo chega
      // pelo realtime de `pedidos`, que esta tela já assina.

      setConfirmando(null);
      setConfirmProduto('');
      setConfirmLote('');
      setConfirmImeis('');
      setConfirmValidade('');
      setEncerrarComSaldo(false);
      setMotivoEncerramento('');
      setConfirmNf({ numero: '', serie: '', emissao: '' });
      showToast(
        servico
          ? (statusFinal !== 'Concluído'
              ? `Aceite registrado. O contrato segue em execução: faltam ${qtdBR(conf.falta)} para fechar, e a conta do fornecedor só libera quando fechar.`
              : 'Serviço aceito. Nada entrou em estoque — serviço não tem saldo. A conta está liberada para pagamento em Financeiro → Contas a pagar, e o custo entra no resultado como despesa do período.')
        : statusFinal !== 'Concluído'
          ? `Entrada confirmada e estoque atualizado. O pedido segue em entrega: faltam ${qtdBR(conf.falta)} para fechar, e a conta do fornecedor só libera quando a entrega fechar.`
          : encerrarComSaldo && !conf.fecha
            ? 'Entrega encerrada com saldo em aberto. O que chegou entrou no estoque, o pedido foi fechado e a conta do fornecedor está liberada em Financeiro → Contas a pagar — confira o valor, ele é o do pedido inteiro.'
            : 'Recebimento confirmado, estoque atualizado e pedido encerrado. A conta do fornecedor está liberada para pagamento em Financeiro → Contas a pagar.',
        'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setConfirmSaving(false);
      confirmingRef.current = null;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Recebimentos — {filial}</h2>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Registrar</NeuButtonAccent>
        </div>
      </div>

      <FilaDeTrabalho itens={[
        { label: 'pedido(s) em entrega a receber', count: pedidosAReceber, hint: 'clique em "Registrar" quando a carga chegar' },
        { label: 'recebimento(s) aguardando confirmação', count: aguardandoConfirmacao, hint: 'até confirmar, o estoque não mudou' },
      ]} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Novo Recebimento</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Pedido *" error={errors.pedido_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.pedido_id ? 'border border-red-500/40' : ''}`} value={form.pedido_id} onChange={e => { setForm(f => ({ ...f, pedido_id: e.target.value })); clearError('pedido_id'); }}><option value="">Selecione...</option>{pedidosAtivos.map((p: any) => {
                  const desc = p.item_descricao ?? p.req?.item ?? '';
                  const s = saldos[p.id];
                  const sufSaldo = s ? ` — falta ${qtdBR(s.qtd_saldo)}/${qtdBR(s.qtd_pedida)}` : '';
                  const esgotado = s && s.qtd_saldo <= 0.0005;
                  // Esgotado sem dizer por quê fazia o aluno reler a lista à
                  // procura da linha que sumiu. A carga inteira já foi lançada:
                  // o que falta é confirmar a entrada na tabela abaixo, e é
                  // isso que a opção cinza passa a dizer.
                  const pendenteDeConfirmar = esgotado && resumo.pedidosAConfirmar.has(String(p.id));
                  // Serviço na mesma lista, marcado (migr. 499): quem abre esta
                  // tela procura "o que chegou", e contratação não chega em
                  // caixa. O selo evita o susto de não achar a dedetização.
                  const selo = p.servico_id ? ' [serviço]' : '';
                  return <option key={p.id} value={p.id} disabled={esgotado}>{numeroPedido(p)}{selo}{desc ? ` — ${desc}` : ''}{sufSaldo}{esgotado ? (pendenteDeConfirmar ? ' (carga já lançada — falta confirmar abaixo)' : ' (recebido totalmente)') : ''}</option>;
                })}</select></FormField>
                {/* A unidade é a do produto do pedido — mercearia recebe 12,5 KG
                    (migr. 439). `type=number` recusava a vírgula do teclado pt-BR
                    e devolvia campo vazio. */}
                <QuantidadeEmbalagem
                  label="Qtd Recebida"
                  unidade={unidadePedidoSel}
                  embalagem={embPedidoSel}
                  emEmbalagem={recebEmEmb}
                  onModo={setRecebEmEmb}
                  value={extras.qtd_recebida}
                  onChange={v => setExtras(x => ({ ...x, qtd_recebida: v }))}
                />
                <FormField label="Data da chegada">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    max={todayBR()}
                    value={extras.data}
                    onChange={e => setExtras(x => ({ ...x, data: e.target.value }))} />
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    Quando a carga chegou de verdade, não quando você está lançando. É esta data
                    que mede a pontualidade do fornecedor.
                  </p>
                </FormField>
                <FormField label="Nota fiscal — número">
                  <div className="flex gap-2">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-0"
                      value={extras.nf_numero}
                      onChange={e => setExtras(x => ({ ...x, nf_numero: e.target.value }))}
                      placeholder="Ex.: 000123456" />
                    {/* Sequencial, não sorteado — lê o maior número já usado
                        nesta filial e sugere o próximo. Mesma régua do Gerar
                        de código em Cadastros > Produtos. */}
                    <button type="button"
                      onClick={() => setExtras(x => ({ ...x, nf_numero: proximoNumeroNfDeMaior(resumo.maxNf) }))}
                      className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0">
                      Gerar
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    O documento que veio com a carga. Pode ficar em branco agora, mas sem ele a
                    entrada não é confirmada — e o financeiro não tem o que conferir contra o pedido.
                  </p>
                </FormField>
                <FormField label="Nota — série">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.nf_serie}
                    onChange={e => setExtras(x => ({ ...x, nf_serie: e.target.value }))}
                    placeholder="Ex.: 1" />
                </FormField>
                <FormField label="Nota — emissão">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    max={todayBR()}
                    value={extras.nf_emissao}
                    onChange={e => setExtras(x => ({ ...x, nf_emissao: e.target.value }))} />
                </FormField>
                <FormField label="Observação"><input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.observacao} onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))} placeholder="Opcional..." /></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4">Pedido</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Observação</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : enriched.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <React.Fragment key={item.id}>
                      <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        {/* O código do pedido sozinho não diz o que chegou:
                            a tela listava PC-TM-2026-0011 e o conferente tinha
                            de abrir o Confirmar para descobrir se era o tablet
                            ou o roteador. O nome vem do produto quando o pedido
                            o carrega (Reposição) e da descrição da requisição
                            quando é compra eventual. */}
                        <td className="py-3 px-4 text-xs">
                          <span className="font-credencial text-gray-300">{numeroPedido(item.ped ?? { id: item.pedido_id })}</span>
                          {nomeDoItem(item.pedido_id) && (
                            <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{nomeDoItem(item.pedido_id)}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          {item.qtd_recebida != null ? qtdBR(item.qtd_recebida) : '—'}
                          {(devolvido[item.id] ?? 0) > 0 && (
                            <div className="text-[10px] text-amber-400 mt-0.5" title="Devolvido ao fornecedor por divergência.">
                              − {qtdBR(devolvido[item.id] ?? 0)} devolvido
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.observacao || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-center items-center gap-1.5">
                            {devolucaoDisponivel
                              && (item.status === 'Concluído' || item.status === 'Parcial')
                              && (parseQtd(item.qtd_recebida) - (devolvido[item.id] ?? 0)) > 0 && (
                              <button
                                onClick={() => setDevolvendo(item)}
                                title="Chegou avariado, errado ou a mais? Devolva ao fornecedor."
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-amber-400 hover:bg-amber-400/10 transition-colors flex items-center gap-1"
                              >
                                <PackageX size={11} /> Divergência
                              </button>
                            )}
                            {/* Confirmado antes da migr. 491, ou nota que chegou depois
                                da carga: sem este número a conta do fornecedor não passa
                                na conferência do financeiro e fica impagável. */}
                            {(item.status === 'Concluído' || item.status === 'Parcial') && !item.nf_numero && (
                              <button
                                onClick={() => { setNotaAtrasada(item); setNotaForm({ numero: '', serie: '1', emissao: '' }); }}
                                title="Este recebimento entrou sem nota fiscal. Informe o número para o financeiro poder conferir e pagar."
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-amber-400 hover:bg-amber-400/10 transition-colors flex items-center gap-1"
                              >
                                Nota pendente
                              </button>
                            )}
                            {item.status === 'Pendente' && (
                              <button
                                onClick={() => {
                                  const abrindo = confirmando !== item.id;
                                  setConfirmando(abrindo ? item.id : null);
                                  // A ficha de perecível (migr. 360) prometia
                                  // "prazo desde o recebimento" e nunca era
                                  // lida: a data era digitada à mão, lote a
                                  // lote. Aqui ela vira conta — data da carga +
                                  // validade_dias — e continua editável, porque
                                  // o prazo do cadastro é o padrão do produto,
                                  // não a validade impressa naquela caixa.
                                  if (abrindo) {
                                    const pid = produtoDoPedido(item.pedido_id);
                                    const prod = pid ? produtos.find((x: any) => x.id === pid) : null;
                                    const prevista = prod
                                      ? vencimentoPrevisto(prod, item.data ?? todayBR())
                                      : null;
                                    setConfirmValidade(prevista ?? '');
                                  }
                                  // Pedido com produto declarado já abre resolvido: não há
                                  // escolha a fazer, e deixar o campo vazio faria o almoxarife
                                  // procurar no catálogo o que o pedido já diz.
                                  setConfirmProduto(produtoDoPedido(item.pedido_id) ?? '');
                                  // O auto-status daqui existia e estava certo — só que
                                  // ia para um <select> que o conferente reabria. Agora a
                                  // conta é feita no painel (conferenciaDo) e no banco
                                  // (migr. 489), e o que se limpa aqui é a decisão humana
                                  // que sobrou: encerrar a entrega faltando mercadoria.
                                  setEncerrarComSaldo(false);
                                  setMotivoEncerramento('');
                                  setConfirmNf({
                                    numero:  item.nf_numero  ?? '',
                                    // Série é constante em quase toda empresa — 1, salvo
                                    // exceção rara. O default poupa o clique de digitar
                                    // o óbvio; continua editável.
                                    serie:   item.nf_serie   ?? '1',
                                    emissao: item.nf_emissao ?? '',
                                  });
                                }}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
                              >
                                <CheckCircle2 size={11} /> Confirmar <ChevronDown size={10} className={`transition-transform ${confirmando === item.id ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            <MenuMais>
                              {fechar => (
                                <>
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="recebimentos" entidadeId={item.id} titulo={`Recebimento ${String(item.id).slice(-6).toUpperCase()}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  <ItemMenu onClick={() => { fechar(); handleDelete(item.id, item.status); }}
                                    cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                    Excluir
                                  </ItemMenu>
                                </>
                              )}
                            </MenuMais>
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {confirmando === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)' }}>
                                {saldos[item.pedido_id] && (
                                  <div className="basis-full flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 -mt-1 mb-1">
                                    <span>Pedido: <strong className="text-gray-200">{qtdBR(saldos[item.pedido_id].qtd_pedida)}</strong></span>
                                    <span>Já recebido: <strong className="text-gray-200">{qtdBR(saldos[item.pedido_id].qtd_recebida_total)}</strong></span>
                                    <span>Saldo restante: <strong className={saldos[item.pedido_id].qtd_saldo > 0 ? 'text-amber-300' : 'text-emerald-300'}>{qtdBR(saldos[item.pedido_id].qtd_saldo)}</strong></span>
                                  </div>
                                )}
                                {/* Pedido de Reposição já sabe o produto: o campo vira leitura.
                                    A trava de verdade está na trigger da migr. 396 — esta tela
                                    só evita que o almoxarife tenha de adivinhar (e o F12 não
                                    passa pelo <select> mesmo). */}
                                {/* Serviço (migr. 499): não há produto, não há
                                    lote, não há número de série — há uma
                                    execução a atestar. O painel diz isso em vez
                                    de mostrar campos que não se aplicam. */}
                                {ehServico(item.pedido_id) ? (
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Serviço contratado</span>
                                  <div className="neu-pressed py-2 px-3 rounded-xl text-xs text-gray-200 flex items-center gap-1.5">
                                    <Lock size={11} className="text-gray-500 shrink-0" />
                                    {nomeDoServico(item.pedido_id) ?? descricaoDoPedido(item.pedido_id) ?? '—'}
                                  </div>
                                  <p className="text-[10px] text-gray-500 leading-snug">
                                    Isto é um <span className="text-gray-300 font-semibold">aceite</span>, não uma entrada:
                                    você está atestando que o serviço foi executado. Nada entra no estoque —
                                    serviço não tem saldo. O que a confirmação faz é liberar o pagamento.
                                  </p>
                                </div>
                                ) : produtoDoPedido(item.pedido_id) ? (
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Produto recebido</span>
                                  <div className="neu-pressed py-2 px-3 rounded-xl text-xs text-gray-200 flex items-center gap-1.5">
                                    <Lock size={11} className="text-gray-500 shrink-0" />
                                    {produtos.find((p: any) => p.id === produtoDoPedido(item.pedido_id))?.nome
                                      ?? descricaoDoPedido(item.pedido_id) ?? '—'}
                                  </div>
                                  <p className="text-[10px] text-gray-500">
                                    Definido no pedido, herdado da requisição. Chegou outra coisa? Não confirme —
                                    registre a divergência com Compras.
                                  </p>
                                </div>
                                ) : (
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <label htmlFor={`receb-produto-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Produto recebido *</label>
                                  <select
                                    id={`receb-produto-${item.id}`}
                                    className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                                    value={confirmProduto}
                                    onChange={e => {
                                      setConfirmProduto(e.target.value);
                                      // Compra eventual: a ficha só é conhecida
                                      // depois de o produto ser escolhido, então
                                      // a data prevista é calculada aqui.
                                      const prod = produtos.find((x: any) => x.id === e.target.value);
                                      setConfirmValidade(
                                        (prod ? vencimentoPrevisto(prod, item.data ?? todayBR()) : null) ?? '');
                                    }}
                                  >
                                    <option value="">
                                      {catalogoVazio ? 'Nenhum produto cadastrado nesta unidade' : 'Selecione o produto...'}
                                    </option>
                                    {produtosOrdenados.map((p: any) => <option key={p.id} value={p.id}>{p.nome} (saldo: {qtdBR(p.estoque ?? 0)} {normalizarUnidade(p.unidade)})</option>)}
                                  </select>
                                  {/* Catálogo vazio é o estado normal de turma nova: nenhum
                                      produto cadastrado ainda, e todo pedido é compra eventual.
                                      A lista abria muda e o conferente ficava clicando no
                                      <select> sem entender por que não havia opção — o aviso
                                      abaixo era um parágrafo cinza de rodapé que ninguém lia.
                                      Sem produto no catálogo não há o que escolher, e a tela
                                      passa a dizer isso primeiro. */}
                                  {/* "já aparece lá como sugestão" foi lido como
                                      "o produto já está cadastrado, é só escolher" —
                                      e não é: a sugestão é do campo "Item comprado"
                                      DENTRO do formulário de cadastro, que preenche
                                      nome, fornecedor e custo. Ainda há uma ficha a
                                      completar. O texto agora diz o caminho na
                                      ordem em que se clica. */}
                                  {catalogoVazio ? (
                                  <p className="text-[10px] leading-snug text-amber-300/90">
                                    O catálogo desta unidade ainda está vazio — não há o que listar aqui.
                                    Vá em <span className="font-semibold">Cadastros &gt; Produtos &gt; Novo</span>,
                                    escolha “{descricaoDoPedido(item.pedido_id) || 'o item deste pedido'}” no campo
                                    <span className="font-semibold"> Item comprado</span> (ele traz nome, fornecedor e custo deste pedido),
                                    complete a ficha e salve — o produto nasce com saldo zero, e é o certo.
                                    Depois volte nesta linha e clique em Confirmar: é aqui que a quantidade entra no estoque.
                                  </p>
                                  ) : (
                                  <p className="text-[10px] text-gray-500 leading-snug">
                                    Compra eventual não vem do catálogo, então o produto é escolhido aqui.
                                    Não está na lista? Cadastre em <span className="text-gray-300 font-semibold">Cadastros &gt; Produtos &gt; Novo</span>,
                                    escolhendo “{descricaoDoPedido(item.pedido_id) || 'o item deste pedido'}” no campo
                                    <span className="text-gray-300 font-semibold"> Item comprado</span> — ele já traz fornecedor e custo deste pedido.
                                    Salve com saldo zero e volte aqui para confirmar a entrada.
                                  </p>
                                  )}
                                </div>
                                )}
                                {filialTemValidade && !ehServico(item.pedido_id) && (<>
                                {/* Validade da carga (migr. 424). Preenchido
                                    aqui, o lote entra na fila do FEFO já com a
                                    origem — depois vira digitação retroativa. */}
                                <div className="flex flex-col gap-1 sm:w-32">
                                  <label htmlFor={`receb-lote-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Lote</label>
                                  <input id={`receb-lote-${item.id}`} className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                                    value={confirmLote} onChange={e => setConfirmLote(e.target.value)} placeholder="opcional" />
                                </div>
                                {(() => {
                                  const prod = produtoDoPainel(item);
                                  const perec = ehPerecivel(prod);
                                  const dias  = validadeDias(prod);
                                  const arm   = armazenagemDe(prod);
                                  const sugerida = prod ? vencimentoPrevisto(prod, item.data ?? todayBR()) : null;
                                  return (
                                <div className="flex flex-col gap-1 sm:w-44">
                                  <label htmlFor={`receb-validade-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                                    Validade
                                    {perec && (
                                      <span className="normal-case tracking-normal text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 border border-amber-400/25">
                                        perecível
                                      </span>
                                    )}
                                    {arm && arm !== 'Ambiente' && (
                                      <span className={`normal-case tracking-normal text-[9px] font-black px-1.5 py-0.5 rounded ${ARMAZENAGEM_ESTILO[arm]}`}>
                                        {arm}
                                      </span>
                                    )}
                                  </label>
                                  <input id={`receb-validade-${item.id}`} type="date" className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                                    value={confirmValidade} onChange={e => setConfirmValidade(e.target.value)} />
                                  <span className="text-[10px] text-gray-500 leading-snug">
                                    {dias !== null && sugerida
                                      ? <>Calculada: {dias} dia(s) do cadastro a partir de {fmtDataBR(item.data)}. Ajuste se a caixa vier com outra.</>
                                      : perec
                                        ? <span className="text-amber-400/90">Perecível sem prazo no cadastro — informe a data à mão.</span>
                                        : <>Só para perecível.</>}
                                  </span>
                                </div>
                                  );
                                })()}
                                </>)}
                                {/* IMEI/serial por unidade (migr. 444). Só para
                                    produto marcado no cadastro: pedir número de
                                    série de saco de arroz seria ruído. */}
                                {requerImei(produtoDoPainel(item)) && (
                                  <div className="flex flex-col gap-1 sm:w-56">
                                    <label htmlFor={`receb-imei-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                                      IMEI / Série
                                      <span className="normal-case tracking-normal text-[9px] font-black px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-400 border border-sky-400/25">
                                        1 por unidade
                                      </span>
                                    </label>
                                    <textarea id={`receb-imei-${item.id}`} rows={3}
                                      className="neu-input py-2 px-3 rounded-xl text-xs w-full font-mono"
                                      placeholder={'359123456789012\n359123456789013'}
                                      value={confirmImeis}
                                      onChange={e => setConfirmImeis(e.target.value)} />
                                    {/* O número mora na caixa, e a caixa está
                                        aqui — por isso o campo continua no
                                        recebimento. O que não cabe na aula é
                                        digitar 30 números de 15 dígitos: o botão
                                        gera a lista inteira do tamanho da carga,
                                        com TAC do modelo e dígito de Luhn, igual
                                        ao "Gerar" do EAN em Cadastros. */}
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const qtd = Math.floor(parseQtd(item.qtd_recebida)) || 0;
                                        if (qtd <= 0) { showToast('Quantidade recebida inválida.', 'error', true); return; }
                                        if (confirmImeis.trim() && !await confirm(
                                          `Substituir os números já digitados por ${qtd} gerado(s)?`)) return;
                                        setConfirmImeis(gerarImeis(qtd, confirmProduto).join('\n'));
                                      }}
                                      className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-sky-400 hover:bg-sky-400/10 transition-colors self-start"
                                    >
                                      Gerar {Math.floor(parseQtd(item.qtd_recebida)) || 0} número(s)
                                    </button>
                                    <span className="text-[10px] text-gray-500 leading-snug">
                                      Um número por linha. É o que liga o aparelho ao cliente na venda — sem ele,
                                      garantia e recall não têm resposta. Sem as caixas na mão, use o Gerar: os 8
                                      primeiros dígitos são do modelo, como no aparelho de verdade.
                                    </span>
                                  </div>
                                )}
                                {/* A nota é o documento da carga, e a doca é quem o tem
                                    na mão. Valor não aparece aqui de propósito: quem
                                    confere preço é o financeiro, contra o pedido (migr.
                                    491) — conferente que enxerga valor é conferente que
                                    "ajusta" a nota para a carga passar. */}
                                <div className="flex flex-col gap-1 basis-full sm:basis-auto sm:flex-1 sm:min-w-[200px]">
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Nota fiscal *</span>
                                  <div className="flex gap-2">
                                    <input className="neu-input py-2 px-3 rounded-xl text-xs flex-1 min-w-0"
                                      value={confirmNf.numero}
                                      onChange={e => setConfirmNf(n => ({ ...n, numero: e.target.value }))}
                                      placeholder="Número" />
                                    <button type="button"
                                      onClick={() => setConfirmNf(n => ({ ...n, numero: proximoNumeroNfDeMaior(resumo.maxNf) }))}
                                      title="Sugerir o próximo número desta filial"
                                      className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0">
                                      Gerar
                                    </button>
                                    <input className="neu-input py-2 px-3 rounded-xl text-xs w-16 shrink-0"
                                      value={confirmNf.serie}
                                      onChange={e => setConfirmNf(n => ({ ...n, serie: e.target.value }))}
                                      placeholder="1" />
                                  </div>
                                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                                    max={todayBR()}
                                    value={confirmNf.emissao}
                                    onChange={e => setConfirmNf(n => ({ ...n, emissao: e.target.value }))} />
                                  <p className="text-[10px] text-gray-500 leading-snug">
                                    {ehServico(item.pedido_id)
                                      ? <>Serviço também tem nota — sem ela o financeiro não tem o que conferir e a
                                          conta fica impagável. O valor não é digitado aqui: quem confere quanto está
                                          sendo cobrado é o financeiro, contra o pedido.</>
                                      : <>Sem nota a mercadoria não entra. O valor não é digitado aqui — quem
                                          confere quanto está sendo cobrado é o financeiro, contra o pedido.</>}
                                  </p>
                                </div>
                                {/* Era um <select> com "Concluído" pré-selecionado,
                                    logo abaixo do saldo que a própria tela imprime:
                                    a pergunta já estava respondida ali em cima, e a
                                    resposta errada ou trancava o pagamento para
                                    sempre ou fechava o pedido com carga por chegar
                                    (migr. 489). Agora é leitura. */}
                                {(() => {
                                  const conf = conferenciaDo(item);
                                  if (!conf.conhecido) {
                                    return (
                                      <div className="basis-full text-[11px] text-amber-300/90">
                                        Não foi possível ler o saldo deste pedido — recarregue a tela antes de confirmar.
                                      </div>
                                    );
                                  }
                                  return (
                                    <div className="flex flex-col gap-1 basis-full sm:basis-auto sm:flex-1 sm:min-w-[220px]">
                                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status final</span>
                                      <div className="neu-pressed py-2 px-3 rounded-xl text-xs text-gray-200 flex items-center gap-1.5">
                                        <Lock size={11} className="text-gray-500 shrink-0" />
                                        {conf.fecha
                                          ? 'Concluído — esta entrega fecha o pedido'
                                          : encerrarComSaldo
                                            ? 'Concluído — encerrado com falta'
                                            : `Parcial — faltam ${qtdBR(conf.falta)}`}
                                      </div>
                                      <p className="text-[10px] text-gray-500 leading-snug">
                                        {conf.fecha
                                          ? 'A quantidade fechou. O pedido encerra e a conta do fornecedor libera para pagamento.'
                                          : ehServico(item.pedido_id)
                                            ? 'Vem do saldo do pedido, não de escolha: o que foi executado fica aceito agora e o contrato continua aberto, esperando o resto.'
                                            : 'Vem do saldo do pedido, não de escolha: o que chegou entra no estoque agora e o pedido continua em entrega, esperando o resto.'}
                                      </p>
                                      {/* A saída para o caso real: o fornecedor avisou
                                          que não manda o resto. Existe, mas é ato
                                          deliberado e com motivo — não o default. */}
                                      {!conf.fecha && (
                                        <div className="mt-1.5 flex flex-col gap-1.5">
                                          <label className="flex items-start gap-2 cursor-pointer">
                                            <input type="checkbox" className="mt-0.5 accent-amber-400"
                                              checked={encerrarComSaldo}
                                              onChange={e => { setEncerrarComSaldo(e.target.checked); if (!e.target.checked) setMotivoEncerramento(''); }} />
                                            <span className="text-[10px] text-amber-300/90 leading-snug">
                                              Encerrar a entrega faltando {qtdBR(conf.falta)} — o resto não vem
                                            </span>
                                          </label>
                                          {encerrarComSaldo && (
                                            <>
                                              <textarea rows={2} className="neu-input py-2 px-3 rounded-xl text-xs w-full resize-none"
                                                value={motivoEncerramento}
                                                onChange={e => setMotivoEncerramento(e.target.value)}
                                                placeholder="O que aconteceu com o que falta? Ex.: fornecedor cancelou o saldo, item descontinuado." />
                                              <p className="text-[10px] text-amber-300/80 leading-snug">
                                                O pedido fecha assim mesmo e a conta libera pelo valor cheio do pedido —
                                                se você pagou por mais do que recebeu, ajuste com o fornecedor.
                                              </p>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmar(item)} disabled={confirmSaving}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {confirmSaving ? 'Salvando...'
                                      : ehServico(item.pedido_id)
                                        ? <><Save size={12} /> Aceitar o serviço e liberar pagamento</>
                                        : <><Save size={12} /> Confirmar e atualizar estoque</>}
                                  </button>
                                  <button onClick={() => setConfirmando(null)} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center">Cancelar</button>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))}
                </AnimatePresence>
              )}
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

      {/* Nota que chegou depois da carga (migr. 491). Não desfaz a entrada nem
          mexe no estoque: só preenche o documento que faltava, para o financeiro
          poder conferir contra o pedido e pagar. */}
      <AnimatePresence>
        {notaAtrasada && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !notaSalvando && setNotaAtrasada(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-md flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-300">
                  Nota fiscal da carga
                  <span className="text-accent ml-2 font-credencial">— {numeroPedido(notaAtrasada.ped ?? { id: notaAtrasada.pedido_id })}</span>
                </h3>
                <button onClick={() => !notaSalvando && setNotaAtrasada(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Esta entrada foi confirmada sem o número da nota. O estoque já subiu e continua como
                está — o que falta é o documento, e sem ele o financeiro não consegue conferir o que
                está sendo cobrado contra o pedido. A conta do fornecedor fica impagável até isso.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <FormField label="Número *">
                    <div className="flex gap-2">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-0"
                        value={notaForm.numero}
                        onChange={e => setNotaForm(n => ({ ...n, numero: e.target.value }))}
                        placeholder="Ex.: 000123456" />
                      <button type="button"
                        onClick={() => setNotaForm(n => ({ ...n, numero: proximoNumeroNfDeMaior(resumo.maxNf) }))}
                        className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0">
                        Gerar
                      </button>
                    </div>
                  </FormField>
                </div>
                <FormField label="Série">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={notaForm.serie}
                    onChange={e => setNotaForm(n => ({ ...n, serie: e.target.value }))}
                    placeholder="1" />
                </FormField>
              </div>
              <FormField label="Emissão">
                <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                  max={todayBR()}
                  value={notaForm.emissao}
                  onChange={e => setNotaForm(n => ({ ...n, emissao: e.target.value }))} />
              </FormField>
              <div className="flex justify-end gap-2">
                <button onClick={() => setNotaAtrasada(null)} disabled={notaSalvando}
                  className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400 disabled:opacity-50">Cancelar</button>
                <NeuButtonAccent
                  isLoading={notaSalvando}
                  disabled={!notaForm.numero.trim()}
                  onClick={async () => {
                    setNotaSalvando(true);
                    try {
                      const salvo = await dbUpdate<any>('/api/recebimentosview', notaAtrasada.id, {
                        nf_numero:  notaForm.numero.trim(),
                        nf_serie:   notaForm.serie.trim() || null,
                        nf_emissao: notaForm.emissao || null,
                      });
                      setData((prev: any[]) => prev.map(r => r.id === notaAtrasada.id ? { ...r, ...(salvo ?? {}) } : r));
                      setNotaAtrasada(null);
                      showToast('Nota registrada. O financeiro já pode conferir o valor contra o pedido em Contas a pagar.', 'success', true);
                    } catch (err: any) {
                      showToast(`Erro ao gravar a nota: ${err?.message ?? 'verifique o console'}`, 'error', true);
                    } finally {
                      setNotaSalvando(false);
                    }
                  }}>
                  <Save size={14} /> Gravar nota
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {devolvendo && (
          <ModalDevolucao
            item={devolvendo}
            disponivel={parseQtd(devolvendo.qtd_recebida) - (devolvido[devolvendo.id] ?? 0)}
            produtoNome={produtos.find((p: any) => p.id === produtoDoPedido(devolvendo.pedido_id))?.nome
              ?? descricaoDoPedido(devolvendo.pedido_id)}
            unidade={normalizarUnidade(
              produtos.find((p: any) => p.id === produtoDoPedido(devolvendo.pedido_id))?.unidade)}
            showToast={showToast}
            onClose={() => setDevolvendo(null)}
            onFeito={async () => {
              setDevolvendo(null);
              await Promise.all([reload(), reloadDevolucoes(), reloadSaldos()]);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Devolução ao fornecedor ─────────────────────────────────────────
// A conferência que dá consequência a "chegou errado" (migr. 423). Toda a
// regra — teto pela quantidade recebida, baixa de estoque, abatimento da conta
// a pagar e encerramento do pedido — vive na RPC; aqui é só a conversa.
const ModalDevolucao = ({ item, disponivel, produtoNome, unidade, showToast, onClose, onFeito }: {
  item: any;
  disponivel: number;
  produtoNome?: string;
  /** Unidade do produto devolvido — decide se a quantidade aceita fração. */
  unidade?: string;
  showToast: any;
  onClose: () => void;
  onFeito: () => void | Promise<void>;
}) => {
  const frac = UNIDADES_FRACIONARIAS.has(normalizarUnidade(unidade));
  const [qtd, setQtd] = useState(qtdBR(disponivel));
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DEVOLUCAO[0]);
  const [reenvio, setReenvio] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  const qtdNum = parseQtd(qtd);
  const qtdValida = qtdNum > 0 && qtdNum <= disponivel;

  const enviar = async () => {
    if (!supabase) return;
    if (!qtdValida) { showToast(`Informe uma quantidade entre ${frac ? '0,001' : '1'} e ${qtdBR(disponivel)}.`, 'error', true); return; }
    setSaving(true);
    try {
      const { data: res, error } = await supabase.rpc('registrar_devolucao_fornecedor', {
        p_recebimento_id:   item.id,
        // Era Math.trunc: devolver 12,5 KG registrava 12 e deixava meio quilo
        // fantasma no estoque e na conta a pagar (migr. 439).
        p_qtd:              qtdNum,
        p_motivo:           motivo,
        p_reenvio_esperado: reenvio,
        p_observacao:       observacao || null,
      });
      if (error) throw new Error(error.message);

      const r = (res ?? {}) as any;
      // Cada efeito vira uma frase: o aluno precisa ver que devolver mexe em
      // estoque, financeiro e no pedido ao mesmo tempo.
      const partes = [
        `${qtdBR(r.qtd)} ${normalizarUnidade(unidade, 'un')} devolvida(s) ao fornecedor.`,
        r.estoque_baixado ? 'Estoque baixado.' : 'Sem baixa de estoque (o recebimento não tinha produto vinculado).',
        r.conta_efeito === 'abatida'   ? `Conta a pagar abatida em R$ ${Number(r.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
        : r.conta_efeito === 'cancelada' ? 'A conta a pagar do pedido foi cancelada — nada mais a pagar.'
        : r.conta_efeito === 'ja_paga'   ? 'ATENÇÃO: a conta deste pedido já foi paga. O crédito precisa ser negociado com o fornecedor.'
        : null,
        r.pedido_fechado ? 'Pedido encerrado.'
          : reenvio ? `Saldo do pedido voltou para ${qtdBR(r.saldo_pedido)} — aguardando reposição.` : null,
      ].filter(Boolean);

      showToast(partes.join(' '), r.conta_efeito === 'ja_paga' ? 'info' : 'success', true);
      await onFeito();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao registrar a devolução.', 'error', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-amber-400/20 p-5 sm:p-6 w-full max-w-lg my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 flex items-center justify-center ring-1 ring-amber-400/25 shrink-0">
              <PackageX size={16} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-gray-100">Devolver ao fornecedor</h3>
              <p className="text-[11px] text-gray-500 truncate">
                {produtoNome || 'Item do pedido'} · recebido {qtdBR(item.qtd_recebida)} · disponível {qtdBR(disponivel)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Quantidade * (máx. ${qtdBR(disponivel)}${unidade ? ` ${unidade}` : ''})`}>
            <input type="text" inputMode="decimal"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={qtd}
              onChange={e => setQtd(formatQtd(e.target.value, frac))}
              onKeyDown={handleQtdKeyDown(frac)} />
          </FormField>
          <FormField label="Motivo *">
            <select className="neu-input py-2 px-3 rounded-xl text-sm" value={motivo} onChange={e => setMotivo(e.target.value)}>
              {MOTIVOS_DEVOLUCAO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label="Observação">
          <input className="neu-input py-2 px-3 rounded-xl text-sm" value={observacao}
            onChange={e => setObservacao(e.target.value)}
            placeholder="O que aconteceu, para Compras cobrar o fornecedor" />
        </FormField>

        {/* A pergunta que decide o destino do pedido. */}
        <div className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={reenvio} onChange={e => setReenvio(e.target.checked)} />
            <span className="text-xs text-gray-300">
              O fornecedor vai repor esta quantidade
              <span className="block text-[10px] text-gray-500 mt-0.5">
                {reenvio
                  ? 'O saldo do pedido reabre e o Estoque volta a esperar a carga.'
                  : 'O pedido encerra com o que chegou — não haverá reposição.'}
              </span>
            </span>
          </label>
        </div>

        <p className="text-[10px] text-gray-500 leading-snug">
          Ao confirmar: sai do estoque, a conta a pagar do pedido é abatida pelo valor devolvido
          (se ainda estiver pendente) e o pedido é encerrado ou reaberto conforme a escolha acima.
        </p>

        <div className="flex gap-3 justify-end pt-1 border-t border-white/5">
          <button onClick={onClose} disabled={saving} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
          <NeuButtonAccent onClick={enviar} isLoading={saving} disabled={!qtdValida}>
            <PackageX size={14} /> Registrar devolução
          </NeuButtonAccent>
        </div>
      </motion.div>
    </motion.div>
  );
};

export const RecebimentosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O recebimento de mercadoria" />;
  return <RecebimentosViewInner showToast={showToast} filial={filialAtiva} />;
};
