// Precificação (migr. 656) — Financeiro › Precificação.
//
// Tudo o que forma o preço de venda, numa tela só e na ordem da aula:
//   1. Tributação e parâmetros da filial — Simples (faixa e alíquota efetiva),
//      taxas de cartão e despesas da loja, em % do faturamento.
//   2. Lucro líquido desejado por categoria — e o markup que ele gera.
//   3. Simulador — um custo qualquer, o preço pelo markup divisor e o que
//      daria a conta antiga (multiplicador) com as mesmas fatias.
//
// A composição do preço de cada produto continua no cadastro de produto,
// que é onde o preço é digitado; o imposto realizado aparece no DRE.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Save, Calculator, Tags } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { useParametrosPrecificacao } from '../hooks/useParametrosPrecificacao';
import { ParametrosPrecificacaoPanel } from '../components/ParametrosPrecificacaoPanel';
import { ComposicaoPreco } from '../components/produtos/ComposicaoPreco';
import { SelecioneUnidade, LoadingSpinner } from '../components/ui';
import { formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';
import {
  composicaoDoPreco, deducoesDe, fmtPct, markupDivisor, markupEquivalente,
  precoPorMarkup, precoPorMarkupDivisor, type Deducoes,
} from '../lib/precificacao';

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctTexto = (v: any) => v == null || v === '' ? '' : String(v).replace('.', ',');
const textoPct = (t: string): number | null => t.trim() === '' ? null : Number(t.replace(',', '.'));

function LucroPorCategoria({ filial, d, showToast }: { filial: string; d: Deducoes | null; showToast: any }) {
  const { data, isLoading, reload } = useFetchData<any>('categorias_produto', { filial });
  const categorias = useMemo(
    () => data.filter((c: any) => c.ativo !== false && !c.excluido_em)
      .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    [data]);
  const [edicao, setEdicao] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setEdicao(Object.fromEntries(categorias.map((c: any) => [c.id, pctTexto(c.lucro_alvo)])));
  }, [categorias]);

  const alteradas = categorias.filter((c: any) => (edicao[c.id] ?? '') !== pctTexto(c.lucro_alvo));

  const salvar = async () => {
    for (const c of alteradas) {
      const v = textoPct(edicao[c.id] ?? '');
      if (v !== null && !(v >= 0 && v < 100)) { showToast(`${c.nome}: o lucro precisa ficar entre 0 e 99,99%.`, 'error'); return; }
    }
    setSalvando(true);
    const falharam: string[] = [];
    for (const c of alteradas) {
      try { await dbUpdate<any>('categorias_produto', c.id, { lucro_alvo: textoPct(edicao[c.id] ?? '') }); }
      catch { falharam.push(c.nome); }
    }
    setSalvando(false);
    reload();
    if (falharam.length) showToast(`Não salvou: ${falharam.join(', ')}.`, 'error');
    else showToast(`Lucro desejado salvo em ${alteradas.length} categoria${alteradas.length > 1 ? 's' : ''}.`, 'success');
  };

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Tags size={15} className="text-accent" />
        <p className="text-sm font-bold text-gray-100">Lucro líquido desejado por categoria</p>
      </div>
      <p className="text-[11px] text-gray-500 leading-snug">
        Quanto a categoria quer que <span className="text-gray-300">sobre do preço</span> depois de custo, imposto, taxas e despesas.
        O markup deixa de ser digitado: ele é consequência da conta. Vazio = produto sem preço sugerido.
      </p>

      {isLoading ? <LoadingSpinner /> : categorias.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhuma categoria ativa nesta unidade.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="text-left font-bold py-2 pr-3">Categoria</th>
                <th className="text-center font-bold py-2 px-3">Lucro desejado</th>
                <th className="text-center font-bold py-2 px-3">Divisor</th>
                <th className="text-center font-bold py-2 px-3">Markup sobre o custo</th>
                <th className="text-center font-bold py-2 pl-3">Custo R$ 100 vira</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((c: any) => {
                const l = textoPct(edicao[c.id] ?? '');
                const div = d && l !== null && l < 100 ? markupDivisor(d, l) : null;
                const mk = d && l !== null && l < 100 ? markupEquivalente(d, l) : null;
                const pv = d && l !== null && l < 100 ? precoPorMarkupDivisor(100, d, l) : null;
                const impossivel = d && l !== null && div === null;
                return (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-gray-200">
                      <span className="mr-1.5">{c.icone ?? '📦'}</span>{c.nome}
                    </td>
                    <td className="py-1.5 px-3 text-center">
                      <div className="relative inline-block">
                        <input className="neu-input py-1.5 pl-3 pr-7 rounded-lg w-24 text-xs text-center tabular-nums" inputMode="decimal"
                          value={edicao[c.id] ?? ''} placeholder="—"
                          onChange={e => setEdicao(x => ({ ...x, [c.id]: e.target.value.replace(/[^0-9,.]/g, '') }))} />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600">%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center tabular-nums text-gray-400">
                      {div === null ? '—' : div.toFixed(4).replace('.', ',')}
                    </td>
                    <td className="py-2 px-3 text-center tabular-nums text-gray-300">{fmtPct(mk)}</td>
                    <td className={`py-2 pl-3 text-center tabular-nums ${impossivel ? 'text-red-400' : 'text-gray-100 font-semibold'}`}>
                      {impossivel ? 'sem preço possível' : pv === null ? '—' : brl(pv)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {alteradas.length > 0 && (
        <div className="flex justify-end">
          <button onClick={salvar} disabled={salvando}
            className="neu-button px-4 py-2 rounded-xl text-sm font-semibold text-accent flex items-center gap-2 disabled:opacity-50">
            <Save size={14} /> {salvando ? 'Salvando…' : `Salvar ${alteradas.length} alteraç${alteradas.length > 1 ? 'ões' : 'ão'}`}
          </button>
        </div>
      )}
    </div>
  );
}

function Simulador({ params }: { params: NonNullable<ReturnType<typeof useParametrosPrecificacao>['params']> }) {
  const [custo, setCusto] = useState('10,00');
  const [lucro, setLucro] = useState('10');
  const d = deducoesDe(params);
  const c = parseBRL(custo);
  const l = textoPct(lucro) ?? 0;
  const soma = d.impostos + d.taxas + d.despesas + l;
  const pvDivisor = precoPorMarkupDivisor(c, d, l);
  // A conta antiga: as mesmas fatias somadas como markup sobre o custo.
  const pvMult = c > 0 ? precoPorMarkup(c, soma) : null;
  const compMult = pvMult ? composicaoDoPreco(pvMult, c, d) : null;

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Calculator size={15} className="text-accent" />
        <p className="text-sm font-bold text-gray-100">Simulador</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-400">Custo do produto (R$)</span>
          <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
            value={custo} onChange={e => setCusto(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-400">Lucro líquido desejado (%)</span>
          <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
            value={lucro} onChange={e => setLucro(e.target.value.replace(/[^0-9,.]/g, ''))} />
        </label>
      </div>

      {c > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-500/20 p-4 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold">Markup divisor</span>
            <span className="text-2xl font-black text-gray-100 tabular-nums">{pvDivisor === null ? '—' : brl(pvDivisor)}</span>
            <span className="text-[11px] text-gray-400 font-mono">
              {brl(c)} ÷ (1 − {fmtPct(soma, 2)})
            </span>
            <span className="text-[11px] text-gray-500">
              {pvDivisor === null ? 'As fatias somam 100% ou mais: nenhum preço paga esta conta.' : `Sobra exatamente ${fmtPct(l)} de lucro.`}
            </span>
          </div>
          <div className="rounded-xl border border-red-500/20 p-4 flex flex-col gap-1">
            <span className="text-[10px] text-red-400 uppercase tracking-widest font-bold">Markup multiplicador (a conta antiga)</span>
            <span className="text-2xl font-black text-gray-100 tabular-nums">{pvMult === null ? '—' : brl(pvMult)}</span>
            <span className="text-[11px] text-gray-400 font-mono">
              {brl(c)} × (1 + {fmtPct(soma, 2)})
            </span>
            {compMult && (
              <span className={`text-[11px] ${compMult.lucro >= 0 ? 'text-gray-500' : 'text-red-400'}`}>
                Lucro real: {brl(compMult.lucro)} ({fmtPct(compMult.lucroPct)}), não {fmtPct(l)} — imposto, taxas e despesas incidem sobre o preço, não sobre o custo.
              </span>
            )}
          </div>
        </div>
      )}

      {c > 0 && pvDivisor !== null && (
        <ComposicaoPreco custo={c} venda={pvDivisor} params={params} lucroAlvo={l} />
      )}
    </div>
  );
}

const PrecificacaoViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const { params, recarregar } = useParametrosPrecificacao(filial);
  const d = params ? deducoesDe(params) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Precificação — {filial}</h2>
        <p className="text-xs text-gray-400 mt-1 font-mono">
          preço = custo ÷ (1 − imposto% − taxas% − despesas% − lucro%)
        </p>
      </div>

      <ParametrosPrecificacaoPanel key={filial} filial={filial} showToast={showToast} onSalvo={recarregar} />
      <LucroPorCategoria filial={filial} d={d} showToast={showToast} />
      {params && <Simulador params={params} />}
    </motion.div>
  );
};

export const PrecificacaoView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A formação de preço" />;
  return <PrecificacaoViewInner showToast={showToast} filial={filialAtiva} />;
};
