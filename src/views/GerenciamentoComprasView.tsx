import React from 'react';
import { motion } from 'motion/react';
import { ClipboardList, BarChart2, ShoppingCart, Package, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, UrgenciaBadge, CardContador } from '../components/ui';

const PipelineCard = ({ icon: Icon, label, total, breakdown, color }: any) => (
  <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3 flex-1 min-w-[140px]">
    <div className="flex items-center gap-2">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={16} />
      </div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</p>
    </div>
    <p className="text-3xl font-black text-gray-100">{total}</p>
    <div className="flex flex-col gap-1">
      {breakdown.map(({ label: bl, value, cls }: any) => (
        <div key={bl} className="flex justify-between items-center">
          <span className="text-[10px] text-gray-500">{bl}</span>
          <span className={`text-[10px] font-bold ${cls}`}>{value}</span>
        </div>
      ))}
    </div>
  </div>
);

export const GerenciamentoComprasView = () => {
  // Escopo por filial ativa. Admin/CEO em Matriz (filialAtiva=null) mantém consolidado.
  const { filialAtiva } = useFilial();
  const ff = filialAtiva ? { filial: filialAtiva } : undefined;
  const { data: requisicoes, isLoading: loadingReq } = useFetchData<any>('/api/requisicoesview', ff);
  const { data: cotacoes, isLoading: loadingCot } = useFetchData<any>('/api/cotacoesview', ff);
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview', ff);
  const { data: recebimentos, isLoading: loadingRec } = useFetchData<any>('/api/recebimentosview', ff);
  const { data: contasPagar, isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview', ff);
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', ff);

  const isLoading = loadingReq || loadingCot || loadingPed || loadingRec || loadingCP;

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  // Contagens por status
  const reqPendentes = requisicoes.filter((r: any) => r.status === 'Pendente').length;
  const reqAprovadas = requisicoes.filter((r: any) => r.status === 'Aprovado').length;
  const reqNegadas = requisicoes.filter((r: any) => r.status === 'Negado').length;
  // Devolvidas (migr. 517): não estão negadas nem pendentes de decisão — estão
  // com quem as abriu. Sem card próprio elas sumiriam do painel, que é onde a
  // direção vê a fila travar.
  const reqEmCorrecao = requisicoes.filter((r: any) => r.status === 'Em correção').length;
  // 'Atendida' = já virou pedido (migr. 266). Sem este card as requisições
  // sumiam de "Aprovadas" sem aparecer em lugar nenhum.
  const reqAtendidas = requisicoes.filter((r: any) => r.status === 'Atendida').length;

  // Status reais das tabelas — os antigos ('Em Cotação', 'Recusada',
  // 'Em Transporte') nunca são escritos e deixavam os cards zerados.
  const cotEmCotacao = cotacoes.filter((c: any) => c.status === 'Aguardando Financeiro').length;
  const cotAprovadas = cotacoes.filter((c: any) => c.status === 'Aprovado').length;
  const cotRecusadas = cotacoes.filter((c: any) => c.status === 'Negado').length;

  const pedPendentes = pedidos.filter((p: any) => p.status === 'Pendente').length;
  const pedAprovados = pedidos.filter((p: any) => p.status === 'Aprovado').length;
  const pedTransporte = pedidos.filter((p: any) => p.status === 'Em Entrega').length;
  const pedRecebidos = pedidos.filter((p: any) => p.status === 'Recebido').length;

  const recPendentes = recebimentos.filter((r: any) => r.status === 'Pendente').length;
  const recConcluidos = recebimentos.filter((r: any) => r.status === 'Concluído').length;
  const recParciais = recebimentos.filter((r: any) => r.status === 'Parcial').length;

  const pgPendentes = contasPagar.filter((c: any) => c.status === 'Pendente').length;
  const pgPagos = contasPagar.filter((c: any) => c.status === 'Pago').length;
  const pgAtrasados = contasPagar.filter((c: any) => c.status === 'Atrasado').length;

  const pipeline = [
    {
      icon: ClipboardList, label: 'Requisições', total: requisicoes.length,
      color: 'bg-blue-900/40 text-blue-400',
      breakdown: [
        { label: 'Pendentes', value: reqPendentes, cls: reqPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Aprovadas', value: reqAprovadas, cls: 'text-green-400' },
        { label: 'Atendidos', value: reqAtendidas, cls: reqAtendidas > 0 ? 'text-accent' : 'text-gray-500' },
        { label: 'Negadas', value: reqNegadas, cls: reqNegadas > 0 ? 'text-red-500' : 'text-gray-500' },
        { label: 'Em correção', value: reqEmCorrecao, cls: reqEmCorrecao > 0 ? 'text-amber-400' : 'text-gray-500' },
      ],
    },
    {
      icon: BarChart2, label: 'Cotações', total: cotacoes.length,
      color: 'bg-purple-900/40 text-purple-400',
      breakdown: [
        { label: 'Aguard. Financeiro', value: cotEmCotacao, cls: cotEmCotacao > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Aprovadas', value: cotAprovadas, cls: 'text-green-400' },
        { label: 'Negadas', value: cotRecusadas, cls: cotRecusadas > 0 ? 'text-red-500' : 'text-gray-500' },
      ],
    },
    {
      icon: ShoppingCart, label: 'Pedidos', total: pedidos.length,
      color: 'bg-accent/20 text-accent',
      breakdown: [
        { label: 'Pendentes', value: pedPendentes, cls: pedPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Em Entrega', value: pedTransporte, cls: pedTransporte > 0 ? 'text-blue-400' : 'text-gray-500' },
        { label: 'Recebidos', value: pedRecebidos, cls: 'text-green-400' },
      ],
    },
    {
      icon: Package, label: 'Recebimentos', total: recebimentos.length,
      color: 'bg-green-900/40 text-green-400',
      breakdown: [
        { label: 'Pendentes', value: recPendentes, cls: recPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Concluídos', value: recConcluidos, cls: 'text-green-400' },
        { label: 'Parciais', value: recParciais, cls: recParciais > 0 ? 'text-orange-400' : 'text-gray-500' },
      ],
    },
    {
      icon: DollarSign, label: 'Contas a Pagar', total: contasPagar.length,
      color: 'bg-orange-900/40 text-orange-400',
      breakdown: [
        { label: 'Pendentes', value: pgPendentes, cls: pgPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Pagos', value: pgPagos, cls: 'text-green-400' },
        { label: 'Atrasados', value: pgAtrasados, cls: pgAtrasados > 0 ? 'text-red-500' : 'text-gray-500' },
      ],
    },
  ];

  // Urgências em aberto (Urgente + Pendente)
  const urgencias = requisicoes
    .filter((r: any) => r.urgencia === 'Urgente' && r.status === 'Pendente')
    .slice(0, 5);

  // Próximos vencimentos de contas
  const vencimentos = [...contasPagar]
    .filter((cp: any) => cp.status === 'Pendente' && cp.vencimento)
    .sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 5)
    .map((cp: any) => ({ ...cp, forn: fornecedores.find((f: any) => f.id === cp.fornecedor_id) }));

  // Valor total comprometido em pedidos ativos
  const valorPedidosAtivos = pedidos
    .filter((p: any) => !['Cancelado', 'Recebido'].includes(p.status))
    .reduce((acc: number, p: any) => acc + Number(p.valor_total || 0), 0);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Gerenciamento de Compras</h2>
      </div>

      {/* Sumário rápido */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        <CardContador label="Pedidos em Aberto" value={pedPendentes + pedAprovados + pedTransporte} sub={<>aguardando recebimento</>} tom="azul" />
        <CardContador label="Valor Comprometido" value={<>R$ {valorPedidosAtivos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</>} sub={<>em pedidos ativos</>} tom="dourado" />
        <CardContador label="Contas em Atraso" value={pgAtrasados} sub="vencimentos em aberto" tom="vermelho" />
      </div>

      {/* Pipeline */}
      <div className="shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline de Compras</h3>
        <div className="flex gap-3 flex-wrap">
          {pipeline.map((stage, i) => (
            <React.Fragment key={stage.label}>
              <PipelineCard {...stage} />
              {i < pipeline.length - 1 && (
                <div className="hidden lg:flex items-center text-gray-700 text-lg font-thin self-center">›</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 shrink-0">
        {/* Urgências */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} className="text-red-500" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Requisições Urgentes Abertas</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {urgencias.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhuma requisição urgente pendente.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {urgencias.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{r.item ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{r.solicitante ?? 'Sem solicitante'} · {r.data ?? '—'}</p>
                    </div>
                    <UrgenciaBadge urgencia={r.urgencia} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Próximos vencimentos */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-yellow-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Próximos Vencimentos</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {vencimentos.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum vencimento próximo.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {vencimentos.map((cp: any) => (
                  <div key={cp.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{cp.descricao ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{cp.forn?.nome ?? 'Sem fornecedor'} · vence <span className="font-mono">{cp.vencimento}</span></p>
                    </div>
                    <p className="text-sm font-bold text-gray-200 font-mono ml-4">R$ {Number(cp.valor || 0).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
