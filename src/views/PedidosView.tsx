import React, { useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';

const PedidosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>('/api/pedidosview', { filial }, undefined, { page });
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  const { data: cotacoes } = useFetchData<any>('/api/cotacoesview', { filial });
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesview', { filial });
  const [processing, setProcessing] = useState<string | null>(null);

  const enriched = data.map((p: any) => {
    const cotacao = cotacoes.find((c: any) => c.id === p.cotacao_id);
    return {
      ...p,
      forn: fornecedores.find((f: any) => f.id === p.fornecedor_id),
      req: cotacao ? requisicoes.find((r: any) => r.id === cotacao.requisicao_id) : null,
    };
  });

  // "Aprovar Pedido" saiu (migr. 267). Era um gate de mentira: sem nenhum
  // RBAC — qualquer um que enxergasse o módulo Compras clicava — e aprovando
  // pela terceira vez algo que a chefia já aprovou na requisição e o
  // Financeiro na cotação. Sua única função real era gerar a Conta a Pagar,
  // que agora nasce junto com o pedido, dentro da mesma transação.
  //
  // "Em Entrega" → "Recebido" deixou de ser manual aqui: o pedido é fechado
  // automaticamente pelo RecebimentosView quando todos os itens forem confirmados.
  const STATUS_FLOW: Record<string, { next: string; label: string }> = {
    'Aprovado': { next: 'Em Entrega', label: 'Marcar Em Entrega' },
  };

  const handleAvance = async (pedido: any) => {
    const flow = STATUS_FLOW[pedido.status];
    if (!flow) return;
    setProcessing(pedido.id);
    try {
      const updated = await dbUpdate('/api/pedidosview', pedido.id, { status: flow.next });
      setData((prev: any[]) => prev.map(p => p.id === pedido.id ? (updated ?? { ...p, status: flow.next }) : p));
      showToast(`Pedido ${flow.next.toLowerCase()}!`, 'success', true);
    } catch (err: any) {
      showToast(`Erro ao atualizar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar este pedido?')) return;
    try {
      // Pedido aprovado gera Conta a Pagar com pedido_id. Inativar só o pedido
      // deixava a conta órfã visível em Despesas Operacionais. Inativamos
      // junto as contas Pendentes; se houver conta 'Pago', recusamos a
      // exclusão — registro financeiro real não some por exclusão de pedido.
      if (supabase) {
        const { data: contas } = await supabase
          .from('contas_pagar')
          .select('id, status')
          .eq('pedido_id', id)
          .eq('ativo', true);
        const pagas = (contas ?? []).filter((c: any) => c.status === 'Pago');
        if (pagas.length > 0) {
          showToast('Existe Conta a Pagar já quitada para este pedido. Estorne antes de inativar.', 'error', true);
          return;
        }
        const pendentes = (contas ?? []).filter((c: any) => c.status !== 'Pago');
        for (const c of pendentes) {
          await dbDelete('/api/contaspagarview', c.id);
        }
      }
      await dbDelete('/api/pedidosview', id);

      // A requisição foi marcada 'Atendida' quando este pedido nasceu (migr. 266).
      // Inativando o pedido ela precisa voltar a 'Aprovado', senão fica órfã:
      // sem pedido e fora do dropdown de Nova Cotação, ou seja, impossível de
      // reatender. Só volta se não sobrou nenhum outro pedido ativo dela.
      const pedido = data.find((p: any) => p.id === id);
      if (supabase && pedido?.requisicao_id) {
        const { data: outros } = await supabase
          .from('pedidos')
          .select('id')
          .eq('requisicao_id', pedido.requisicao_id)
          .eq('ativo', true)
          .neq('id', id)
          .limit(1);
        if (!outros || outros.length === 0) {
          try {
            await dbUpdate('/api/requisicoesview', pedido.requisicao_id, { status: 'Aprovado' });
          } catch {
            // Best-effort: o pedido já foi inativado e não vale abortar por isto.
            // Admin consegue reabrir a requisição manualmente.
          }
        }
      }

      setData((prev: any[]) => prev.filter(p => p.id !== id));
      showToast('Pedido inativado.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Pedidos] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos de Compra — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Pedidos gerados automaticamente a partir de cotações aprovadas.</p>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhum pedido. Aprove uma cotação para gerar o primeiro pedido." /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Pedido</th>
                  <th className="pb-4 font-bold px-4">Item</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Prazo Entrega</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((item: any) => {
                    const flow = STATUS_FLOW[item.status];
                    const isProc = processing === item.id;
                    // Snapshot tem prioridade sobre o JOIN — preserva nome/qtd se a requisição mudar.
                    const itemDisplay = item.item_descricao ?? item.req?.item ?? '—';
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-500 hidden sm:table-cell">#{item.id?.slice(-6).toUpperCase()}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          <span className="sm:hidden text-[10px] font-mono text-gray-500 block">#{item.id?.slice(-6).toUpperCase()}</span>
                          {itemDisplay}
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5 truncate">{item.forn?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden lg:table-cell">{item.prazo_entrega || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                            {flow && (
                              <button onClick={() => handleAvance(item)} disabled={isProc}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                {isProc ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                                {flow.label}
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
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

export const PedidosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <PedidosViewInner showToast={showToast} filial={filialAtiva} />;
};
