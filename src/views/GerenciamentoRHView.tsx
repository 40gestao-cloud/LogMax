import React from 'react';
import { motion } from 'motion/react';
import { Users, DollarSign, Palmtree, BookOpen, Clock, CalendarCheck } from 'lucide-react';
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

export const GerenciamentoRHView = () => {
  const { data: funcionarios, isLoading: lFun } = useFetchData<any>('/api/funcionariosview');
  const { data: folhas, isLoading: lFol } = useFetchData<any>('/api/folhapagamentoview');
  const { data: ferias, isLoading: lFer } = useFetchData<any>('/api/feriasview');
  const { data: ponto, isLoading: lPon } = useFetchData<any>('/api/pontoeletronicoview');
  const { data: treinamentos, isLoading: lTre } = useFetchData<any>('/api/treinamentosview');

  const isLoading = lFun || lFol || lFer || lPon || lTre;
  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const anoMes = new Date().toISOString().slice(0, 7);

  // Funcionários
  const funAtivos = funcionarios.filter((f: any) => f.status === 'Ativo').length;
  const funAfastados = funcionarios.filter((f: any) => f.status === 'Afastado').length;
  const funDesligados = funcionarios.filter((f: any) => f.status === 'Desligado').length;

  // Folha
  const folhaMes = folhas.filter((f: any) => f.mes_ref === anoMes);
  const folhaPaga = folhaMes.filter((f: any) => f.status === 'Paga').length;
  const folhaProc = folhaMes.filter((f: any) => f.status === 'Processada').length;
  const folhaPend = folhaMes.filter((f: any) => f.status === 'Pendente').length;
  const totalLiqMes = folhaMes
    .filter((f: any) => f.status !== 'Pendente')
    .reduce((acc: number, f: any) => acc + Number(f.salario_liquido || 0), 0);

  // Férias
  const ferSolic = ferias.filter((f: any) => f.status === 'Solicitada').length;
  const ferAprov = ferias.filter((f: any) => f.status === 'Aprovada').length;
  const ferAndando = ferias.filter((f: any) => f.status === 'Em Andamento').length;

  // Ponto
  const pontoNormal = ponto.filter((p: any) => p.status === 'Normal').length;
  const pontoFaltas = ponto.filter((p: any) => p.status === 'Falta').length;
  const pontoJust = ponto.filter((p: any) => p.status === 'Justificado').length;
  const pontoExtras = ponto.filter((p: any) => p.status === 'Hora Extra').length;

  // Treinamentos
  const treAgend = treinamentos.filter((t: any) => t.status === 'Agendado').length;
  const treAndando = treinamentos.filter((t: any) => t.status === 'Em Andamento').length;
  const treConcl = treinamentos.filter((t: any) => t.status === 'Concluído').length;

  const pipeline = [
    {
      icon: Users, label: 'Funcionários', total: funcionarios.length,
      color: 'bg-blue-900/40 text-blue-400',
      breakdown: [
        { label: 'Ativos', value: funAtivos, cls: 'text-green-400' },
        { label: 'Afastados', value: funAfastados, cls: funAfastados > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Desligados', value: funDesligados, cls: funDesligados > 0 ? 'text-red-400' : 'text-gray-500' },
      ],
    },
    {
      icon: DollarSign, label: 'Folha', total: folhaMes.length,
      color: 'bg-green-900/40 text-green-400',
      breakdown: [
        { label: 'Paga', value: folhaPaga, cls: 'text-green-400' },
        { label: 'Processada', value: folhaProc, cls: 'text-blue-400' },
        { label: 'Pendente', value: folhaPend, cls: folhaPend > 0 ? 'text-yellow-400' : 'text-gray-500' },
      ],
    },
    {
      icon: Palmtree, label: 'Férias', total: ferias.length,
      color: 'bg-yellow-400/20 text-yellow-400',
      breakdown: [
        { label: 'Solicitadas', value: ferSolic, cls: ferSolic > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Aprovadas', value: ferAprov, cls: 'text-green-400' },
        { label: 'Em Andamento', value: ferAndando, cls: 'text-blue-400' },
      ],
    },
    {
      icon: Clock, label: 'Ponto', total: ponto.length,
      color: 'bg-purple-900/40 text-purple-400',
      breakdown: [
        { label: 'Normal', value: pontoNormal, cls: 'text-green-400' },
        { label: 'Faltas', value: pontoFaltas, cls: pontoFaltas > 0 ? 'text-red-400' : 'text-gray-500' },
        { label: 'Hora Extra', value: pontoExtras, cls: 'text-blue-400' },
      ],
    },
    {
      icon: BookOpen, label: 'Treinamentos', total: treinamentos.length,
      color: 'bg-orange-900/40 text-orange-400',
      breakdown: [
        { label: 'Agendados', value: treAgend, cls: treAgend > 0 ? 'text-yellow-400' : 'text-gray-500' },
        { label: 'Em Andamento', value: treAndando, cls: 'text-blue-400' },
        { label: 'Concluídos', value: treConcl, cls: 'text-green-400' },
      ],
    },
  ];

  // Bottom sections
  const feriasSolicitadas = ferias
    .filter((f: any) => f.status === 'Solicitada')
    .slice(0, 5)
    .map((f: any) => ({ ...f, func: funcionarios.find((fn: any) => fn.id === f.funcionario_id) }));

  const proximosTreinamentos = [...treinamentos]
    .filter((t: any) => t.status === 'Agendado' && t.data_inicio)
    .sort((a: any, b: any) => a.data_inicio.localeCompare(b.data_inicio))
    .slice(0, 5);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Gerenciamento de RH</h2>
        <p className="text-sm text-gray-400 mt-1">Visão consolidada do capital humano — funcionários, folha, férias e treinamentos.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Funcionários Ativos</p>
          <p className="text-2xl font-black text-gray-100">{funAtivos}</p>
          <p className="text-xs text-gray-600 mt-1">de {funcionarios.length} cadastrados</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Folha do Mês</p>
          <p className="text-xl font-black text-green-400 leading-tight">R$ {totalLiqMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <p className="text-xs text-gray-600 mt-1">líquido processado · {anoMes}</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Férias Pendentes</p>
          <p className={`text-2xl font-black ${ferSolic > 0 ? 'text-yellow-400' : 'text-gray-100'}`}>{ferSolic}</p>
          <p className="text-xs text-gray-600 mt-1">aguardando aprovação</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Treinamentos Ativos</p>
          <p className="text-2xl font-black text-gray-100">{treAndando}</p>
          <p className="text-xs text-gray-600 mt-1">em andamento</p>
        </div>
      </div>

      {/* Pipeline */}
      <div className="shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline de RH</h3>
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

      {/* Bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Palmtree size={14} className="text-yellow-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Férias Aguardando Aprovação</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {feriasSolicitadas.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhuma solicitação pendente.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {feriasSolicitadas.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">{f.func?.nome ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="font-mono">{f.data_inicio ?? '—'}</span> → <span className="font-mono">{f.data_fim ?? '—'}</span> · {f.dias ?? 0} dias
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-yellow-900/30 text-yellow-400">Solicitada</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <CalendarCheck size={14} className="text-yellow-400" />
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Próximos Treinamentos</h3>
          </div>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            {proximosTreinamentos.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">Nenhum treinamento agendado.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {proximosTreinamentos.map((t: any) => {
                  const vagasLiv = Math.max(Number(t.vagas || 0) - Number(t.inscritos || 0), 0);
                  return (
                    <div key={t.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">{t.nome}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.instrutor ?? 'Sem instrutor'} · <span className="font-mono">{t.data_inicio}</span></p>
                      </div>
                      <span className={`text-xs font-bold font-mono ${vagasLiv === 0 ? 'text-red-400' : 'text-green-400'}`}>{vagasLiv} vagas</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
