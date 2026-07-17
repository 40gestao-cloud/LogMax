import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Monitor, ShoppingCart, Users, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_COLOR: Record<FilialOp, { text: string }> = {
  SuperMax: { text: 'text-sky-400' },
  MaxLook:  { text: 'text-amber-300' },
  TechMax:  { text: 'text-orange-400' },
};

function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}

function KpiRow({ label, values, fmt = String, highlight = 'max' }: {
  label: string; values: Record<FilialOp, number>;
  fmt?: (v: number) => string; highlight?: 'max' | 'min' | 'none';
}) {
  const nums = OP_FILIAIS.map(f => values[f]);
  const best = highlight === 'max' ? Math.max(...nums) : highlight === 'min' ? Math.min(...nums) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {OP_FILIAIS.map(f => {
          const v = values[f];
          const isBest = best !== null && v === best && best > 0;
          return (
            <div key={f} className={`neu-pressed rounded-xl p-2.5 text-center ${isBest ? 'ring-1 ring-emerald-500/30' : ''}`}>
              <span className={`text-sm font-black font-mono tabular-nums ${isBest ? 'text-emerald-400' : 'text-gray-200'}`}>
                {fmt(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, isLoading }: {
  title: string; icon: any; children: React.ReactNode; isLoading?: boolean;
}) {
  return (
    <div className="neu-flat p-5 rounded-3xl border border-accent/20 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-accent shrink-0" />
        <h3 className="text-sm font-bold text-gray-200 tracking-wide">{title}</h3>
      </div>
      {isLoading ? <LoadingSpinner /> : children}
    </div>
  );
}

function FilialHeaders() {
  return (
    <div className="grid grid-cols-3 gap-2 mb-1">
      {OP_FILIAIS.map(f => (
        <div key={f} className="text-center">
          <span className={`text-[11px] font-black uppercase tracking-widest ${FILIAL_COLOR[f].text}`}>{f}</span>
        </div>
      ))}
    </div>
  );
}

export function MatrizOperacoesView() {
  const { data: chamados,   isLoading: lCh } = useFetchData('/api/tichamadosview');
  const { data: requisicoes,isLoading: lRq } = useFetchData('/api/requisicoesview');
  const { data: pedidos,    isLoading: lPd } = useFetchData('/api/pedidosview');
  const { data: clientes,   isLoading: lCl } = useFetchData('/api/crmview-clientes');
  const { data: tarefas,    isLoading: lTr } = useFetchData('/api/tarefasview');
  const { data: afastamentos, isLoading: lAf } = useFetchData('/api/afastamentosview');

  const isLoading = lCh || lRq || lPd || lCl || lTr || lAf;

  // ── TI Chamados ──────────────────────────────────────────────────────────
  const chamAbertos    = useMemo(() => countByFilial(chamados.filter((c: any) => c.status === 'Aberto')), [chamados]);
  const chamResolvidos = useMemo(() => countByFilial(chamados.filter((c: any) => c.status === 'Resolvido' || c.status === 'Fechado')), [chamados]);
  const chamTotal      = useMemo(() => countByFilial(chamados), [chamados]);
  const taxaResolucao  = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = chamTotal[f] > 0 ? Math.round((chamResolvidos[f] / chamTotal[f]) * 100) : 0;
    return out as Record<FilialOp, number>;
  }, [chamResolvidos, chamTotal]);

  // ── Compras — requisições e pedidos ─────────────────────────────────────
  const reqPendentes  = useMemo(() => countByFilial(requisicoes.filter((r: any) => r.status === 'Pendente' || r.status === 'Aguardando')), [requisicoes]);
  const reqAprovadas  = useMemo(() => countByFilial(requisicoes.filter((r: any) => r.status === 'Aprovado' || r.status === 'Aprovada')), [requisicoes]);
  const pedPendentes  = useMemo(() => countByFilial(pedidos.filter((p: any) => p.status === 'Pendente' || p.status === 'Em andamento')), [pedidos]);
  const pedEntregues  = useMemo(() => countByFilial(pedidos.filter((p: any) => p.status === 'Entregue' || p.status === 'Recebido')), [pedidos]);

  // ── CRM — Clientes ───────────────────────────────────────────────────────
  const clientesTotal  = useMemo(() => countByFilial(clientes), [clientes]);
  const clientesAtivos = useMemo(() => countByFilial(clientes.filter((c: any) => c.status !== 'Inativo')), [clientes]);

  // ── Tarefas ──────────────────────────────────────────────────────────────
  const tarefasPend   = useMemo(() => countByFilial(tarefas.filter((t: any) => t.status === 'Pendente' || !t.status)), [tarefas]);
  const tarefasConc   = useMemo(() => countByFilial(tarefas.filter((t: any) => t.status === 'Concluída' || t.status === 'Concluido')), [tarefas]);
  const tarefasAndamento = useMemo(() => countByFilial(tarefas.filter((t: any) => t.status === 'Em Andamento' || t.status === 'Em andamento')), [tarefas]);

  // ── Afastamentos ativos ──────────────────────────────────────────────────
  const now = new Date();
  const afAtivos = useMemo(() =>
    afastamentos.filter((a: any) => a.data_inicio && a.data_retorno &&
      new Date(a.data_inicio) <= now && new Date(a.data_retorno) >= now),
  [afastamentos]);
  const afCount = useMemo(() => countByFilial(afAtivos), [afAtivos]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Operações — Comparativo entre Unidades</h2>
        <p className="text-sm text-gray-400 mt-1">TI, Compras, Clientes, Tarefas e Afastamentos.</p>
        <div className="mt-2"><CompeticaoBadge /></div>
      </div>

      <FilialHeaders />

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* TI */}
          <SectionCard title="TI — Chamados" icon={Monitor}>
            <KpiRow label="Total de chamados" values={chamTotal} />
            <KpiRow label="Abertos" values={chamAbertos} highlight="min" />
            <KpiRow label="Resolvidos" values={chamResolvidos} />
            <KpiRow label="Taxa de resolução %" values={taxaResolucao} fmt={v => `${v}%`} />
          </SectionCard>

          {/* Compras */}
          <SectionCard title="Compras — Requisições e Pedidos" icon={ShoppingCart}>
            <KpiRow label="Requisições pendentes" values={reqPendentes} highlight="min" />
            <KpiRow label="Requisições aprovadas" values={reqAprovadas} />
            <KpiRow label="Pedidos pendentes" values={pedPendentes} highlight="min" />
            <KpiRow label="Pedidos entregues" values={pedEntregues} />
          </SectionCard>

          {/* CRM Clientes */}
          <SectionCard title="Clientes (CRM)" icon={Users}>
            <KpiRow label="Total cadastrado" values={clientesTotal} />
            <KpiRow label="Ativos" values={clientesAtivos} />
          </SectionCard>

          {/* Tarefas */}
          <SectionCard title="Tarefas" icon={CheckCircle}>
            <KpiRow label="Em andamento" values={tarefasAndamento} />
            <KpiRow label="Pendentes" values={tarefasPend} highlight="min" />
            <KpiRow label="Concluídas" values={tarefasConc} />
          </SectionCard>

          {/* Afastamentos */}
          <SectionCard title="Afastamentos Ativos" icon={AlertTriangle}>
            <KpiRow label="Funcionários afastados hoje" values={afCount} highlight="min" />
          </SectionCard>

        </div>
      )}
    </motion.div>
  );
}
