// Condição de pagamento de compra (migr. 584) em forma curta, para caber embaixo
// do valor numa linha de tabela: "30/60/90" sozinho parecia código. Parcelado
// vira "3x"; o que já se explica ("À vista", "30 dias") fica como está. O
// detalhe dos vencimentos vai no title.
const DETALHE: Record<string, { curto: string; detalhe: string }> = {
  'À vista':  { curto: 'À vista', detalhe: 'À vista — pago de uma vez, na data do pedido' },
  '15 dias':  { curto: '15 dias', detalhe: '1 parcela, vence 15 dias depois do pedido' },
  '30 dias':  { curto: '30 dias', detalhe: '1 parcela, vence 30 dias depois do pedido' },
  '30/60':    { curto: '2x',      detalhe: '2 parcelas, vencem 30 e 60 dias depois do pedido' },
  '30/60/90': { curto: '3x',      detalhe: '3 parcelas, vencem 30, 60 e 90 dias depois do pedido' },
};

export const CondicaoCompra = ({ condicao, className = '' }: { condicao?: string | null; className?: string }) => {
  if (!condicao) return null;
  const d = DETALHE[condicao] ?? { curto: condicao, detalhe: condicao };
  return (
    <span title={d.detalhe} className={`block text-[10px] text-gray-500 cursor-help ${className}`}>
      {d.curto}
    </span>
  );
};
