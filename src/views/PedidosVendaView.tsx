import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, DollarSign, CheckCircle2, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination } from '../components/ui';
import { formatBRL } from '../lib/viewUtils';
import { hasAnySetor, hasSetor } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

export const PedidosVendaView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const [page, setPage] = useState(0);
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/pedidosvendaview', undefined, true, { page }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview');
  const [processando, setProcessando] = useState<string | null>(null);

  const isLogistica  = hasSetor(profile, 'logistica');
  const isFinanceiro = hasSetor(profile, 'financeiro');
  const isVendas     = hasSetor(profile, 'vendas');
  const isAdminOuCeo = profile.role === 'admin' || profile.role === 'ceo';

  const enriched = data.map((p: any) => ({
    ...p,
    cliente: clientes.find((c: any) => c.id === p.cliente_id),
  }));

  // Status final 'Concluído' é atribuído pela ação que completar o par
  // (separar quando já pago, ou pagar quando já separado). Antes disso o
  // status reflete só o último evento ('Separado' ou 'Pago').
  const marcarSeparado = async (p: any) => {
    setProcessando(p.id);
    try {
      const novoStatus = p.pago_em ? 'Concluído' : 'Separado';
      const updates = {
        status: novoStatus,
        separado_em: new Date().toISOString(),
        separado_por: profile.id,
        separado_por_nome: profile.nome,
      };
      await dbUpdate('/api/pedidosvendaview', p.id, updates);
      setData((prev: any[]) => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
      showToast('Marcado como separado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setProcessando(null);
    }
  };

  const marcarPago = async (p: any) => {
    setProcessando(p.id);
    try {
      const novoStatus = p.separado_em ? 'Concluído' : 'Pago';
      const updates = {
        status: novoStatus,
        pago_em: new Date().toISOString(),
        pago_por: profile.id,
        pago_por_nome: profile.nome,
      };
      await dbUpdate('/api/pedidosvendaview', p.id, updates);
      setData((prev: any[]) => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
      showToast('Pagamento registrado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setProcessando(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Cancelar este pedido de venda?')) return;
    try {
      await dbDelete('/api/pedidosvendaview', id);
      setData((prev: any[]) => prev.filter(p => p.id !== id));
      showToast('Pedido inativado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  if (!hasAnySetor(profile, 'vendas', 'logistica', 'financeiro') && !isAdminOuCeo) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <p className="text-sm text-gray-400">Sem acesso a Pedidos de Venda.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos de Venda</h2>
        <p className="text-sm text-gray-400 mt-1">
          Pedidos gerados a partir de propostas aprovadas pelo cliente. Logística separa, Financeiro recebe.
        </p>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? (
        <EmptyState message="Nenhum pedido de venda. Quando um cliente aprovar uma proposta, ele aparece aqui." />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Pedido</th>
                  <th className="pb-4 font-bold px-4">Cliente</th>
                  <th className="pb-4 font-bold px-4">Vendedor</th>
                  <th className="pb-4 font-bold px-4 text-center">Itens</th>
                  <th className="pb-4 font-bold px-4 text-right">Total</th>
                  <th className="pb-4 font-bold px-4 text-center">Separado</th>
                  <th className="pb-4 font-bold px-4 text-center">Pago</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((p: any) => {
                    const podeSeparar = (isLogistica || isAdminOuCeo) && !p.separado_em && p.status !== 'Cancelado';
                    const podePagar   = (isFinanceiro || isAdminOuCeo) && !p.pago_em && p.status !== 'Cancelado';
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-500">#{p.id.slice(-6).toUpperCase()}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.cliente?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{Array.isArray(p.itens) ? p.itens.length : 0}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {formatBRL(Number(p.valor_total ?? 0))}</td>
                        <td className="py-3 px-4 text-xs text-center">
                          {p.separado_em ? (
                            <span className="text-emerald-400 font-bold flex items-center justify-center gap-1">
                              <CheckCircle2 size={11} />
                              <span title={`${p.separado_por_nome ?? ''} • ${new Date(p.separado_em).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}`}>
                                {p.separado_por_nome ?? 'OK'}
                              </span>
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="py-3 px-4 text-xs text-center">
                          {p.pago_em ? (
                            <span className="text-emerald-400 font-bold flex items-center justify-center gap-1">
                              <CheckCircle2 size={11} />
                              <span title={`${p.pago_por_nome ?? ''} • ${new Date(p.pago_em).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}`}>
                                {p.pago_por_nome ?? 'OK'}
                              </span>
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {podeSeparar && (
                              <button onClick={() => marcarSeparado(p)} disabled={processando === p.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-cyan-400 hover:bg-cyan-400/10 flex items-center gap-1 disabled:opacity-50">
                                {processando === p.id ? <Loader2 size={11} className="animate-spin" /> : <Package size={11} />}
                                Marcar separado
                              </button>
                            )}
                            {podePagar && (
                              <button onClick={() => marcarPago(p)} disabled={processando === p.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 flex items-center gap-1 disabled:opacity-50">
                                {processando === p.id ? <Loader2 size={11} className="animate-spin" /> : <DollarSign size={11} />}
                                Registrar pagamento
                              </button>
                            )}
                            {p.conta_receber_id && (isFinanceiro || isAdminOuCeo) && (
                              <span title="Conta a Receber gerada" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400">
                                <ExternalLink size={12} />
                              </span>
                            )}
                            {(isVendas || isAdminOuCeo) && p.status !== 'Concluído' && (
                              <button onClick={() => handleDelete(p.id)} title="Cancelar"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500">
                                <Trash2 size={12} />
                              </button>
                            )}
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
