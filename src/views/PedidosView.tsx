import React, { useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Loader2, Ban } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho } from '../components/ui';
import { supabase } from '../lib/supabase';
import { numeroPedido } from '../lib/documentos';
import { useConfirm } from '../contexts/ConfirmContext';

const PedidosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  // Realtime: o pedido nasce em outra tela (Cotações, botão "gerar pedido") e
  // muitas vezes por outra pessoa. Sem isto, quem estivesse com Pedidos aberto
  // não via o pedido aparecer.
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>('/api/pedidosview', { filial }, true, { page });
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  const { data: cotacoes } = useFetchData<any>('/api/cotacoesview', { filial });
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesview', { filial });
  const [processing, setProcessing] = useState<string | null>(null);
  // Consulta própria, sem paginação: a lista principal traz 50 linhas por vez e
  // um contador que só enxerga a página 1 diz "nada a fazer" com trabalho na 2.
  const { data: aguardandoEnvio } = useFetchData<any>('/api/pedidosview', { filial, status: 'Aprovado' }, true);
  const { data: emEntrega } = useFetchData<any>('/api/pedidosview', { filial, status: 'Em Entrega' }, true);

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

      // "Em Entrega" é o único aviso que o Estoque tem de que a carga está a
      // caminho. Sem isto ninguém no almoxarifado sabia que havia recebimento
      // pra registrar — o pedido simplesmente mudava de cor numa tela de
      // Compras que o setor de Estoque nem abre.
      //
      // Setor 'logistica' porque é dele que o módulo Estoque pende
      // (SETOR_MODULES.logistica) — não existe setor 'estoque'.
      if (flow.next === 'Em Entrega' && supabase) {
        const item = pedido.item_descricao ?? pedido.req?.item ?? '';
        const forn = fornecedores.find((f: any) => f.id === pedido.fornecedor_id)?.nome;
        const { error: notifErr } = await supabase.rpc('notificar_setor', {
          p_setor:     'logistica',
          p_tipo:      'info',
          p_titulo:    `Carga a caminho — ${numeroPedido(pedido)}`,
          p_mensagem:  [
            item ? `Item: ${item}.` : null,
            pedido.item_qtd ? `Qtd: ${pedido.item_qtd}.` : null,
            forn ? `Fornecedor: ${forn}.` : null,
            'Registre a chegada em Estoque > Recebimentos.',
          ].filter(Boolean).join(' '),
          p_link_view: 'estoque-recebimentos',
          p_urgencia:  'Média',
          p_ref_id:    pedido.id,
          p_filial:    filial,
        });
        // Best-effort: o pedido já avançou, e falha de notificação não pode
        // desfazer isso nem travar a tela.
        if (notifErr) console.warn('[Pedidos] notificar_setor(logistica):', notifErr.message);
      }

      showToast(
        'Pedido em entrega. O Estoque dá entrada da carga em Estoque → Recebimentos — e é essa conferência que libera o pagamento.',
        'success', true);
    } catch (err: any) {
      showToast(`Erro ao atualizar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  // Excluir pedido saiu (migr. 340). Cancelar preserva o documento e faz o
  // resto na mesma transação: inativa a conta a pagar pendente e devolve a
  // requisição para 'Aprovado', para poder ser cotada de novo. Antes eram três
  // chamadas soltas com catch vazio no meio — falhando a segunda, sobrava conta
  // a pagar de um pedido que não existia mais.
  const handleCancelar = async (pedido: any) => {
    if (!supabase) return;
    if (!await confirm(
      `Cancelar o pedido ${numeroPedido(pedido)}?\n\n` +
      'A conta a pagar pendente é inativada e a requisição volta a poder ser cotada. ' +
      'O pedido continua na lista, marcado como Cancelado — o rastro fica.')) return;
    setProcessing(pedido.id);
    try {
      const { data: res, error } = await supabase.rpc('cancelar_pedido_compra', {
        p_id: pedido.id, p_motivo: null,
      });
      if (error) throw error;
      const contas = Number((res as any)?.contas_inativadas ?? 0);
      showToast(contas > 0
        ? `Pedido cancelado e ${contas} conta(s) a pagar inativada(s).`
        : 'Pedido cancelado.', 'success', true);
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível cancelar.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos de Compra — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Pedidos gerados a partir de cotações aprovadas. Marcar "em entrega" é o que avisa
            o Estoque de que há carga a receber.
          </p>
        </div>
      </div>

      <FilaDeTrabalho itens={[
        { label: 'pedido(s) para marcar em entrega', count: aguardandoEnvio.length, hint: 'sem isso o almoxarifado não sabe que a carga vem' },
        { label: 'pedido(s) em entrega', count: emEntrega.length, hint: 'agora é com o Estoque, em Estoque → Recebimentos' },
      ]} />

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
                        <td className="py-3 px-4 text-xs font-mono text-gray-500 hidden sm:table-cell">{numeroPedido(item)}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          <span className="sm:hidden text-[10px] font-mono text-gray-500 block">{numeroPedido(item)}</span>
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
                          <HistoricoOperacoes entidade="pedidos" entidadeId={item.id} titulo={item.item_descricao ?? item.req?.item ?? 'Pedido'} />
                            {flow && (
                              <button onClick={() => handleAvance(item)} disabled={isProc}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                {isProc ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                                {flow.label}
                              </button>
                            )}
                            {item.status !== 'Cancelado' && item.status !== 'Recebido' && (
                              <button onClick={() => handleCancelar(item)} disabled={processing === item.id}
                                title="Cancelar pedido — o documento fica, marcado como cancelado"
                                className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 border border-white/5 hover:text-red-400 hover:border-red-500/30 transition disabled:opacity-40">
                                <Ban size={12} />
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

export const PedidosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O pedido de compra" />;
  return <PedidosViewInner showToast={showToast} filial={filialAtiva} />;
};
