import { TriangleAlert } from 'lucide-react';
import {
  composicaoDoPreco, deducoesDe, fmtPct, markupDivisor,
  type OrigemPercentual, type ParametrosPrecificacao,
} from '../../lib/precificacao';

// Composição do preço (migr. 656): onde cada real da venda vai parar. É a
// outra metade do markup divisor — a sugestão diz quanto cobrar, esta tabela
// mostra o que sobra do preço que o aluno de fato digitou.

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const origemTexto =(o: OrigemPercentual, janela: string) =>
  o === 'manual' ? 'informado pela gestão'
  : o === 'historico' ? `média de ${janela}`
  : o === 'mix' ? `mix de vendas de ${janela} × taxa cadastrada`
  : 'sem histórico — contando 0%';

const mesAno = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '');
};

export function ComposicaoPreco({ custo, venda, params, lucroAlvo, anexo = 'I' }: {
  custo: number;
  venda: number;
  params: ParametrosPrecificacao;
  lucroAlvo: number | null;
  /** Migr. 659: 'III' quando o que se precifica é serviço. */
  anexo?: 'I' | 'III';
}) {
  const d = deducoesDe(params, anexo);
  const c = composicaoDoPreco(venda, custo, d);
  const janela = `${mesAno(params.janela_inicio)} a ${mesAno(params.janela_fim)}`;
  const divisor = lucroAlvo !== null ? markupDivisor(d, lucroAlvo) : null;

  const linhas = c ? [
    { rotulo: anexo === 'III' ? 'Custo do serviço' : 'Custo do produto', valor: c.custo, cor: 'bg-gray-500',
      nota: anexo === 'III' ? 'material e mão de obra direta' : 'o que a compra custou, com o frete da nota e do CT-e' },
    { rotulo: 'Simples Nacional', valor: c.impostos, cor: 'bg-amber-500',
      nota: `Anexo ${anexo}, faixa ${params.faixa} — alíquota efetiva ${fmtPct(d.impostos, 2)}` },
    { rotulo: 'Taxas de cartão', valor: c.taxas, cor: 'bg-sky-500', nota: origemTexto(params.taxas_origem, janela) },
    { rotulo: 'Despesas da loja', valor: c.despesas, cor: 'bg-violet-500', nota: origemTexto(params.despesas_origem, janela) },
  ] : [];

  return (
    <div className="mt-4 rounded-xl border border-white/5 p-4 flex flex-col gap-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Composição do preço</p>

      {c && (
        <>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-white/5">
            {linhas.map(l => (
              <div key={l.rotulo} className={l.cor} style={{ width: `${Math.max(0, (l.valor / venda) * 100)}%` }} />
            ))}
            {c.lucro > 0 && <div className="bg-emerald-500" style={{ width: `${(c.lucro / venda) * 100}%` }} />}
          </div>

          <div className="flex flex-col text-xs">
            {linhas.map(l => (
              <div key={l.rotulo} className="flex items-baseline gap-2 py-1 border-b border-white/5">
                <span className={`w-2 h-2 rounded-sm shrink-0 self-center ${l.cor}`} />
                <span className="text-gray-300">{l.rotulo}</span>
                <span className="text-[10px] text-gray-500 truncate min-w-0">{l.nota}</span>
                <span className="ml-auto tabular-nums text-gray-400 w-14 text-right">{fmtPct((l.valor / venda) * 100)}</span>
                <span className="tabular-nums text-gray-200 w-24 text-right">{brl(l.valor)}</span>
              </div>
            ))}
            <div className="flex items-baseline gap-2 pt-2">
              <span className={`w-2 h-2 rounded-sm shrink-0 self-center ${c.lucro >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-bold text-gray-100">= Lucro líquido</span>
              {lucroAlvo !== null && (
                <span className="text-[10px] text-gray-500">desejado pela categoria: {fmtPct(lucroAlvo)}</span>
              )}
              <span className={`ml-auto tabular-nums font-bold w-14 text-right ${c.lucro >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtPct(c.lucroPct)}
              </span>
              <span className={`tabular-nums font-bold w-24 text-right ${c.lucro >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {brl(c.lucro)}
              </span>
            </div>
          </div>
        </>
      )}

      {lucroAlvo !== null && divisor !== null && (
        <p className="text-[11px] text-gray-400 leading-snug">
          Markup divisor: <span className="font-mono text-gray-200">custo ÷ (1 − {fmtPct(d.impostos + d.taxas + d.despesas + lucroAlvo, 2)}) = custo ÷ {divisor.toFixed(4).replace('.', ',')}</span>
        </p>
      )}
      {lucroAlvo !== null && divisor === null && (
        <p className="text-[11px] text-red-400 flex items-start gap-1.5">
          <TriangleAlert size={12} className="shrink-0 mt-0.5" />
          Imposto, taxas, despesas e lucro desejado somam 100% ou mais: nenhum preço paga esta conta.
        </p>
      )}
      {lucroAlvo === null && (
        <p className="text-[11px] text-gray-500">
          Defina o <span className="text-gray-300">lucro líquido desejado</span> da categoria em Financeiro › Precificação para o sistema sugerir o preço.
        </p>
      )}
      {params.acima_do_teto && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
          <TriangleAlert size={12} className="shrink-0 mt-0.5" />
          Faturamento dos 12 meses acima de R$ 4,8 milhões: a empresa sairia do Simples Nacional.
        </p>
      )}
    </div>
  );
}
