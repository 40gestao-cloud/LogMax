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
import { Save, Calculator, Tags, Landmark, SlidersHorizontal, TriangleAlert, Receipt, Package, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { useParametrosPrecificacao } from '../hooks/useParametrosPrecificacao';
import { ComposicaoPreco } from '../components/produtos/ComposicaoPreco';
import { SelecioneUnidade, LoadingSpinner, EmptyState, CardContador, AbaComContador, SecaoFormulario, StatusBadge } from '../components/ui';
import { formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';
import {
  composicaoDoPreco, custoDiretoTotal, deducoesDe, fmtPct, markupDivisor, markupEquivalente,
  precoPorMarkup, precoPorMarkupDivisor, somaDeducoes,
  type Deducoes, type OrigemPercentual, type ParametrosPrecificacao,
} from '../lib/precificacao';
import { ehVendavel } from '../lib/tipoProduto';

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctTexto = (v: any) => v == null || v === '' ? '' : String(v).replace('.', ',');
const textoPct = (t: string): number | null => t.trim() === '' ? null : Number(t.replace(',', '.'));
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const mesAno = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const mesCurto = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
};

const origemCurta = (o: OrigemPercentual, p: ParametrosPrecificacao) =>
  o === 'manual' ? 'valor manual'
  : o === 'historico' ? `média ${mesCurto(p.janela_inicio)}–${mesCurto(p.janela_fim)}`
  : o === 'mix' ? `mix de vendas ${mesCurto(p.janela_inicio)}–${mesCurto(p.janela_fim)}`
  : 'sem histórico: conta 0%';

const origemLonga = (o: OrigemPercentual, p: ParametrosPrecificacao) =>
  o === 'manual' ? 'informado manualmente'
  : o === 'historico' ? `histórico de ${dataBR(p.janela_inicio)} a ${dataBR(p.janela_fim)}`
  : o === 'mix' ? `vendas de ${dataBR(p.janela_inicio)} a ${dataBR(p.janela_fim)} × taxa de cada forma no cadastro`
  : `sem venda entre ${dataBR(p.janela_inicio)} e ${dataBR(p.janela_fim)} — conta como 0%`;

const RBT12_ORIGEM: Record<ParametrosPrecificacao['rbt12_origem'], (meses: number | null) => string> = {
  manual:        () => 'informado manualmente',
  primeiro_mes:  () => '1º mês de atividade (ou sem venda ainda): receita do mês × 12',
  proporcional:  (n) => `início de atividade: média ${n === 1 ? 'do mês anterior' : `dos ${n} meses anteriores`} × 12`,
  '12_meses':    () => 'receita bruta dos 12 meses anteriores',
};

// ── Faixa do topo ────────────────────────────────────────────────────────────
// As cores repetem as da barra de composição do preço (âmbar = imposto, laranja = variáveis,
// azul = taxas, roxo = despesas): o aluno liga o card à fatia sem legenda.
function FaixaDeducoes({ p, d }: { p: ParametrosPrecificacao; d: Deducoes }) {
  const soma = somaDeducoes(d);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <CardContador label="Simples Nacional" tom="amarelo" corFixa value={fmtPct(d.impostos, 2)}
        sub={p.vende_servico
          ? `faixa ${p.faixa} · serviço ${fmtPct(Number(p.aliquota_efetiva_iii), 2)}`
          : `faixa ${p.faixa} · alíquota efetiva`} />
      <CardContador label="Taxas de cartão" tom="azul" value={fmtPct(d.taxas)} sub={origemCurta(p.taxas_origem, p)} />
      <CardContador label="Despesas fixas" tom="roxo" value={fmtPct(d.despesas)} sub={origemCurta(p.despesas_origem, p)} />
      {/* Migr. 664: o que cresce junto com cada venda (comissão, embalagem). */}
      <CardContador label="Despesas variáveis" tom="laranja" corFixa value={fmtPct(d.variaveis ?? 0)}
        sub={p.variaveis_origem === 'manual' ? 'informado pela gestão' : 'não informado: conta 0%'} />
      <div className="col-span-2 lg:col-span-1">
        <CardContador label="Antes do lucro" tom={soma >= 100 ? 'vermelho' : 'dourado'} corFixa value={fmtPct(soma, 2)}
          sub={soma >= 100 ? 'nenhum preço paga a conta' : `lucro pode ir até ${fmtPct(100 - soma)}`} />
      </div>
    </div>
  );
}

// ── Aba Simulador ────────────────────────────────────────────────────────────
// Migr. 664: o custo entra aberto — o Custo Direto Total é a soma do que a
// mercadoria custou posta na loja, não um número único digitado de cabeça.
function CampoMoeda({ rotulo, nota, valor, onChange }: { rotulo: string; nota?: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-400">{rotulo}</span>
      <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
        value={valor} placeholder="0,00"
        onChange={e => onChange(e.target.value === '' ? '' : formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} />
      {nota && <span className="text-[10px] text-gray-500 leading-snug">{nota}</span>}
    </label>
  );
}

function AbaSimulador({ p, d: dMercadoria }: { p: ParametrosPrecificacao; d: Deducoes }) {
  const [valorPago, setValorPago] = useState('10,00');
  const [frete, setFrete] = useState('');
  const [impostosCompra, setImpostosCompra] = useState('');
  const [outros, setOutros] = useState('');
  const [lucro, setLucro] = useState('10');
  // Migr. 659: serviço (mão de obra) sai pela tabela do Anexo III.
  const [anexo, setAnexo] = useState<'I' | 'III'>('I');
  const servico = anexo === 'III';
  const d = servico ? deducoesDe(p, 'III') : dMercadoria;
  const partes = {
    valorPago: parseBRL(valorPago), frete: servico ? 0 : parseBRL(frete),
    impostosCompra: servico ? 0 : parseBRL(impostosCompra), outros: parseBRL(outros),
  };
  const c = custoDiretoTotal(partes);
  const l = textoPct(lucro) ?? 0;
  const soma = somaDeducoes(d) + l;
  const pvDivisor = precoPorMarkupDivisor(c, d, l);
  // A conta antiga: as mesmas fatias somadas como markup sobre o custo.
  const pvMult = c > 0 ? precoPorMarkup(c, soma) : null;
  const compMult = pvMult ? composicaoDoPreco(pvMult, c, d) : null;

  const trocarAnexo = (k: 'I' | 'III') => {
    setAnexo(k);
    // O lucro do serviço é um só para a unidade (Categorias › Serviços prestados).
    if (k === 'III' && p.lucro_servico_pct != null) setLucro(String(p.lucro_servico_pct).replace('.', ','));
  };

  const parcelas: [string, number][] = servico
    ? [['Material', partes.valorPago], ['Outros', partes.outros]]
    : [['Valor pago', partes.valorPago], ['Frete', partes.frete], ['IPI/ICMS-ST', partes.impostosCompra], ['Outros', partes.outros]];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      <div className="flex flex-col gap-4">
        {p.vende_servico && (
          <div className="flex gap-2">
            {([['I', 'Mercadoria · Anexo I'], ['III', 'Serviço · Anexo III']] as const).map(([k, rot]) => (
              <button key={k} type="button" onClick={() => trocarAnexo(k)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${anexo === k ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
                {rot}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 p-4 flex flex-col gap-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
            {servico ? 'Custo direto do serviço (por unidade)' : 'Custo Direto Total (por unidade)'}
          </p>
          {servico ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CampoMoeda rotulo="Material e mão de obra direta (R$)" nota="o que se gasta para prestar uma vez"
                valor={valorPago} onChange={setValorPago} />
              <CampoMoeda rotulo="Outros (R$)" nota="deslocamento, peça de reposição" valor={outros} onChange={setOutros} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CampoMoeda rotulo="Valor pago ao fornecedor (R$)" nota="preço da nota, já com o desconto dele"
                valor={valorPago} onChange={setValorPago} />
              <CampoMoeda rotulo="Frete (R$)" nota="da nota ou do CT-e, dividido pelas unidades"
                valor={frete} onChange={setFrete} />
              <CampoMoeda rotulo="IPI e ICMS-ST da compra (R$)" nota="no Simples não se recuperam: são custo"
                valor={impostosCompra} onChange={setImpostosCompra} />
              <CampoMoeda rotulo="Outros (R$)" nota="seguro, embalagem de compra, descarga"
                valor={outros} onChange={setOutros} />
            </div>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 pt-3">
            <span className="text-[11px] text-gray-400 font-mono">
              {parcelas.filter(([, v]) => v > 0).map(([r, v]) => `${r} ${brl(v)}`).join(' + ') || '—'}
            </span>
            <span className="text-sm font-black text-gray-100 tabular-nums">= {brl(c)}</span>
          </div>
          {!servico && (
            <p className="text-[10px] text-gray-500 leading-snug">
              No cadastro de cada produto o sistema já faz esta soma sozinho: a nota conferida e o frete lançado em
              Contas a pagar › Frete (CT-e) entram no custo médio.
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1 max-w-[16rem]">
          <span className="text-[11px] text-gray-400">Lucro líquido desejado (%)</span>
          <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
            value={lucro} onChange={e => setLucro(e.target.value.replace(/[^0-9,.]/g, ''))} />
        </label>

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
        ? <div className="-mt-4"><ComposicaoPreco custo={c} venda={pvDivisor} params={p} lucroAlvo={l} anexo={anexo}
            rotuloLucro="desejado na simulação" /></div>
        : <p className="text-xs text-gray-500">Informe o custo para ver a composição do preço.</p>}
    </div>
  );
}

// ── Aba Lucro por categoria ──────────────────────────────────────────────────
// Migr. 664: serviço prestado não tem categoria de produto — o lucro desejado
// dele é um só por unidade, e o divisor dele usa o Anexo III.
function LucroServico({ p, salvar, showToast }: {
  p: ParametrosPrecificacao; salvar: (pct: number | null) => Promise<void>; showToast: any;
}) {
  const [valor, setValor] = useState(pctTexto(p.lucro_servico_pct));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(pctTexto(p.lucro_servico_pct)); }, [p.lucro_servico_pct]);
  const l = textoPct(valor);
  const dIII = deducoesDe(p, 'III');
  const pv = l !== null && l < 100 ? precoPorMarkupDivisor(100, dIII, l) : null;
  const alterado = valor !== pctTexto(p.lucro_servico_pct);

  const gravar = async () => {
    if (l !== null && !(l >= 0 && l < 100)) { showToast('O lucro precisa ficar entre 0 e 99,99%.', 'error'); return; }
    setSalvando(true);
    try { await salvar(l); showToast('Lucro desejado dos serviços salvo.', 'success'); }
    catch (e: any) { showToast(e?.message ?? 'Não foi possível salvar.', 'error'); }
    finally { setSalvando(false); }
  };

  return (
    <div className="rounded-2xl border border-teal-500/25 p-4 flex flex-wrap items-center gap-3">
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-teal-500/10 text-teal-400"><Wrench size={16} /></span>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-xs font-bold text-gray-200">Serviços prestados</p>
        <p className="text-[10px] text-gray-500 leading-snug">
          Anexo III ({fmtPct(dIII.impostos, 2)}). Vale para todo serviço da unidade — o preço sugerido aparece no cadastro de cada serviço.
        </p>
      </div>
      <div className="relative inline-block">
        <input className={`neu-input py-1.5 pl-3 pr-7 rounded-lg w-20 text-xs text-center tabular-nums ${alterado ? 'ring-1 ring-emerald-500/60' : ''}`}
          inputMode="decimal" value={valor} disabled={!p.pode_editar} aria-label="Lucro desejado dos serviços"
          onChange={e => setValor(e.target.value.replace(/[^0-9,.]/g, ''))} />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600">%</span>
      </div>
      <span className={`text-xs tabular-nums whitespace-nowrap ${l !== null && pv === null ? 'text-red-400' : 'text-gray-300'}`}>
        {l === null ? '' : pv === null ? 'impossível' : `custo R$ 100 → ${brl(pv)}`}
      </span>
      {p.pode_editar && (
        <button onClick={gravar} disabled={salvando || !alterado}
          className="btn-solido btn-solido--verde !py-1.5 !px-3 !text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-default">
          <Save size={12} /> {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      )}
    </div>
  );
}

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

// ── Aba Produtos ─────────────────────────────────────────────────────────────
// Migr. 664: o catálogo inteiro contra a conta — preço praticado × preço que o
// markup divisor pede, e o lucro que sobra de verdade em cada um. Só leitura:
// o preço se muda no cadastro do produto, que é onde a composição aparece.
type FiltroProdutos = 'todos' | 'abaixo' | 'prejuizo' | 'sem_custo';

function AbaProdutos({ p, d, categorias, filial }: {
  p: ParametrosPrecificacao; d: Deducoes; categorias: any[]; filial: string;
}) {
  const { data, isLoading } = useFetchData<any>('/api/produtoscomcustoview', { filial });
  const [filtro, setFiltro] = useState<FiltroProdutos>('abaixo');
  const [busca, setBusca] = useState('');

  const lucroDaCategoria = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of categorias) m.set(c.id, c.lucro_alvo == null || c.lucro_alvo === '' ? null : Number(c.lucro_alvo));
    return m;
  }, [categorias]);

  const linhas = useMemo(() => (data ?? [])
    .filter((x: any) => x.ativo !== false && (x.status ?? 'Ativo') === 'Ativo' && ehVendavel(x.tipo))
    .map((x: any) => {
      const custo = x.preco_custo == null ? null : Number(x.preco_custo);
      const preco = Number(x.preco ?? 0);
      const alvo = x.categoria_id ? lucroDaCategoria.get(x.categoria_id) ?? null : null;
      const sugerido = custo && custo > 0 && alvo !== null ? precoPorMarkupDivisor(custo, d, alvo) : null;
      const comp = custo && custo > 0 && preco > 0 ? composicaoDoPreco(preco, custo, d) : null;
      return { id: x.id, nome: x.nome, codigo: x.codigo, categoria: x.categoria, custo, preco, alvo, sugerido,
               lucroPct: comp ? comp.lucroPct : null, lucro: comp ? comp.lucro : null };
    }), [data, lucroDaCategoria, d]);

  const cont = useMemo(() => ({
    todos: linhas.length,
    abaixo: linhas.filter(l => l.lucroPct !== null && l.alvo !== null && l.lucroPct < l.alvo - 0.05).length,
    prejuizo: linhas.filter(l => l.lucro !== null && l.lucro < 0).length,
    sem_custo: linhas.filter(l => !(l.custo && l.custo > 0)).length,
  }), [linhas]);

  const termo = busca.trim().toLowerCase();
  const visiveis = linhas
    .filter(l => filtro === 'todos' ? true
      : filtro === 'abaixo' ? l.lucroPct !== null && l.alvo !== null && l.lucroPct < l.alvo - 0.05
      : filtro === 'prejuizo' ? l.lucro !== null && l.lucro < 0
      : !(l.custo && l.custo > 0))
    .filter(l => !termo || String(l.nome ?? '').toLowerCase().includes(termo) || String(l.codigo ?? '').toLowerCase().includes(termo))
    .sort((a, b) => (a.lucroPct ?? Infinity) - (b.lucroPct ?? Infinity));

  if (isLoading) return <LoadingSpinner />;
  // Custo é visível ao Financeiro, Marketing e Logística (produtos_custo_select).
  const semAcessoAoCusto = linhas.length > 0 && linhas.every(l => l.custo === null);

  const FILTROS: [FiltroProdutos, string][] = [
    ['abaixo', 'Abaixo do lucro desejado'], ['prejuizo', 'No prejuízo'], ['sem_custo', 'Sem custo'], ['todos', 'Todos'],
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-gray-400 leading-snug max-w-3xl">
        Cada produto vendável da unidade: o preço que está no cadastro, o que o markup divisor pede para o lucro desejado da
        categoria, e o lucro líquido que sobra de verdade depois de custo, imposto, taxas e despesas. Para mudar o preço, abra o
        produto em Cadastros › Produtos.
      </p>
      {semAcessoAoCusto && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
          <TriangleAlert size={12} className="shrink-0 mt-0.5" />
          O custo dos produtos é visível ao Financeiro, ao Marketing e à Logística — sem ele não há lucro a calcular.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(([k, rot]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${filtro === k ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            {rot} <span className="tabular-nums opacity-60">{cont[k]}</span>
          </button>
        ))}
        <input className="neu-input py-1.5 px-3 rounded-xl text-xs ml-auto w-full sm:w-56" placeholder="Buscar…"
          value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar produto" />
      </div>

      {visiveis.length === 0 ? (
        <EmptyState message={filtro === 'abaixo' ? 'Nenhum produto abaixo do lucro desejado.' : 'Nenhum produto neste filtro.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="tabela w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="hidden sm:table-cell">Custo</th>
                <th>Preço</th>
                <th className="hidden md:table-cell">Sugerido</th>
                <th>Lucro real</th>
                <th className="hidden md:table-cell">Desejado</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(l => {
                const cor = l.lucro === null ? 'text-gray-500'
                  : l.lucro < 0 ? 'text-red-400'
                  : l.alvo !== null && (l.lucroPct ?? 0) < l.alvo - 0.05 ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <tr key={l.id}>
                    <td className="py-2">
                      <span className="text-gray-200">{l.nome}</span>
                      <span className="block text-[10px] text-gray-500">{[l.codigo, l.categoria].filter(Boolean).join(' · ') || '—'}</span>
                    </td>
                    <td className="hidden sm:table-cell tabular-nums text-gray-400 whitespace-nowrap">{l.custo && l.custo > 0 ? brl(l.custo) : '—'}</td>
                    <td className="tabular-nums text-gray-100 whitespace-nowrap">
                      {l.preco > 0 ? brl(l.preco) : '—'}
                      {l.sugerido !== null && (
                        <span className="md:hidden block text-[10px] text-gray-500">sugerido {brl(l.sugerido)}</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell tabular-nums text-gray-300 whitespace-nowrap">
                      {l.sugerido !== null ? brl(l.sugerido) : l.alvo === null ? <span className="text-gray-600">sem lucro na categoria</span> : '—'}
                    </td>
                    <td className={`tabular-nums font-semibold whitespace-nowrap ${cor}`}>
                      {l.lucroPct === null ? '—' : fmtPct(l.lucroPct)}
                      {l.lucro !== null && <span className="block text-[10px] font-normal opacity-80">{brl(l.lucro)} por unidade</span>}
                    </td>
                    <td className="hidden md:table-cell tabular-nums text-gray-400">{l.alvo === null ? '—' : fmtPct(l.alvo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {p.despesas_origem === 'sem_historico' && (
        <p className="text-[10px] text-gray-500">Sem histórico de despesas na janela: o lucro real está contando 0% de despesas fixas.</p>
      )}
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

// Migr. 657: de onde sai a taxa — participação de cada forma nas vendas e a
// taxa que o cadastro diz que ela cobra. O realizado da conciliação vai junto,
// para comparar o esperado com o que a adquirente de fato reteve.
function MixDeTaxas({ p }: { p: ParametrosPrecificacao }) {
  const itens = p.taxas_mix ?? [];
  if (itens.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[10px] text-gray-500 uppercase tracking-widest">
            <th className="text-left font-bold pb-1">Forma</th>
            <th className="text-center font-bold pb-1">Das vendas</th>
            <th className="text-center font-bold pb-1">Taxa</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(i => (
            <tr key={i.tipo} className="border-t border-white/5">
              <td className="py-1 text-gray-300">{i.tipo}</td>
              <td className="py-1 text-center tabular-nums text-gray-400">{fmtPct(i.participacao_pct)}</td>
              <td className={`py-1 text-center tabular-nums ${i.taxa_pct == null ? 'text-amber-400' : 'text-gray-200'}`}>
                {i.taxa_pct == null ? 'sem cadastro' : fmtPct(Number(i.taxa_pct), 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(p.taxas_sem_cadastro ?? []).length > 0 && (
        <p className="text-[10px] text-amber-400 leading-snug flex items-start gap-1.5">
          <TriangleAlert size={11} className="shrink-0 mt-0.5" />
          {p.taxas_sem_cadastro.join(', ')}: vendido sem forma com esse Tipo no cadastro — entra como 0%.
          Classifique em Empresa › Formas de Pagamento.
        </p>
      )}
      {p.taxas_fora_mix_pct != null && p.taxas_fora_mix_pct > 0 && (
        <p className="text-[10px] text-gray-500">{fmtPct(p.taxas_fora_mix_pct)} da receita ficou fora do mix: venda mista gravada antes de 29/09 ou forma de pagamento sem Tipo no cadastro.</p>
      )}
      {p.taxas_realizada_pct != null && (
        <p className="text-[10px] text-gray-500">
          Conferência: a maquininha reteve {fmtPct(Number(p.taxas_realizada_pct), 2)} do faturamento na conciliação do mesmo período.
        </p>
      )}
    </div>
  );
}

function AbaTributacao({ p, salvar, showToast }: {
  p: ParametrosPrecificacao;
  salvar: (m: { rbt12: number | null; despesas_pct: number | null; taxas_pct: number | null; variaveis_pct: number | null }) => Promise<void>;
  showToast: any;
}) {
  const m = p.manual;
  const temManual = !!m && (m.rbt12 != null || m.despesas_pct != null || m.taxas_pct != null || m.variaveis_pct != null);
  const [ajustando, setAjustando] = useState(temManual);
  const [rbt12, setRbt12] = useState('');
  const [despesas, setDespesas] = useState('');
  const [taxas, setTaxas] = useState('');
  const [variaveis, setVariaveis] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setRbt12(m?.rbt12 == null ? '' : formatBRL(m.rbt12));
    setDespesas(pctTexto(m?.despesas_pct));
    setTaxas(pctTexto(m?.taxas_pct));
    setVariaveis(pctTexto(m?.variaveis_pct));
  }, [m?.rbt12, m?.despesas_pct, m?.taxas_pct, m?.variaveis_pct]);

  const handleSalvar = async () => {
    const dv = textoPct(despesas), tv = textoPct(taxas), vv = textoPct(variaveis);
    for (const v of [dv, tv, vv]) {
      if (v !== null && !(v >= 0 && v < 100)) { showToast('Percentual precisa ficar entre 0 e 99,99.', 'error'); return; }
    }
    setSalvando(true);
    try {
      await salvar({ rbt12: rbt12.trim() === '' ? null : parseBRL(rbt12), despesas_pct: dv, taxas_pct: tv, variaveis_pct: vv });
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
      <SecaoFormulario titulo={p.vende_servico ? 'Simples Nacional — Anexos I e III' : 'Simples Nacional — Anexo I (comércio)'} icon={Landmark} cor="amareloEscuro">
        <Linha rotulo="Faturamento 12 meses (RBT12)" valor={p.rbt12 == null ? '—' : brl(p.rbt12)}
          nota={RBT12_ORIGEM[p.rbt12_origem](p.rbt12_meses)} />
        <Linha rotulo={`Faixa ${p.faixa}`} valor={`${fmtPct(p.aliquota_nominal, 2)} nominal`}
          nota={`parcela a deduzir ${brl(p.parcela_deduzir)}`} />
        <Linha rotulo="Alíquota efetiva" valor={fmtPct(p.aliquota_efetiva, 2)} nota={formulaAliquota} />
        {/* Migr. 659: serviço prestado na mesma faixa, pela tabela do Anexo III. */}
        {p.vende_servico && (
          <Linha rotulo="Serviço — Anexo III" valor={`${fmtPct(Number(p.aliquota_efetiva_iii), 2)} efetiva`}
            nota={`nominal ${fmtPct(Number(p.aliquota_nominal_iii), 2)}, parcela a deduzir ${brl(Number(p.parcela_deduzir_iii))} — mão de obra vendida no PDV`} />
        )}
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
        <Linha rotulo="Despesas fixas" valor={fmtPct(p.despesas_pct ?? 0)} nota={origemLonga(p.despesas_origem, p)} />
        {/* Migr. 664: de onde sai o % fixo — os grupos do DRE, em % da receita. */}
        {p.despesas_origem === 'historico' && (p.despesas_grupos ?? []).length > 0 && (
          <div className="pl-3 border-l border-white/10 my-1 flex flex-col">
            {(p.despesas_grupos ?? []).map(g => (
              <div key={g.grupo} className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
                <span className="text-gray-400">{g.grupo}</span>
                <span className={`tabular-nums ${g.pct < 0 ? 'text-gray-500' : 'text-gray-300'}`}>{fmtPct(Number(g.pct), 2)}</span>
              </div>
            ))}
          </div>
        )}
        <Linha rotulo="Despesas variáveis" valor={fmtPct(p.variaveis_pct ?? 0)}
          nota={p.variaveis_origem === 'manual'
            ? 'comissão, embalagem, entrega — informado pela gestão'
            : 'comissão sobre a venda, embalagem, entrega: não informado, conta 0% — informe em "Ajustar manualmente"'} />
        <MixDeTaxas p={p} />
        <p className="text-[10px] text-gray-500 leading-snug mt-3">
          Taxas = quanto se vende em cada forma × a taxa dela em Empresa › Formas de Pagamento (pelo campo Tipo).
          Despesas fixas = despesas do DRE sem a taxa da maquininha ÷ faturamento (aluguel, folha, energia — não mudam com cada venda).
          Despesas variáveis = o que cresce junto com cada venda; só entra aqui o que não está nas contas a pagar do DRE, senão conta duas vezes.
          Janela: os 3 últimos meses fechados.
        </p>

        {p.pode_editar && ajustando && (
          <div className="border-t border-white/10 mt-4 pt-4 flex flex-col gap-3">
            <p className="text-[11px] text-gray-400 leading-snug">
              Para filial nova sem histórico, ou para simular outra faixa. Preenchido vence o histórico; vazio devolve a ele.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <span className="text-[11px] text-gray-400">Despesas fixas (%)</span>
                <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                  value={despesas} onChange={e => setDespesas(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Histórico" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Despesas variáveis (%)</span>
                <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                  value={variaveis} onChange={e => setVariaveis(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="0" />
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

      {p.pode_editar && <div className="lg:col-span-2"><ApuracaoDas filial={p.filial} showToast={showToast} /></div>}
    </div>
  );
}

// ── DAS (migr. 658) ──────────────────────────────────────────────────────────
// O imposto que o DRE deduz da receita vira obrigação aqui: o Financeiro apura
// o mês fechado e nasce a conta a pagar, vencendo no dia 20 do mês seguinte.
type CompetenciaDas = {
  competencia: string; receita: number; faixa: number; aliquota_efetiva: number;
  receita_servico?: number; aliquota_efetiva_iii?: number;
  imposto: number; vencimento: string; apurado: boolean; valor_apurado: number | null;
  conta_status: string | null;
};

function ApuracaoDas({ filial, showToast }: { filial: string; showToast: any }) {
  const [linhas, setLinhas] = useState<CompetenciaDas[] | null>(null);
  const [apurando, setApurando] = useState<string | null>(null);

  const carregar = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('das_competencias', { p_filial: filial });
    if (error) { setLinhas([]); showToast(error.message, 'error'); return; }
    setLinhas((data ?? []) as CompetenciaDas[]);
  };
  useEffect(() => { void carregar(); }, [filial]);

  const apurar = async (c: CompetenciaDas) => {
    if (!supabase) return;
    setApurando(c.competencia);
    const { data, error } = await supabase.rpc('apurar_das', { p_filial: filial, p_competencia: c.competencia });
    setApurando(null);
    if (error) { showToast(error.message, 'error', true); return; }
    const d = data as any;
    showToast(Number(d?.valor) > 0
      ? `DAS de ${mesAno(c.competencia)} apurado: ${brl(d.valor)}, vence em ${dataBR(d.vencimento)}. A conta está em Contas a pagar.`
      : d?.mensagem ?? 'Sem DAS nesta competência.', 'success', true);
    void carregar();
  };

  return (
    <SecaoFormulario titulo="DAS — apuração mensal" icon={Receipt} cor="verdeEscuro"
      extra="vence no dia 20 do mês seguinte">
      <p className="text-[11px] text-gray-400 leading-snug mb-3">
        O imposto do Simples que o DRE desconta da receita se paga num documento só, o DAS. Apure cada mês fechado:
        a conta a pagar nasce com o valor e o vencimento. Apurar de novo um mês ainda não pago refaz o valor.
      </p>
      {linhas === null ? <LoadingSpinner /> : linhas.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhum mês fechado com receita nos últimos 12 meses.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabela w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                <th>Competência</th>
                <th>Receita</th>
                <th className="hidden sm:table-cell">Alíquota</th>
                <th>DAS</th>
                <th className="hidden sm:table-cell">Vencimento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(c => {
                const pago = c.conta_status === 'Pago' || c.conta_status === 'Parcial';
                const desatualizado = c.apurado && !pago && Math.abs(Number(c.valor_apurado ?? 0) - Number(c.imposto)) >= 0.01;
                return (
                  <tr key={c.competencia}>
                    <td className="py-2 text-gray-200 capitalize">{mesAno(c.competencia)}</td>
                    <td className="tabular-nums whitespace-nowrap">
                      {brl(c.receita)}
                      {Number(c.receita_servico ?? 0) > 0 && (
                        <span className="block text-[10px] text-gray-500">serviço {brl(Number(c.receita_servico))}</span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell tabular-nums text-gray-400">
                      {fmtPct(Number(c.aliquota_efetiva), 2)} <span className="text-[10px] text-gray-500">faixa {c.faixa}</span>
                    </td>
                    <td className="tabular-nums whitespace-nowrap font-semibold text-gray-100">
                      {brl(c.apurado ? Number(c.valor_apurado) : Number(c.imposto))}
                      {desatualizado && <span className="block text-[10px] text-amber-400 font-normal">hoje daria {brl(c.imposto)}</span>}
                    </td>
                    <td className="hidden sm:table-cell tabular-nums text-gray-400">{dataBR(c.vencimento)}</td>
                    <td>
                      {!c.apurado || desatualizado ? (
                        <button onClick={() => apurar(c)} disabled={apurando !== null}
                          className="btn-solido btn-solido--verde !py-1 !px-3 !text-[11px] disabled:opacity-50">
                          {apurando === c.competencia ? 'Apurando…' : c.apurado ? 'Reapurar' : 'Apurar'}
                        </button>
                      ) : (
                        <StatusBadge status={c.conta_status ?? 'Pendente'} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SecaoFormulario>
  );
}

// ── Tela ─────────────────────────────────────────────────────────────────────
type Aba = 'simulador' | 'produtos' | 'lucro' | 'tributacao';

const PrecificacaoViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const { params, erro, carregando, salvar, salvarLucroServico } = useParametrosPrecificacao(filial);
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
          preço = Custo Direto Total ÷ (1 − {fmtPct(d.impostos, 2)} imposto − {fmtPct(d.taxas)} taxas − {fmtPct(d.despesas)} fixas
          {(d.variaveis ?? 0) > 0 ? ` − ${fmtPct(d.variaveis ?? 0)} variáveis` : ''} − lucro%)
        </p>
      </div>

      <FaixaDeducoes p={params} d={d} />

      <div role="tablist" className="flex flex-wrap gap-3">
        <AbaComContador label="Simulador" cor="roxo" icon={Calculator} ativa={aba === 'simulador'} onClick={() => setAba('simulador')} />
        <AbaComContador label="Produtos" cor="verde" icon={Package} ativa={aba === 'produtos'} onClick={() => setAba('produtos')}
          title="Preço praticado × preço pelo markup divisor, produto a produto" />
        <AbaComContador label="Categorias" cor="dourado" icon={Tags} ativa={aba === 'lucro'} onClick={() => setAba('lucro')}
          n={isLoading ? undefined : semLucro} title="Lucro líquido desejado por categoria. O número ao lado: categorias sem lucro definido — produto delas fica sem preço sugerido" />
        <AbaComContador label="Tributação" cor="azul" icon={Landmark} ativa={aba === 'tributacao'} onClick={() => setAba('tributacao')} />
      </div>

      <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5">
        {aba === 'simulador' && <AbaSimulador p={params} d={d} />}
        {aba === 'produtos' && <AbaProdutos p={params} d={d} categorias={categorias} filial={filial} />}
        {aba === 'lucro' && (
          <div className="flex flex-col gap-5">
            {params.vende_servico && <LucroServico p={params} salvar={salvarLucroServico} showToast={showToast} />}
            <AbaLucroCategorias categorias={categorias} isLoading={isLoading} reload={reload} d={d} showToast={showToast} />
          </div>
        )}
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
