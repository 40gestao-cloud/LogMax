import React, { useMemo } from 'react';
import { todayBR } from '../lib/dates';
import { motion } from 'motion/react';
import { Users, TrendingUp, TrendingDown, Award, Calendar, Clock, AlertTriangle } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (a: number, b: number) => b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`;

const FILIAL_COLOR: Record<FilialOp, { text: string; ring: string; bg: string }> = {
  SuperMax: { text: 'text-sky-400',     ring: 'ring-sky-500/30',     bg: 'bg-sky-500/10' },
  MaxLook:  { text: 'text-amber-300',   ring: 'ring-amber-400/30',   bg: 'bg-amber-400/10' },
  TechMax:  { text: 'text-orange-400',  ring: 'ring-orange-500/30',  bg: 'bg-orange-500/10' },
};

// ── Bloco de KPI reutilizável ──────────────────────────────────────────────
function KpiRow({ label, values, fmt = (v: number) => String(v), accent = false }: {
  label: string;
  values: Record<FilialOp, number>;
  fmt?: (v: number) => string;
  accent?: boolean;
}) {
  const max = Math.max(...OP_FILIAIS.map(f => values[f]));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {OP_FILIAIS.map(f => {
          const v = values[f];
          const isMax = v === max && max > 0;
          const color = accent ? FILIAL_COLOR[f].text : (isMax ? 'text-emerald-400' : 'text-gray-200');
          return (
            <div key={f} className={`neu-pressed rounded-xl p-2.5 text-center ${isMax && !accent ? 'ring-1 ring-emerald-500/30' : ''}`}>
              <div className={`text-lg font-black font-mono tabular-nums ${color}`}>{fmt(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Card de seção ──────────────────────────────────────────────────────────
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

// ── Header de filiais (reutilizado em todos os cards) ──────────────────────
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

// ── Helpers de agregação ────────────────────────────────────────────────────
function sumByFilial(arr: any[], key: string): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial] += Number(r[key]) || 0;
  return out as Record<FilialOp, number>;
}
function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}

// ───────────────────────────────────────────────────────────────────────────
export function MatrizRHView() {
  // Todos os fetches sem filtro de filial → consolidado global
  const { data: funcionarios,  isLoading: lFn }  = useFetchData('/api/funcionariosview');
  const { data: frequencias,   isLoading: lFr }  = useFetchData('/api/frequenciatrabalhoview');
  const { data: folhas,        isLoading: lFo }  = useFetchData('/api/folhapagamentoview');
  const { data: afastamentos,  isLoading: lAf }  = useFetchData('/api/afastamentosview');
  const { data: ferias,        isLoading: lFe }  = useFetchData('/api/feriasview');
  const { data: treinamentos,  isLoading: lTr }  = useFetchData('/api/treinamentosview');
  const { data: inscricoes,    isLoading: lIn }  = useFetchData('/api/treinamentoinscricoesview');
  const { data: ciclos,        isLoading: lCi }  = useFetchData('/api/ciclosavaliacaoview' as any);

  const isLoading = lFn || lFr || lFo || lAf || lFe || lTr || lIn || lCi;

  // ── Funcionários ativos por filial ───────────────────────────────────────
  const fnAtivos = useMemo(() => {
    const ativos = funcionarios.filter((f: any) => f.status !== 'Inativo');
    return countByFilial(ativos);
  }, [funcionarios]);

  // ── Frequência — hoje ────────────────────────────────────────────────────
  // frequencia_trabalho não tem filial direta; join via funcionarios.filial
  const fnFilialMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of funcionarios) m[f.id] = f.filial;
    return m;
  }, [funcionarios]);

  const hoje = todayBR();
  const freqHoje = useMemo(() => {
    const hoje_ = new Date().toDateString();
    return frequencias.filter((r: any) => new Date(r.data ?? r.created_at).toDateString() === hoje_);
  }, [frequencias]);

  const presencaHoje = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const r of freqHoje) {
      const fil = fnFilialMap[r.funcionario_id];
      if (fil && out[fil] !== undefined && r.status === 'Presente') out[fil]++;
    }
    return out as Record<FilialOp, number>;
  }, [freqHoje, fnFilialMap]);

  const faltasHoje = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const r of freqHoje) {
      const fil = fnFilialMap[r.funcionario_id];
      if (fil && out[fil] !== undefined && r.status === 'Falta') out[fil]++;
    }
    return out as Record<FilialOp, number>;
  }, [freqHoje, fnFilialMap]);

  const taxaPresenca = useMemo(() => {
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) {
      const total = fnAtivos[f];
      out[f] = total > 0 ? Math.round((presencaHoje[f] / total) * 100) : 0;
    }
    return out as Record<FilialOp, number>;
  }, [presencaHoje, fnAtivos]);

  // ── Folha — mês corrente ─────────────────────────────────────────────────
  const mesRef = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const folhasMes = useMemo(() => folhas.filter((f: any) => f.mes_ref === mesRef), [folhas, mesRef]);
  const folhaBruto  = useMemo(() => sumByFilial(folhasMes, 'salario_bruto'), [folhasMes]);
  const folhaLiq    = useMemo(() => sumByFilial(folhasMes, 'salario_liquido'), [folhasMes]);
  const folhaNr     = useMemo(() => countByFilial(folhasMes), [folhasMes]);
  const folhaPagas  = useMemo(() => {
    const pagas = folhasMes.filter((f: any) => f.status === 'Pago');
    return countByFilial(pagas);
  }, [folhasMes]);

  // ── Afastamentos ativos ──────────────────────────────────────────────────
  const afAtivos = useMemo(() => {
    const now = new Date();
    return afastamentos.filter((a: any) => {
      if (!a.data_inicio || !a.data_retorno) return false;
      return new Date(a.data_inicio) <= now && new Date(a.data_retorno) >= now;
    });
  }, [afastamentos]);
  const afCount = useMemo(() => countByFilial(afAtivos), [afAtivos]);

  // ── Férias ───────────────────────────────────────────────────────────────
  const feriasPendentes = useMemo(() =>
    ferias.filter((f: any) => f.status === 'Solicitada' || f.status === 'Pendente'),
  [ferias]);
  const feriasAprovadas = useMemo(() =>
    ferias.filter((f: any) => f.status === 'Aprovada' || f.status === 'Aprovado'),
  [ferias]);
  const feriasPend  = useMemo(() => countByFilial(feriasPendentes), [feriasPendentes]);
  const feriasAprov = useMemo(() => countByFilial(feriasAprovadas), [feriasAprovadas]);

  // ── Treinamentos ─────────────────────────────────────────────────────────
  const trAtivos   = useMemo(() => treinamentos.filter((t: any) => t.status === 'Ativo' || !t.status), [treinamentos]);
  const trCount    = useMemo(() => countByFilial(trAtivos), [trAtivos]);
  const inscrCount = useMemo(() => countByFilial(inscricoes), [inscricoes]);

  // ── Avaliações ───────────────────────────────────────────────────────────
  const ciclosAtivos = useMemo(() => ciclos.filter((c: any) => c.status === 'Ativo' || c.status === 'Em andamento'), [ciclos]);
  const ciclosCount  = useMemo(() => countByFilial(ciclosAtivos), [ciclosAtivos]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">RH — Comparativo entre Unidades</h2>
        <p className="text-sm text-gray-400 mt-1">Dados consolidados de todas as 3 filiais. Mês de referência: <span className="font-mono text-accent">{mesRef}</span></p>
      </div>

      <FilialHeaders />

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Headcount */}
          <SectionCard title="Headcount Ativo" icon={Users}>
            <KpiRow label="Funcionários ativos" values={fnAtivos} accent />
            <KpiRow label="Afastados (hoje)" values={afCount} fmt={v => String(v)} />
          </SectionCard>

          {/* Frequência hoje */}
          <SectionCard title={`Frequência — ${hoje}`} icon={Clock}>
            <KpiRow label="Presentes hoje" values={presencaHoje} />
            <KpiRow label="Faltas hoje" values={faltasHoje} />
            <KpiRow label="Taxa de presença %" values={taxaPresenca} fmt={v => `${v}%`} />
          </SectionCard>

          {/* Folha do mês */}
          <SectionCard title={`Folha de Pagamento — ${mesRef}`} icon={TrendingUp}>
            <KpiRow label="Nº de folhas" values={folhaNr} />
            <KpiRow label="Folhas pagas" values={folhaPagas} />
            <KpiRow label="Total bruto" values={folhaBruto} fmt={BRL} />
            <KpiRow label="Total líquido" values={folhaLiq} fmt={BRL} />
          </SectionCard>

          {/* Férias */}
          <SectionCard title="Férias" icon={Calendar}>
            <KpiRow label="Aprovadas" values={feriasAprov} />
            <KpiRow label="Pendentes de aprovação" values={feriasPend} />
          </SectionCard>

          {/* Treinamentos */}
          <SectionCard title="Treinamentos" icon={Award}>
            <KpiRow label="Treinamentos ativos" values={trCount} />
            <KpiRow label="Inscrições registradas" values={inscrCount} />
          </SectionCard>

          {/* Avaliações */}
          <SectionCard title="Avaliações de Desempenho" icon={TrendingDown}>
            <KpiRow label="Ciclos ativos" values={ciclosCount} />
          </SectionCard>

        </div>
      )}
    </motion.div>
  );
}
