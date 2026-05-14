import React from 'react';
import { motion } from 'motion/react';
import { ClipboardCheck, CheckSquare, Truck, TrendingUp, Clock, Package } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, StatusBadge } from '../components/ui';

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

export const GerenciamentoEstoqueView = () => {
  const { data: requisicoes, isLoading: loadingReq } = useFetchData<any>('/api/requisicoesestoqueview');
  const { data: aprovacoes, isLoading: loadingApr } = useFetchData<any>('/api/minhasaprovacoesestoqueview');
  const { data: expedicao, isLoading: loadingExp } = useFetchData<any>('/api/expedicao');
  const { data: movimentacoes, isLoading: loadingMov } = useFetchData<any>('/api/movimentacoesestoqueview');
  const { data: inventarios, isLoading: loadingInv } = useFetchData<any>('/api/inventariosestoqueview');
  const { data: vencimentos, isLoading: loadingVen } = useFetchData<any>('/api/vencimentosestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');

  const isLoading = loadingReq || loadingApr || loadingExp || loadingMov || loadingInv || loadingVen;

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const enrich = (list: any[]) =>
    list.map((i: any) => ({ ...i, prod: produtos.find((p: any) => p.id === i.produto_id) }));

  const reqEnriched = enrich(requisicoes);
  const expEnriched = enrich(expedicao);
  const invEnriched = enrich(inventarios);
  const venEnriched = enrich(vencimentos);

  // Contagens por status
  const reqPendentes = requisicoes.filter((r: any) => r.status === 'Pendente').length;
  const reqAprovadas = requisicoes.filter((r: any) => r.status === 'Aprovada').length;
  const reqNegadas   = requisicoes.filter((r: any) => r.status === 'Negada').length;

  const aprPendentes = aprovacoes.filter((a: any) => a.status === 'Pendente').length;
  const aprAprovados = aprovacoes.filter((a: any) => a.status === 'Aprovado').length;
  const aprNegados   = aprovacoes.filter((a: any) => a.status === 'Negado').length;

  const expPendentes = expedicao.filter((e: any) => e.status === 'Pendente').length;
  const expExpedidos = expedicao.filter((e: any) => e.status === 'Expedido').length;
  const expCancelados = expedicao.filter((e: any) => e.status === 'Cancelado').length;

  const movEntradas = movimentacoes.filter((m: any) => m.tipo === 'Entrada').length;
  const movSaidas   = movimentacoes.filter((m: any) => m.tipo === 'Saída').length;
  const movAjustes  = movimentacoes.filter((m: any) => m.tipo === 'Ajuste').length;

  // KPIs sumário
  const produtosZerados = produtos.filter((p: any) => p.estoque === 0 && p.status === 'Ativo').length;
  const vencCriticos = vencimentos.filter((v: any) => v.status === 'Vencido' || v.status === 'Próximo').length;
  const invEmAndamento = inventarios.filter((i: any) => i.status === 'Em Andamento').length;
  const totalMovMes = movimentacoes.length; // todos (sem filtro de data por ora)

  const pipeline = [
    {
      icon: ClipboardCheck, label: 'Requisições', total: requisicoes.length,
      color: 'bg-blue-900/40 text-blue-400',
      breakdown: [
        { label: 'Pendentes', value: reqPendentes, cls: reqPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Aprovadas', value: reqAprovadas, cls: 'text-green-400' },
        { label: 'Negadas',   value: reqNegadas,   cls: reqNegadas > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: CheckSquare, label: 'Aprovações', total: aprovacoes.length,
      color: 'bg-purple-900/40 text-purple-400',
      breakdown: [
        { label: 'Pendentes', value: aprPendentes, cls: aprPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Aprovados', value: aprAprovados, cls: 'text-green-400' },
        { label: 'Negados',   value: aprNegados,   cls: aprNegados > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: Truck, label: 'Expedição', total: expedicao.length,
      color: 'bg-accent/20 text-accent',
      breakdown: [
        { label: 'Pendentes', value: expPendentes,  cls: expPendentes > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Expedidos', value: expExpedidos,  cls: 'text-green-400' },
        { label: 'Cancelados',value: expCancelados, cls: expCancelados > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: TrendingUp, label: 'Movimentações', total: movimentacoes.length,
      color: 'bg-green-900/40 text-green-400',
      breakdown: [
        { label: 'Entradas', value: movEntradas, cls: 'text-green-400' },
        { label: 'Saídas',   value: movSaidas,   cls: movSaidas > 0 ? 'text-red-400' : 'text-gray-500' },
        { label: 'Ajustes',  value: movAjustes,  cls: movAjustes > 0 ? 'text-blue-400' : 'text-gray-500' },
      ],
    },
  ];

  const kpis = [
    { label: 'Produtos sem Estoque', value: produtosZerados, sub: 'ativos zerados',       warn: produtosZerados > 0 },
    { label: 'Vencimentos Críticos', value: vencCriticos,    sub: 'próximos ou vencidos', warn: vencCriticos > 0 },
    { label: 'Inventários Abertos',  value: invEmAndamento,  sub: 'em andamento',          warn: false },
    { label: 'Total Movimentações',  value: totalMovMes,     sub: 'registradas',           warn: false },
  ];

  // Inventários em andamento (até 5)
  const invAbertos = invEnriched
    .filter((i: any) => i.status === 'Em Andamento')
    .slice(0, 5);

  // Vencimentos críticos (até 5)
  const venCriticos = venEnriched
    .filter((v: any) => v.status === 'Vencido' || v.status === 'Próximo')
    .slice(0, 5);

  // Expedições pendentes mais recentes (até 5)
  const expPendList = expEnriched
    .filter((e: any) => e.status === 'Pendente')
    .slice(0, 5);

  const statusVencColor = (s: string) =>
    s === 'Vencido' ? 'bg-red-900/30 text-red-400' : 'bg-yellow-900/30 text-yellow-400';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Gerenciamento de Estoque</h2>
        <p className="text-sm text-gray-400 mt-1">Visão geral do fluxo de estoque — requisições, aprovações, expedição e movimentações.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-red-400' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline de Estoque</h3>
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

      {/* Bottom row — 3 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
        {/* Inventários em andamento */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Package size={14} className="text-accent" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Inventários em Andamento</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {invAbertos.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum inventário em andamento.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {invAbertos.map((i: any) => {
                  const dif = Number(i.diferenca ?? (i.qtd_contada - i.qtd_sistema) ?? 0);
                  return (
                    <div key={i.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">{i.prod?.nome ?? '—'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{i.data ?? '—'}</p>
                      </div>
                      <span className={`text-xs font-mono font-bold ${dif < 0 ? 'text-red-400' : dif > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                        {dif > 0 ? `+${dif}` : dif}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Vencimentos críticos */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-red-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Vencimentos Críticos</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {venCriticos.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum vencimento crítico.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {venCriticos.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{v.prod?.nome ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Lote {v.lote || '—'} · <span className="font-mono">{v.vencimento}</span></p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusVencColor(v.status)}`}>{v.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Expedições pendentes */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Truck size={14} className="text-yellow-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Expedições Pendentes</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {expPendList.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhuma expedição pendente.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {expPendList.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{e.prod?.nome ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{e.data_expedicao ?? '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{e.qtd_expedida ?? 0} un.</span>
                      <StatusBadge status={e.status} />
                    </div>
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
