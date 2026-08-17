import React, { useState } from 'react';
import { todayBR } from '../lib/dates';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, ShoppingCart, AlertTriangle, X, Save } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { parseQtd, qtdBR, formatQtd, handleQtdKeyDown } from '../lib/viewUtils';
import { normalizarUnidade, UNIDADES_FRACIONARIAS } from '../lib/unidades';
import { temEstoque } from '../lib/tipoProduto';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, ExportButton, NeuButtonAccent } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

const SugestoesComprasViewInner = ({ showToast, profile, filial }: any) => {
  // Lê pela view mascarada (migr. 262): o valor de uma recompra é o que a casa
  // PAGA no item, não o que cobra por ele. Antes daqui a estimativa saía de
  // `p.preco` — o comprador via um orçamento de reposição inflado pela própria
  // margem da loja e levava esse número para a cotação. Logística está entre os
  // setores que enxergam custo; para quem não está, `preco_custo` vem NULL e a
  // coluna mostra "—" em vez de mentir.
  const { data: produtos, isLoading } = useFetchData<any>('/api/produtoscomcustoview', { filial });
  const [search, setSearch] = useState('');
  const [filtroMode, setFiltroMode] = useState<'todos' | 'zerados'>('todos');
  const [requestingItem, setRequestingItem] = useState<any | null>(null);
  const [qtdSolicitada, setQtdSolicitada] = useState<string>('');
  const [urgencia, setUrgencia] = useState('Normal');
  const [isSaving, setIsSaving] = useState(false);

  const openSolicitar = (p: any) => {
    setRequestingItem(p);
    setQtdSolicitada(qtdBR(p.qtd_sugerida));
  };

  // Patrimônio não se repõe: um freezer com saldo 0 não é ruptura de estoque.
  // Material de uso e consumo SIM — resma acabando é exatamente o caso de uso
  // desta tela. Por isso `temEstoque`, não `ehVendavel` (migr. 440).
  const ativos = produtos.filter((p: any) => p.status === 'Ativo' && temEstoque(p.tipo));
  const limiteMin = (p: any) => Number(p.estoque_minimo ?? 0) || 10;
  // A unidade do item em pauta decide se a quantidade pedida aceita fração.
  const sugFrac = UNIDADES_FRACIONARIAS.has(normalizarUnidade(requestingItem?.unidade));
  const criticos = ativos.filter((p: any) => p.estoque === 0);
  const baixos = ativos.filter((p: any) => p.estoque > 0 && p.estoque <= limiteMin(p));

  const sugestoes = ativos
    .filter((p: any) => p.estoque <= limiteMin(p))
    .filter((p: any) => filtroMode === 'zerados' ? p.estoque === 0 : true)
    .filter((p: any) => [p.codigo, p.nome, p.categoria].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())))
    .map((p: any) => {
      // `estoque_minimo` e `estoque` são numeric(15,3) — sem arredondar, a
      // sugestão sai como 12,333333333 e vira o texto da requisição.
      const qtd_sugerida = Math.round(
        Math.max((limiteMin(p) * 2) - Number(p.estoque ?? 0), limiteMin(p)) * 1000) / 1000;
      const custo = Number(p.preco_custo ?? 0);
      // Custo desconhecido (não cadastrado, ou usuário sem permissão de ver)
      // não vira zero nem cai no preço de venda: fica nulo e some do total.
      const valor_est = custo > 0 ? qtd_sugerida * custo : null;
      return { ...p, qtd_sugerida, custo, valor_est };
    });

  const valorTotalEst = sugestoes.reduce((acc: number, p: any) => acc + (p.valor_est ?? 0), 0);
  const semCusto = sugestoes.filter((p: any) => p.valor_est === null).length;
  const fmtValor = (v: number | null) =>
    v === null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const situacao = (estoque: number) =>
    estoque === 0 ? { label: 'Crítico', cls: 'bg-red-950/50 text-red-500' }
    : { label: 'Baixo', cls: 'bg-yellow-900/30 text-yellow-400' };

  const handleSolicitar = async () => {
    if (!requestingItem) return;
    const qtdNum = parseQtd(qtdSolicitada);
    if (qtdNum <= 0) {
      showToast("Informe uma quantidade válida.", 'error', true);
      return;
    }
    setIsSaving(true);
    showToast("Criando requisição...", 'info', false);
    try {
      // Usa a MESMA RPC de RequisicoesView. O insert direto que estava aqui
      // criava só a linha de `requisicoes` — a linha de `aprovacoes_compras`
      // (que a RPC cria junto) ficava faltando, então a requisição nunca
      // aparecia em Minhas Aprovações e travava em Pendente pra sempre.
      // Também não mandava `filial`: o default da coluna é 'SuperMax', então
      // sugestão da TechMax virava requisição da SuperMax.
      if (!supabase) throw new Error('Supabase não configurado');
      // A justificativa não é digitada aqui de propósito: ela É o motivo da
      // reposição, e o motivo está nos dados (saldo atual × estoque mínimo).
      // Pedir para o comprador redigitar isso só produziria "reposição" como
      // texto — a migr. 283 exige justificativa justamente para o gerente ter
      // o que ler antes de aprovar.
      const saldoAtual = Number(requestingItem.estoque ?? 0);
      const minimo     = limiteMin(requestingItem);
      const justificativa = saldoAtual === 0
        ? `Reposição automática: ${requestingItem.nome} está ZERADO em ${filial} (estoque mínimo ${qtdBR(minimo)} ${normalizarUnidade(requestingItem.unidade)}). Sem saldo para atender a operação.`
        : `Reposição automática: saldo atual ${qtdBR(saldoAtual)} ${normalizarUnidade(requestingItem.unidade)} contra estoque mínimo de ${qtdBR(minimo)} em ${filial}. Ponto de pedido atingido.`;

      const { error } = await supabase.rpc('criar_requisicoes_compra_lote', {
        p_itens:        [{ item: requestingItem.nome, qtd: qtdNum, unidade: normalizarUnidade(requestingItem.unidade) }],
        p_solicitante:  '',
        p_urgencia:     urgencia,
        p_centro_custo: '',
        p_filial:       filial,
        p_justificativa: justificativa,
        // Reposição não tem data contratada: o prazo sai da cotação.
        p_data_necessidade: null,
      });
      if (error) throw new Error(error.message);
      showToast("Requisição criada e enviada para aprovação!", 'success', true);
      setRequestingItem(null);
      setQtdSolicitada('');
      setUrgencia('Normal');
    } catch (err: any) {
      showToast(`Erro ao criar requisição: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const exportCols = ['Código', 'Produto', 'Estoque Atual', 'Unidade', 'Situação', 'Qtd Sugerida', 'Custo Est.'];
  const exportRows = () => sugestoes.map((p: any) => [
    p.codigo ?? '', p.nome ?? '', qtdBR(p.estoque ?? 0), normalizarUnidade(p.unidade, ''),
    situacao(p.estoque).label,
    qtdBR(p.qtd_sugerida),
    fmtValor(p.valor_est),
  ]);

  const kpis = [
    { label: 'Estoque Crítico', value: criticos.length, sub: 'produtos zerados', warn: criticos.length > 0 },
    { label: 'Estoque Baixo', value: baixos.length, sub: 'menos de 10 unid.', warn: baixos.length > 0 },
    { label: 'Valor Estimado de Recompra', value: `R$ ${valorTotalEst.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      sub: semCusto > 0 ? `a preço de custo — ${semCusto} item(ns) sem custo ficaram de fora` : 'a preço de custo', warn: false },
    { label: 'Produtos Monitorados', value: ativos.length, sub: 'ativos no catálogo', warn: false },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Sugestões de Compras</h2>
        <p className="text-sm text-gray-400 mt-1">Produtos com estoque crítico ou baixo que precisam de reabastecimento.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-red-500' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-2">
          <button onClick={() => setFiltroMode('todos')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filtroMode === 'todos' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            Críticos e Baixos
          </button>
          <button onClick={() => setFiltroMode('zerados')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filtroMode === 'zerados' ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            <AlertTriangle size={14} />Somente Zerados
          </button>
        </div>
        <div className="flex gap-3 items-center">
          {sugestoes.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={() => exportToPDF('Sugestões de Compras', exportCols, exportRows(), 'logmax-sugestoes')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Sugestões', exportCols, exportRows(), 'logmax-sugestoes')} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Modal de solicitação */}
      <AnimatePresence>
        {requestingItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-accent/20 flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-200">Criar Requisição — <span className="text-accent">{requestingItem.nome}</span></h3>
                <button onClick={() => setRequestingItem(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sug-qtd" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Quantidade <span className="text-gray-600 normal-case font-medium tracking-normal">(sugerido: {qtdBR(requestingItem.qtd_sugerida)} {normalizarUnidade(requestingItem.unidade)})</span>
                  </label>
                  <input id="sug-qtd" type="text" inputMode="decimal"
                    className="neu-input py-2 px-3 rounded-xl text-sm text-accent font-mono font-bold"
                    value={qtdSolicitada}
                    onChange={e => setQtdSolicitada(formatQtd(e.target.value, sugFrac))}
                    onKeyDown={handleQtdKeyDown(sugFrac)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sug-urgencia" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Urgência</label>
                  <select id="sug-urgencia" className="neu-input py-2 px-3 rounded-xl text-sm" value={urgencia} onChange={e => setUrgencia(e.target.value)}>
                    {['Normal', 'Alta', 'Urgente'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {/* Solicitante saiu do formulário (migr. 283): quem pede é
                    quem está logado, e o banco grava isso. Campo de texto
                    livre para autoria é a porta da requisição fantasma. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Solicitante</span>
                  <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">{profile?.nome ?? 'Você'}</div>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setRequestingItem(null)} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSolicitar} isLoading={isSaving}><Save size={14} /> Criar Requisição</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-3 sm:p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          {isLoading ? <LoadingSpinner /> : sugestoes.length === 0 ? (
            <EmptyState message={filtroMode === 'zerados' ? 'Nenhum produto com estoque zerado.' : 'Nenhum produto com estoque crítico ou baixo.'} />
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="sm:hidden flex flex-col gap-3">
                <AnimatePresence>
                  {sugestoes.map((p: any) => {
                    const sit = situacao(p.estoque);
                    return (
                      <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-100 truncate">{p.nome ?? '—'}</p>
                            <p className="text-[11px] font-mono text-gray-500 mt-0.5">{p.codigo ?? '—'}</p>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sit.cls}`}>{sit.label}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Estoque</p>
                            <p className={`text-sm font-mono font-bold ${p.estoque === 0 ? 'text-red-500' : 'text-yellow-400'}`}>{p.estoque}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Sugerido</p>
                            <p className="text-sm font-mono font-bold text-gray-200">{qtdBR(p.qtd_sugerida)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Custo est.</p>
                            <p className="text-sm font-mono font-bold text-gray-200">{fmtValor(p.valor_est)}</p>
                          </div>
                        </div>
                        <button onClick={() => openSolicitar(p)}
                          className="w-full flex items-center justify-center gap-2 neu-button py-2.5 rounded-xl text-sm text-accent font-semibold border border-accent/20">
                          <ShoppingCart size={14} /> Solicitar
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Desktop: tabela */}
              <table className="hidden sm:table w-full text-left border-collapse">
                <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Código</th>
                  <th className="pb-4 font-bold px-4">Produto</th>
                  <th className="pb-4 font-bold px-4 text-right">Estoque Atual</th>
                  <th className="pb-4 font-bold px-4">Unidade</th>
                  <th className="pb-4 font-bold px-4 text-center">Situação</th>
                  <th className="pb-4 font-bold px-4 text-right">Qtd Sugerida</th>
                  <th className="pb-4 font-bold px-4 text-right">Custo Est.</th>
                  <th className="pb-4 font-bold px-4 text-right">Ação</th>
                </tr></thead>
                <tbody>
                  <AnimatePresence>
                    {sugestoes.map((p: any) => {
                      const sit = situacao(p.estoque);
                      return (
                        <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.codigo ?? '—'}</td>
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome ?? '—'}</td>
                          <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${p.estoque === 0 ? 'text-red-500' : 'text-yellow-400'}`}>{p.estoque}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{p.unidade ?? '—'}</td>
                          <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sit.cls}`}>{sit.label}</span></td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{qtdBR(p.qtd_sugerida)}</td>
                          <td className={`py-3 px-4 text-xs font-mono text-right ${p.valor_est === null ? 'text-gray-600' : 'text-gray-200'}`}
                              title={p.valor_est === null ? 'Produto sem preço de custo cadastrado — o custo passa a vir sozinho no primeiro recebimento de compra deste item.' : `Custo unitário R$ ${p.custo.toFixed(2)}`}>
                            {fmtValor(p.valor_est)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button onClick={() => openSolicitar(p)}
                              className="flex items-center gap-1.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity neu-button px-3 py-1.5 rounded-lg text-xs text-accent font-semibold hover:border-accent/20 border border-transparent">
                              <ShoppingCart size={12} /> Solicitar
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
};


export const SugestoesComprasView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <SugestoesComprasViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
