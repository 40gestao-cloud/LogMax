import type React from 'react';
import { Percent, TrendingUp } from 'lucide-react';
import { FormField } from '../ui';
import { formatBRL, handleMoneyKeyDown } from '../../lib/viewUtils';
import { corDoMarkup, fmtPct } from '../../lib/precificacao';
import { ehVendavel } from '../../lib/tipoProduto';
import { type FormProduto, type ExtrasProduto } from './produtoFormComum';

// Preços: custo, venda, markup e margem ao vivo. Quem não vende tem só o custo.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoPrecos({
  custoDaCotacao, errors, clearError, custoObrigatorio, editItem, extras, extrasErrors, form, margemAoVivo, markupAoVivo, markupCategoria, precoAbaixoDoCusto, precoSugerido, setExtras, setExtrasErrors, setForm,
}: {
  custoDaCotacao: boolean;
  errors: Partial<Record<keyof FormProduto, string>>;
  clearError: (key: keyof FormProduto) => void;
  custoObrigatorio: boolean;
  editItem: any;
  extras: ExtrasProduto;
  extrasErrors: Record<string, string>;
  form: FormProduto;
  margemAoVivo: number | null;
  markupAoVivo: number | null;
  markupCategoria: any;
  precoAbaixoDoCusto: boolean;
  precoSugerido: any;
  setExtras: React.Dispatch<React.SetStateAction<ExtrasProduto>>;
  setExtrasErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setForm: React.Dispatch<React.SetStateAction<FormProduto>>;
}) {
  return (
    <>
      {/* Preços. Quem não vende tem só o lado do custo: o que a empresa
          pagou. Preço de venda e margem saem da tela em vez de pedir um
          número inventado (migr. 440). */}
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">
          {ehVendavel(extras.tipo) ? 'Preços' : 'Valor de aquisição'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField
            label={extras.tipo === 'patrimonio' ? 'Valor de Aquisição (R$) *'
              : extras.tipo === 'consumo'       ? 'Custo Unitário (R$) *'
              : `Preço de Custo (R$)${custoObrigatorio ? ' *' : ''}`}
            error={extrasErrors.preco_custo}>
            <input type="text" inputMode="numeric"
              className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${extrasErrors.preco_custo ? 'border border-red-500/40' : ''}`}
              value={extras.preco_custo}
              onChange={e => { setExtras(x => ({ ...x, preco_custo: formatBRL(e.target.value) })); setExtrasErrors(ev => ({ ...ev, preco_custo: '' })); }}
              onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
            {custoDaCotacao && (
              <p className="text-[10px] text-accent font-bold mt-1">Previsto pela cotação aprovada</p>
            )}
          </FormField>
          {ehVendavel(extras.tipo) && (
          <FormField label={`Preço de Venda (R$${extras.unidade && extras.unidade !== 'UN' ? ` / ${extras.unidade}` : ''}) *`} error={errors.preco}>
            <input type="text" inputMode="numeric" className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${errors.preco ? 'border border-red-500/40' : ''}`}
              value={form.preco} onChange={e => { setForm(f => ({ ...f, preco: formatBRL(e.target.value) })); clearError('preco'); }}
              onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
            {/* Markup da categoria (migr. 360). Sugere, não impõe: o
                preço continua editável, e é a diferença entre o
                sugerido e o praticado que rende a conversa em aula. */}
            {precoSugerido !== null && (
              <button type="button"
                onClick={() => { setForm(f => ({ ...f, preco: formatBRL(precoSugerido) })); clearError('preco'); }}
                className="text-[10px] text-accent hover:underline mt-1 text-left block">
                Sugerido pelo markup de {markupCategoria}%: <strong>R$ {formatBRL(precoSugerido)}</strong> — clique para usar
              </button>
            )}
            {precoAbaixoDoCusto && (
              <label className="mt-2 flex items-start gap-2 text-[10px] leading-snug text-gray-400 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-amber-500"
                  checked={extras.venda_abaixo_custo}
                  onChange={e => {
                    setExtras(x => ({ ...x, venda_abaixo_custo: e.target.checked }));
                    setExtrasErrors(ev => ({ ...ev, preco_custo: '' }));
                  }} />
                <span>
                  <span className="text-amber-400 font-bold">Venda abaixo do custo, de propósito</span> (promoção ou queima de validade)
                </span>
              </label>
            )}
          </FormField>
          )}
          {/* As DUAS contas, lado a lado. Antes havia uma só, rotulada
              "Margem de Lucro" e calculando markup — custo 10 e venda 20
              exibiam 100%, e a margem real é 50%. Mostrar as duas juntas
              é mais barato que escolher uma: são perguntas diferentes, e
              é a diferença entre elas que o curso quer ensinar.

              A cor fica no markup, com a régua de sempre e os mesmos
              valores — margem saudável depende do ramo, e inventar um
              corte único para as três filiais ensinaria outro erro. */}
          {ehVendavel(extras.tipo) && (
          <div className="flex flex-col gap-1.5">
            {/* Calculado read-only, sem input — span em vez de label */}
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Markup <span className="normal-case tracking-normal text-gray-600 font-medium">(sobre o custo)</span>
            </span>
            <div className={`neu-pressed py-2 px-3 rounded-xl text-sm flex items-center gap-2 border border-white/5 ${corDoMarkup(markupAoVivo)}`}>
              <TrendingUp size={13} className="shrink-0 opacity-60" />
              <span className="font-bold tabular-nums">{fmtPct(markupAoVivo)}</span>
              {markupAoVivo !== null && markupAoVivo < 10 && (
                <span className="text-[10px] text-red-400/70 ml-auto">Markup baixo</span>
              )}
            </div>
          </div>
          )}
          {ehVendavel(extras.tipo) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Margem <span className="normal-case tracking-normal text-gray-600 font-medium">(sobre a venda)</span>
            </span>
            <div className="neu-pressed py-2 px-3 rounded-xl text-sm flex items-center gap-2 border border-white/5 text-gray-300">
              <Percent size={13} className="shrink-0 opacity-60" />
              <span className="font-bold tabular-nums">{fmtPct(margemAoVivo)}</span>
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}
