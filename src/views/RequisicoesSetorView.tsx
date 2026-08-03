import React, { useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Send, Trash2, ClipboardList, ChevronRight } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { FluxoCompra } from '../components/FluxoCompra';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, UrgenciaBadge, SelecioneUnidade } from '../components/ui';
import { todayBR } from '../lib/dates';
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

// Dois tipos, como na empresa:
//
//   • Material do estoque — o item já existe no almoxarifado. Escolhe-se do
//     catálogo (não se pede do estoque o que o estoque não tem), o Estoque
//     libera e a saída é registrada. Não passa por Compras.
//   • Compra — não existe, ou acabou. Descrição livre, vai para Compras cotar
//     e o gerente decide.
//
// Quem sabe qual é o caso é quem pede. Forçar tudo por Compras faria o sistema
// mentir sobre o fluxo — e encheria a fila de cotação de coisa que está na
// prateleira.
type TipoReq = 'compra' | 'estoque';

const UNIDADES = ['un', 'cx', 'pct', 'kg', 'g', 'L', 'mL', 'm', 'm²', 'sv'];

const linhaVazia = () => ({ item: '', qtd: '1', unidade: 'un' });

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

  const [tipo, setTipo] = useState<TipoReq>('compra');
  const [estoqueForm, setEstoqueForm] = useState({ produto_id: '', qtd: '1', destino: '' });
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
      id: r.id, tipo: 'compra' as TipoReq, item: r.item, qtd: r.qtd, unidade: r.unidade,
      numero: numeroRequisicao(r),
      complemento: r.centro_custo, prazo: r.data_necessidade, urgencia: r.urgencia ?? 'Normal',
      abertura: r.data ?? (r.created_at ?? '').slice(0, 10), status: r.status,
      justificativa: r.justificativa, solicitante: r.solicitante,
    }));
    const materiais = reqEstoque.map((r: any) => ({
      id: r.id, tipo: 'estoque' as TipoReq, numero: null as string | null,
      item: produtos.find((p: any) => p.id === r.produto_id)?.nome ?? 'Produto',
      qtd: r.qtd, unidade: 'un',
      complemento: r.destino, prazo: null, urgencia: 'Normal',
      abertura: (r.created_at ?? '').slice(0, 10), status: r.status,
      justificativa: null, solicitante: r.solicitante,
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
  const updateLinha = (i: number, patch: Partial<{ item: string; qtd: string; unidade: string }>) =>
    setItens(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const closeForm = () => {
    setShowForm(false);
    setCab({ urgencia: 'Normal', centro_custo: '', justificativa: '', data_necessidade: '' });
    setItens([linhaVazia()]);
    setEstoqueForm({ produto_id: '', qtd: '1', destino: '' });
    setErros({});
  };

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

  const validar = (): boolean => {
    const e: Record<string, string> = {};
    if (cab.justificativa.trim().length < 10) e.justificativa = 'Explique por que o item é necessário (mín. 10 caracteres)';
    if (!cab.data_necessidade) e.data_necessidade = 'Obrigatório';
    else if (cab.data_necessidade < todayBR()) e.data_necessidade = 'Não pode ser no passado';
    itens.forEach((r, i) => { if (!r.item.trim()) e[`item_${i}`] = 'Descreva o item'; });
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const handleEnviar = async () => {
    if (!validar() || !supabase) return;
    setSaving(true);
    try {
      const { data: saved, error } = await supabase.rpc('criar_requisicoes_compra_lote', {
        p_itens: itens.map(r => ({
          item:    r.item.trim(),
          qtd:     parseInt(r.qtd, 10) || 1,
          unidade: r.unidade,
        })),
        p_solicitante:      profile.nome,
        p_urgencia:         cab.urgencia,
        p_centro_custo:     cab.centro_custo || null,
        p_filial:           filial,
        p_justificativa:    cab.justificativa.trim(),
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
            e o gerente decide. A requisição de compra que você abre aqui é o <strong className="text-gray-300">mesmo
            documento</strong> que Compras trabalha em Compras &rarr; Requisições de compra — clique na linha para ver
            em que etapa ela está.
          </p>
        </div>
        {!showForm && (
          <NeuButtonAccent onClick={() => setShowForm(true)}>
            <Plus size={16} /> Nova Requisição
          </NeuButtonAccent>
        )}
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
                    { id: 'compra'  as TipoReq, label: 'Comprar', hint: 'não temos, ou acabou — vai para Compras cotar' },
                    { id: 'estoque' as TipoReq, label: 'Material do estoque', hint: 'já existe no almoxarifado — o Estoque libera' },
                  ]).map(op => (
                    <button
                      key={op.id}
                      onClick={() => { setTipo(op.id); setErros({}); }}
                      className={`flex-1 min-w-[200px] text-left py-2 px-3 rounded-xl border transition-colors ${
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

              <FormField label="Justificativa * — por que a empresa precisa disto" error={erros.justificativa}>
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

                <datalist id="sugestoes-catalogo">
                  {sugestoes.map(nome => <option key={nome} value={nome} />)}
                </datalist>

                {itens.map((row, i) => (
                  <div key={i} className="flex flex-wrap md:flex-nowrap gap-2 items-start">
                    <div className="flex-1 min-w-[180px]">
                      <input
                        list="sugestoes-catalogo"
                        className={`neu-input py-2 px-3 rounded-xl text-sm w-full ${erros[`item_${i}`] ? 'border border-red-500/40' : ''}`}
                        placeholder="Descreva o item — ex.: papel A4 75g, resma"
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
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button
                      onClick={() => removeLinha(i)}
                      disabled={itens.length <= 1}
                      title="Remover item"
                      className="action-btn-delete disabled:opacity-30 mt-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <span className="text-[10px] text-gray-500">
                  Cada item vira uma requisição própria — é assim que Compras cota e fecha um a um.
                </span>
              </div>
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
                        r.tipo === 'estoque' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'
                      }`}>
                        {r.tipo === 'estoque' ? 'Estoque' : 'Compra'}
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
                        {r.tipo === 'compra' && (
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
                        {r.justificativa && (
                          <div className={r.tipo === 'compra' ? 'mt-3' : ''}>
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
