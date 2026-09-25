import { useRolarAteFormulario } from '../hooks/useRolarAteFormulario';
import React, { useState, useEffect, useMemo } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Save, ChevronRight, RotateCcw } from 'lucide-react';
import { FluxoCompra } from '../components/FluxoCompra';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, Pagination, SelecioneUnidade, AbaComContador, type CorAba } from '../components/ui';
import { useFormValidation, formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { UNIDADES_FRACIONARIAS, normalizarUnidade, pluralEmbalagem } from '../lib/unidades';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { usePrompt } from '../contexts/PromptContext';
import { isConselheiro } from '../lib/rbac';
import { formatDataHoraBR, diasDesde, dataSimplesBR } from '../lib/dates';
import { FiltroSolicitante } from '../components/FiltroSolicitante';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';

// Sentinel pra opção "Outro (digitar)" — usado quando o item solicitado
// não existe no catálogo (compra eventual, serviço, item novo).
const ITEM_OUTRO = '__outro__';

// Rótulos legíveis dos atributos JSONB (produtos.atributos). Mantido
// duplicado com CatalogoProdutosView pra não criar dependência cruzada.
const ATRIBUTO_LABEL: Record<string, string> = {
  tamanho: 'Tamanho', cor: 'Cor', genero: 'Gênero', colecao: 'Coleção', material: 'Material',
  modelo: 'Modelo', memoria: 'Memória', tela: 'Tela', bateria: 'Bateria', camera: 'Câmera',
  garantia_dias: 'Garantia (dias)', requer_imei: 'Requer IMEI/Serial',
};
const formatAtributoValor = (v: any): string =>
  typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);

// Preview compacto de marca + ficha técnica do produto escolhido. Mostrado
// abaixo do select pra o solicitante confirmar que pegou o item certo
// (tamanho/cor no MaxLook, memória/tela no TechMax etc.) sem precisar sair
// da tela de requisição.
const ProdutoResumo = ({ produto }: { produto: any }) => {
  if (!produto) return null;
  const atr = (produto.atributos && typeof produto.atributos === 'object') ? produto.atributos : {};
  const atrEntries = Object.entries(atr).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!produto.marca && atrEntries.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg px-3 py-2 border border-white/5 bg-white/[0.02] flex flex-wrap gap-x-3 gap-y-1">
      {produto.marca && (
        <span className="text-[10px] text-gray-400">
          <span className="text-gray-500 font-bold uppercase tracking-widest">Marca:</span>{' '}
          <span className="text-gray-200 font-bold">{produto.marca}</span>
        </span>
      )}
      {atrEntries.map(([k, v]) => (
        <span key={k} className="text-[10px] text-gray-400">
          <span className="text-gray-500 font-bold uppercase tracking-widest">{ATRIBUTO_LABEL[k] ?? k.replace(/_/g, ' ')}:</span>{' '}
          <span className="text-gray-200 font-bold">{formatAtributoValor(v)}</span>
        </span>
      ))}
    </div>
  );
};

// Um campo da ficha da requisição: rótulo pequeno em cima, valor embaixo.
// Existe porque a linha da tabela trunca (e tem de truncar) — a ficha é o
// lugar onde nada fica cortado.
const Campo = ({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) => (
  <div>
    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block">{rotulo}</span>
    <span className="text-xs text-gray-200 break-words">{valor ?? '—'}</span>
  </div>
);

// `cor` diz o que a fila significa PARA COMPRAS: amarelo é trabalho seu; as
// outras são de quem está com o documento agora.
const ABAS: { key: string; label: string; status: string[] | null; cor: CorAba }[] = [
  { key: 'acotar',    label: 'A cotar',       status: ['Aprovado'],    cor: 'amarelo' },
  { key: 'gerente',   label: 'Com o gerente', status: ['Pendente'],    cor: 'preto' },
  { key: 'correcao',  label: 'Em correção',   status: ['Em correção'], cor: 'azul' },
  { key: 'atendidas', label: 'Atendidas',     status: ['Atendida'],    cor: 'cinza' },
  { key: 'negadas',   label: 'Negadas',       status: ['Negado'],      cor: 'vermelho' },
  { key: 'todas',     label: 'Todas',         status: null,            cor: 'roxo' },
];
type AbaKey = string;

const ABERTOS = new Set(['Pendente', 'Aprovado', 'Em correção']);

// Prazo em dd/mm e o quanto falta. O relativo só aparece enquanto a
// requisição está viva — em atendida ou negada, "atrasada" não diz nada.
const Prazo = ({ data, status }: { data: string | null; status: string }) => {
  if (!data) return <span className="text-xs text-gray-600">—</span>;
  const n = diasDesde(data);
  let rel: string | null = null;
  let cor = 'text-gray-500';
  if (ABERTOS.has(status) && n !== null) {
    if (n > 0)       { rel = `atrasada ${n} dia${n === 1 ? '' : 's'}`; cor = 'text-red-400 font-bold'; }
    else if (n === 0) { rel = 'vence hoje'; cor = 'text-amber-400 font-bold'; }
    else if (n >= -3) { rel = `em ${-n} dia${n === -1 ? '' : 's'}`; cor = 'text-amber-400/90'; }
    else              { rel = `em ${-n} dias`; }
  }
  return (
    <span className="whitespace-nowrap">
      <span className="block text-xs font-mono text-gray-300">{dataSimplesBR(data).slice(0, 5)}</span>
      {rel && <span className={`block text-[10px] ${cor}`}>{rel}</span>}
    </span>
  );
};

const RequisicoesViewInner =({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const [reabrindo, setReabrindo] = useState<string | null>(null);
  // Só a direção reabre — e só ela precisa enxergar o que foi excluído antes de
  // a exclusão sair de cena (migr. 340).
  const isAdmin = profile?.role === 'admin';
  const podeReabrir = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);
  const [verExcluidas, setVerExcluidas] = useState(false);

  // ── Filtro por solicitante (2026-09-01) ─────────────────────────
  //
  // Mesmo controle de Requisições > Aprovações. Aqui, porém, a lista é
  // paginada pelo servidor: recortar o array já carregado filtraria só a
  // página aberta e mentiria no total. Por isso o nome escolhido vira um `eq`
  // no filtro da consulta — e o `totalCount` que volta é, literalmente,
  // quantas aquela pessoa pediu nesta unidade.
  const [solicitante, setSolicitante] = useState<string | null>(null);
  useEffect(() => { setPage(0); }, [solicitante]);

  // A fila de Compras é "A cotar"; o resto é acompanhamento. O status vira
  // filtro da consulta (não recorte da página), para o total e a paginação
  // continuarem dizendo a verdade.
  const [aba, setAba] = useState<AbaKey>('acotar');
  useEffect(() => { setPage(0); }, [aba]);
  const statusDaAba = ABAS.find(a => a.key === aba)!.status;
  const filtroBusca = useMemo(() => {
    const f: Record<string, any> = { filial };
    if (solicitante !== null) f.solicitante = solicitante;
    if (statusDaAba) f.status = statusDaAba;
    return f;
  }, [filial, solicitante, statusDaAba]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/requisicoesview', filtroBusca, true,
    { page, searchTerm: debouncedSearch, includeInactive: verExcluidas,
      searchColumns: ['item', 'solicitante', 'setor_solicitante', 'urgencia', 'centro_custo', 'status'] }
  );

  // O catálogo de nomes não pode sair da página aberta — ela traz 20 linhas e
  // esconderia justamente quem pediu pouco. Uma consulta de uma coluna só,
  // sobre a mesma fila, dá a lista e a contagem de cada um.
  // A mesma consulta dá o contador de cada aba.
  const [fila, setFila] = useState<{ solicitante: string; status: string }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    (async () => {
      let q = supabase!.from('requisicoes').select('solicitante, status').eq('filial', filial);
      if (!verExcluidas) q = q.eq('ativo', true);
      const { data: rows } = await q;
      if (cancelado) return;
      setFila(((rows ?? []) as any[]).map(r => ({
        solicitante: String(r.solicitante ?? '').trim(),
        status: String(r.status ?? ''),
      })));
    })();
    return () => { cancelado = true; };
    // `data` entra para o contador acompanhar reabrir/corrigir/excluir.
  }, [filial, verExcluidas, data]);
  const naAba = (a: typeof ABAS[number], r: { status: string }) => !a.status || a.status.includes(r.status);
  // Linha sem nome não vira opção: o filtro é um `eq` no servidor e não teria
  // como casar NULL e '' no mesmo valor. Ela continua em "Todos".
  const nomes = useMemo(
    () => fila.filter(r => naAba(ABAS.find(a => a.key === aba)!, r)).map(r => r.solicitante).filter(Boolean),
    [fila, aba],
  );
  const contagem = (a: typeof ABAS[number]) =>
    fila.filter(r => naAba(a, r) && (solicitante === null || r.solicitante === solicitante)).length;
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });
  const produtosOrdenados = useMemo(
    () => [...produtos]
      .filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [produtos]
  );
  const [isSaving, setIsSaving] = useState(false);
  // Linha expandida: mostra a régua inteira do fluxo e a justificativa de quem
  // pediu — o que Compras precisa ler antes de cotar.
  const [aberto, setAberto] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<any | null>(null);
  // produtoSel = id do produto escolhido no dropdown, ITEM_OUTRO ou '' (nenhum).
  // form.item = texto final que vai pra BD (nome do produto ou texto livre).
  // Só o modo edição vive aqui: a criação saiu desta tela (migr. 283) e mora
  // em Requisições → Do Setor, onde qualquer setor pede o que precisa.
  // Compras recebe a fila e executa — não pede para si por uma porta própria.
  const [produtoSel, setProdutoSel] = useState<string>('');
  const [form, setForm] = useState({ item: '', marca: '' });
  const [extras, setExtras] = useState({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
  // A unidade vem da requisição em edição — quem corrige não escolhe a medida.
  const editFrac = UNIDADES_FRACIONARIAS.has(normalizarUnidade(editItem?.unidade));
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Criação em lote: N linhas de {produto/item, qtd} compartilhando
  // urgência/centro de custo. Cada requisição continua sendo 1
  // linha independente (Cotações/Pedidos seguem 1:1) — o lote só agiliza a
  // etapa de solicitação quando vários itens vão pro mesmo fornecedor.

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ item: item.item ?? '', marca: item.marca ?? '' });
    setExtras({ qtd: qtdBR(item.qtd ?? 1), urgencia: item.urgencia ?? 'Normal', centro_custo: item.centro_custo ?? '' });
    // O vínculo gravado manda (migr. 545): `produto_id` é o que o pedido e o
    // recebimento vão obedecer, e é ele que precisa aparecer no campo — não o
    // resultado de casar o texto por acaso. Sem vínculo, cai no palpite pelo
    // nome; sem nenhum dos dois, em "Outro" pra preservar o texto histórico.
    const doVinculo = item.produto_id
      ? produtosOrdenados.find((p: any) => p.id === item.produto_id)
      : null;
    const match = doVinculo ?? produtosOrdenados.find((p: any) => p.nome === item.item);
    setProdutoSel(match ? match.id : (item.item ? ITEM_OUTRO : ''));
    setErrors({});
  };

  const closeForm = () => {
    setEditItem(null);
    setProdutoSel('');
    setForm({ item: '', marca: '' });
    setExtras({ qtd: '1', urgencia: 'Normal', centro_custo: '' });
    setErrors({});
  };

  const handleProdutoChange = (value: string) => {
    setProdutoSel(value);
    clearError('item');
    if (value === ITEM_OUTRO) {
      setForm(f => ({ ...f, item: '' }));
    } else if (value === '') {
      setForm(f => ({ ...f, item: '' }));
    } else {
      const p = produtosOrdenados.find((pr: any) => pr.id === value);
      // MIGR 582: a marca acompanha o produto — a RPC vai carimbar a do
      // cadastro de qualquer jeito, e o campo mostrar outra coisa mentiria.
      setForm(f => ({ ...f, item: p?.nome ?? '', marca: p?.marca ?? '' }));
    }
  };

  // Só edição de requisição já existente. A criação mora em
  // Requisições → Do Setor.
  //
  // Corrigir o que o gerente já aprovou devolve o documento para ele (migr.
  // 330): item, quantidade e PRODUTO são a decisão — aprovar 5 e comprar 50
  // esvaziaria a aprovação, e trocar o produto esvazia mais ainda. Urgência e
  // centro de custo não reabrem nada. Quem decide isso é a RPC, porque reabrir
  // são duas escritas (requisição e aprovação) que só fazem sentido juntas.
  //
  // `p_vincula` (migr. 545) diz "esta chamada está decidindo o vínculo com o
  // catálogo". Sem ela, `p_produto_id = null` seria ambíguo: "não mandei nada"
  // e "escolhi Outro (digitar)" são opostos. Só mandamos a flag quando o
  // dropdown foi de fato resolvido — com o campo em branco a RPC preserva o
  // vínculo que já existia.
  const handleSave = async () => {
    if (!validate() || !editItem || !supabase) return;

    const qtd = parseQtd(extras.qtd) || 1;
    const vincula   = produtoSel !== '';
    const produtoId = produtoSel === ITEM_OUTRO ? null : (produtoSel || null);
    const trocouProduto = vincula && (produtoId ?? null) !== (editItem.produto_id ?? null);
    // MIGR 582: a marca entra na mesma régua do item e da quantidade —
    // "papel A4 Chamex" e "papel A4 genérico" não são a mesma compra.
    const ehTextoLivre = produtoSel === ITEM_OUTRO || (produtoSel === '' && !editItem.produto_id);
    const marcaNova = ehTextoLivre ? form.marca.trim() : null;
    const mudouDecisao = form.item.trim() !== (editItem.item ?? '')
      || qtd !== Number(editItem.qtd)
      || (marcaNova !== null && marcaNova !== (editItem.marca ?? ''))
      || trocouProduto;
    if (editItem.status === 'Aprovado' && mudouDecisao) {
      const ok = await confirm(
        `O gerente aprovou "${editItem.item}" na quantidade ${editItem.qtd}.\n\n` +
        'Mudar o item, a marca, o produto do catálogo ou a quantidade devolve a requisição para aprovação — ' +
        'ela sai da sua fila e volta para a do gerente. Urgência e centro de custo você corrige ' +
        'sem reabrir nada.\n\n' +
        'Corrigir mesmo assim?');
      if (!ok) return;
    }

    setIsSaving(true);
    showToast("Atualizando...", 'info', false);
    try {
      const { data: res, error } = await supabase.rpc('corrigir_requisicao_compra', {
        p_id:           editItem.id,
        p_item:         form.item,
        p_qtd:          qtd,
        p_urgencia:     extras.urgencia,
        p_centro_custo: extras.centro_custo,
        p_produto_id:   produtoId,
        p_vincula:      vincula,
        // null = "não mexi" (item do catálogo manda a marca dele); string
        // vazia = "sem marca definida", que é decisão e não esquecimento.
        p_marca:        marcaNova,
      });
      if (error) throw error;
      const atualizada = (res as any)?.requisicao;
      const reaberta   = !!(res as any)?.reaberta;
      setData((prev: any[]) => prev.map(d => d.id === editItem.id
        ? (atualizada ?? { ...d, item: form.item, marca: marcaNova ?? d.marca, qtd, urgencia: extras.urgencia,
                           centro_custo: extras.centro_custo,
                           produto_id: vincula ? produtoId : d.produto_id })
        : d));
      showToast(
        reaberta
          ? 'Requisição corrigida e devolvida para aprovação — o gerente decide de novo em Requisições → Aprovações.'
          : 'Requisição corrigida. Quando o gerente aprovar, ela entra no dropdown de Compras → Cotações.',
        reaberta ? 'info' : 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Excluir saiu (migr. 340). Apagar a requisição some com o documento que o
  // aluno abriu, o gerente aprovou e Compras ia cotar — e as telas seguintes
  // ficam sem correspondência. Foi o que aconteceu com a REQ-TM-2026-0001,
  // procurada depois em Cotações e Pedidos, onde nunca estaria.
  //
  // No lugar, a direção reabre: o documento volta para 'Pendente', a aprovação
  // volta para a fila do gerente, e quem errou corrige. Numa turma, erro é a
  // regra — a resposta a erro não pode ser destruir o rastro.
  const handleReabrir = async (item: any) => {
    if (!supabase) return;
    const excluida = item.ativo === false;
    if (!await confirm(
      excluida
        ? `Restaurar a requisição ${numeroRequisicao(item)}?

Ela foi excluída e voltará para a fila como Pendente, para o gerente decidir de novo.`
        : `Reabrir a requisição ${numeroRequisicao(item)}?

Ela volta para 'Pendente' e sai da fila de Compras — o gerente decide de novo depois da correção.`)) return;

    const motivo = await prompt({
      message: 'Por que está sendo reaberta? (fica registrado no histórico)',
      placeholder: 'Ex.: aluno lançou o item errado',
      confirmLabel: excluida ? 'Restaurar' : 'Reabrir',
      maxLength: 200,
    });
    if (motivo == null) return;

    setReabrindo(item.id);
    try {
      const { data: res, error } = await supabase.rpc('reabrir_requisicao', {
        p_id: item.id, p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      showToast((res as any)?.restaurada
        ? 'Requisição restaurada e devolvida para aprovação.'
        : 'Requisição reaberta — está em Requisições → Aprovações, com o gerente.', 'success', true);
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reabrir.', 'error', true);
    } finally {
      setReabrindo(null);
    }
  };

  const isFormOpen = !!editItem;

  const formEdicaoRef = useRolarAteFormulario(isFormOpen, editItem?.id);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar requisição..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Quem pediu — o mesmo seletor de Aprovações, com a contagem de
              cada um ao lado do nome. */}
          <FiltroSolicitante nomes={nomes} valor={solicitante} onChange={setSolicitante} />
          {/* A exclusão saiu (migr. 340), mas o que já foi excluído continua no
              banco — e é a direção quem traz de volta. */}
          {podeReabrir && (
            <button onClick={() => { setVerExcluidas(v => !v); setPage(0); }}
              className={`neu-button rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                verExcluidas ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {verExcluidas ? 'Ocultar excluídas' : 'Ver excluídas'}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div ref={formEdicaoRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">
                {editItem?.status === 'Aprovado' ? 'Corrigir requisição aprovada' : 'Corrigir requisição'}
              </h3>

              {editItem && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Item solicitado *" error={errors.item}>
                      <select
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.item ? 'border border-red-500/40' : ''}`}
                        value={produtoSel}
                        onChange={e => handleProdutoChange(e.target.value)}
                      >
                        <option value="">Selecione um produto...</option>
                        {produtosOrdenados.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}{p.marca ? ` — ${p.marca}` : ''}{p.codigo ? ` (${p.codigo})` : ''}
                          </option>
                        ))}
                        <option value={ITEM_OUTRO}>Outro (digitar manualmente)</option>
                      </select>
                      {produtoSel === ITEM_OUTRO && (
                        <input
                          className={`neu-input py-2 px-3 rounded-xl text-sm mt-2 ${errors.item ? 'border border-red-500/40' : ''}`}
                          value={form.item}
                          onChange={e => { setForm(f => ({ ...f, item: e.target.value })); clearError('item'); }}
                          placeholder="Descreva o item solicitado"
                          autoFocus
                        />
                      )}
                      {produtoSel && produtoSel !== ITEM_OUTRO && (
                        <ProdutoResumo produto={produtosOrdenados.find((p: any) => p.id === produtoSel)} />
                      )}
                    </FormField>
                    {/* MIGR 582. Com produto do catálogo a marca é a do
                        cadastro (a RPC carimba de lá); em texto livre é o que
                        o solicitante pediu, e Compras pode precisar do ajuste
                        que faz o item ser encontrável. */}
                    {produtoSel && produtoSel !== ITEM_OUTRO ? (
                      <FormField label="Marca">
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                          {produtosOrdenados.find((p: any) => p.id === produtoSel)?.marca || '—'}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Item do catálogo: a marca é a do cadastro. Para trocar de marca, troque de produto.
                        </p>
                      </FormField>
                    ) : (
                      <FormField label="Marca">
                        <input className="neu-input py-2 px-3 rounded-xl text-sm"
                          value={form.marca}
                          onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
                          placeholder="Marca (opcional)" />
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          É o que o comprador leva para a cotação. Em branco significa "qualquer marca".
                        </p>
                      </FormField>
                    )}
                    {/* Solicitante e setor vêm de quem abriu a requisição
                        (migr. 283) — Compras corrige o item e a quantidade, não
                        a autoria do pedido. */}
                    <FormField label="Solicitante">
                      <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                        {editItem?.solicitante ?? '—'}
                        {editItem?.setor_solicitante && (
                          <span className="text-[10px] text-gray-500 ml-2 uppercase tracking-widest">{editItem.setor_solicitante}</span>
                        )}
                      </div>
                    </FormField>
                    {/* A unidade é a que o solicitante escolheu na requisição —
                        Compras corrige a quantidade, não a medida. Fração só se a
                        unidade for fracionária (migr. 439). */}
                    <FormField label={`Quantidade (${normalizarUnidade(editItem?.unidade)})`}>
                      <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                        value={extras.qtd}
                        onChange={e => setExtras(x => ({ ...x, qtd: formatQtd(e.target.value, editFrac) }))}
                        onKeyDown={handleQtdKeyDown(editFrac)} />
                      {/* Migr. 590: o pedido pode ter nascido em fardo — negociar
                          "manda 610, o fornecedor aceita" é legítimo, mas quem
                          digita precisa saber que está saindo do fardo fechado.
                          Ficando múltiplo do fator, o documento continua contando
                          em fardo; saindo, o gatilho apaga o rótulo sozinho. */}
                      {editItem?.embalagem_nome && editItem?.qtd_embalagens != null ? (
                        <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                          Pedido em <span className="text-gray-400">{qtdBR(editItem.qtd_embalagens)} {pluralEmbalagem(editItem.embalagem_nome, Number(editItem.qtd_embalagens))} de {qtdBR(editItem.embalagem_fator)}</span>.
                          Digite em {normalizarUnidade(editItem.unidade)}: múltiplo de {qtdBR(editItem.embalagem_fator)} continua contando em {editItem.embalagem_nome.toLowerCase()}.
                        </p>
                      ) : null}
                    </FormField>
                    <FormField label="Urgência">
                      <select className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.urgencia} onChange={e => setExtras(x => ({ ...x, urgencia: e.target.value }))}>
                        <option>Normal</option>
                        <option>Alta</option>
                        <option>Urgente</option>
                      </select>
                    </FormField>
                    <FormField label="Centro de Custo">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.centro_custo} onChange={e => setExtras(x => ({ ...x, centro_custo: e.target.value }))}
                        placeholder="Ex: TI, Marketing" />
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                      <Save size={14} /> Atualizar
                    </NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-3 flex-wrap" role="tablist">
        {ABAS.map(a => (
          <AbaComContador key={a.key} label={a.label} cor={a.cor} n={contagem(a)}
            ativa={a.key === aba} onClick={() => { setAba(a.key); setAberto(null); }} />
        ))}
      </div>

      {isLoading ? <LoadingSpinner /> : data.length === 0 ? (
        <EmptyState message={solicitante !== null
          ? `Nenhuma requisição de ${solicitante} nesta aba${debouncedSearch ? ' com esta busca' : ''}.`
          : aba === 'acotar'
          ? 'Nada aprovado esperando cotação — quando o gerente aprovar uma requisição, ela aparece aqui.'
          : 'Nenhuma requisição nesta situação.'} />
      ) : (
        <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            {/* Seis colunas: o item leva a sobra da largura. Centro de custo,
                data de abertura e a régua do fluxo moram na ficha que abre ao
                clicar — na linha, só o que decide o que fazer primeiro. */}
            <table className="tabela w-full text-left border-collapse">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="font-bold px-3 text-center">Item</th>
                  <th className="font-bold px-3 text-center hidden md:table-cell w-36">Quem pediu</th>
                  <th className="font-bold px-3 text-center sm:w-28">Qtd</th>
                  <th className="font-bold px-3 text-center hidden sm:table-cell w-32">Prazo</th>
                  <th className="font-bold px-3 text-center hidden sm:table-cell sm:w-32">Situação</th>
                  <th className="font-bold px-3 text-center sm:w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.map((item: any) => {
                    const direcaoTemAcao = (podeReabrir && item.ativo !== false && ['Aprovado', 'Negado'].includes(item.status))
                      || (isAdmin && item.ativo !== false);
                    const urg = item.urgencia ?? 'Normal';
                    return (
                    <React.Fragment key={item.id}>
                    <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      onClick={() => setAberto(a => a === item.id ? null : item.id)}
                      className={`border-b border-accent/10 hover:bg-accent/[0.04] transition-colors cursor-pointer align-middle ${aberto === item.id ? 'bg-accent/[0.05]' : ''}`}>
                      <td className="py-3 px-3 sm:min-w-[14rem]">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-credencial text-[10px] text-gray-500 tracking-wider whitespace-nowrap">{numeroRequisicao(item)}</span>
                          {/* Urgência só aparece quando muda a ordem do dia —
                              "Normal" em toda linha era ruído. */}
                          {urg !== 'Normal' && <UrgenciaBadge urgencia={urg} />}
                        </span>
                        <span className="flex items-start gap-1.5 mt-1">
                          <ChevronRight size={14}
                            className={`text-gray-500 shrink-0 mt-0.5 transition-transform ${aberto === item.id ? 'rotate-90' : ''}`} />
                          <span className="text-sm font-semibold text-gray-100 leading-snug line-clamp-2 break-words" title={item.item}>
                            {item.item}
                            {/* A marca é metade do que identifica o produto:
                                sem ela a lista mostra dois pedidos diferentes
                                com a mesma cara. */}
                            {item.marca && <span className="text-xs text-gray-500 font-normal"> · {item.marca}</span>}
                          </span>
                        </span>
                        <span className="md:hidden block text-[11px] text-gray-500 mt-0.5 ml-5 truncate">
                          {item.solicitante}{item.setor_solicitante ? ` · ${item.setor_solicitante}` : ''}
                        </span>
                        <span className="sm:hidden block mt-1.5 ml-5"><StatusBadge status={item.status} /></span>
                      </td>
                      <td className="py-3 px-3 text-center hidden md:table-cell">
                        <span className="block text-xs text-gray-300 truncate max-w-[8rem] mx-auto">{item.solicitante || '—'}</span>
                        {item.setor_solicitante && (
                          <span className="block text-[10px] text-gray-500 uppercase tracking-widest truncate max-w-[8rem] mx-auto">{item.setor_solicitante}</span>
                        )}
                      </td>
                      {/* Migr. 589: quem pediu em fardo pediu em fardo. A
                          quantidade de estoque continua sendo a de cima — é
                          ela que a cotação e o pedido usam. */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="text-sm font-semibold text-gray-200 tabular-nums">{qtdBR(item.qtd)}</span>
                        <span className="text-[10px] text-gray-500 ml-1 uppercase">{normalizarUnidade(item.unidade)}</span>
                        {item.embalagem_nome && item.qtd_embalagens != null && (
                          <span className="block text-[10px] text-gray-500 leading-tight">
                            {qtdBR(item.qtd_embalagens)} {pluralEmbalagem(item.embalagem_nome, Number(item.qtd_embalagens)).toLowerCase()}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center hidden sm:table-cell" title={item.justificativa ?? ''}>
                        <Prazo data={item.data_necessidade} status={item.status} />
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap hidden sm:table-cell">
                        <StatusBadge status={item.status} />
                        {item.ativo === false && (
                          <span className="block mt-1 text-[9px] font-black uppercase tracking-widest text-red-400">
                            excluída
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          {['Pendente', 'Aprovado'].includes(item.status) && item.ativo !== false && (
                            <button onClick={() => openEdit(item)}
                              title={item.status === 'Aprovado'
                                ? 'Corrigir — mudar item ou quantidade devolve para aprovação'
                                : 'Corrigir'}
                              className="action-btn-edit"><Edit2 size={12} /></button>
                          )}
                          {podeReabrir && item.ativo === false && (
                            <button onClick={() => handleReabrir(item)} disabled={reabrindo === item.id}
                              title="Restaurar esta requisição excluída"
                              className="px-2.5 h-8 rounded-lg flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 transition-colors disabled:opacity-50">
                              <RotateCcw size={11} />Restaurar
                            </button>
                          )}
                            <MenuMais>
                              {fechar => (
                                <>
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="requisicoes" entidadeId={item.id} titulo={`${numeroRequisicao(item)} · ${item.item}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  {podeReabrir && ['Aprovado', 'Negado'].includes(item.status) && (
                                    <ItemMenu onClick={() => { fechar(); handleReabrir(item); }} disabled={reabrindo === item.id}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={RotateCcw}>
                                      Reabrir para correção
                                    </ItemMenu>
                                  )}
                                  {isAdmin && (
                                    <ExcluirAdmin variante="menu" endpoint="/api/requisicoesview" id={item.id}
                                      rotulo={numeroRequisicao(item)} showToast={showToast}
                                      alternativa="use Reabrir para correção: ela volta para Pendente e o aluno corrige."
                                      onExcluido={() => reload()} />
                                  )}
                                </>
                              )}
                            </MenuMais>
                        </div>
                      </td>
                    </motion.tr>
                    {aberto === item.id && (
                      <tr className="border-b border-accent/10 bg-accent/[0.03]">
                        <td colSpan={6} className="py-4 px-4">
                          {(() => {
                            // A linha da tabela trunca o nome do item — precisa
                            // truncar, senão nove colunas não cabem. Aqui é o
                            // avesso: a requisição inteira, sem corte, para quem
                            // vai cotar decidir com o que foi realmente pedido.
                            const prod = produtosOrdenados.find((p: any) =>
                              (item.produto_id && p.id === item.produto_id) || p.nome === item.item);
                            return (
                          <div className="flex flex-col gap-4">
                            {/* Cabeçalho: o nome inteiro, quebrando linha se
                                precisar. É a informação que faltava. */}
                            <div>
                              <span className="block font-credencial text-[10px] text-gray-500 tracking-wider">{numeroRequisicao(item)}</span>
                              <h4 className="text-sm sm:text-base font-bold text-gray-100 leading-snug break-words">{item.item}</h4>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {item.tipo_requisicao && (
                                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                                    item.tipo_requisicao === 'Reposição'
                                      ? 'bg-emerald-500/15 text-emerald-400'
                                      : 'bg-purple-500/15 text-purple-400'
                                  }`}>
                                    {item.tipo_requisicao}
                                  </span>
                                )}
                                {item.servico_id && (
                                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-400">
                                    Serviço
                                  </span>
                                )}
                                {prod?.codigo && (
                                  <span className="font-mono text-[10px] text-gray-500">cód. {prod.codigo}</span>
                                )}
                                {!prod && !item.servico_id && (
                                  <span className="text-[10px] text-gray-500">Item fora do catálogo — descrito pelo solicitante</span>
                                )}
                              </div>
                              <ProdutoResumo produto={prod} />
                            </div>

                            {/* A ficha. Tudo o que a requisição guarda, inclusive
                                o que a tabela esconde em tela pequena. */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
                              <Campo rotulo="Quantidade" valor={`${qtdBR(item.qtd)} ${normalizarUnidade(item.unidade)}`} />
                              {/* Migr. 589: como o setor pediu, e com que fator
                                  NAQUELE dia — o cadastro pode ter mudado
                                  desde então, e o documento não muda junto. */}
                              {item.embalagem_nome && item.qtd_embalagens != null && (
                                <Campo rotulo="Pedido em embalagem"
                                  valor={`${qtdBR(item.qtd_embalagens)} ${pluralEmbalagem(item.embalagem_nome, Number(item.qtd_embalagens))} de ${qtdBR(item.embalagem_fator)} ${normalizarUnidade(item.unidade)}`} />
                              )}
                              <Campo rotulo="Urgência" valor={<UrgenciaBadge urgencia={item.urgencia ?? 'Normal'} />} />
                              <Campo rotulo="Status" valor={<StatusBadge status={item.status} />} />
                              <Campo rotulo="Centro de custo" valor={item.centro_custo || '—'} />
                              <Campo rotulo="Solicitante" valor={item.solicitante || '—'} />
                              <Campo rotulo="Setor" valor={item.setor_solicitante || '—'} />
                              <Campo rotulo="Unidade" valor={item.filial || filial} />
                              <Campo rotulo="Aberta em" valor={<span className="font-mono">{item.data || '—'}</span>} />
                              <Campo rotulo="Necessário até" valor={<span className="font-mono">{item.data_necessidade || '—'}</span>} />
                              {item.reenviada_em && (
                                <Campo rotulo="Reenviada em" valor={<span className="font-mono">{formatDataHoraBR(item.reenviada_em)}</span>} />
                              )}
                              {item.updated_at && (
                                <Campo rotulo="Última alteração" valor={<span className="font-mono">{formatDataHoraBR(item.updated_at)}</span>} />
                              )}
                            </div>

                            {/* Na reposição o saldo é o motivo — ninguém escreveu
                                justificativa, e nem precisava. */}
                            {item.saldo_no_pedido != null && (
                              <div>
                                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">
                                  Saldo quando foi pedido
                                </span>
                                <span className="text-xs text-gray-300">
                                  <strong className={Number(item.minimo_no_pedido) > 0 && Number(item.saldo_no_pedido) <= Number(item.minimo_no_pedido) ? 'text-red-400' : 'text-gray-200'}>
                                    {qtdBR(item.saldo_no_pedido)}
                                  </strong>
                                  {item.minimo_no_pedido != null && Number(item.minimo_no_pedido) > 0 && (
                                    <> em estoque, para um mínimo de <strong className="text-gray-200">{qtdBR(item.minimo_no_pedido)}</strong></>
                                  )}
                                  {' '}{normalizarUnidade(item.unidade)}
                                </span>
                              </div>
                            )}

                            {item.justificativa && (
                              <div>
                                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">
                                  Por que foi pedido
                                </span>
                                <span className="text-xs text-gray-300 break-words">{item.justificativa}</span>
                              </div>
                            )}

                            {/* Em correção não tem botão nesta tela (2026-08-24)
                                — Compras não corrige o texto de outro setor, só
                                acompanha. Sem esta linha a requisição ficava
                                muda: etiqueta e nenhuma explicação de por quê
                                nada mais aparece nela. */}
                            {item.status === 'Em correção' && (
                              <div className="neu-pressed p-3 rounded-xl border border-amber-400/20">
                                <span className="text-[10px] text-amber-300/90 uppercase tracking-widest font-bold block mb-1">
                                  Devolvida — está com {item.solicitante || 'o solicitante'}
                                </span>
                                <span className="text-xs text-gray-300">
                                  {item.correcao_motivo || 'Aguardando correção.'}
                                </span>
                                <span className="block text-[11px] text-gray-500 mt-2 leading-snug">
                                  Não há o que fazer aqui agora: quando {item.solicitante || 'o solicitante'} reenviar,
                                  o documento volta para a fila do gerente em Requisições &gt; Aprovações.
                                </span>
                              </div>
                            )}

                            <div>
                              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">
                                Onde está
                              </span>
                              <FluxoCompra etapa={etapaDaRequisicao(item.status)} />
                            </div>
                          </div>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                    );
                  })}
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
    </motion.div>
  );
};

export const RequisicoesView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A fila de requisições de compra" />;
  return <RequisicoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
