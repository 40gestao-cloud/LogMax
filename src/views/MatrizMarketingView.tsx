import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Megaphone, TrendingUp, Users, DollarSign } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';
import { FilialsComparativo, FilialOp, Metric } from '../components/FilialsComparativo';
import { daysAgoBR, todayBR } from '../lib/dates';
import { sumByFilial, countByFilial, zerosByFilial, OP_FILIAIS } from '../lib/matrizAgg';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PERIOD_LABELS = { '30d': '30 dias', '90d': '90 dias', 'ano': 'Este ano' } as const;
type Period = keyof typeof PERIOD_LABELS;

export function MatrizMarketingView() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data: campanhas, isLoading: lCa } = useFetchData('/api/marketingcampanhasview');
  const { data: metricas,  isLoading: lMe } = useFetchData('/api/metricasredessociaisview');
  const { data: roi,       isLoading: lRo } = useFetchData('/api/campanharoiview');

  const isLoading = lCa || lMe || lRo;

  const cutoffISO = useMemo(() => {
    if (period === '30d') return daysAgoBR(29);
    if (period === '90d') return daysAgoBR(89);
    return `${todayBR().slice(0, 4)}-01-01`;
  }, [period]);
  const hojeISO = useMemo(() => todayBR(), []);

  const campanhasAtivas = useMemo(
    () => campanhas.filter((c: any) => c.status === 'Ativa' || c.status === 'Ativo'),
    [campanhas],
  );
  const campanhasCount = useMemo(() => countByFilial(campanhasAtivas), [campanhasAtivas]);

  // Receita das campanhas cuja janela sobrepõe o período filtrado — espelha
  // a lógica de calcular_placar_competicao (marketing = SUM(receita) do
  // v_campanha_roi das campanhas da filial no intervalo). Campanhas sem
  // filial ficam de fora, pra não distorcer o comparativo.
  const receitaCampanhas = useMemo(() => {
    const out = zerosByFilial();
    for (const r of roi) {
      const fil = r.filial as FilialOp;
      if (!fil || out[fil] === undefined) continue;
      const ini = String(r.data_inicio ?? '');
      const fim = String(r.data_fim ?? '');
      // Sobreposição: campanha começou até hoje E terminou depois do cutoff.
      if (ini && fim && ini <= hojeISO && fim >= cutoffISO) {
        out[fil] += Number(r.receita) || 0;
      }
    }
    return out;
  }, [roi, cutoffISO, hojeISO]);

  // Redes sociais — último registro por plataforma × filial
  const PLATAFORMAS_RS = ['Instagram', 'TikTok', 'Facebook', 'YouTube'] as const;
  const ultimaMetricaPorFilialPlat = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    for (const r of metricas) {
      if (!map[r.plataforma]) map[r.plataforma] = {};
      if (!map[r.plataforma][r.filial]) map[r.plataforma][r.filial] = r;
    }
    return map;
  }, [metricas]);

  const seguidoresMetrics: Metric[] = useMemo(() =>
    PLATAFORMAS_RS
      .map(plat => ({
        label: plat,
        values: Object.fromEntries(
          OP_FILIAIS.map(f => [f, Number(ultimaMetricaPorFilialPlat[plat]?.[f]?.seguidores ?? 0)])
        ) as Record<FilialOp, number>,
        fmt: (v: number) => v > 0 ? v.toLocaleString('pt-BR') : '—',
        highlight: 'max' as const,
      }))
      .filter(m => OP_FILIAIS.some(f => m.values[f] > 0)),
  [ultimaMetricaPorFilialPlat]);

  const metricasPeriodo = useMemo(
    () => metricas.filter((m: any) => String(m.data_registro ?? m.created_at ?? '') >= cutoffISO),
    [metricas, cutoffISO],
  );
  const curtidasTotal    = useMemo(() => sumByFilial(metricasPeriodo, 'curtidas'), [metricasPeriodo]);
  const comentariosTotal = useMemo(() => sumByFilial(metricasPeriodo, 'comentarios'), [metricasPeriodo]);
  const temEngajamento   = OP_FILIAIS.some(f => curtidasTotal[f] > 0 || comentariosTotal[f] > 0);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Marketing — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Engajamento em redes sociais e campanhas ativas por unidade.</p>
          <div className="mt-2"><CompeticaoBadge /></div>
        </div>
        <select
          value={period} onChange={e => setPeriod(e.target.value as Period)}
          className="neu-input py-2 px-3 rounded-xl text-xs text-gray-300"
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
      ) : (
        <div className="flex flex-col gap-6">
          {seguidoresMetrics.length > 0 ? (
            <FilialsComparativo
              title="Redes Sociais — Seguidores"
              icon={Users}
              metrics={seguidoresMetrics}
            />
          ) : (
            <div className="neu-flat p-5 rounded-2xl border border-accent/20">
              <p className="text-xs text-gray-500 text-center">Nenhuma métrica de redes sociais registrada ainda.</p>
            </div>
          )}

          {temEngajamento && (
            <FilialsComparativo
              title={`Redes Sociais — Engajamento (${PERIOD_LABELS[period]})`}
              icon={TrendingUp}
              metrics={[
                { label: 'Curtidas',    values: curtidasTotal,    fmt: v => v.toLocaleString('pt-BR'), highlight: 'max' },
                { label: 'Comentários', values: comentariosTotal, fmt: v => v.toLocaleString('pt-BR'), highlight: 'max' },
              ]}
            />
          )}

          <FilialsComparativo
            title="Receita das Campanhas"
            subtitle="mesmo cálculo do placar da Competição"
            icon={DollarSign}
            metrics={[
              { label: `Receita atribuída (${PERIOD_LABELS[period]})`, values: receitaCampanhas, fmt: BRL, highlight: 'max' },
            ]}
          />
          <FilialsComparativo
            title="Campanhas de Marketing"
            icon={Megaphone}
            metrics={[
              { label: 'Campanhas ativas', values: campanhasCount, highlight: 'max' },
            ]}
          />
        </div>
      )}
    </motion.div>
  );
}
