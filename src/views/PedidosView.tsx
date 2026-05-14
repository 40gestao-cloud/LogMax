import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useFetchData, dbUpdate, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge } from '../components/ui';
import { useWhatsApp } from '../hooks/useWhatsApp';

export const PedidosView = ({ showToast }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/pedidosview');
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

  const STATUS_FLOW: Record<string, { next: string; label: string }> = {
    'Pendente':   { next: 'Aprovado',   label: 'Aprovar Pedido' },
    'Aprovado':   { next: 'Em Entrega', label: 'Marcar Em Entrega' },
    'Em Entrega': { next: 'Recebido',   label: 'Confirmar Recebimento' },
  };

  const handleAvance = async (pedido: any) => {
    const flow = STATUS_FLOW[pedido.status];
    if (!flow) return;
    setProcessing(pedido.id);
    try {
      const updated = await dbUpdate('/api/pedidosview', pedido.id, { status: flow.next });
      setData((prev: any[]) => prev.map(p => p.id === pedido.id ? (updated ?? { ...p, status: flow.next }) : p));
      if (pedido.status === 'Pendente') {
        await dbInsert('/api/contaspagarview', {
          fornecedor_id: pedido.fornecedor_id,
          descricao: `Pedido #${pedido.id.slice(-6).toUpperCase()} — ${pedido.req?.item ?? 'Compra'}`,
          valor: pedido.valor_total,
          vencimento: pedido.prazo_entrega || null,
          status: 'Pendente',
          pedido_id: pedido.id,
        });
        showToast('Pedido aprovado! Conta a Pagar gerada.', 'success', true);
        wppNotify(`📦 *LogMax — Pedido aprovado*\n🛒 Item: ${pedido.req?.item ?? `#${pedido.id.slice(-6).toUpperCase()}`}\n🏢 Fornecedor: ${pedido.forn?.nome ?? '—'}\n💰 Valor: R$ ${Number(pedido.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
      } else if (pedido.status === 'Em Entrega') {
        const today = new Date().toISOString().slice(0, 10);
        await dbInsert('/api/recebimentosview', {
          pedido_id: pedido.id,
          data: today,
          qtd_recebida: pedido.req?.qtd ?? 0,
          status: 'Pendente',
          observacao: 'Gerado automaticamente. Selecione o produto em Recebimentos para atualizar o estoque.',
        });
        showToast('Pedido recebido! Acesse Recebimentos para confirmar o produto e dar entrada no estoque.', 'success', true);
        wppNotify(`🚚 *LogMax — Pedido recebido*\n📦 Item: ${pedido.req?.item ?? `#${pedido.id.slice(-6).toUpperCase()}`}\n🏢 Fornecedor: ${pedido.forn?.nome ?? '—'}\n⚠️ Acesse Recebimentos para confirmar o produto no estoque.`);
      } else {
        showToast(`Pedido ${flow.next.toLowerCase()}!`, 'success', true);
      }
    } catch {
      showToast("Erro ao atualizar pedido.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="shrink-0">
        <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Pedidos de Compra</h2>
        <p className="text-sm text-gray-400 mt-1">Pedidos gerados automaticamente a partir de cotações aprovadas.</p>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhum pedido. Aprove uma cotação para gerar o primeiro pedido." /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Pedido</th>
                  <th className="pb-4 font-bold px-4">Item</th>
                  <th className="pb-4 font-bold px-4">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                  <th className="pb-4 font-bold px-4">Prazo Entrega</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((item: any) => {
                    const flow = STATUS_FLOW[item.status];
                    const isProc = processing === item.id;
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-500">#{item.id?.slice(-6).toUpperCase()}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.req?.item ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(item.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.prazo_entrega || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          {flow && (
                            <button onClick={() => handleAvance(item)} disabled={isProc}
                              className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 ml-auto disabled:opacity-50">
                              {isProc ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                              {flow.label}
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
};
