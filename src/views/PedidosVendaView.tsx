import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Package, DollarSign, CheckCircle2, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { numeroPedidoVenda } from '../lib/documentos';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination } from '../components/ui';
import { formatBRL } from '../lib/viewUtils';
import { hasAnySetor, hasSetor, isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';

// A tela é alcançável por três portas de menu — Vendas, Estoque e Financeiro
// — e até aqui as três abriam a lista inteira, idêntica. Cada módulo tem uma
// pergunta diferente a fazer ao mesmo documento, e é isso que `mode` recorta:
// Estoque quer o que falta separar, Financeiro o que falta receber, Vendas
// acompanha o pedido do início ao fim.
const PedidosVendaViewInner = ({ showToast, profile, filial, mode }: { showToast: any; profile: UserProfile; filial: FilialOp; mode?: 'vendas' | 'estoque' | 'financeiro' }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/pedidosvendaview', { filial }, true, { page }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview', { filial });
  const [processando, setProcessando] = useState<string | null>(null);

  const isLogistica  = hasSetor(profile, 'logistica');
  const isFinanceiro = hasSetor(profile, 'financeiro');
  const isVendas     = hasSetor(profile, 'vendas');
  const isAdminOuCeo = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);

  const todos = data.map((p: any) => ({
    ...p,
    cliente: clientes.find((c: any) => c.id === p.cliente_id),
  }));

  // O recorte espelha exatamente a ação que cada módulo pode executar mais
  // abaixo (podeSeparar / podePagar): a fila mostra o que há para fazer ali,
  // não o arquivo inteiro. Cancelado sai das filas — não há o que separar nem
  // receber —, mas segue visível em Vendas, que acompanha o ciclo todo.
  const enriched = mode === 'estoque'
    ? todos.filter((p: any) => !p.separado_em && p.status !== 'Cancelado')
    : mode === 'financeiro'
      ? todos.filter((p: any) => !p.pago_em && p.status !== 'Cancelado')
      : todos;

  const tituloModo =
    mode === 'estoque'    ? 'Pedidos a Separar'
    : mode === 'financeiro' ? 'Pedidos a Receber'
    : 'Pedidos de Venda';

  const subtituloModo =
    mode === 'estoque'
      ? 'Pedidos aprovados pelo cliente aguardando separação no almoxarifado.'
    : mode === 'financeiro'
      ? 'Pedidos aprovados pelo cliente com recebimento ainda em aberto.'
      : 'Pedidos gerados a partir de propostas aprovadas pelo cliente. Logística separa, Financeiro recebe.';

  // Status final 'Concluído' é atribuído pela ação que completar o par
  // (separar quando já pago, ou pagar quando já separado). Antes disso o
  // status reflete só o último evento ('Separado' ou 'Pago').
  // Separar deixou de ser um carimbo. Até a migr. 400 isto era um UPDATE de
  // três campos: a mercadoria saía da loja e o saldo ficava igual — o único
  // lugar do sistema onde vender não mexia no estoque, bem ao lado do PDV,
  // onde a baixa é no mesmo clique. Agora a RPC lança uma saída por item e
  // marca a separação na mesma transação; saldo insuficiente derruba tudo,
  // que é o certo (pedido meio separado é pior que pedido não separado).
  const marcarSeparado = async (p: any) => {
    if (!supabase) return;
    setProcessando(p.id);
    try {
      const { data: atualizado, error } = await supabase.rpc('separar_pedido_venda', { p_pedido_id: p.id });
      if (error) throw new Error(error.message);
      setData((prev: any[]) => prev.map(x => x.id === p.id ? { ...x, ...(atualizado ?? {}) } : x));
      showToast('Pedido separado e estoque baixado.', 'success', true);
    } catch (err: any) {
      showToast(`Não foi possível separar: ${err?.message ?? 'verifique o console'}`, 'error', true);
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
    if (!await confirm('Cancelar este pedido de venda?')) return;
    try {
      await dbDelete('/api/pedidosvendaview', id);
      setData((prev: any[]) => prev.filter(p => p.id !== id));
      showToast('Pedido inativado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  if (!hasAnySetor(profile, 'vendas', 'logistica', 'financeiro') && !isAdminOuCeo && profile.role !== 'gerente') {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <p className="text-sm text-gray-400">Sem acesso a Pedidos de Venda.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{tituloModo} — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">{subtituloModo}</p>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? (
        <EmptyState message={
          mode === 'estoque'      ? 'Nada a separar. Pedidos aprovados pelo cliente aparecem aqui.'
          : mode === 'financeiro' ? 'Nada a receber. Pedidos com pagamento em aberto aparecem aqui.'
          : 'Nenhum pedido de venda. Quando um cliente aprovar uma proposta, ele aparece aqui.'
        } />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
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
                    // Pedido com conta a receber se paga NA CONTA, não aqui. Havia duas
                    // portas para o mesmo fato e nenhuma avisava a outra: este botão
                    // marcava a flag e deixava a conta Aberta para sempre, e quitar a
                    // conta não fechava o pedido. Agora a conta manda (trigger da migr.
                    // 400) e este botão sobra só para pedido sem conta vinculada.
                    const podePagar   = (isFinanceiro || isAdminOuCeo) && !p.pago_em
                                        && !p.conta_receber_id && p.status !== 'Cancelado';
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-500">{numeroPedidoVenda(p)}</td>
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
                            <AuditoriaInspect criadoPor={p.criado_por} criadoEm={p.created_at} atualizadoPor={p.atualizado_por} atualizadoEm={p.updated_at} />
                          <HistoricoOperacoes entidade="pedidos_venda" entidadeId={p.id} titulo={`${numeroPedidoVenda(p)} · ${p.cliente?.nome ?? 'Pedido de venda'}`} />
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
                              <span
                                title={p.pago_em
                                  ? 'Conta a Receber quitada — foi ela que fechou este pedido.'
                                  : 'O recebimento deste pedido é feito em Financeiro → Contas a Receber. Ao quitar a conta, o pedido fecha sozinho.'}
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400">
                                <ExternalLink size={12} />
                              </span>
                            )}
                            {(isVendas || isAdminOuCeo) && p.status !== 'Concluído' && (
                              <button onClick={() => handleDelete(p.id)} title="Cancelar"
                                className="action-btn-delete">
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

export const PedidosVendaView = ({ showToast, profile, mode }: { showToast: any; profile: UserProfile; mode?: 'vendas' | 'estoque' | 'financeiro' }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <PedidosVendaViewInner showToast={showToast} profile={profile} filial={filialAtiva} mode={mode} />;
};
