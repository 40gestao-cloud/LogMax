import { calcMarkup, calcMargem, corDoMarkup, fmtPct } from '../../lib/precificacao';
import { parseNum } from './produtoFormComum';

/**
 * Selo da grade. Mostra MARKUP, que é o que sempre mostrou — só o nome estava
 * errado. A margem real vai no title, porque a coluna não comporta as duas e
 * quem decide preço na listagem está olhando formação, não resultado.
 */
export const MarkupBadge = ({ venda, custo }: { venda: string | number; custo: string | number }) => {
  const v  = parseNum(venda);
  const c  = parseNum(custo);
  const mk = calcMarkup(v, c);
  if (mk === null) return <span className="text-gray-600">—</span>;
  const mg = calcMargem(v, c);
  return (
    <span className={`font-bold tabular-nums ${corDoMarkup(mk)}`}
      title={`Markup ${fmtPct(mk)} (sobre o custo) · Margem ${fmtPct(mg)} (sobre a venda)`}>
      {fmtPct(mk)}
    </span>
  );
};
