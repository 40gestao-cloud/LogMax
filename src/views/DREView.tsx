// DRE — Demonstrativo de Resultado (migr. 425).
//
// A pergunta que a filial não sabia responder: no mês passado deu lucro?
// Saldo de banco é caixa; resultado é outra coisa, e a diferença entre os dois
// é metade da aula de finanças.
//
// Todo o cálculo vive na RPC `gerar_dre` — aqui é apresentação. Duas coisas a
// tela faz questão de mostrar em vez de esconder: as despesas que ninguém
// classificou ainda, e quantos itens vendidos entraram no CMV pelo custo de
// hoje por serem anteriores ao carimbo da migr. 425.

import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { FileDown, Sheet, TrendingUp, TrendingDown, TriangleAlert, RefreshCw } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from '../components/FilialSelector';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';
import { LoadingSpinner, EmptyState, ExportButton, SelecioneUnidade } from '../components/ui';

type Dre = {
  receita_bruta: number; descontos: number; devolucoes: number; receita_liquida: number;
  cmv: number; lucro_bruto: number; margem_bruta_pct: number | null;
  despesas: number; despesas_grupos: { grupo: string; valor: number }[];
  // Migr. 442. `consumo_material` já está DENTRO de `despesas` e dos grupos —
  // aqui ele vem separado só para a tela poder dizer de onde veio aquele pedaço.
  consumo_material?: number; consumos_sem_custo?: number;
  resultado: number; margem_liquida_pct: number | null;
  itens_vendidos: number; itens_sem_custo: number;
};

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Primeiro e último dia do mês, N meses atrás (0 = mês atual). */
const mesRange = (atras: number): { inicio: string; fim: string; rotulo: string } => {
  const [y, m] = todayBR().split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 - atras, 1));
  const ini  = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const fim  = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return {
    inicio: ini.toISOString().slice(0, 10),
    fim:    fim.toISOString().slice(0, 10),
    rotulo: ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
};

const anoRange = (): { inicio: string; fim: string; rotulo: string } => {
  const y = Number(todayBR().slice(0, 4));
  return { inicio: `${y}-01-01`, fim: `${y}-12-31`, rotulo: String(y) };
};

const DREViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [periodo, setPeriodo] = useState<'mes' | 'anterior' | 'ano' | 'custom'>('mes');
  const [inicio, setInicio] = useState(mesRange(0).inicio);
  const [fim, setFim] = useState(mesRange(0).fim);
  const [dre, setDre] = useState<Dre | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const aplicarPeriodo = (p: typeof periodo) => {
    setPeriodo(p);
    if (p === 'mes')      { const r = mesRange(0); setInicio(r.inicio); setFim(r.fim); }
    if (p === 'anterior') { const r = mesRange(1); setInicio(r.inicio); setFim(r.fim); }
    if (p === 'ano')      { const r = anoRange();  setInicio(r.inicio); setFim(r.fim); }
  };

  const carregar = useCallback(async () => {
    if (!supabase) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('gerar_dre', {
      p_filial: filial, p_inicio: inicio, p_fim: fim,
    });
    if (error) {
      setErro(/gerar_dre|schema cache/i.test(error.message)
        ? 'O DRE ainda não foi liberado nesta turma (migração 425 pendente).'
        : error.message);
      setDre(null);
    } else {
      const d = data as any;
      setDre({
        ...d,
        despesas_grupos: (d?.despesas_grupos ?? []).map((g: any) => ({ grupo: g.grupo, valor: Number(g.valor ?? 0) })),
        consumo_material:   Number(d?.consumo_material ?? 0),
        consumos_sem_custo: Number(d?.consumos_sem_custo ?? 0),
      });
    }
    setCarregando(false);
  }, [filial, inicio, fim]);

  useEffect(() => { carregar(); }, [carregar]);

  const rotuloPeriodo = periodo === 'mes' ? mesRange(0).rotulo
    : periodo === 'anterior' ? mesRange(1).rotulo
    : periodo === 'ano' ? anoRange().rotulo
    : `${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`;

  // Linhas do demonstrativo. `nivel` controla o peso visual: subtotal pesa mais
  // que a linha que o compõe, e é isso que faz o relatório ser lido de cima
  // para baixo sem legenda.
  const linhas = !dre ? [] : [
    { rotulo: 'Receita bruta de vendas',     valor: dre.receita_bruta,   nivel: 'item' as const },
    { rotulo: '(−) Descontos e cupons',      valor: -dre.descontos,      nivel: 'item' as const },
    { rotulo: '(−) Devoluções de venda',     valor: -dre.devolucoes,     nivel: 'item' as const },
    { rotulo: '= Receita líquida',           valor: dre.receita_liquida, nivel: 'subtotal' as const },
    { rotulo: '(−) CMV — custo da mercadoria vendida', valor: -dre.cmv,  nivel: 'item' as const },
    { rotulo: '= Lucro bruto',               valor: dre.lucro_bruto,     nivel: 'subtotal' as const,
      extra: dre.margem_bruta_pct !== null ? `margem ${dre.margem_bruta_pct}%` : undefined },
    { rotulo: '(−) Despesas operacionais',   valor: -dre.despesas,       nivel: 'item' as const,
      extra: Number(dre.consumo_material ?? 0) > 0
        ? `inclui ${brl(Number(dre.consumo_material))} de material de consumo` : undefined },
    { rotulo: '= Resultado do período',      valor: dre.resultado,       nivel: 'total' as const,
      extra: dre.margem_liquida_pct !== null ? `margem ${dre.margem_liquida_pct}%` : undefined },
  ];

  const exportCols = ['Linha', 'Valor (R$)'];
  const exportRows = () => [
    ...linhas.map(l => [l.rotulo, l.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })]),
    ['', ''],
    ['Despesas por grupo', ''],
    ...(dre?.despesas_grupos ?? []).map(g => [g.grupo, g.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })]),
  ];
  const titulo = `DRE — ${filial} — ${rotuloPeriodo}`;
  const slug = `logmax-dre-${filial.toLowerCase()}-${inicio}`;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">DRE — {filial}</h2>
        </div>
        <div className="flex gap-2 items-center">
          {dre && (
            <>
              <ExportButton label="PDF" onClick={() => exportToPDF(titulo, exportCols, exportRows(), slug)} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('DRE', exportCols, exportRows(), slug)} icon={Sheet} />
            </>
          )}
          <button onClick={carregar} title="Recalcular"
            className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent">
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 shrink-0">
        {([['mes', 'Mês atual'], ['anterior', 'Mês anterior'], ['ano', 'Ano'], ['custom', 'Período']] as const).map(([id, label]) => (
          <button key={id} onClick={() => aplicarPeriodo(id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${periodo === id ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            {label}
          </button>
        ))}
        {periodo === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" className="neu-input py-2 px-3 rounded-xl text-xs" value={inicio} onChange={e => setInicio(e.target.value)} />
            <span className="text-xs text-gray-500">até</span>
            <input type="date" className="neu-input py-2 px-3 rounded-xl text-xs" value={fim} onChange={e => setFim(e.target.value)} />
          </div>
        )}
      </div>

      {carregando ? <LoadingSpinner />
        : erro ? <EmptyState message={erro} />
        : !dre ? <EmptyState message="Sem dados para o período." />
        : (
        <div className="flex flex-col lg:flex-row gap-6 mb-6">
          {/* Demonstrativo */}
          <div className="neu-flat rounded-3xl p-6 border border-white/5 flex-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-4">{rotuloPeriodo}</p>
            <div className="flex flex-col">
              {linhas.map((l, i) => {
                const negativo = l.valor < 0;
                const cor = l.nivel === 'total'
                  ? (l.valor >= 0 ? 'text-emerald-400' : 'text-red-400')
                  : l.nivel === 'subtotal' ? 'text-gray-100' : (negativo ? 'text-gray-400' : 'text-gray-200');
                return (
                  <div key={i}
                    className={`flex items-baseline justify-between gap-4 py-2.5 ${
                      l.nivel === 'item' ? 'border-b border-white/5 pl-4' : 'border-b border-white/10'} ${
                      l.nivel === 'total' ? 'mt-2 pt-4 border-t-2 border-b-0 border-accent/30' : ''}`}>
                    <span className={`${l.nivel === 'item' ? 'text-xs text-gray-400' : l.nivel === 'total' ? 'text-sm font-black text-gray-100' : 'text-sm font-bold text-gray-200'}`}>
                      {l.rotulo}
                      {l.extra && <span className="ml-2 text-[10px] font-normal text-gray-500">{l.extra}</span>}
                    </span>
                    <span className={`font-mono tabular-nums shrink-0 ${l.nivel === 'total' ? 'text-lg font-black' : l.nivel === 'subtotal' ? 'text-sm font-bold' : 'text-xs'} ${cor}`}>
                      {brl(l.valor)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 mt-4">
              {dre.resultado >= 0
                ? <TrendingUp size={14} className="text-emerald-400" />
                : <TrendingDown size={14} className="text-red-400" />}
              <span className="text-xs text-gray-400">
                {dre.resultado >= 0
                  ? 'A unidade fechou o período no positivo.'
                  : 'A unidade gastou mais do que ganhou no período.'}
              </span>
            </div>

            {dre.itens_sem_custo > 0 && (
              <p className="text-[11px] text-amber-400/90 mt-3 flex items-start gap-1.5">
                <TriangleAlert size={12} className="shrink-0 mt-0.5" />
                {dre.itens_sem_custo} de {dre.itens_vendidos} itens vendidos não têm custo carimbado
                (venda anterior ao controle) — entraram no CMV pelo custo atual do produto.
              </p>
            )}
          </div>

          {/* Despesas por grupo */}
          <div className="neu-flat rounded-3xl p-6 border border-white/5 lg:w-80 shrink-0">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-4">Despesas por grupo</p>
            {dre.despesas_grupos.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma despesa no período.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dre.despesas_grupos.map(g => {
                  const pct = dre.despesas > 0 ? (g.valor / dre.despesas) * 100 : 0;
                  const naoClassificado = g.grupo === 'Não classificado';
                  return (
                    <div key={g.grupo} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-xs ${naoClassificado ? 'text-amber-400' : 'text-gray-300'}`}>{g.grupo}</span>
                        <span className="text-xs font-mono tabular-nums text-gray-200">{brl(g.valor)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full ${naoClassificado ? 'bg-amber-400/60' : 'bg-accent/60'}`}
                          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {dre.despesas_grupos.some(g => g.grupo === 'Não classificado') && (
              <p className="text-[11px] text-gray-500 mt-4 leading-snug">
                Despesa sem grupo aparece aqui até alguém decidir onde ela entra. Classifique em
                <span className="text-gray-300 font-semibold"> Financeiro → Centros de Custo</span>.
              </p>
            )}
            <p className="text-[10px] text-gray-600 mt-4 leading-snug">
              Compra de mercadoria não entra como despesa: ela vira estoque e só afeta o resultado
              pelo CMV, quando o produto é vendido.
            </p>
            {/* Migr. 442. A outra ponta da mesma regra: material de consumo
                também não é despesa na compra, é despesa quando sai do
                almoxarifado — e é aqui que a turma vê isso acontecer. */}
            {Number(dre.consumo_material ?? 0) > 0 && (
              <p className="text-[10px] text-gray-600 mt-2 leading-snug">
                Material de consumo entra pelo valor que <span className="text-gray-400">saiu do almoxarifado</span> no
                período ({brl(Number(dre.consumo_material))}), pelo custo médio, no centro de custo de quem requisitou.
              </p>
            )}
            {Number(dre.consumos_sem_custo ?? 0) > 0 && (
              <p className="text-[11px] text-amber-400/90 mt-2 flex items-start gap-1.5">
                <TriangleAlert size={12} className="shrink-0 mt-0.5" />
                {dre.consumos_sem_custo} saída(s) de material sem custo apurado entraram por R$ 0,00 —
                o produto nunca foi comprado pelo fluxo de Compras.
              </p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export const DREView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O resultado do período" />;
  return <DREViewInner showToast={showToast} filial={filialAtiva} />;
};
