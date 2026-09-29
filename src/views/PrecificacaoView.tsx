// Precificação (migr. 656) — Financeiro › Precificação.
//
// Tudo o que forma o preço de venda, numa tela só:
//   • faixa do topo — os quatro números de que o preço depende (Simples,
//     taxas, despesas e a soma), visíveis em qualquer aba;
//   • Simulador — um custo qualquer, o preço pelo markup divisor ao lado do
//     que daria a conta antiga (multiplicador). Abre por padrão: é a aba que
//     ensina;
//   • Lucro por categoria — o lucro líquido desejado, que só se edita aqui;
//   • Tributação — regime, RBT12, faixa e a origem de taxas e despesas, com os
//     valores manuais atrás de um botão (são exceção, não rotina).
//
// A composição do preço de cada produto continua no cadastro de produto,
// que é onde o preço é digitado; o imposto realizado aparece no DRE.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Save, Calculator, Tags, Landmark, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { useParametrosPrecificacao } from '../hooks/useParametrosPrecificacao';
import { ComposicaoPreco } from '../components/produtos/ComposicaoPreco';
import { SelecioneUnidade, LoadingSpinner, EmptyState, CardContador, AbaComContador, SecaoFormulario } from '../components/ui';
import { formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';
import {
  composicaoDoPreco, deducoesDe, fmtPct, markupDivisor, markupEquivalente,
  precoPorMarkup, precoPorMarkupDivisor,
  type Deducoes, type OrigemPercentual, type ParametrosPrecificacao,
} from '../lib/precificacao';

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctTexto = (v: any) => v == null || v === '' ? '' : String(v).replace('.', ',');
const textoPct = (t: string): number | null => t.trim() === '' ? null : Number(t.replace(',', '.'));
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const mesCurto = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
};

const origemCurta = (o: OrigemPercentual, p: ParametrosPrecificacao) =>
  o === 'manual' ? 'valor manual'
  : o === 'historico' ? `média ${mesCurto(p.janela_inicio)}–${mesCurto(p.janela_fim)}`
  : 'sem histórico: conta 0%';

const origemLonga = (o: OrigemPercentual, p: ParametrosPrecificacao) =>
  o === 'manual' ? 'informado manualmente'
  : o === 'historico' ? `histórico de ${dataBR(p.janela_inicio)} a ${dataBR(p.janela_fim)}`
  : `sem venda entre ${dataBR(p.janela_inicio)} e ${dataBR(p.janela_fim)} — conta como 0%`;

const RBT12_ORIGEM: Record<ParametrosPrecificacao['rbt12_origem'], (meses: number | null) => string> = {
  manual:        () => 'informado manualmente',
  primeiro_mes:  () => '1º mês de atividade (ou sem venda ainda): receita do mês × 12',
  proporcional:  (n) => `início de atividade: média ${n === 1 ? 'do mês anterior' : `dos ${n} meses anteriores`} × 12`,
  '12_meses':    () => 'receita bruta dos 12 meses anteriores',
};

// ── Faixa do topo ────────────────────────────────────────────────────────────
// As cores repetem as da barra de composição do preço (âmbar = imposto,
// azul = taxas, roxo = despesas): o aluno liga o card à fatia sem legenda.
function FaixaDeducoes({ p, d }: { p: ParametrosPrecificacao; d: Deducoes }) {
  const soma = d.impostos + d.taxas + d.despesas;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <CardContador label="Simples Nacional" tom="amarelo" corFixa value={fmtPct(d.impostos, 2)}
        sub={`faixa ${p.faixa} · alíquota efetiva`} />
      <CardContador label="Taxas de cartão" tom="azul" value={fmtPct(d.taxas)} sub={origemCurta(p.taxas_origem, p)} />
      <CardContador label="Despesas da loja" tom="roxo" value={fmtPct(d.despesas)} sub={origemCurta(p.despesas_origem, p)} />
      <CardContador label="Antes do lucro" tom={soma >= 100 ? 'vermelho' : 'dourado'} corFixa value={fmtPct(soma, 2)}
        sub={soma >= 100 ? 'nenhum preço paga a conta' : `lucro pode ir até ${fmtPct(100 - soma)}`} />
    </div>
  );
}

// ── Aba Simulador ────────────────────────────────────────────────────────────
function AbaSimulador({ p, d }: { p: ParametrosPrecificacao; d: Deducoes }) {
  const [custo, setCusto] = useState('10,00');
  const [lucro, setLucro] = useState('10');
  const c = parseBRL(custo);
  const l = textoPct(lucro) ?? 0;
  const soma = d.impostos + d.taxas + d.despesas + l;
  const pvDivisor = precoPorMarkupDivisor(c, d, l);
  // A conta antiga: as mesmas fatias somadas como markup sobre o custo.
  const pvMult = c > 0 ? precoPorMarkup(c, soma) : null;
  const compMult = pvMult ? composicaoDoPreco(pvMult, c, d) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-500/30 p-4 flex flex-col gap-1">
              <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold">Markup divisor</span>
              <span className="text-2xl font-black text-gray-100 tabular-nums">{pvDivisor === null ? '—' : brl(pvDivisor)}</span>
              <span className="text-[11px] text-gray-400 font-mono">{brl(c)} ÷ (1 − {fmtPct(soma, 2)})</span>
              <span className="text-[11px] text-gray-500 leading-snug">
                {pvDivisor === null ? 'As fatias somam 100% ou mais: nenhum preço paga esta conta.' : `Sobra exatamente ${fmtPct(l)} de lucro.`}
              </span>
            </div>
            <div className="rounded-2xl border border-red-500/30 p-4 flex flex-col gap-1">
              <span className="text-[10px] text-red-400 uppercase tracking-widest font-bold">Multiplicador (conta antiga)</span>
              <span className="text-2xl font-black text-gray-100 tabular-nums">{pvMult === null ? '—' : brl(pvMult)}</span>
              <span className="text-[11px] text-gray-400 font-mono">{brl(c)} × (1 + {fmtPct(soma, 2)})</span>
              {compMult && (
                <span className={`text-[11px] leading-snug ${compMult.lucro >= 0 ? 'text-gray-500' : 'text-red-400'}`}>
                  Lucro real {brl(compMult.lucro)} ({fmtPct(compMult.lucroPct)}), não {fmtPct(l)}: imposto, taxas e despesas
                  incidem sobre o preço, não sobre o custo.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {c > 0 && pvDivisor !== null
        ? <div className="-mt-4"><ComposicaoPreco custo={c} venda={pvDivisor} params={p} lucroAlvo={l} /></div>
        : <p className="text-xs text-gray-500">Informe um custo para ver a composição do preço.</p>}
    </div>
  );
}

// ── Aba Lucro por categoria ──────────────────────────────────────────────────
function AbaLucroCategorias({ categorias, isLoading, reload, d, showToast }: {
  categorias: any[]; isLoading: boolean; reload: () => void; d: Deducoes; showToast: any;
}) {
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

  if (isLoading) return <LoadingSpinner />;
  if (categorias.length === 0) return <EmptyState message="Nenhuma categoria ativa nesta unidade." />;

  return (
    <div className="flex flex-col gap-4">
      {/* O salvar fica em cima: com 17 linhas, embaixo ele sumia da tela de
          quem acabou de editar a primeira. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-gray-400 leading-snug max-w-2xl">
          Quanto a categoria quer que <span className="text-gray-200">sobre do preço</span> depois de custo, imposto, taxas e despesas.
          O markup é consequência da conta. Vazio = produto sem preço sugerido.
        </p>
        <button onClick={salvar} disabled={salvando || alteradas.length === 0}
          className="btn-solido btn-solido--verde !py-2 !px-4 !text-xs flex items-center gap-2 disabled:opacity-40 disabled:cursor-default">
          <Save size={13} />
          {salvando ? 'Salvando…' : alteradas.length ? `Salvar ${alteradas.length} alteraç${alteradas.length > 1 ? 'ões' : 'ão'}` : 'Salvar'}
        </button>
      </div>

      <div className="overflow-x-auto">
      <table className="tabela w-full text-left border-collapse text-xs">
        <thead>
          <tr>
            <th>Categoria</th>
            <th><span className="sm:hidden">Lucro</span><span className="hidden sm:inline">Lucro desejado</span></th>
            <th className="hidden sm:table-cell">Divisor</th>
            <th className="hidden sm:table-cell">Markup s/ custo</th>
            <th><span className="sm:hidden">R$ 100 →</span><span className="hidden sm:inline">Custo R$ 100 vira</span></th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((c: any) => {
            const l = textoPct(edicao[c.id] ?? '');
            const valido = l !== null && l < 100;
            const div = valido ? markupDivisor(d, l) : null;
            const mk = valido ? markupEquivalente(d, l) : null;
            const pv = valido ? precoPorMarkupDivisor(100, d, l) : null;
            const impossivel = l !== null && div === null;
            const alterada = (edicao[c.id] ?? '') !== pctTexto(c.lucro_alvo);
            return (
              <tr key={c.id}>
                <td className="py-2">
                  <span className="text-gray-200"><span className="mr-1.5">{c.icone ?? '📦'}</span>{c.nome}</span>
                  {div !== null && (
                    <span className="sm:hidden block text-[10px] text-gray-500 tabular-nums mt-0.5">
                      ÷ {div.toFixed(4).replace('.', ',')} · markup {fmtPct(mk)}
                    </span>
                  )}
                </td>
                <td className="py-1.5">
                  <div className="relative inline-block">
                    <input className={`neu-input py-1.5 pl-3 pr-7 rounded-lg w-16 sm:w-20 text-xs text-center tabular-nums ${alterada ? 'ring-1 ring-emerald-500/60' : ''}`}
                      inputMode="decimal" value={edicao[c.id] ?? ''} aria-label={`Lucro desejado de ${c.nome}`}
                      onChange={e => setEdicao(x => ({ ...x, [c.id]: e.target.value.replace(/[^0-9,.]/g, '') }))} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600">%</span>
                  </div>
                </td>
                <td className="hidden sm:table-cell tabular-nums text-gray-400">{div === null ? '' : div.toFixed(4).replace('.', ',')}</td>
                <td className="hidden sm:table-cell tabular-nums text-gray-300">{mk === null ? '' : fmtPct(mk)}</td>
                <td className={`tabular-nums whitespace-nowrap ${impossivel ? 'text-red-400' : 'text-gray-100 font-semibold'}`}>
                  {impossivel ? 'impossível' : pv === null ? '' : brl(pv)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Aba Tributação ───────────────────────────────────────────────────────────
function Linha({ rotulo, valor, nota }: { rotulo: string; valor: React.ReactNode; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-white/5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs text-gray-300">{rotulo}</p>
        {nota && <p className="text-[10px] text-gray-500 leading-snug">{nota}</p>}
      </div>
      <span className="text-sm font-bold text-gray-100 tabular-nums whitespace-nowrap">{valor}</span>
    </div>
  );
}

function AbaTributacao({ p, salvar, showToast }: {
  p: ParametrosPrecificacao;
  salvar: (m: { rbt12: number | null; despesas_pct: number | null; taxas_pct: number | null }) => Promise<void>;
  showToast: any;
}) {
  const m = p.manual;
  const temManual = !!m && (m.rbt12 != null || m.despesas_pct != null || m.taxas_pct != null);
  const [ajustando, setAjustando] = useState(temManual);
  const [rbt12, setRbt12] = useState('');
  const [despesas, setDespesas] = useState('');
  const [taxas, setTaxas] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setRbt12(m?.rbt12 == null ? '' : formatBRL(m.rbt12));
    setDespesas(pctTexto(m?.despesas_pct));
    setTaxas(pctTexto(m?.taxas_pct));
  }, [m?.rbt12, m?.despesas_pct, m?.taxas_pct]);

  const handleSalvar = async () => {
    const dv = textoPct(despesas), tv = textoPct(taxas);
    for (const v of [dv, tv]) {
      if (v !== null && !(v >= 0 && v < 100)) { showToast('Percentual precisa ficar entre 0 e 99,99.', 'error'); return; }
    }
    setSalvando(true);
    try {
      await salvar({ rbt12: rbt12.trim() === '' ? null : parseBRL(rbt12), despesas_pct: dv, taxas_pct: tv });
      showToast('Parâmetros de preço salvos.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Não foi possível salvar.', 'error');
    } finally { setSalvando(false); }
  };

  const formulaAliquota = p.rbt12 && p.rbt12 > 0
    ? `(${brl(p.rbt12)} × ${fmtPct(p.aliquota_nominal, 2)} − ${brl(p.parcela_deduzir)}) ÷ ${brl(p.rbt12)}`
    : 'sem faturamento, vale a alíquota nominal da 1ª faixa';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <SecaoFormulario titulo="Simples Nacional — Anexo I (comércio)" icon={Landmark} cor="amareloEscuro">
        <Linha rotulo="Faturamento 12 meses (RBT12)" valor={p.rbt12 == null ? '—' : brl(p.rbt12)}
          nota={RBT12_ORIGEM[p.rbt12_origem](p.rbt12_meses)} />
        <Linha rotulo={`Faixa ${p.faixa}`} valor={`${fmtPct(p.aliquota_nominal, 2)} nominal`}
          nota={`parcela a deduzir ${brl(p.parcela_deduzir)}`} />
        <Linha rotulo="Alíquota efetiva" valor={fmtPct(p.aliquota_efetiva, 2)} nota={formulaAliquota} />
        {p.acima_do_teto && (
          <p className="text-[11px] text-amber-400 flex items-start gap-1.5 mt-2">
            <TriangleAlert size={12} className="shrink-0 mt-0.5" />
            Acima de R$ 4,8 milhões em 12 meses a empresa sai do Simples Nacional.
          </p>
        )}
      </SecaoFormulario>

      <SecaoFormulario titulo="Taxas e despesas" icon={SlidersHorizontal} cor="roxo"
        extra={p.pode_editar && (
          <button type="button" onClick={() => setAjustando(a => !a)} className="underline underline-offset-2">
            {ajustando ? 'Fechar ajuste' : 'Ajustar manualmente'}
          </button>
        )}>
        <Linha rotulo="Taxas de cartão" valor={fmtPct(p.taxas_pct ?? 0)} nota={origemLonga(p.taxas_origem, p)} />
        <Linha rotulo="Despesas da loja" valor={fmtPct(p.despesas_pct ?? 0)} nota={origemLonga(p.despesas_origem, p)} />
        <p className="text-[10px] text-gray-500 leading-snug mt-2">
          Taxas = o que a maquininha reteve na conciliação ÷ faturamento. Despesas = despesas do DRE sem essas taxas ÷ faturamento.
          Janela: os 3 últimos meses fechados.
        </p>

        {p.pode_editar && ajustando && (
          <div className="border-t border-white/10 mt-4 pt-4 flex flex-col gap-3">
            <p className="text-[11px] text-gray-400 leading-snug">
              Para filial nova sem histórico, ou para simular outra faixa. Preenchido vence o histórico; vazio devolve a ele.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Faturamento 12 meses (R$)</span>
                <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                  value={rbt12} onChange={e => setRbt12(e.target.value === '' ? '' : formatBRL(e.target.value))}
                  onKeyDown={handleMoneyKeyDown} placeholder="Histórico" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Taxas de cartão (%)</span>
                <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                  value={taxas} onChange={e => setTaxas(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Histórico" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Despesas da loja (%)</span>
                <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                  value={despesas} onChange={e => setDespesas(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Histórico" />
              </label>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSalvar} disabled={salvando}
                className="btn-solido btn-solido--verde !py-2 !px-4 !text-xs flex items-center gap-2 disabled:opacity-50">
                <Save size={13} /> {salvando ? 'Salvando…' : 'Salvar parâmetros'}
              </button>
            </div>
          </div>
        )}
      </SecaoFormulario>
    </div>
  );
}

// ── Tela ─────────────────────────────────────────────────────────────────────
type Aba = 'simulador' | 'lucro' | 'tributacao';

const PrecificacaoViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const { params, erro, carregando, salvar } = useParametrosPrecificacao(filial);
  const { data, isLoading, reload } = useFetchData<any>('categorias_produto', { filial });
  const [aba, setAba] = useState<Aba>('simulador');

  const categorias = useMemo(
    () => data.filter((c: any) => c.ativo !== false && !c.excluido_em)
      .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    [data]);
  const semLucro = categorias.filter((c: any) => c.lucro_alvo == null).length;

  if (erro) return <EmptyState message={erro} />;
  if (!params) return carregando ? <LoadingSpinner /> : null;
  const d = deducoesDe(params);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 pb-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Precificação — {filial}</h2>
        <p className="text-[11px] text-gray-400 mt-1 font-mono">
          preço = custo ÷ (1 − {fmtPct(d.impostos, 2)} imposto − {fmtPct(d.taxas)} taxas − {fmtPct(d.despesas)} despesas − lucro%)
        </p>
      </div>

      <FaixaDeducoes p={params} d={d} />

      <div role="tablist" className="flex flex-wrap gap-3">
        <AbaComContador label="Simulador" cor="roxo" icon={Calculator} ativa={aba === 'simulador'} onClick={() => setAba('simulador')} />
        <AbaComContador label="Categorias" cor="dourado" icon={Tags} ativa={aba === 'lucro'} onClick={() => setAba('lucro')}
          n={isLoading ? undefined : semLucro} title="Lucro líquido desejado por categoria. O número ao lado: categorias sem lucro definido — produto delas fica sem preço sugerido" />
        <AbaComContador label="Tributação" cor="azul" icon={Landmark} ativa={aba === 'tributacao'} onClick={() => setAba('tributacao')} />
      </div>

      <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5">
        {aba === 'simulador' && <AbaSimulador p={params} d={d} />}
        {aba === 'lucro' && <AbaLucroCategorias categorias={categorias} isLoading={isLoading} reload={reload} d={d} showToast={showToast} />}
        {aba === 'tributacao' && <AbaTributacao key={filial} p={params} salvar={salvar} showToast={showToast} />}
      </div>
    </motion.div>
  );
};

export const PrecificacaoView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A formação de preço" />;
  return <PrecificacaoViewInner showToast={showToast} filial={filialAtiva} />;
};
