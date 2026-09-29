import { useEffect, useState } from 'react';
import { Save, Landmark } from 'lucide-react';
import { useParametrosPrecificacao } from '../hooks/useParametrosPrecificacao';
import { fmtPct, type OrigemPercentual, type ParametrosPrecificacao } from '../lib/precificacao';
import { formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';

// Tributação e parâmetros da filial (migr. 656), em Financeiro › Precificação.
// São os percentuais que o cadastro de produto usa no markup divisor.
//
// Os três parâmetros saem do histórico. O valor manual existe para a filial
// nova, que ainda não tem histórico, e para o professor simular outra faixa
// do Simples — preenchido vence o histórico; vazio devolve a ele.

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RBT12_ORIGEM: Record<ParametrosPrecificacao['rbt12_origem'], (meses: number | null) => string> = {
  manual:        () => 'informado manualmente',
  primeiro_mes:  () => '1º mês de atividade (ou sem venda ainda): receita do mês × 12',
  proporcional:  (n) => `início de atividade: média dos ${n} ${n === 1 ? 'mês anterior' : 'meses anteriores'} × 12`,
  '12_meses':    () => 'receita bruta dos 12 meses anteriores',
};

const origemPct = (o: OrigemPercentual, janela: string) =>
  o === 'manual' ? 'informado manualmente'
  : o === 'historico' ? `histórico de ${janela}`
  : 'sem venda na janela — conta como 0%';

const pctParaTexto = (v: number | null | undefined) => v == null ? '' : String(v).replace('.', ',');
const textoParaPct = (t: string): number | null => t.trim() === '' ? null : Number(t.replace(',', '.'));

export function ParametrosPrecificacaoPanel({ filial, showToast, onSalvo }: {
  filial: string; showToast: any; onSalvo?: () => void;
}) {
  const { params, erro, salvar } = useParametrosPrecificacao(filial);
  const [rbt12, setRbt12] = useState('');
  const [despesas, setDespesas] = useState('');
  const [taxas, setTaxas] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const m = params?.manual;
    setRbt12(m?.rbt12 == null ? '' : formatBRL(m.rbt12));
    setDespesas(pctParaTexto(m?.despesas_pct));
    setTaxas(pctParaTexto(m?.taxas_pct));
  }, [params?.manual?.rbt12, params?.manual?.despesas_pct, params?.manual?.taxas_pct]);

  if (erro) return <p className="text-[11px] text-gray-500 mb-6">{erro}</p>;
  if (!params) return null;

  const janela = `${params.janela_inicio.split('-').reverse().join('/')} a ${params.janela_fim.split('-').reverse().join('/')}`;

  const handleSalvar = async () => {
    const d = textoParaPct(despesas), t = textoParaPct(taxas);
    for (const v of [d, t]) {
      if (v !== null && !(v >= 0 && v < 100)) { showToast('Percentual precisa ficar entre 0 e 99,99.', 'error'); return; }
    }
    setSalvando(true);
    try {
      await salvar({ rbt12: rbt12.trim() === '' ? null : parseBRL(rbt12), despesas_pct: d, taxas_pct: t });
      showToast('Parâmetros de preço salvos.', 'success');
      onSalvo?.();
    } catch (e: any) {
      showToast(e?.message ?? 'Não foi possível salvar.', 'error');
    } finally { setSalvando(false); }
  };

  const Item = ({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{rotulo}</span>
      <span className="text-sm font-bold text-gray-100 tabular-nums">{valor}</span>
      <span className="text-[10px] text-gray-500 leading-snug">{nota}</span>
    </div>
  );

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 mb-6 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Landmark size={15} className="text-accent" />
        <p className="text-sm font-bold text-gray-100">Tributação e formação de preço</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Item rotulo="Regime" valor="Simples Nacional" nota="Anexo I — comércio" />
        <Item rotulo="Faturamento 12 meses (RBT12)"
          valor={params.rbt12 == null ? '—' : brl(params.rbt12)}
          nota={RBT12_ORIGEM[params.rbt12_origem](params.rbt12_meses)} />
        <Item rotulo={`Faixa ${params.faixa}`}
          valor={`${fmtPct(params.aliquota_efetiva, 2)} efetiva`}
          nota={`nominal ${fmtPct(params.aliquota_nominal, 2)}, parcela a deduzir ${brl(params.parcela_deduzir)} — (RBT12 × nominal − dedução) ÷ RBT12`} />
        <div className="grid grid-cols-2 gap-3">
          <Item rotulo="Taxas" valor={fmtPct(params.taxas_pct)} nota={origemPct(params.taxas_origem, janela)} />
          <Item rotulo="Despesas" valor={fmtPct(params.despesas_pct)} nota={origemPct(params.despesas_origem, janela)} />
        </div>
      </div>

      {params.acima_do_teto && (
        <p className="text-[11px] text-amber-400">Acima de R$ 4,8 milhões em 12 meses a empresa sai do Simples Nacional.</p>
      )}

      <p className="text-[11px] text-gray-500 leading-snug">
        Taxas = o que a maquininha reteve na conciliação ÷ faturamento. Despesas = despesas do DRE sem essas taxas ÷ faturamento.
        O cadastro de produto usa os três percentuais no <span className="text-gray-300">markup divisor</span>:
        preço = custo ÷ (1 − imposto − taxas − despesas − lucro desejado da categoria).
      </p>

      {params.pode_editar && (
        <div className="border-t border-white/5 pt-4 flex flex-col gap-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valores manuais — vazio usa o histórico</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400">Faturamento 12 meses (R$)</span>
              <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                value={rbt12} onChange={e => setRbt12(e.target.value === '' ? '' : formatBRL(e.target.value))}
                onKeyDown={handleMoneyKeyDown} placeholder="Pelo histórico" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400">Taxas de cartão (%)</span>
              <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                value={taxas} onChange={e => setTaxas(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Pelo histórico" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400">Despesas da loja (%)</span>
              <input type="text" inputMode="decimal" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                value={despesas} onChange={e => setDespesas(e.target.value.replace(/[^0-9,.]/g, ''))} placeholder="Pelo histórico" />
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={handleSalvar} disabled={salvando}
              className="neu-button px-4 py-2 rounded-xl text-sm font-semibold text-accent flex items-center gap-2 disabled:opacity-50">
              <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar parâmetros'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
