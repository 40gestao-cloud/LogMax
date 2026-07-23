import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, FilialBadge, LoadingSpinner } from '../components/ui';
import { CRITERIOS_MATRIZ, ESCALA_MAX } from '../lib/avaliacaoCriterios';
import { FILIAIS_OP, type Ciclo } from './AvaliacoesView';

type PainelRow = {
  filial: string;
  eixo: string;
  nota_subjetiva: number | null;
  metrica_valor: number | null;
  metrica_label: string | null;
};

// Painel Comparativo dos 7 Eixos — antes vivia na aba Padrão (bloco B2 de
// AvaliacoesView). Migrado pra Competição do Conselho porque cruza notas
// subjetivas do conselho com métricas objetivas do sistema no período do
// ciclo Matriz, formando o retrato analítico das filiais em competição.
// Self-contained: carrega o próprio ciclo Matriz aberto + RPC dedicada.
export function PainelComparativoEixos({ showToast }: { showToast: any }) {
  const [ciclo, setCiclo]   = useState<Ciclo | null>(null);
  const [painel, setPainel] = useState<PainelRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data: cs } = await supabase
      .from('ciclos_avaliacao')
      .select('*')
      .eq('status', 'Aberto')
      .eq('filial', 'Matriz')
      .order('data_inicio', { ascending: false })
      .limit(1);
    const c = (cs?.[0] as Ciclo | undefined) ?? null;
    setCiclo(c);
    if (!c) { setPainel(null); setLoading(false); return; }
    try {
      const { data, error } = await supabase.rpc('painel_matriz_metricas', {
        p_ciclo_matriz_id: c.id,
      });
      if (error) throw error;
      setPainel((data as PainelRow[]) ?? []);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao carregar painel.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  const rankingPorEixo = useMemo(() => {
    if (!painel) return {};
    const porEixo: Record<string, { filial: string; score: number }[]> = {};
    painel.forEach(p => {
      if (!porEixo[p.eixo]) porEixo[p.eixo] = [];
      const score = p.nota_subjetiva != null ? Number(p.nota_subjetiva) : (p.metrica_valor ?? 0);
      porEixo[p.eixo].push({ filial: p.filial, score });
    });
    Object.values(porEixo).forEach(arr => arr.sort((a, b) => b.score - a.score));
    return porEixo;
  }, [painel]);

  if (!ciclo) return null;

  return (
    <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-200">Painel Comparativo dos 7 Eixos</h3>
          <span className="text-[10px] text-gray-500 font-bold">Ciclo: {ciclo.nome}</span>
        </div>
        <button
          onClick={carregar}
          disabled={loading}
          className="text-[10px] text-gray-500 hover:text-accent font-bold uppercase tracking-widest flex items-center gap-1"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <BarChart3 size={11} />}
          Recarregar
        </button>
      </div>
      <p className="text-[11px] text-gray-500 mb-4">
        Notas subjetivas do avaliador (0-10) + métricas objetivas coletadas do sistema no período do ciclo.
        Ranking por eixo destaca a filial líder em cada critério.
      </p>

      {loading && !painel ? (
        <LoadingSpinner />
      ) : !painel || painel.length === 0 ? (
        <EmptyState message="Sem dados do painel. Avalie ao menos uma filial ou aguarde geração de vendas/contas no período." />
      ) : (() => {
        const totaisPorFilial: Record<string, number> = {};
        const vitoriasPorFilial: Record<string, number> = {};
        FILIAIS_OP.forEach(f => { totaisPorFilial[f] = 0; vitoriasPorFilial[f] = 0; });
        CRITERIOS_MATRIZ.criterios.forEach(eixo => {
          const rank = rankingPorEixo[eixo] ?? [];
          const lider = rank[0];
          if (lider && lider.score > 0) vitoriasPorFilial[lider.filial] = (vitoriasPorFilial[lider.filial] ?? 0) + 1;
          painel.filter(p => p.eixo === eixo).forEach(p => {
            const s = p.nota_subjetiva != null ? Number(p.nota_subjetiva) : (p.metrica_valor ?? 0);
            totaisPorFilial[p.filial] = (totaisPorFilial[p.filial] ?? 0) + s;
          });
        });
        const totalRank = FILIAIS_OP
          .map(f => ({ filial: f, total: totaisPorFilial[f] }))
          .sort((a, b) => b.total - a.total);
        const liderGeral = totalRank[0]?.total > 0 ? totalRank[0].filial : null;
        const posGeral: Record<string, number> = {};
        totalRank.forEach((r, i) => { posGeral[r.filial] = i + 1; });
        const MEDALHA = ['🥇', '🥈', '🥉'];

        return (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-3">Eixo</th>
                  {FILIAIS_OP.map(f => (
                    <th key={f} className="pb-3 font-bold px-3 text-center">
                      <FilialBadge filial={f} />
                    </th>
                  ))}
                  <th className="pb-3 font-bold px-3 text-center">Líder</th>
                </tr>
              </thead>
              <tbody>
                {CRITERIOS_MATRIZ.criterios.map(eixo => {
                  const linhaPorFilial: Record<string, PainelRow | undefined> = {};
                  painel.filter(p => p.eixo === eixo).forEach(p => { linhaPorFilial[p.filial] = p; });
                  const rank = rankingPorEixo[eixo] ?? [];
                  const lider = rank[0];
                  const posPorFilial: Record<string, number> = {};
                  rank.forEach((r, i) => { posPorFilial[r.filial] = i + 1; });
                  const label = linhaPorFilial[FILIAIS_OP[0]]?.metrica_label ?? null;
                  return (
                    <tr key={eixo} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-3 px-3 font-semibold text-gray-200">
                        {eixo}
                        {label && <span className="block text-[9px] text-gray-500 font-normal mt-0.5">{label}</span>}
                      </td>
                      {FILIAIS_OP.map(f => {
                        const cell = linhaPorFilial[f];
                        const isLider = lider && lider.filial === f && lider.score > 0;
                        const pos = posPorFilial[f];
                        const nota = cell?.nota_subjetiva;
                        const metrica = cell?.metrica_valor;
                        const notaN = nota != null ? Number(nota) : null;
                        const intensity = notaN != null ? Math.max(0, Math.min(1, notaN / ESCALA_MAX)) : 0;
                        return (
                          <td key={f} className={`py-2 px-2 text-center tabular-nums ${isLider ? 'text-accent font-black' : 'text-gray-300'}`}>
                            <div className="relative rounded-lg overflow-hidden px-2 py-2">
                              {notaN != null && (
                                <div
                                  className="absolute inset-0 pointer-events-none"
                                  style={{
                                    background: `linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent) ${intensity * 100}%, transparent ${intensity * 100}%)`,
                                    opacity: isLider ? 0.22 : 0.10,
                                  }}
                                />
                              )}
                              <div className="relative">
                                {notaN != null && (
                                  <div className="flex items-center justify-center gap-1">
                                    {pos && pos <= 3 && lider && lider.score > 0 && (
                                      <span className="text-[10px] leading-none" title={`${pos}º lugar`}>{MEDALHA[pos - 1]}</span>
                                    )}
                                    <span>{notaN.toFixed(1)}<span className="text-[9px] text-gray-500">/10</span></span>
                                  </div>
                                )}
                                {metrica != null && (
                                  <div className="text-[10px] text-gray-500 font-mono">
                                    {label?.startsWith('R$') || label?.includes('(R$)')
                                      ? `R$ ${Number(metrica).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : label?.includes('(%)')
                                      ? `${Number(metrica).toFixed(1)}%`
                                      : Number(metrica).toLocaleString('pt-BR')}
                                  </div>
                                )}
                                {nota == null && metrica == null && <span className="text-gray-600">—</span>}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-3 px-3 text-center">
                        {lider && lider.score > 0 ? (
                          <span className="inline-flex items-center gap-1"><span className="text-xs">🥇</span><FilialBadge filial={lider.filial} /></span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-white/10 bg-white/[0.03]">
                  <td className="py-3 px-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Total (0-70)
                    <span className="block text-[9px] text-gray-600 font-normal normal-case tracking-normal mt-0.5">
                      Soma dos 7 eixos · vitórias por eixo
                    </span>
                  </td>
                  {FILIAIS_OP.map(f => {
                    const total = totaisPorFilial[f] ?? 0;
                    const vits = vitoriasPorFilial[f] ?? 0;
                    const pos = posGeral[f];
                    const isLiderGeral = liderGeral === f;
                    return (
                      <td key={f} className={`py-3 px-3 text-center tabular-nums ${isLiderGeral ? 'text-accent font-black' : 'text-gray-300 font-bold'}`}>
                        <div className="flex items-center justify-center gap-1">
                          {pos && liderGeral && <span className="text-[11px] leading-none">{MEDALHA[pos - 1]}</span>}
                          <span>{total.toFixed(1)}</span>
                        </div>
                        <div className="text-[9px] text-gray-500 font-normal mt-0.5">
                          {vits} {vits === 1 ? 'vitória' : 'vitórias'}
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-center">
                    {liderGeral ? (
                      <span className="inline-flex items-center gap-1"><span className="text-xs">👑</span><FilialBadge filial={liderGeral} /></span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
