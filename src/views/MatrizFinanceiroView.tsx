import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { DollarSign, TrendingDown, Scale } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { CompeticaoBadge } from '../components/CompeticaoBadge';
import { FilialsComparativo } from '../components/FilialsComparativo';
import {
  Period, PERIOD_LABELS, periodStartISO,
  sumByFilial, countByFilial, zerosByFilial, OP_FILIAIS, FilialOp,
} from '../lib/matrizAgg';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function MatrizFinanceiroView() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data: vendas,        isLoading: lV } = useFetchData('/api/vendasview');
  const { data: contasReceber, isLoading: lR } = useFetchData('/api/contasreceberview');
  const { data: contasPagar,   isLoading: lP } = useFetchData('/api/contaspagarview');

  const isLoading = lV || lR || lP;

  const cutoffISO = useMemo(() => periodStartISO(period), [period]);

  // ── Vendas / ticket (contexto operacional) ─────────────────────────────
  const vPeriodo = useMemo(
    () => vendas.filter((v: any) => String(v.created_at ?? '') >= cutoffISO && v.status !== 'Cancelada'),
    [vendas, cutoffISO],
  );
  const vendasTotal = useMemo(() => sumByFilial(vPeriodo, 'total_final'), [vPeriodo]);
  const vendasCount = useMemo(() => countByFilial(vPeriodo), [vPeriodo]);
  const ticketMedio = useMemo(() => {
    const out = zerosByFilial();
    for (const f of OP_FILIAIS) out[f] = vendasCount[f] > 0 ? vendasTotal[f] / vendasCount[f] : 0;
    return out;
  }, [vendasTotal, vendasCount]);

  // ── Resultado financeiro alinhado ao placar da Competição ──────────────
  // A RPC calcular_placar_competicao usa: contas_receber Pago  −  contas_pagar Pago
  // no período (por vencimento). Espelhamos aqui pra não divergir.
  const receberPagoPeriodo = useMemo(
    () => contasReceber.filter((c: any) =>
      c.status === 'Pago' && c.ativo !== false && (c.vencimento ?? '') >= cutoffISO,
    ),
    [contasReceber, cutoffISO],
  );
  const pagarPagoPeriodo = useMemo(
    () => contasPagar.filter((c: any) =>
      c.status === 'Pago' && c.ativo !== false && (c.vencimento ?? '') >= cutoffISO,
    ),
    [contasPagar, cutoffISO],
  );

  const receitasPagas = useMemo(() => sumByFilial(receberPagoPeriodo, 'valor'), [receberPagoPeriodo]);
  const despesasPagas = useMemo(() => sumByFilial(pagarPagoPeriodo,   'valor'), [pagarPagoPeriodo]);
  const resultado = useMemo(() => {
    const out = zerosByFilial();
    for (const f of OP_FILIAIS) out[f] = receitasPagas[f] - despesasPagas[f];
    return out;
  }, [receitasPagas, despesasPagas]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Financeiro — Comparativo entre Unidades</h2>
          <p className="text-sm text-gray-400 mt-1">Resultado por unidade no período — <span className="font-mono text-accent">{PERIOD_LABELS[period]}</span></p>
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
          <FilialsComparativo
            title="Resultado — Receitas Pagas − Despesas Pagas"
            subtitle="mesmo cálculo do placar da Competição"
            icon={Scale}
            metrics={[
              { label: 'Receitas pagas', values: receitasPagas, fmt: BRL, highlight: 'max' },
              { label: 'Despesas pagas', values: despesasPagas, fmt: BRL, highlight: 'min' },
              { label: 'Resultado líquido', values: resultado, fmt: BRL, highlight: 'max' },
            ]}
          />
          <FilialsComparativo
            title="Faturamento (Vendas)"
            subtitle="contexto operacional — não entra no placar"
            icon={DollarSign}
            metrics={[
              { label: 'Receita de vendas', values: vendasTotal, fmt: BRL, highlight: 'max' },
              { label: 'Nº de vendas',      values: vendasCount, highlight: 'max' },
              { label: 'Ticket médio',      values: ticketMedio, fmt: BRL, highlight: 'max' },
            ]}
          />
          <p className="text-[10px] text-gray-500 -mt-3 px-1">
            <TrendingDown size={10} className="inline mr-1 text-gray-500" />
            Devoluções entram nas vendas canceladas (excluídas do faturamento). Se receita paga ainda estiver zerada, é porque as contas ainda não foram baixadas — mesmo comportamento do placar.
          </p>
        </div>
      )}
    </motion.div>
  );
}
