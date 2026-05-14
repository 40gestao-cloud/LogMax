import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Landmark, FileText, CreditCard, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';

const PipelineCard = ({ icon: Icon, label, total, breakdown, color }: any) => (
  <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3 flex-1 min-w-[130px]">
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

export const GerenciamentoFinanceiroView = () => {
  const { data: previsoes, isLoading: loadingPrev } = useFetchData<any>('/api/previsoesview');
  const { data: receber, isLoading: loadingRec } = useFetchData<any>('/api/contasreceberview');
  const { data: pagar, isLoading: loadingPag } = useFetchData<any>('/api/contaspagarview');
  const { data: duplicatas, isLoading: loadingDup } = useFetchData<any>('/api/duplicatasview');
  const { data: bancos, isLoading: loadingBan } = useFetchData<any>('/api/caixabancosview');
  const { data: clientes } = useFetchData<any>('/api/crmview-clientes');
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');

  const isLoading = loadingPrev || loadingRec || loadingPag || loadingDup || loadingBan;
  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  // Previsões
  const prevReceitas = previsoes.filter((p: any) => p.tipo === 'Receita' && p.status !== 'Cancelado');
  const prevDespesas = previsoes.filter((p: any) => p.tipo === 'Despesa' && p.status !== 'Cancelado');
  const prevPrevisto = previsoes.filter((p: any) => p.status === 'Previsto').length;
  const prevRealizado = previsoes.filter((p: any) => p.status === 'Realizado').length;
  const prevCancelado = previsoes.filter((p: any) => p.status === 'Cancelado').length;

  // Contas a receber
  const recAberto = receber.filter((r: any) => r.status === 'Aberto').length;
  const recPago = receber.filter((r: any) => r.status === 'Pago').length;
  const recAtrasado = receber.filter((r: any) => r.status === 'Atrasado').length;

  // Contas a pagar
  const pagPendente = pagar.filter((p: any) => p.status === 'Pendente').length;
  const pagPago = pagar.filter((p: any) => p.status === 'Pago').length;
  const pagAtrasado = pagar.filter((p: any) => p.status === 'Atrasado').length;

  // Duplicatas
  const dupEmitida = duplicatas.filter((d: any) => d.status === 'Emitida').length;
  const dupPaga = duplicatas.filter((d: any) => d.status === 'Paga').length;
  const dupVencida = duplicatas.filter((d: any) => d.status === 'Vencida').length;

  // Bancos
  const bancosAtivos = bancos.filter((b: any) => b.status === 'Ativo');
  const saldoTotal = bancosAtivos.reduce((acc: number, b: any) => acc + Number(b.saldo || 0), 0);
  const bancosPositivos = bancosAtivos.filter((b: any) => Number(b.saldo) >= 0).length;
  const bancosNegativos = bancosAtivos.filter((b: any) => Number(b.saldo) < 0).length;

  // KPIs financeiros
  const totalReceber = receber.filter((r: any) => r.status !== 'Pago').reduce((acc: number, r: any) => acc + Number(r.valor || 0), 0);
  const totalPagar = pagar.filter((p: any) => p.status !== 'Pago').reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
  const totalPrevReceita = prevReceitas.reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
  const totalPrevDespesa = prevDespesas.reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
  const resultadoPrevisto = totalPrevReceita - totalPrevDespesa;

  const pipeline = [
    {
      icon: TrendingUp, label: 'Previsões', total: previsoes.length,
      color: 'bg-blue-900/40 text-blue-400',
      breakdown: [
        { label: 'Previstas', value: prevPrevisto, cls: prevPrevisto > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Realizadas', value: prevRealizado, cls: 'text-green-400' },
        { label: 'Canceladas', value: prevCancelado, cls: prevCancelado > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: ArrowUpRight, label: 'A Receber', total: receber.length,
      color: 'bg-green-900/40 text-green-400',
      breakdown: [
        { label: 'Em Aberto', value: recAberto, cls: recAberto > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Recebidos', value: recPago, cls: 'text-green-400' },
        { label: 'Atrasados', value: recAtrasado, cls: recAtrasado > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: ArrowDownRight, label: 'A Pagar', total: pagar.length,
      color: 'bg-red-900/40 text-red-400',
      breakdown: [
        { label: 'Pendentes', value: pagPendente, cls: pagPendente > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Pagos', value: pagPago, cls: 'text-green-400' },
        { label: 'Atrasados', value: pagAtrasado, cls: pagAtrasado > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: FileText, label: 'Duplicatas', total: duplicatas.length,
      color: 'bg-purple-900/40 text-purple-400',
      breakdown: [
        { label: 'Emitidas', value: dupEmitida, cls: dupEmitida > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Pagas', value: dupPaga, cls: 'text-green-400' },
        { label: 'Vencidas', value: dupVencida, cls: dupVencida > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: Landmark, label: 'Caixa/Bancos', total: bancosAtivos.length,
      color: 'bg-accent/20 text-accent',
      breakdown: [
        { label: 'Saldo Total', value: `R$ ${saldoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, cls: saldoTotal >= 0 ? 'text-green-400' : 'text-red-400' },
        { label: 'Positivas', value: bancosPositivos, cls: 'text-green-400' },
        { label: 'Negativas', value: bancosNegativos, cls: bancosNegativos > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
  ];

  // Próximos vencimentos a receber (abertos, ordenados)
  const proxReceber = [...receber]
    .filter((r: any) => r.status === 'Aberto' && r.vencimento)
    .sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 5)
    .map((r: any) => ({ ...r, cliente: clientes.find((c: any) => c.id === r.cliente_id) }));

  // Próximos vencimentos a pagar (pendentes, ordenados)
  const proxPagar = [...pagar]
    .filter((p: any) => p.status === 'Pendente' && p.vencimento)
    .sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 5)
    .map((p: any) => ({ ...p, fornecedor: fornecedores.find((f: any) => f.id === p.fornecedor_id) }));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Gerenciamento Financeiro</h2>
        <p className="text-sm text-gray-400 mt-1">Visão consolidada do fluxo financeiro — previsões, recebimentos, pagamentos e saldos.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Resultado Previsto</p>
          <p className={`text-xl font-black leading-tight ${resultadoPrevisto >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {resultadoPrevisto >= 0 ? '+' : ''}R$ {Math.abs(resultadoPrevisto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-600 mt-1">receitas − despesas previstas</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Total a Receber</p>
          <p className="text-xl font-black text-green-400 leading-tight">
            R$ {totalReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-600 mt-1">contas abertas + atrasadas</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Total a Pagar</p>
          <p className={`text-xl font-black leading-tight ${pagAtrasado > 0 ? 'text-red-400' : 'text-gray-100'}`}>
            R$ {totalPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-600 mt-1">pendentes + atrasadas</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Saldo em Bancos</p>
          <p className={`text-xl font-black leading-tight ${saldoTotal >= 0 ? 'text-gray-100' : 'text-red-400'}`}>
            R$ {saldoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-600 mt-1">{bancosAtivos.length} conta(s) ativa(s)</p>
        </div>
      </div>

      {/* Pipeline */}
      <div className="shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline Financeiro</h3>
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

      {/* Bottom — 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 shrink-0">
        {/* Próximos recebimentos */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-green-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Próximos Recebimentos</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {proxReceber.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum recebimento pendente.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {proxReceber.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{r.descricao ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.cliente?.nome ?? 'Sem cliente'} · vence <span className="font-mono">{r.vencimento}</span>
                      </p>
                    </div>
                    <p className="text-sm font-bold text-green-400 font-mono ml-4">
                      R$ {Number(r.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Próximos pagamentos */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-red-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Próximos Pagamentos</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {proxPagar.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum pagamento pendente.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {proxPagar.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{p.descricao ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.fornecedor?.nome ?? 'Sem fornecedor'} · vence <span className="font-mono">{p.vencimento}</span>
                      </p>
                    </div>
                    <p className={`text-sm font-bold font-mono ml-4 ${p.status === 'Atrasado' ? 'text-red-400' : 'text-gray-200'}`}>
                      R$ {Number(p.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contas bancárias resumo */}
      {bancosAtivos.length > 0 && (
        <div className="shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Landmark size={14} className="text-accent" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Posição Bancária</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {bancosAtivos.map((b: any) => (
              <div key={b.id} className="neu-flat rounded-2xl p-4 border border-white/5">
                <p className="text-xs font-bold text-gray-400">{b.banco ?? '—'}</p>
                <p className="text-[10px] text-gray-600 mt-0.5">{b.tipo ?? '—'} · {b.conta ?? '—'}</p>
                <p className={`text-lg font-black font-mono mt-2 ${Number(b.saldo) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  R$ {Number(b.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
