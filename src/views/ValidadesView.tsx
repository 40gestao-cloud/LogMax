// Controle de validade (migr. 424).
//
// A tabela `vencimentos_estoque` existia desde a migr. 010 sem tela nenhuma —
// a SuperMax é uma mercearia que nunca olhou uma data de validade. Esta é a
// tela que faltava.
//
// FEFO aqui é ORDEM DE PRIORIDADE: a lista sai do que vence primeiro, e é isso
// que decide o que vender, promover ou baixar antes. O PDV não escolhe lote na
// venda (ver o cabeçalho da migração) — por isso a tela mostra lado a lado o
// que há em lote e o saldo do produto, para a diferença ficar à vista em vez de
// fingida.

import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, X, CalendarClock, TriangleAlert, PackageMinus, Check } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { UNIDADES_FRACIONARIAS, normalizarUnidade } from '../lib/unidades';
import { temEstoque } from '../lib/tipoProduto';
import { ehPerecivel, validadeDias, vencimentoPrevisto, armazenagemDe, ARMAZENAGEM_ESTILO } from '../lib/perecivel';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { useConfirm } from '../contexts/ConfirmContext';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { SelectBusca } from '../components/SelectBusca';
import { opcaoProduto } from '../lib/opcoesSelect';
import {
  LoadingSpinner, EmptyState, FormField, NeuButtonAccent,
  Pagination, SelecioneUnidade, FilaDeTrabalho,
} from '../components/ui';

type Situacao = 'Vencido' | 'Vence em 7 dias' | 'Vence em 30 dias' | 'OK' | 'Encerrado';

const diasAte = (venc: string, hoje: string): number =>
  Math.round((Date.parse(`${venc}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);

const situacaoDe = (lote: any, hoje: string): Situacao => {
  if (lote.status !== 'OK') return 'Encerrado';
  const d = diasAte(lote.vencimento, hoje);
  if (d < 0)  return 'Vencido';
  if (d <= 7) return 'Vence em 7 dias';
  if (d <= 30) return 'Vence em 30 dias';
  return 'OK';
};

const COR_SITUACAO: Record<Situacao, string> = {
  'Vencido':          'bg-red-950/50 text-red-400 border border-red-500/30',
  'Vence em 7 dias':  'bg-amber-400/15 text-amber-400 border border-amber-400/25',
  'Vence em 30 dias': 'bg-yellow-900/25 text-yellow-500 border border-yellow-500/20',
  'OK':               'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  'Encerrado':        'bg-white/5 text-gray-500 border border-white/10',
};

const fmtData = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Traduz o erro de RPC ausente. O deploy do front chega antes de a migração
 * rodar nos 4 bancos; sem isto a turma veria "Could not find the function
 * public.baixar_lote_vencido" e ninguém saberia que é só SQL pendente.
 */
const mensagemErro = (err: any, padrao: string): string => {
  const msg = String(err?.message ?? '');
  if (/baixar_lote_vencido|encerrar_lote_consumido|schema cache/i.test(msg)) {
    return 'O controle de validade ainda não foi liberado nesta turma (migração 424 pendente). Fale com o professor.';
  }
  return msg || padrao;
};

const ValidadesViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const confirm = useConfirm();
  const hoje = todayBR();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<'ativos' | 'vencidos' | '7' | '30' | 'encerrados'>('ativos');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [form, setForm] = useState({ produto_id: '', lote: '', vencimento: '', qtd: '' });

  const { data, setData, isLoading, totalCount, reload } =
    useFetchData<any>('/api/vencimentosestoqueview', { filial }, true, { page });
  const { data: produtosBrutos } = useFetchData<any>('/api/produtosview', { filial });
  // Patrimônio não vence nem tem lote. Consumo vence — álcool, desinfetante e
  // água têm validade tanto quanto iogurte (migr. 440).
  const produtos = useMemo(
    () => produtosBrutos.filter((p: any) => temEstoque(p.tipo)),
    [produtosBrutos],
  );

  const nomeProduto = (id: string) => produtos.find((p: any) => p.id === id)?.nome ?? '—';
  const saldoProduto = (id: string) => Number(produtos.find((p: any) => p.id === id)?.estoque ?? 0);
  const unidadeDoProduto = (id: string) =>
    normalizarUnidade(produtos.find((p: any) => p.id === id)?.unidade);

  // O lote herda a unidade do produto: queijo entra a KG, refrigerante a UN.
  const unidadeSel = form.produto_id ? unidadeDoProduto(form.produto_id) : '';
  const loteFrac = UNIDADES_FRACIONARIAS.has(unidadeSel);

  // FEFO: o que vence primeiro aparece primeiro. Lote encerrado desce, porque
  // já não é decisão de ninguém.
  const enriched = useMemo(() => data
    .map((l: any) => ({ ...l, situacao: situacaoDe(l, hoje), dias: diasAte(l.vencimento, hoje) }))
    .sort((a: any, b: any) => {
      if ((a.status === 'OK') !== (b.status === 'OK')) return a.status === 'OK' ? -1 : 1;
      return String(a.vencimento).localeCompare(String(b.vencimento));
    }), [data, hoje]);

  const contarSit = (s: Situacao) => enriched.filter((l: any) => l.situacao === s).length;
  const vencidos = contarSit('Vencido');
  const em7      = contarSit('Vence em 7 dias');
  const em30     = contarSit('Vence em 30 dias');

  const termo = search.trim().toLowerCase();
  const filtrados = enriched.filter((l: any) => {
    const passaFiltro =
      filtro === 'ativos'     ? l.status === 'OK'
      : filtro === 'vencidos' ? l.situacao === 'Vencido'
      : filtro === '7'        ? l.situacao === 'Vence em 7 dias' || l.situacao === 'Vencido'
      : filtro === '30'       ? l.status === 'OK' && l.dias <= 30
      :                         l.status !== 'OK';
    if (!passaFiltro) return false;
    if (!termo) return true;
    return [nomeProduto(l.produto_id), l.lote, l.observacao]
      .some((v: any) => String(v ?? '').toLowerCase().includes(termo));
  });

  // Lotes de um produto somam mais que o saldo dele? A tela não esconde: é o
  // sinal de que houve saída (venda) que o lote não acompanhou.
  const somaLotesPorProduto = useMemo(() => {
    const m: Record<string, number> = {};
    enriched.filter((l: any) => l.status === 'OK')
      .forEach((l: any) => { m[l.produto_id] = (m[l.produto_id] ?? 0) + Number(l.qtd ?? 0); });
    return m;
  }, [enriched]);

  const fecharForm = () => { setShowForm(false); setForm({ produto_id: '', lote: '', vencimento: '', qtd: '' }); };

  const salvarLote = async () => {
    if (!form.produto_id)  { showToast('Selecione o produto.', 'error', true); return; }
    if (!form.vencimento)  { showToast('Informe a data de validade.', 'error', true); return; }
    const qtd = parseQtd(form.qtd);
    if (!(qtd > 0))        { showToast('Informe a quantidade do lote.', 'error', true); return; }
    setSaving(true);
    try {
      const payload = {
        produto_id: form.produto_id,
        lote:       form.lote.trim() || null,
        vencimento: form.vencimento,
        qtd,
        status:     'OK',
        filial,
      };
      const salvo = await dbInsert('/api/vencimentosestoqueview', payload);
      setData((prev: any[]) => [salvo ?? { id: Date.now(), ...payload }, ...prev]);
      showToast('Lote registrado. Ele entra na fila de validade da unidade.', 'success', true);
      fecharForm();
    } catch (err: any) {
      showToast(`Erro ao registrar lote: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSaving(false);
    }
  };

  const baixarPerda = async (lote: any) => {
    const nome = nomeProduto(lote.produto_id);
    if (!await confirm(
      `Baixar ${lote.qtd} unidade(s) de "${nome}" como perda por validade?\n\n` +
      'O estoque cai pela quantidade do lote (Ajuste −) e o lote é encerrado. ' +
      'A movimentação fica registrada com o número do lote.')) return;
    if (!supabase) return;
    setAcaoId(lote.id);
    try {
      const { data: res, error } = await supabase.rpc('baixar_lote_vencido', {
        p_lote_id: lote.id,
        p_qtd:     lote.qtd,
        p_motivo:  'Vencido',
      });
      if (error) throw new Error(error.message);
      const r = (res ?? {}) as any;
      showToast(`Perda registrada: ${r.baixado} un. de ${r.produto} saíram do estoque.`, 'success', true);
      await reload();
    } catch (err: any) {
      showToast(mensagemErro(err, 'Erro ao baixar o lote.'), 'error', true);
    } finally {
      setAcaoId(null);
    }
  };

  const encerrarConsumido = async (lote: any) => {
    if (!await confirm(
      `Encerrar o lote de "${nomeProduto(lote.produto_id)}" como consumido?\n\n` +
      'O estoque NÃO muda — a saída dessas unidades já foi registrada pelas vendas. ' +
      'O lote só sai da fila do que precisa ser olhado.')) return;
    if (!supabase) return;
    setAcaoId(lote.id);
    try {
      const { error } = await supabase.rpc('encerrar_lote_consumido', { p_lote_id: lote.id });
      if (error) throw new Error(error.message);
      showToast('Lote encerrado como consumido.', 'success', true);
      await reload();
    } catch (err: any) {
      showToast(mensagemErro(err, 'Erro ao encerrar o lote.'), 'error', true);
    } finally {
      setAcaoId(null);
    }
  };

  const FILTROS: { id: typeof filtro; label: string }[] = [
    { id: 'ativos',     label: 'Em estoque' },
    { id: '7',          label: 'Urgentes (7 dias)' },
    { id: '30',         label: 'Próximos 30 dias' },
    { id: 'vencidos',   label: 'Vencidos' },
    { id: 'encerrados', label: 'Encerrados' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Validades — {filial}</h2>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Produto ou lote..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => setShowForm(v => !v)}><Plus size={16} /> Registrar lote</NeuButtonAccent>
        </div>
      </div>

      <FilaDeTrabalho itens={[
        { label: 'lote(s) vencido(s) em estoque', count: vencidos, hint: 'produto vencido não se vende — baixe como perda' },
        { label: 'lote(s) vencendo em 7 dias',    count: em7,      hint: 'ainda dá para vender: promoção, ponta de gôndola' },
        { label: 'lote(s) vencendo em 30 dias',   count: em30,     hint: 'planeje a saída antes que vire perda' },
      ]} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              {/* O caminho normal é o lote no recebimento; aqui entra o que já estava na prateleira. */}
              <h3 className="text-sm font-bold text-gray-200">Novo lote</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField label="Produto *">
                  <SelectBusca
                    value={form.produto_id}
                    onChange={v => {
                      // A ficha sugere hoje + validade_dias (migr. 360); continua editável.
                      const prod = produtos.find((p: any) => p.id === v);
                      const sugerida = prod ? vencimentoPrevisto(prod, hoje) : null;
                      setForm(ff => ({ ...ff, produto_id: v, vencimento: sugerida ?? ff.vencimento }));
                    }}
                    placeholder="Escolha o produto"
                    opcoes={[...produtos].sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
                      .map((p: any) => opcaoProduto(p, { saldo: true }))}
                  />
                </FormField>
                <FormField label="Lote">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={form.lote}
                    onChange={e => setForm(f => ({ ...f, lote: e.target.value }))} placeholder="Ex: L-2026-08" />
                </FormField>
                <FormField label="Validade *">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={form.vencimento}
                    onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))} />
                  {(() => {
                    const prod = produtos.find((p: any) => p.id === form.produto_id);
                    if (!prod) return null;
                    const dias = validadeDias(prod);
                    if (dias !== null) {
                      return <p className="text-[10px] text-gray-500 mt-1">{dias} dia(s) a partir de hoje</p>;
                    }
                    if (ehPerecivel(prod)) {
                      return <p className="text-[10px] text-amber-400/90 mt-1">Informe a data</p>;
                    }
                    return null;
                  })()}
                </FormField>
                {/* Frios e laticínios são loteados a peso — 12,5 KG de queijo é
                    um lote (migr. 439). A unidade é a do produto escolhido. */}
                <FormField label={`Quantidade *${unidadeSel ? ` (${unidadeSel})` : ''}`}>
                  <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums" value={form.qtd}
                    onChange={e => setForm(f => ({ ...f, qtd: formatQtd(e.target.value, loteFrac) }))}
                    onKeyDown={handleQtdKeyDown(loteFrac)} placeholder="0" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={fecharForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={salvarLote} isLoading={saving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap gap-2 shrink-0">
        {FILTROS.map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filtro === f.id ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Produto</th>
                <th className="pb-4 font-bold px-4 hidden sm:table-cell">Lote</th>
                <th className="pb-4 font-bold px-4">Validade</th>
                <th className="pb-4 font-bold px-4 text-center">Situação</th>
                <th className="pb-4 font-bold px-4 text-right">No lote</th>
                <th className="pb-4 font-bold px-4 text-right hidden md:table-cell">Saldo do produto</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={7}><LoadingSpinner /></td></tr>)
                : filtrados.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState message={
                    filtro === 'vencidos' ? 'Nenhum lote vencido. É o que se espera de um estoque bem girado.'
                      : 'Nenhum lote nesta situação.'} /></td></tr>
                ) : (
                <AnimatePresence>
                  {filtrados.map((l: any) => {
                    const divergente = l.status === 'OK'
                      && (somaLotesPorProduto[l.produto_id] ?? 0) > saldoProduto(l.produto_id);
                    return (
                      <motion.tr key={l.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className={`border-b border-white/5 hover:bg-white/5 transition-colors group ${l.status !== 'OK' ? 'opacity-50' : ''}`}>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          {nomeProduto(l.produto_id)}
                          {/* Armazenagem decide o que se resolve primeiro: um
                              congelado vencendo é outra urgência que uma caixa
                              de bolacha. Era campo gravado e nunca lido. */}
                          {(() => {
                            const arm = armazenagemDe(produtos.find((p: any) => p.id === l.produto_id));
                            return arm && arm !== 'Ambiente' ? (
                              <span className={`ml-1.5 align-middle text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${ARMAZENAGEM_ESTILO[arm]}`}>
                                {arm}
                              </span>
                            ) : null;
                          })()}
                          <span className="sm:hidden block text-[10px] font-mono text-gray-500 mt-0.5">{l.lote || 'sem lote'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell">{l.lote || '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-300">
                          {fmtData(l.vencimento)}
                          {l.status === 'OK' && (
                            <div className={`text-[10px] mt-0.5 ${l.dias < 0 ? 'text-red-400' : l.dias <= 7 ? 'text-amber-400' : 'text-gray-500'}`}>
                              {l.dias < 0 ? `venceu há ${Math.abs(l.dias)}d` : l.dias === 0 ? 'vence hoje' : `faltam ${l.dias}d`}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${COR_SITUACAO[l.situacao as Situacao]}`}>
                            {l.status === 'OK' ? l.situacao : l.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right tabular-nums">{qtdBR(l.qtd ?? 0)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-right tabular-nums hidden md:table-cell">
                          <span className={divergente ? 'text-amber-400' : 'text-gray-400'}>
                            {qtdBR(saldoProduto(l.produto_id))}
                          </span>
                          {divergente && (
                            <span title="Os lotes deste produto somam mais que o saldo. A venda no PDV não escolhe lote — quando isso acontece, encerre o lote consumido ou ajuste a quantidade."
                              className="ml-1 inline-block align-middle text-amber-400"><TriangleAlert size={10} /></span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-center items-center gap-1.5">
                            {l.status === 'OK' && (
                              <>
                                <button onClick={() => encerrarConsumido(l)} disabled={acaoId === l.id}
                                  title="Vendeu tudo antes de vencer — encerra o lote sem mexer no estoque"
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors flex items-center gap-1 disabled:opacity-40">
                                  <Check size={11} /> Consumido
                                </button>
                                <button onClick={() => baixarPerda(l)} disabled={acaoId === l.id}
                                  title="Perdeu por validade — baixa o estoque"
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-400/10 transition-colors flex items-center gap-1 disabled:opacity-40">
                                  <PackageMinus size={11} /> Perda
                                </button>
                              </>
                            )}
                            <MenuMais>
                              {fechar => (
                                <>
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="vencimentos_estoque" entidadeId={l.id} titulo={`Lote ${l.lote ?? '—'}`} criadoEm={l.created_at} atualizadoEm={l.updated_at} />
                                </>
                              )}
                            </MenuMais>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
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

      <p className="text-[11px] text-gray-600 -mt-4 flex items-start gap-1.5">
        <CalendarClock size={12} className="shrink-0 mt-0.5" />
        A venda no PDV não escolhe lote: o controle aqui é de validade e perda, não um segundo saldo.
        Quando os lotes somarem mais que o saldo do produto, é sinal de saída que o lote não acompanhou.
      </p>
    </motion.div>
  );
};

export const ValidadesView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O controle de validade" />;
  return <ValidadesViewInner showToast={showToast} filial={filialAtiva} />;
};
