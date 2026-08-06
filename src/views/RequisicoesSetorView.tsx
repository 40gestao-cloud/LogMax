import React, { useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Send, Trash2, ClipboardList, ChevronRight, MessageSquareText, Search, Check } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { FluxoCompra } from '../components/FluxoCompra';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, SelecioneUnidade } from '../components/ui';
import { todayBR } from '../lib/dates';
import { unidadesDeRequisicao, exemploItemRequisicao } from '../lib/unidades';
import type { UserProfile } from '../hooks/useUserProfile';

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
//   • Compra eventual — não está no catálogo, é serviço ou foge do normal.
//     Descrição livre e justificativa obrigatória: aqui o comprador não tem
//     histórico nenhum, e o texto é o que decide.
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
const linhaVazia = () => ({ uid: ++seqLinha, item: '', qtd: '1', unidade: 'UN', justificativa: '' });

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
  const { data: centrosCusto } = useFetchData<any>('/api/centroscustoview');

  const [tipo, setTipo] = useState<TipoReq>('reposicao');
  const [estoqueForm, setEstoqueForm] = useState({ produto_id: '', qtd: '1', destino: '' });
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

  // Sugestões do catálogo — o campo continua livre, a lista só ajuda a
  // escrever o nome de algo que a empresa já compra.
  const sugestoes = useMemo(
    () => [...produtos]
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo')
      .map((p: any) => p.nome)
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b, 'pt-BR')),
    [produtos],
  );

  // Catálogo para reposição: tudo que está ativo, inclusive com saldo zero —
  // saldo zero é justamente o que mais se repõe. `abaixoMin` é o ponto de
  // pedido, e ordena a lista: quem furou o mínimo aparece primeiro, porque é
  // essa a pergunta que a reposição responde.
  const catalogoRepo = useMemo(() => {
    const termo = buscaCat.trim().toLowerCase();
    return [...produtos]
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo')
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

  // O nicho entra por aqui e só por aqui: mercearia compra por peso e volume,
  // loja de roupa e de eletrônico não. O formulário em si é o mesmo nas três —
  // requisição de compra é documento corporativo único.
  const unidadesReq = useMemo(() => unidadesDeRequisicao(filial), [filial]);

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
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo' && Number(p.estoque ?? 0) > 0)
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
      item: r.item, qtd: r.qtd, unidade: r.unidade,
      numero: numeroRequisicao(r),
      complemento: r.centro_custo, prazo: r.data_necessidade, urgencia: r.urgencia ?? 'Normal',
      abertura: r.data ?? (r.created_at ?? '').slice(0, 10), status: r.status,
      justificativa: r.justificativa, solicitante: r.solicitante,
      saldo: r.saldo_no_pedido, minimo: r.minimo_no_pedido,
    }));
    const materiais = reqEstoque.map((r: any) => ({
      id: r.id, tipo: 'estoque' as TipoReq, tipoLabel: 'Estoque', numero: null as string | null,
      item: produtos.find((p: any) => p.id === r.produto_id)?.nome ?? 'Produto',
      qtd: r.qtd, unidade: 'UN',
      complemento: r.destino, prazo: null, urgencia: 'Normal',
      abertura: (r.created_at ?? '').slice(0, 10), status: r.status,
      justificativa: null, solicitante: r.solicitante,
      saldo: null as number | null, minimo: null as number | null,
    }));
    return [...compras, ...materiais].sort((a, b) => String(b.abertura).localeCompare(String(a.abertura)));
  }, [data, reqEstoque, produtos]);

  const centrosOrdenados = useMemo(
    () => [...centrosCusto]
      .filter((c: any) => (c.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [centrosCusto],
  );

  const addLinha    = () => setItens(rows => [...rows, linhaVazia()]);
  const removeLinha = (i: number) => setItens(rows => rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i));
  const updateLinha = (i: number, patch: Partial<{ item: string; qtd: string; unidade: string; justificativa: string }>) =>
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
    setEstoqueForm({ produto_id: '', qtd: '1', destino: '' });
    setRepo(new Map());
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
        p_qtd:         parseInt(estoqueForm.qtd, 10) || 1,
        p_destino:     estoqueForm.destino.trim() || null,
        p_filial:      filial,
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
    });
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const handleEnviar = async () => {
    const ehRepo = tipo === 'reposicao';
    if (!(ehRepo ? validarReposicao() : validar()) || !supabase) return;
    setSaving(true);
    try {
      // Na reposição só o `produto_id` viaja: nome e unidade a RPC lê do
      // catálogo, e o saldo ela mesma fotografa (migr. 358). Mandar o nome
      // daqui seria deixar o navegador escrever o que o comprador vai ler.
      const p_itens = ehRepo
        ? [...repo.entries()].map(([produto_id, qtd]) => ({
            produto_id, qtd: parseInt(qtd, 10) || 1,
          }))
        : itens.map(r => ({
            item:    r.item.trim(),
            qtd:     parseInt(r.qtd, 10) || 1,
            unidade: r.unidade,
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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            O que o seu setor pediu. Material que já existe sai do Estoque; o que falta vai para Compras cotar,
            e o gerente decide. <strong className="text-gray-300">Repor</strong> item do catálogo e{' '}
            <strong className="text-gray-300">comprar</strong> algo fora dele são pedidos diferentes: o primeiro se
            explica pelo saldo, o segundo precisa de justificativa. A requisição que você abre aqui é o mesmo
            documento que Compras trabalha em Compras &rarr; Requisições de compra — clique na linha para ver em que
            etapa ela está.
          </p>
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
                    { id: 'eventual'  as TipoReq, label: 'Compra eventual', hint: 'não está no catálogo, é serviço ou foge do normal' },
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
                      : 'Sai do almoxarifado, sem passar por Compras.'}
                </p>
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
                          {p.nome}{p.codigo ? ` (${p.codigo})` : ''} — saldo {p.estoque ?? 0}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Quantidade">
                    <input
                      type="number" min="1"
                      className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={estoqueForm.qtd}
                      onChange={e => setEstoqueForm(f => ({ ...f, qtd: e.target.value }))}
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

                  <div className={`neu-pressed rounded-xl max-h-72 overflow-y-auto main-scrollbar divide-y divide-white/5 ${erros.repo ? 'border border-red-500/40' : ''}`}>
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
                              {p.codigo ? `${p.codigo} · ` : ''}saldo {p.saldo}
                              {p.minimo > 0 ? ` · mínimo ${p.minimo}` : ''}
                              {' '}{p.unidade ?? 'un'}
                            </span>
                          </button>
                          {p.abaixoMin && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 shrink-0">
                              No mínimo
                            </span>
                          )}
                          {marcado && (
                            <input
                              type="number" min="1"
                              className="neu-input py-1 px-2 rounded-lg text-xs w-20 shrink-0"
                              value={repo.get(p.id) ?? '1'}
                              onChange={e => setQtdRepo(p.id, e.target.value)}
                              title="Quantidade a repor"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-gray-500">
                    Cada item marcado vira uma requisição própria, com o saldo do momento anexado — é isso que Compras lê no lugar da justificativa.
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

                <datalist id="sugestoes-catalogo">
                  {sugestoes.map(nome => <option key={nome} value={nome} />)}
                </datalist>

                {itens.map((row, i) => (
                  <div key={row.uid} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap md:flex-nowrap gap-2 items-start">
                      <div className="flex-1 min-w-[180px]">
                        <input
                          list="sugestoes-catalogo"
                          className={`neu-input py-2 px-3 rounded-xl text-sm w-full ${erros[`item_${i}`] ? 'border border-red-500/40' : ''}`}
                          placeholder={`Descreva o item — ${exemploItemRequisicao(filial)}`}
                          value={row.item}
                          onChange={e => updateLinha(i, { item: e.target.value })}
                        />
                        {erros[`item_${i}`] && (
                          <span className="text-[10px] text-red-500 font-semibold">{erros[`item_${i}`]}</span>
                        )}
                      </div>
                      <input
                        type="number" min="1"
                        className="neu-input py-2 px-3 rounded-xl text-sm w-20"
                        value={row.qtd}
                        onChange={e => updateLinha(i, { qtd: e.target.value })}
                      />
                      <select
                        className="neu-input py-2 px-3 rounded-xl text-sm w-24"
                        value={row.unidade}
                        onChange={e => updateLinha(i, { unidade: e.target.value })}
                      >
                        {unidadesReq.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
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

      {(isLoading || loadingEst) ? <LoadingSpinner /> : pedidos.length === 0 ? (
        <EmptyState message="O seu setor ainda não abriu nenhum pedido" />
      ) : (
        <div className="neu-flat rounded-2xl border border-white/5 overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="border-b border-white/5">
                {['Item', 'Tipo', 'Solicitante', 'Qtd', 'Necessário até', 'Urgência', 'Aberto em', 'Situação', 'Histórico'].map(h => (
                  <th key={h} className="py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pedidos.map(r => (
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
                      {r.numero && (
                        <span className="block font-mono text-[10px] text-gray-500 ml-[21px] tracking-wider">{r.numero}</span>
                      )}
                      {r.complemento && (
                        <span className="text-[10px] text-gray-500 ml-[21px]">{r.complemento}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
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
                    <td className="py-3 px-4 text-xs text-gray-300 capitalize">
                      {r.solicitante ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-300">{r.qtd} {r.unidade ?? ''}</td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-400">{r.prazo ?? '—'}</td>
                    <td className="py-3 px-4"><UrgenciaBadge urgencia={r.urgencia} /></td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-500">{r.abertura || '—'}</td>
                    <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                    {/* O aluno que pediu acompanha o próprio documento sem ter
                        de perguntar ao professor por que ele parou. */}
                    <td className="py-3 px-4 text-right">
                      <HistoricoOperacoes
                        entidade={r.tipo === 'estoque' ? 'requisicoes_estoque' : 'requisicoes'}
                        entidadeId={r.id}
                        titulo={r.numero ? `${r.numero} · ${r.item}` : r.item}
                      />
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
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
};

export const RequisicoesSetorView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A requisição que o seu setor abre" />;
  return <RequisicoesSetorViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
