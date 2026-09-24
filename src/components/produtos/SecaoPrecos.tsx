import type React from 'react';
import { Percent, TrendingUp } from 'lucide-react';
import { FormField } from '../ui';
import { formatBRL, handleMoneyKeyDown } from '../../lib/viewUtils';
import { corDoMarkup, fmtPct, EXPLICA_MARKUP_MARGEM } from '../../lib/precificacao';
import { ehVendavel } from '../../lib/tipoProduto';
import { parseNum, fmtBRL, type FormProduto, type ExtrasProduto } from './produtoFormComum';

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            {/* Cadastro antecipado: a cotação ainda não aconteceu, e o
                campo deixa de cobrar um número que ninguém tem. Dizer
                isso na tela é o que impede o aluno de inventar um. */}
            {custoDaCotacao ? (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                <span className="text-accent font-bold">Previsto pela cotação aprovada</span> — o{' '}
                <span className="text-gray-400 font-bold">Recebimento</span> confirma o custo real, e é ele que vale no DRE.
              </p>
            ) : !custoObrigatorio && (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                Pode ficar em branco: você ainda vai cotar. O custo real é apurado no{' '}
                <span className="text-gray-400 font-bold">Recebimento</span>, por média ponderada — e
                é ele que vale no DRE.
              </p>
            )}
            {/* Custo apurado pela compra (migr. 417). Editar aqui é
                permitido — mas o próximo recebimento deste produto
                recalcula a média ponderada e assume de volta. */}
            {editItem?.custo_origem === 'compra' && (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                Média ponderada apurada no recebimento
                {editItem?.custo_ultima_compra_em ? ` de ${new Date(`${editItem.custo_ultima_compra_em}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                {editItem?.custo_ultima_compra_valor != null
                  ? ` — última compra a R$ ${fmtBRL(parseNum(editItem.custo_ultima_compra_valor))} a unidade`
                  : ''}.
              </p>
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
            {extras.unidade && extras.unidade !== 'UN' && (
              <p className="text-[10px] text-gray-500 mt-1">
                Vendido por <span className="font-bold text-accent">{extras.unidade}</span> — no PDV, o caixa digita a quantidade fracionária ao pesar.
              </p>
            )}
            {/* A exceção só aparece quando o caso existe. Caixa sempre
                visível seria um convite a marcar e seguir — aqui ela
                surge junto com o problema, com o número na frente. */}
            {precoAbaixoDoCusto && (
              <label className="mt-2 flex items-start gap-2 text-[10px] leading-snug text-gray-400 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-amber-500"
                  checked={extras.venda_abaixo_custo}
                  onChange={e => {
                    setExtras(x => ({ ...x, venda_abaixo_custo: e.target.checked }));
                    setExtrasErrors(ev => ({ ...ev, preco_custo: '' }));
                  }} />
                <span>
                  <span className="text-amber-400 font-bold">Venda abaixo do custo, de propósito</span> — promoção-isca ou
                  queima de validade. Sem marcar, o cadastro não salva: custo maior que a venda costuma ser os dois campos trocados.
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
              <span className="text-[10px] text-gray-600 ml-auto">é a do DRE</span>
            </div>
          </div>
          )}
        </div>
        {ehVendavel(extras.tipo) && (
          <p className="text-[10px] text-gray-500 mt-2 leading-snug">{EXPLICA_MARKUP_MARGEM}</p>
        )}
      </div>
    </>
  );
}
