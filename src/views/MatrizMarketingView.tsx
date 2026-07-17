import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Megaphone, Star, Image, Calendar, Tag, TrendingUp, Users } from 'lucide-react';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Legend,
} from 'recharts';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_COLOR: Record<FilialOp, { text: string; bar: string }> = {
  SuperMax: { text: 'text-sky-400',    bar: '#38bdf8' },
  MaxLook:  { text: 'text-amber-300',  bar: '#fcd34d' },
  TechMax:  { text: 'text-orange-400', bar: '#fb923c' },
};

function countByFilial(arr: any[]): Record<FilialOp, number> {
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) if (out[r.filial] !== undefined) out[r.filial]++;
  return out as Record<FilialOp, number>;
}
function avgByFilial(arr: any[], key: string): Record<FilialOp, number> {
  const sums: Record<string, number>  = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  const cnts: Record<string, number>  = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const r of arr) {
    const v = Number(r[key]);
    if (!isNaN(v) && cnts[r.filial] !== undefined) { sums[r.filial] += v; cnts[r.filial]++; }
  }
  const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
  for (const f of OP_FILIAIS) out[f] = cnts[f] > 0 ? sums[f] / cnts[f] : 0;
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

export function MatrizMarketingView() {
  const [period, setPeriod] = useState<'30d' | '90d' | 'ano'>('30d');

  const { data: artes,       isLoading: lA }  = useFetchData('/api/marketingartesview');
  const { data: feedbacks,   isLoading: lF }  = useFetchData('/api/marketingartefeedbackview');
  const { data: campanhas,   isLoading: lCa } = useFetchData('/api/marketingcampanhasview');
  const { data: promocoes,   isLoading: lPr } = useFetchData('/api/marketingpromocoesview');
  const { data: cupons,      isLoading: lCu } = useFetchData('/api/marketingcuponsview');
  const { data: calendario,  isLoading: lCl } = useFetchData('/api/marketingcalendarioview');
  const { data: metricas,    isLoading: lMe } = useFetchData('/api/metricasredessociaisview');

  const isLoading = lA || lF || lCa || lPr || lCu || lCl || lMe;

  const cutoff = useMemo(() => {
    const d = new Date();
    if (period === '30d')  { d.setDate(d.getDate() - 29); return d; }
    if (period === '90d')  { d.setDate(d.getDate() - 89); return d; }
    return new Date(d.getFullYear(), 0, 1);
  }, [period]);

  // Artes no período
  const artesPeriodo = useMemo(() => artes.filter((a: any) => new Date(a.publicada_em ?? a.created_at) >= cutoff), [artes, cutoff]);
  const artesCount   = useMemo(() => countByFilial(artesPeriodo), [artesPeriodo]);

  // Feedbacks médios de estrelas por filial
  // feedbacks ligados às artes → mapear arte → filial
  const arteFilialMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of artes) m[a.id] = a.filial;
    return m;
  }, [artes]);

  const feedbacksComFilial = useMemo(() =>
    feedbacks.map((fb: any) => ({ ...fb, filial: arteFilialMap[fb.arte_id] ?? null }))
      .filter((fb: any) => fb.filial),
  [feedbacks, arteFilialMap]);

  const mediaEstrelas = useMemo(() => avgByFilial(feedbacksComFilial, 'estrelas'), [feedbacksComFilial]);
  const feedbackCount = useMemo(() => countByFilial(feedbacksComFilial), [feedbacksComFilial]);
  const aprovacoes    = useMemo(() => {
    const aprov = feedbacksComFilial.filter((fb: any) => Number(fb.estrelas) >= 4);
    const cnt   = countByFilial(aprov);
    const total = feedbackCount;
    const out: Record<string, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of OP_FILIAIS) out[f] = total[f] > 0 ? Math.round((cnt[f] / total[f]) * 100) : 0;
    return out as Record<FilialOp, number>;
  }, [feedbacksComFilial, feedbackCount]);

  // Campanhas
  const campanhasAtivas = useMemo(() => campanhas.filter((c: any) => c.status === 'Ativa' || c.status === 'Ativo'), [campanhas]);
  const campanhasCount  = useMemo(() => countByFilial(campanhasAtivas), [campanhasAtivas]);
  const cuponsUsados    = useMemo(() => {
    const used = cupons.filter((c: any) => c.uso_atual > 0);
    return countByFilial(used);
  }, [cupons]);

  // Promoções
  const promAtivas = useMemo(() => promocoes.filter((p: any) => p.status === 'Ativa' || p.status === 'Aprovada' || p.status === 'Aprovado'), [promocoes]);
  const promCount  = useMemo(() => countByFilial(promAtivas), [promAtivas]);

  // Calendário editorial
  const calPeriodo = useMemo(() => calendario.filter((c: any) => new Date(c.data_publicacao ?? c.created_at) >= cutoff), [calendario, cutoff]);
  const calCount   = useMemo(() => countByFilial(calPeriodo), [calPeriodo]);
  const calPub     = useMemo(() => {
    const pub = calPeriodo.filter((c: any) => c.status === 'Publicado');
    return countByFilial(pub);
  }, [calPeriodo]);

  // Redes Sociais — último registro por plataforma por filial
  const PLATAFORMAS_RS = ['Instagram', 'TikTok', 'Facebook', 'YouTube'] as const;
  const ultimaMetricaPorFilialPlat = useMemo(() => {
    // Para cada (plataforma, filial) pega o registro mais recente (já vem ordenado por created_at desc)
    const map: Record<string, Record<string, any>> = {};
    for (const r of metricas) {
      const key = `${r.plataforma}::${r.filial}`;
      if (!map[r.plataforma]) map[r.plataforma] = {};
      if (!map[r.plataforma][r.filial]) map[r.plataforma][r.filial] = r;
    }
    return map;
  }, [metricas]);

  const seguidoresPorPlat = useMemo(() =>
    PLATAFORMAS_RS.map(plat => ({
      plat,
      values: Object.fromEntries(OP_FILIAIS.map(f => [f, Number(ultimaMetricaPorFilialPlat[plat]?.[f]?.seguidores ?? 0)])) as Record<FilialOp, number>,
    })),
  [ultimaMetricaPorFilialPlat]);

  // Gráfico artes por mês
  const chartData = useMemo(() => {
    const meses = Array.from({ length: 3 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (2 - i));
      return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) };
    });
    return meses.map(m => {
      const row: Record<string, any> = { name: m.label };
      for (const f of OP_FILIAIS) {
        row[f] = artes.filter((a: any) => {
          const d = new Date(a.publicada_em ?? a.created_at);
          return a.filial === f && d.getFullYear() === m.year && d.getMonth() === m.month;
        }).length;
      }
      return row;
    });
  }, [artes]);

  const PERIOD_LABELS = { '30d': '30 dias', '90d': '90 dias', 'ano': 'Este ano' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Marketing — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Artes, campanhas, promoções e calendário editorial.</p>
          <div className="mt-2"><CompeticaoBadge /></div>
        </div>
        <select
          value={period} onChange={e => setPeriod(e.target.value as any)}
          className="neu-input py-2 px-3 rounded-xl text-xs text-gray-300"
        >
          {(Object.keys(PERIOD_LABELS) as (keyof typeof PERIOD_LABELS)[]).map(p => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </select>
      </div>

      <FilialHeaders />

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Redes Sociais — seguidores por plataforma */}
            <SectionCard title="Redes Sociais — Seguidores" icon={Users}>
              {seguidoresPorPlat.every(({ values }) => OP_FILIAIS.every(f => values[f] === 0)) ? (
                <p className="text-xs text-gray-500 text-center py-2">Nenhuma métrica registrada ainda.</p>
              ) : (
                seguidoresPorPlat.map(({ plat, values }) =>
                  OP_FILIAIS.some(f => values[f] > 0) ? (
                    <KpiRow key={plat} label={plat} values={values} fmt={v => v > 0 ? v.toLocaleString('pt-BR') : '—'} />
                  ) : null
                )
              )}
            </SectionCard>

            {/* Artes */}
            <SectionCard title="Artes Publicadas" icon={Image}>
              <KpiRow label="Artes no período" values={artesCount} />
              <KpiRow label="Feedbacks recebidos" values={feedbackCount} />
              <KpiRow label="Média de estrelas" values={mediaEstrelas} fmt={v => v > 0 ? `${v.toFixed(1)} ★` : '—'} />
              <KpiRow label="Taxa aprovação (≥4★)" values={aprovacoes} fmt={v => `${v}%`} />
            </SectionCard>

            {/* Campanhas */}
            <SectionCard title="Campanhas de Marketing" icon={Megaphone}>
              <KpiRow label="Campanhas ativas" values={campanhasCount} />
              <KpiRow label="Cupons utilizados" values={cuponsUsados} />
            </SectionCard>

            {/* Promoções */}
            <SectionCard title="Promoções" icon={Tag}>
              <KpiRow label="Promoções ativas / aprovadas" values={promCount} />
            </SectionCard>

            {/* Calendário editorial */}
            <SectionCard title="Calendário Editorial" icon={Calendar}>
              <KpiRow label="Posts no período" values={calCount} />
              <KpiRow label="Publicados" values={calPub} />
            </SectionCard>

          </div>

          {/* Gráfico artes mensais */}
          <div className="neu-flat p-6 rounded-3xl border border-accent/20">
            <h3 className="text-sm font-bold text-gray-200 mb-5">Artes Publicadas por Mês — últimos 3 meses</h3>
            <div className="w-full h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border-md)', borderRadius: '12px' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', color: '#9ca3af' }} />
                  {OP_FILIAIS.map(f => (
                    <Bar key={f} dataKey={f} fill={FILIAL_COLOR[f].bar} radius={[4, 4, 0, 0]} maxBarSize={32} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
