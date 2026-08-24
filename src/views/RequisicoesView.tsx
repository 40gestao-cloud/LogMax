import React, { useState, useEffect, useMemo } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Plus, Save, ChevronRight, RotateCcw } from 'lucide-react';
import { FluxoCompra } from '../components/FluxoCompra';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, Pagination, SelecioneUnidade } from '../components/ui';
import { useFormValidation, formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { UNIDADES_FRACIONARIAS, normalizarUnidade } from '../lib/unidades';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { usePrompt } from '../contexts/PromptContext';
import { isConselheiro } from '../lib/rbac';

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

const RequisicoesViewInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
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

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/requisicoesview', { filial }, true,
    { page, searchTerm: debouncedSearch, includeInactive: verExcluidas,
      searchColumns: ['item', 'solicitante', 'setor_solicitante', 'urgencia', 'centro_custo', 'status'] }
  );
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
  const [form, setForm] = useState({ item: '' });
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
    setForm({ item: item.item ?? '' });
    setExtras({ qtd: qtdBR(item.qtd ?? 1), urgencia: item.urgencia ?? 'Normal', centro_custo: item.centro_custo ?? '' });
    // Pré-seleciona o produto se o item gravado bater com algum do catálogo;
    // senão cai em "Outro" pra preservar o texto histórico.
    const match = produtosOrdenados.find((p: any) => p.nome === item.item);
    setProdutoSel(match ? match.id : (item.item ? ITEM_OUTRO : ''));
    setErrors({});
  };

  const closeForm = () => {
    setEditItem(null);
    setProdutoSel('');
    setForm({ item: '' });
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
      setForm(f => ({ ...f, item: p?.nome ?? '' }));
    }
  };

  // Só edição de requisição já existente. A criação mora em
  // Requisições → Do Setor.
  //
  // Corrigir o que o gerente já aprovou devolve o documento para ele (migr.
  // 330): item e quantidade SÃO a decisão — aprovar 5 e comprar 50 esvaziaria a
  // aprovação. Urgência e centro de custo não reabrem nada. Quem decide isso é
  // a RPC, porque reabrir são duas escritas (requisição e aprovação) que só
  // fazem sentido juntas.
  const handleSave = async () => {
    if (!validate() || !editItem || !supabase) return;

    const qtd = parseQtd(extras.qtd) || 1;
    const mudouDecisao = form.item.trim() !== (editItem.item ?? '') || qtd !== Number(editItem.qtd);
    if (editItem.status === 'Aprovado' && mudouDecisao) {
      const ok = await confirm(
        `O gerente aprovou "${editItem.item}" na quantidade ${editItem.qtd}.\n\n` +
        'Mudar o item ou a quantidade devolve a requisição para aprovação — ela sai da sua fila ' +
        'e volta para a do gerente. Urgência e centro de custo você corrige sem reabrir nada.\n\n' +
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
      });
      if (error) throw error;
      const atualizada = (res as any)?.requisicao;
      const reaberta   = !!(res as any)?.reaberta;
      setData((prev: any[]) => prev.map(d => d.id === editItem.id
        ? (atualizada ?? { ...d, item: form.item, qtd, urgencia: extras.urgencia, centro_custo: extras.centro_custo })
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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Fila da filial. Quem pede é a área que precisa, em Requisições &rarr; Do Setor; aqui Compras confere,
            corrige e leva para cotação — é o <strong className="text-gray-300">mesmo documento</strong>, visto pelo
            papel de quem executa a compra. Clique na linha para ver em que etapa ela está e por que foi pedida.
          </p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar requisição..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
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

      {isLoading ? <LoadingSpinner /> : data.length === 0 ? <EmptyState message="Nenhuma requisição encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Item</th>
                  <th className="pb-4 font-bold px-4 text-center">Qtd</th>
                  <th className="pb-4 font-bold px-4 text-center">Urgência</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Centro de Custo</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Solicitante</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Necessário até</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Data</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.map((item: any) => (
                    <React.Fragment key={item.id}>
                    <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      onClick={() => setAberto(a => a === item.id ? null : item.id)}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group cursor-pointer">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200 max-w-[9rem] sm:max-w-[200px]">
                        <span className="block font-mono text-[10px] text-gray-500 tracking-wider">{numeroRequisicao(item)}</span>
                        <span className="flex items-center gap-1.5">
                          <ChevronRight size={13}
                            className={`text-gray-500 shrink-0 transition-transform ${aberto === item.id ? 'rotate-90' : ''}`} />
                          <span className="block truncate">{item.item}</span>
                        </span>
                        <span className="md:hidden block text-[10px] text-gray-500 mt-0.5 truncate">{item.solicitante}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400 text-center font-mono">{qtdBR(item.qtd)}</td>
                      <td className="py-3 px-4 text-center"><UrgenciaBadge urgencia={item.urgencia ?? 'Normal'} /></td>
                      <td className="py-3 px-4 text-xs text-gray-400 hidden lg:table-cell">{item.centro_custo || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">
                        {item.solicitante}
                        {item.setor_solicitante && (
                          <span className="block text-[10px] text-gray-600 uppercase tracking-widest">{item.setor_solicitante}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-500 hidden lg:table-cell" title={item.justificativa ?? ''}>
                        {item.data_necessidade ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono hidden sm:table-cell">{item.data}</td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={item.status} />
                        {item.ativo === false && (
                          <span className="block mt-1 text-[9px] font-black uppercase tracking-widest text-red-400">
                            excluída
                          </span>
                        )}
                        {/* O status nomeia um ponto; a régua mostra a linha —
                            e é a linha que responde "falta o quê?". */}
                        <span className="block mt-1">
                          <FluxoCompra etapa={etapaDaRequisicao(item.status)} compact />
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {/* Era `opacity-0 group-hover:opacity-100`: em tablet, onde
                            não existe hover, os botões não apareciam nunca — a tela
                            prometia correção e não mostrava sequer o botão. */}
                        <div className="flex justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}>
                          <HistoricoOperacoes entidade="requisicoes" entidadeId={item.id} titulo={`${numeroRequisicao(item)} · ${item.item}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                          {['Pendente', 'Aprovado'].includes(item.status) && (
                            <button onClick={() => openEdit(item)}
                              title={item.status === 'Aprovado'
                                ? 'Corrigir — mudar item ou quantidade devolve para aprovação'
                                : 'Corrigir'}
                              className="action-btn-edit"><Edit2 size={12} /></button>
                          )}
                          {podeReabrir && ['Aprovado', 'Negado'].includes(item.status) && item.ativo !== false && (
                            <button onClick={() => handleReabrir(item)} disabled={reabrindo === item.id}
                              title="Reabrir para correção — volta para Pendente e para a fila do gerente"
                              className="action-btn-warning">
                              <RotateCcw size={12} />
                            </button>
                          )}
                          {isAdmin && item.ativo !== false && (
                            <ExcluirAdmin endpoint="/api/requisicoesview" id={item.id}
                              rotulo={numeroRequisicao(item)} showToast={showToast}
                              alternativa="use o botão de reabrir ao lado: ela volta para Pendente e o aluno corrige."
                              onExcluido={() => reload()} />
                          )}
                          {podeReabrir && item.ativo === false && (
                            <button onClick={() => handleReabrir(item)} disabled={reabrindo === item.id}
                              title="Restaurar esta requisição excluída"
                              className="px-2.5 h-8 rounded-lg flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 transition-colors disabled:opacity-50">
                              <RotateCcw size={11} />Restaurar
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                    {aberto === item.id && (
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        <td colSpan={9} className="py-3 px-4">
                          {/* Em correção não tem botão nesta tela (2026-08-24)
                              — Compras não corrige o texto de outro setor, só
                              acompanha. Sem esta linha a requisição ficava
                              muda: etiqueta e nenhuma explicação de por quê
                              nada mais aparece nela. */}
                          {item.status === 'Em correção' && (
                            <div className="neu-pressed p-3 rounded-xl border border-amber-400/20 mb-3">
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
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1.5">
                            Onde está
                          </span>
                          <FluxoCompra etapa={etapaDaRequisicao(item.status)} />
                          {item.justificativa && (
                            <div className="mt-3">
                              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">
                                Por que foi pedido
                              </span>
                              <span className="text-xs text-gray-300">{item.justificativa}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
    </motion.div>
  );
};

export const RequisicoesView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A fila de requisições de compra" />;
  return <RequisicoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
