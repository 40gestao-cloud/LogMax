import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, Tag, TrendingDown, Info } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { EmptyState } from '../components/ui';

export const AprovacoesPromocaoFinanceiroView = ({ showToast }: any) => {
  const { data: promocoes, setData } = useFetchData<any>('/api/marketingpromocoesview', { status: 'Aguardando Aprovação' });
  const [obs, setObs]           = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const handleAprovar = async (promo: any) => {
    if (processing) return;
    setProcessing(promo.id);
    try {
      await dbUpdate('/api/marketingpromocoesview', promo.id, {
        status:     'Aprovado',
        observacao: obs[promo.id] ?? '',
      });
      // Atualiza o preço do produto no PDV automaticamente
      if (promo.produto_id && promo.preco_promocional) {
        await dbUpdate('/api/produtosview', promo.produto_id, {
          preco: Number(promo.preco_promocional),
        });
      }
      setData((prev: any[]) => prev.filter(p => p.id !== promo.id));
      showToast('Promoção aprovada! Preço atualizado no PDV.', 'success', true);
    } catch {
      showToast('Erro ao aprovar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleReprovar = async (promo: any) => {
    if (processing) return;
    if (!obs[promo.id]?.trim()) {
      showToast('Informe uma observação para reprovar.', 'error', true);
      return;
    }
    setProcessing(promo.id);
    try {
      await dbUpdate('/api/marketingpromocoesview', promo.id, {
        status:     'Reprovado',
        observacao: obs[promo.id],
      });
      setData((prev: any[]) => prev.filter(p => p.id !== promo.id));
      showToast('Promoção reprovada.', 'info', true);
    } catch {
      showToast('Erro ao reprovar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const calcDesconto = (promo: any) => {
    const atual  = Number(promo.preco_atual || 0);
    const promo_ = Number(promo.preco_promocional || 0);
    if (!atual || promo_ >= atual) return null;
    return ((atual - promo_) / atual * 100).toFixed(1);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações de Promoções</h2>
        <p className="text-sm text-gray-400 mt-1">Analise e aprove ou reprove propostas de preço promocional enviadas pelo Marketing.</p>
      </div>

      {/* Aviso sobre impacto da aprovação */}
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-accent/20 shrink-0"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }}>
        <Info size={16} className="text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          Ao <span className="text-accent font-bold">Aprovar</span>, o preço do produto será atualizado imediatamente no PDV para o valor sugerido pelo Marketing.
          O preço anterior não é revertido automaticamente ao fim da campanha.
        </p>
      </div>

      {promocoes.length === 0 ? (
        <EmptyState message="Nenhuma promoção aguardando aprovação" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto main-scrollbar pb-6">
          {promocoes.map((promo: any) => {
            const desc = calcDesconto(promo);
            return (
              <motion.div key={promo.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">

                {/* Cabeçalho */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-accent shrink-0" />
                      <p className="text-sm font-bold text-gray-200 truncate">{promo.nome_produto ?? 'Produto'}</p>
                    </div>
                    {promo.descricao && (
                      <p className="text-xs text-gray-500 mt-1 truncate">{promo.descricao}</p>
                    )}
                    {(promo.data_inicio || promo.data_fim) && (
                      <p className="text-[10px] font-mono text-gray-600 mt-1">
                        Período: {promo.data_inicio ?? '?'} → {promo.data_fim ?? '?'}
                      </p>
                    )}
                    {promo.nome_criador && (
                      <p className="text-[10px] text-gray-600 mt-0.5">Proposto por: {promo.nome_criador}</p>
                    )}
                  </div>
                  {desc && (
                    <div className="flex items-center gap-1 text-[10px] font-black text-accent shrink-0 px-2 py-1 rounded-full border border-accent/20"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                      <TrendingDown size={10} />-{desc}%
                    </div>
                  )}
                </div>

                {/* Comparativo de preços */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Custo</p>
                    <p className="text-xs font-mono font-bold text-gray-500">
                      {promo.preco_custo > 0
                        ? `R$ ${Number(promo.preco_custo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '—'}
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

                {/* Observação (expandível) */}
                {expanded === promo.id && (
                  <textarea
                    className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                    placeholder="Observação (obrigatória para reprovar)..."
                    value={obs[promo.id] ?? ''}
                    onChange={e => setObs(o => ({ ...o, [promo.id]: e.target.value }))}
                  />
                )}

                {/* Botões de ação */}
                <div className="flex gap-2 justify-end items-center">
                  {expanded !== promo.id && (
                    <button onClick={() => setExpanded(promo.id)} disabled={!!processing}
                      className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">
                      Adicionar obs.
                    </button>
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
    </motion.div>
  );
};
