import React, { useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { todayBR } from '../lib/dates';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Loader2, Ban, Clock } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho } from '../components/ui';
import { supabase } from '../lib/supabase';
import { notificarSetor } from '../lib/notificar';
import { numeroPedido } from '../lib/documentos';
import { qtdBR } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';

// Atraso do pedido (migr. 418). Não é coluna nem status: é a data prometida
// contra hoje. Guardar "Atrasado" no banco envelheceria errado — o pedido
// marcado ontem continuaria atrasado depois de recebido no prazo combinado
// numa renegociação. Datas do PostgREST vêm 'YYYY-MM-DD', que compara e
// subtrai direto como string ordenável.
const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

const EM_ABERTO = (status: string) => status !== 'Recebido' && status !== 'Cancelado';

type Atraso = { dias: number; entregue: boolean } | null;

const calcAtraso = (pedido: any, hoje: string): Atraso => {
  const prazo = pedido?.prazo_entrega;
  if (!prazo) return null;
  // Já recebido: o atraso é histórico e congelado na data da chegada.
  if (pedido.recebido_em) {
    const d = diasEntre(prazo, pedido.recebido_em);
    return d > 0 ? { dias: d, entregue: true } : null;
  }
  if (!EM_ABERTO(pedido.status)) return null;
  const d = diasEntre(prazo, hoje);
  return d > 0 ? { dias: d, entregue: false } : null;
};

const fmtData = (iso?: string | null) =>
  iso ? iso.split('-').reverse().join('/') : '—';

const PedidosViewInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
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

  const hoje = todayBR();
  // Atrasados vêm das duas consultas sem paginação que a fila já usa: são os
  // dois únicos status em que a carga ainda pode chegar.
  const atrasados = [...aguardandoEnvio, ...emEntrega]
    .filter((p: any) => calcAtraso(p, hoje) !== null).length;
  const semPrazo = [...aguardandoEnvio, ...emEntrega]
    .filter((p: any) => !p.prazo_entrega).length;

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

  /** Pedido de serviço (migr. 499) — não tem carga, tem execução. */
  const ehServico = (pedido: any) => !!pedido?.servico_id;

  // O status 'Em Entrega' continua sendo o passo, porque é ele que põe o
  // documento na fila do Estoque e é dele que a bolinha da barra lateral vive.
  // O que muda para serviço é a PALAVRA: "carga a caminho" numa dedetização
  // manda o almoxarife esperar um caminhão.
  const rotuloAvance = (pedido: any) =>
    ehServico(pedido) ? 'Marcar Em Execução' : 'Marcar Em Entrega';

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
        const servico = ehServico(pedido);
        // Best-effort: o pedido já avançou, e falha de notificação não pode
        // desfazer isso nem travar a tela.
        await notificarSetor({
          setor:     'logistica',
          tipo:      'info',
          titulo:    servico
            ? `Serviço contratado — ${numeroPedido(pedido)}`
            : `Carga a caminho — ${numeroPedido(pedido)}`,
          mensagem:  [
            item ? `Item: ${item}.` : null,
            pedido.item_qtd ? `Qtd: ${qtdBR(pedido.item_qtd)}.` : null,
            forn ? `Fornecedor: ${forn}.` : null,
            servico
              ? 'Quando for executado, registre o aceite em Estoque > Recebimentos — nada entra no estoque.'
              : 'Registre a chegada em Estoque > Recebimentos.',
          ].filter(Boolean).join(' '),
          link_view: 'estoque-recebimentos',
          ref_id:    pedido.id,
          filial:    pedido.filial ?? filial,
        });
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
        </div>
      </div>

      <FilaDeTrabalho itens={[
        { label: 'pedido(s) para marcar em entrega', count: aguardandoEnvio.length, hint: 'sem isso o almoxarifado não sabe que a carga vem' },
        { label: 'pedido(s) em entrega', count: emEntrega.length, hint: 'agora é com o Estoque, em Estoque → Recebimentos' },
        { label: 'pedido(s) com prazo estourado', count: atrasados, hint: 'a data prometida passou e a carga não chegou — cobre o fornecedor' },
        { label: 'pedido(s) em aberto sem prazo', count: semPrazo, hint: 'sem data prometida não há o que cobrar — informe o prazo médio no cadastro do fornecedor' },
      ]} />

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhum pedido. Aprove uma cotação para gerar o primeiro pedido." /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
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
                    const atraso = calcAtraso(item, hoje);
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-credencial text-gray-500 hidden sm:table-cell">{numeroPedido(item)}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          <span className="sm:hidden text-[10px] font-credencial text-gray-500 block">{numeroPedido(item)}</span>
                          {itemDisplay}
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5 truncate">{item.forn?.nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 hidden md:table-cell">{item.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          R$ {Number(item.valor_total ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          {/* MIGR 584: o pedido carimba a condição negociada, e
                              é ela que explica por que o contas a pagar tem uma
                              ou três linhas deste mesmo pedido. */}
                          {item.condicao_pagamento && (
                            <span className="block text-[10px] text-gray-500 font-sans">{item.condicao_pagamento}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs hidden lg:table-cell">
                          <span className={atraso && !atraso.entregue ? 'text-red-400 font-semibold' : 'text-gray-400'}>
                            {fmtData(item.prazo_entrega)}
                          </span>
                          {atraso && (
                            <span
                              title={atraso.entregue
                                ? `Prometido para ${fmtData(item.prazo_entrega)}, chegou em ${fmtData(item.recebido_em)}.`
                                : 'A data prometida passou e a carga não chegou.'}
                              className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                atraso.entregue ? 'bg-amber-900/30 text-amber-400' : 'bg-red-950/50 text-red-400'}`}>
                              <Clock size={9} />
                              {atraso.entregue ? `entregou +${atraso.dias}d` : `atrasado ${atraso.dias}d`}
                            </span>
                          )}
                          {!item.prazo_entrega && EM_ABERTO(item.status) && (
                            <span title="Cotação sem data e fornecedor sem prazo médio cadastrado — este pedido não tem como ser cobrado."
                              className="ml-2 text-[10px] text-gray-600">sem prazo</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge status={item.status} />
                          {/* Quem lê esta tela é Compras, e o passo seguinte quase
                              nunca é dela. Dizer de quem é a vez evita o pedido
                              parado por semanas esperando um clique que ninguém
                              sabia que faltava — e evita a tentativa de carimbar
                              "Recebido" daqui, que a migr. 492 recusa. */}
                          {item.status === 'Aprovado' && (
                            <span className="block text-[10px] text-gray-500 mt-1 leading-snug">
                              Avise o Estoque marcando{' '}
                              <strong className="text-gray-400">
                                {ehServico(item) ? 'Em Execução' : 'Em Entrega'}
                              </strong>.
                            </span>
                          )}
                          {item.status === 'Em Entrega' && (
                            <span className="block text-[10px] text-gray-500 mt-1 leading-snug">
                              {ehServico(item)
                                ? <>Agora é aguardar a execução: o pedido encerra no aceite,
                                    em Recebimentos. Serviço não entra em estoque.</>
                                : <>Agora é com o Estoque: o pedido encerra quando a carga
                                    for conferida em Recebimentos.</>}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <HistoricoOperacoes entidade="pedidos" entidadeId={item.id} titulo={item.item_descricao ?? item.req?.item ?? 'Pedido'} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                            {flow && (
                              <button onClick={() => handleAvance(item)} disabled={isProc}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                                {isProc ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                                {rotuloAvance(item)}
                              </button>
                            )}
                            {profile?.role === 'admin' && (
                              <ExcluirAdmin endpoint="/api/pedidosview" id={item.id}
                                rotulo={numeroPedido(item)} showToast={showToast}
                                alternativa="cancele o pedido: a conta a pagar é inativada junto e a requisição volta a poder ser cotada."
                                onExcluido={() => reload()} />
                            )}
                            {item.status !== 'Cancelado' && item.status !== 'Recebido' && (
                              <button onClick={() => handleCancelar(item)} disabled={processing === item.id}
                                title="Cancelar pedido — o documento fica, marcado como cancelado"
                                className="action-btn-delete">
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

export const PedidosView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O pedido de compra" />;
  return <PedidosViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
