import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { useFetchData, dbUpdate, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination } from '../components/ui';
import { useWhatsApp } from '../hooks/useWhatsApp';
import { supabase } from '../lib/supabase';

export const PedidosView = ({ showToast }: any) => {
  const [page, setPage] = useState(0);
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>('/api/pedidosview', undefined, undefined, { page });
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');
  const { data: cotacoes } = useFetchData<any>('/api/cotacoesview');
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesview');
  const { notify: wppNotify } = useWhatsApp();
  const [processing, setProcessing] = useState<string | null>(null);

  const enriched = data.map((p: any) => {
    const cotacao = cotacoes.find((c: any) => c.id === p.cotacao_id);
    return {
      ...p,
      forn: fornecedores.find((f: any) => f.id === p.fornecedor_id),
      req: cotacao ? requisicoes.find((r: any) => r.id === cotacao.requisicao_id) : null,
    };
  });

  // "Em Entrega" → "Recebido" deixou de ser manual aqui: o pedido é fechado
  // automaticamente pelo RecebimentosView quando todos os itens forem confirmados.
  const STATUS_FLOW: Record<string, { next: string; label: string }> = {
    'Pendente': { next: 'Aprovado',   label: 'Aprovar Pedido' },
    'Aprovado': { next: 'Em Entrega', label: 'Marcar Em Entrega' },
  };

  const handleAvance = async (pedido: any) => {
    const flow = STATUS_FLOW[pedido.status];
    if (!flow) return;
    setProcessing(pedido.id);
    try {
      // Idempotência: se for aprovação, verifica se já há Conta a Pagar para este pedido
      // ANTES de avançar o status (evita duplicação em race / clique duplo / realtime).
      if (pedido.status === 'Pendente' && supabase) {
        const { data: existentes } = await supabase
          .from('contas_pagar')
          .select('id')
          .eq('pedido_id', pedido.id)
          .limit(1);
        if (existentes && existentes.length > 0) {
          showToast('Este pedido já possui Conta a Pagar registada.', 'info', true);
          setProcessing(null);
          return;
        }
      }

      const updated = await dbUpdate('/api/pedidosview', pedido.id, { status: flow.next });
      setData((prev: any[]) => prev.map(p => p.id === pedido.id ? (updated ?? { ...p, status: flow.next }) : p));

      if (pedido.status === 'Pendente') {
        // +30 dias se não houver prazo_entrega definido — garante que a conta tem vencimento.
        const vencimento = pedido.prazo_entrega
          || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        const itemDesc = pedido.item_descricao ?? pedido.req?.item ?? 'Compra';
        await dbInsert('/api/contaspagarview', {
          fornecedor_id: pedido.fornecedor_id,
          descricao: `Pedido #${pedido.id.slice(-6).toUpperCase()} — ${itemDesc}`,
          valor: pedido.valor_total,
          vencimento,
          status: 'Pendente',
          pedido_id: pedido.id,
        });
        showToast('Pedido aprovado! Conta a Pagar gerada.', 'success', true);
        wppNotify(`📦 *LogMax — Pedido aprovado*\n🛒 Item: ${itemDesc}\n🏢 Fornecedor: ${pedido.forn?.nome ?? '—'}\n💰 Valor: R$ ${Number(pedido.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      } else {
        showToast(`Pedido ${flow.next.toLowerCase()}!`, 'success', true);
      }
    } catch {
      showToast("Erro ao atualizar pedido.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Inativar este pedido?')) return;
    try {
      await dbDelete('/api/pedidosview', id);
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
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos de Compra</h2>
        <p className="text-sm text-gray-400 mt-1">Pedidos gerados automaticamente a partir de cotações aprovadas.</p>
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
                            {flow && (
                              <button onClick={() => handleAvance(item)} disabled={isProc}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                {isProc ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                                {flow.label}
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
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
