import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, Tag, TrendingDown, Info, Megaphone, Package } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { EmptyState, LoadingSpinner } from '../components/ui';
import { playPlim } from '../utils/audioUtils';

// ── Aba Promoções (código original) ──────────────────────────────────────────
function AbaPromocoes({ showToast, filial }: any) {
  const { data: promocoes, setData } = useFetchData<any>('/api/marketingpromocoesview', { status: 'Aguardando Aprovação', filial });
  const [obs,       setObs]       = useState<Record<string, string>>({});
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [processing,setProcessing]= useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc('reverter_promocoes_expiradas').then(({ error }) => {
      if (error) console.warn('[reverter_promocoes_expiradas]', error.message);
    });
  }, []);

  const handleAprovar = async (promo: any) => {
    if (processing) return;
    setProcessing(promo.id);
    try {
      await dbUpdate('/api/marketingpromocoesview', promo.id, { status: 'Aprovado', observacao: obs[promo.id] ?? '' });
      if (promo.produto_id && promo.preco_promocional) {
        await dbUpdate('/api/produtosview', promo.produto_id, { preco: Number(promo.preco_promocional) });
      }
      setData((prev: any[]) => prev.filter(p => p.id !== promo.id));
      playPlim();
      showToast('Promoção aprovada! Preço atualizado no PDV.', 'success', true);
    } catch { showToast('Erro ao aprovar.', 'error', true); }
    finally { setProcessing(null); }
  };

  const handleReprovar = async (promo: any) => {
    if (processing) return;
    if (!obs[promo.id]?.trim()) { showToast('Informe uma observação para reprovar.', 'error', true); return; }
    setProcessing(promo.id);
    try {
      await dbUpdate('/api/marketingpromocoesview', promo.id, { status: 'Reprovado', observacao: obs[promo.id] });
      setData((prev: any[]) => prev.filter(p => p.id !== promo.id));
      showToast('Promoção reprovada.', 'info', true);
    } catch { showToast('Erro ao reprovar.', 'error', true); }
    finally { setProcessing(null); }
  };

  const calcDesconto = (promo: any) => {
    const atual = Number(promo.preco_atual || 0);
    const p     = Number(promo.preco_promocional || 0);
    if (!atual || p >= atual) return null;
    return ((atual - p) / atual * 100).toFixed(1);
  };

  return (
    <>
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-accent/20"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }}>
        <Info size={16} className="text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          Ao <span className="text-accent font-bold">Aprovar</span>, o preço do produto será atualizado imediatamente no PDV.
          Ao fim da campanha, o preço original é restaurado automaticamente.
        </p>
      </div>

      {promocoes.length === 0 ? (
        <EmptyState message="Nenhuma promoção aguardando aprovação" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {promocoes.map((promo: any) => {
            const desc = calcDesconto(promo);
            return (
              <motion.div key={promo.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-accent shrink-0" />
                      <p className="text-sm font-bold text-gray-200 truncate">{promo.nome_produto ?? 'Produto'}</p>
                    </div>
                    {promo.descricao && <p className="text-xs text-gray-500 mt-1 truncate">{promo.descricao}</p>}
                    {(promo.data_inicio || promo.data_fim) && (
                      <p className="text-[10px] font-mono text-gray-600 mt-1">Período: {promo.data_inicio ?? '?'} → {promo.data_fim ?? '?'}</p>
                    )}
                    {promo.nome_criador && <p className="text-[10px] text-gray-600 mt-0.5">Proposto por: {promo.nome_criador}</p>}
                  </div>
                  {desc && (
                    <div className="flex items-center gap-1 text-[10px] font-black text-accent shrink-0 px-2 py-1 rounded-full border border-accent/20"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                      <TrendingDown size={10} />-{desc}%
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Custo</p>
                    <p className="text-xs font-mono font-bold text-gray-500">
                      {promo.preco_custo > 0 ? `R$ ${Number(promo.preco_custo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Preço Atual</p>
                    <p className="text-xs font-mono font-bold text-gray-200">
                      R$ {Number(promo.preco_atual || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="neu-pressed rounded-xl p-3 border border-accent/25">
                    <p className="text-[9px] font-bold text-accent uppercase tracking-widest mb-1.5">Sugestão</p>
                    <p className="text-xs font-mono font-black text-accent">
                      R$ {Number(promo.preco_promocional || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                {expanded === promo.id && (
                  <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                    placeholder="Observação (obrigatória para reprovar)..."
                    value={obs[promo.id] ?? ''} onChange={e => setObs(o => ({ ...o, [promo.id]: e.target.value }))} />
                )}
                <div className="flex gap-2 justify-end items-center">
                  {expanded !== promo.id && (
                    <button onClick={() => setExpanded(promo.id)} disabled={!!processing}
                      className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">Adicionar obs.</button>
                  )}
                  <button onClick={() => handleReprovar(promo)} disabled={processing === promo.id}
                    className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-500 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                    {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Reprovar
                  </button>
                  <button onClick={() => handleAprovar(promo)} disabled={processing === promo.id}
                    className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                    {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Aprovar
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Aba Campanhas ─────────────────────────────────────────────────────────────
function AbaCampanhas({ showToast, filial }: any) {
  const { data: campanhas, setData: setCampanhas, isLoading: loadingCamp } =
    useFetchData<any>('/api/marketingcampanhasview', { status: 'Aguardando Financeiro', filial });
  // itens_campanha não tem coluna filial própria — escopo é derivado
  // via campanha_id (só carregamos itens das campanhas já filtradas).
  const { data: todosItens, setData: setItens } = useFetchData<any>('itens_campanha');
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });

  const [motivos,    setMotivos]    = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [campAberta, setCampAberta] = useState<string | null>(null);

  const prodMap: Record<string, any> = {};
  for (const p of produtos) prodMap[p.id] = p;

  const itensDaCamp = (campId: string) => todosItens.filter((i: any) => i.campanha_id === campId);

  const atualizaItem = async (itemId: string, status: string, motivo?: string) => {
    if (!supabase) return;
    const payload: any = { status };
    if (motivo !== undefined) payload.motivo_reprovacao = motivo || null;
    const { data, error } = await supabase.from('itens_campanha').update(payload).eq('id', itemId).select().single();
    if (error) throw error;
    setItens((prev: any[]) => prev.map((i: any) => i.id === itemId ? { ...i, ...data } : i));
  };

  const calcNovoStatusCampanha = (itens: any[]) => {
    const total    = itens.length;
    const aprovs   = itens.filter((i: any) => i.status === 'Aprovado').length;
    const reprovs  = itens.filter((i: any) => i.status === 'Reprovado').length;
    if (aprovs === total) return 'Aprovado';
    if (reprovs === total) return 'Reprovado';
    if (aprovs > 0 || reprovs > 0) return 'Parcialmente Aprovado';
    return null;
  };

  const finalizarCampanha = async (camp: any, itens: any[]) => {
    const novoStatus = calcNovoStatusCampanha(itens);
    if (!novoStatus) { showToast('Avalie todos os itens antes de finalizar.', 'error', true); return; }
    const updated = await dbUpdate('/api/marketingcampanhasview', camp.id, { status: novoStatus } as any);
    setCampanhas((prev: any[]) => prev.filter((c: any) => c.id !== camp.id));
    playPlim();
    showToast(`Campanha "${camp.nome}" marcada como ${novoStatus}.`, 'success', true);
  };

  const handleItemAprovar = async (item: any) => {
    setProcessing(item.id);
    try { await atualizaItem(item.id, 'Aprovado'); }
    catch (err: any) { showToast(err.message, 'error', true); }
    finally { setProcessing(null); }
  };

  const handleItemReprovar = async (item: any) => {
    const motivo = motivos[item.id]?.trim();
    if (!motivo) { showToast('Informe o motivo da reprovação.', 'error', true); return; }
    setProcessing(item.id);
    try { await atualizaItem(item.id, 'Reprovado', motivo); }
    catch (err: any) { showToast(err.message, 'error', true); }
    finally { setProcessing(null); }
  };

  const handleAprovarTudo = async (camp: any) => {
    const itens = itensDaCamp(camp.id).filter((i: any) => i.status === 'Pendente');
    if (itens.length === 0) { showToast('Nenhum item Pendente para aprovar.', 'error', true); return; }
    setProcessing(`bulk-${camp.id}`);
    try {
      for (const item of itens) {
        await atualizaItem(item.id, 'Aprovado');
      }
      // re-lê estado dos itens após loop para calcular status correto
      const todosItensAtuais = itensDaCamp(camp.id).map((i: any) =>
        itens.find((x: any) => x.id === i.id) ? { ...i, status: 'Aprovado' } : i
      );
      await finalizarCampanha(camp, todosItensAtuais);
    } catch (err: any) {
      showToast(`Erro ao aprovar: ${err.message ?? 'verifique o console'}. Alguns itens podem não ter sido atualizados.`, 'error', true);
    } finally { setProcessing(null); }
  };

  const handleReprovarTudo = async (camp: any) => {
    const motivo = motivos[`bulk-${camp.id}`]?.trim();
    if (!motivo) { showToast('Informe o motivo para reprovar tudo.', 'error', true); return; }
    const itens = itensDaCamp(camp.id).filter((i: any) => i.status === 'Pendente');
    if (itens.length === 0) { showToast('Nenhum item Pendente para reprovar.', 'error', true); return; }
    setProcessing(`bulk-${camp.id}`);
    try {
      for (const item of itens) {
        await atualizaItem(item.id, 'Reprovado', motivo);
      }
      const todosItensAtuais = itensDaCamp(camp.id).map((i: any) =>
        itens.find((x: any) => x.id === i.id) ? { ...i, status: 'Reprovado' } : i
      );
      await finalizarCampanha(camp, todosItensAtuais);
    } catch (err: any) {
      showToast(`Erro ao reprovar: ${err.message ?? 'verifique o console'}. Alguns itens podem não ter sido atualizados.`, 'error', true);
    } finally { setProcessing(null); }
  };

  const handleFinalizar = async (camp: any) => {
    const itens = itensDaCamp(camp.id);
    try { await finalizarCampanha(camp, itens); }
    catch (err: any) { showToast(err.message, 'error', true); }
  };

  if (loadingCamp) return <LoadingSpinner />;

  if (campanhas.length === 0) return <EmptyState message="Nenhuma campanha aguardando aprovação do Financeiro." />;

  return (
    <div className="space-y-4">
      {campanhas.map((camp: any) => {
        const itens  = itensDaCamp(camp.id);
        const aberta = campAberta === camp.id;
        return (
          <div key={camp.id} className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
            {/* Header da campanha */}
            <button onClick={() => setCampAberta(aberta ? null : camp.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/3 transition-colors">
              <div className="flex items-center gap-3">
                <Megaphone size={16} className="text-accent shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-200">{camp.nome}</p>
                  <p className="text-[10px] text-gray-500">{camp.data_inicio} → {camp.data_fim} · {itens.length} produto(s)</p>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                aberta ? 'border-accent/30 text-accent' : 'border-gray-700 text-gray-500'
              }`}>{aberta ? 'Fechar' : 'Revisar'}</span>
            </button>

            {aberta && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                {/* Itens */}
                {itens.length === 0 ? (
                  <EmptyState message="Nenhum produto nesta campanha." />
                ) : itens.map((item: any) => {
                  const prod = prodMap[item.produto_id];
                  const isProc = processing === item.id;
                  const statusCls =
                    item.status === 'Aprovado'  ? 'border-green-500/20 bg-green-500/5' :
                    item.status === 'Reprovado' ? 'border-red-500/20  bg-red-500/5'   :
                    'border-white/5 bg-white/2';
                  return (
                    <div key={item.id} className={`rounded-xl border p-3 space-y-2 transition-colors ${statusCls}`}>
                      <div className="flex items-center gap-2">
                        <Package size={13} className="text-gray-500 shrink-0" />
                        <p className="text-sm font-semibold text-gray-200 flex-1 truncate">{prod?.nome ?? item.produto_id}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                          item.status === 'Aprovado'  ? 'border-green-500/30 text-green-400' :
                          item.status === 'Reprovado' ? 'border-red-500/30  text-red-400'   :
                          'border-gray-600 text-gray-500'
                        }`}>{item.status}</span>
                      </div>
                      {(item.preco_atual || item.preco_promocional) && (
                        <div className="flex gap-3 text-xs text-gray-500">
                          {item.preco_atual     != null && <span>Atual: <strong className="text-gray-300">R$ {Number(item.preco_atual).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>}
                          {item.preco_promocional != null && <span>Promo: <strong className="text-accent">R$ {Number(item.preco_promocional).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>}
                        </div>
                      )}
                      {item.motivo_reprovacao && (
                        <p className="text-[10px] text-red-400 italic">Motivo: {item.motivo_reprovacao}</p>
                      )}

                      {item.status === 'Pendente' && (
                        <div className="flex gap-2 items-center pt-1">
                          <input className="neu-input flex-1 text-xs px-2 py-1 rounded-lg"
                            placeholder="Motivo (obrigatório para reprovar)…"
                            value={motivos[item.id] ?? ''}
                            onChange={e => setMotivos(m => ({ ...m, [item.id]: e.target.value }))} />
                          <button onClick={() => handleItemReprovar(item)} disabled={isProc}
                            className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                            {isProc ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}Reprovar
                          </button>
                          <button onClick={() => handleItemAprovar(item)} disabled={isProc}
                            className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                            {isProc ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}Aprovar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Ações bulk + finalizar */}
                {itens.length > 0 && (
                  <div className="pt-3 border-t border-white/5 space-y-2">
                    <div className="flex gap-2 items-center">
                      <input className="neu-input flex-1 text-xs px-2 py-1.5 rounded-lg"
                        placeholder="Motivo para reprovar tudo…"
                        value={motivos[`bulk-${camp.id}`] ?? ''}
                        onChange={e => setMotivos(m => ({ ...m, [`bulk-${camp.id}`]: e.target.value }))} />
                      <button onClick={() => handleReprovarTudo(camp)} disabled={!!processing}
                        className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
                        <X size={10} />Reprovar Tudo
                      </button>
                      <button onClick={() => handleAprovarTudo(camp)} disabled={!!processing}
                        className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-green-400 hover:bg-green-900/20 border border-green-500/10 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
                        <Check size={10} />Aprovar Tudo
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => handleFinalizar(camp)} disabled={!!processing}
                        className="neu-button px-4 py-1.5 rounded-lg text-xs font-bold text-gray-200 hover:text-accent border border-white/10 disabled:opacity-40">
                        Finalizar avaliação
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── View Principal ────────────────────────────────────────────────────────────
export const AprovacoesPromocaoFinanceiroView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  const [aba, setAba] = useState<'promocoes' | 'campanhas'>('promocoes');
  if (!filialAtiva) return null;

  const tabs = [
    { id: 'promocoes' as const, label: 'Promoções', icon: Tag },
    { id: 'campanhas' as const, label: 'Campanhas', icon: Megaphone },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — Marketing</h2>
        <p className="text-sm text-gray-400 mt-1">Analise e aprove promoções individuais e itens de campanhas enviados pelo Marketing.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setAba(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
              aba === t.id
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'neu-button border-white/5 text-gray-400 hover:text-gray-200'
            }`}>
            <t.icon size={13} />{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto main-scrollbar pb-6 space-y-4">
        {aba === 'promocoes' ? <AbaPromocoes showToast={showToast} filial={filialAtiva} /> : <AbaCampanhas showToast={showToast} filial={filialAtiva} />}
      </div>
    </motion.div>
  );
};
