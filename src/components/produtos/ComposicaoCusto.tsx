import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Custo Direto Total da última compra (migr. 664). O custo médio do cadastro é
// um número só; aqui ele se abre: o que o pedido previa, o que a nota cobrou
// (com IPI/ICMS-ST que vierem nela) e o frete do CT-e rateado — por unidade.
// É a mesma conta de `_ajustar_custo_pela_nota`, que leva isso ao custo médio.

type Ultima = {
  pedido: string; fornecedor: string | null; recebido_em: string | null; qtd: number;
  unit_pedido: number; unit_nota: number | null; frete_total: number; frete_unit: number;
  custo_direto_unit: number;
};
type Resposta = { custo_medio: number | null; custo_origem: string | null; ultima_compra: Ultima | null };

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export function ComposicaoCusto({ produtoId }: { produtoId: string }) {
  const [dados, setDados] = useState<Resposta | null>(null);

  useEffect(() => {
    let vivo = true;
    if (!supabase) return;
    // Quem não vê custo (fora de Financeiro, Marketing e Logística) recebe
    // recusa do banco — o bloco simplesmente não aparece.
    supabase.rpc('composicao_custo_produto', { p_produto_id: produtoId })
      .then(({ data, error }) => { if (vivo) setDados(error ? null : data as Resposta); });
    return () => { vivo = false; };
  }, [produtoId]);

  const u = dados?.ultima_compra;
  if (!dados || !u) return null;

  const linhas: [string, number, string?][] = [
    [u.unit_nota !== null ? 'Valor da nota' : 'Valor do pedido', u.unit_nota ?? u.unit_pedido,
      u.unit_nota !== null
        ? (Math.abs(u.unit_nota - u.unit_pedido) >= 0.005 ? `pedido previa ${brl(u.unit_pedido)}` : 'igual ao pedido')
        : 'nota ainda não conferida no Financeiro'],
    ['Frete (CT-e rateado)', u.frete_unit, u.frete_total > 0 ? `${brl(u.frete_total)} ÷ ${Number(u.qtd).toLocaleString('pt-BR')} un.` : 'sem frete lançado'],
  ];

  return (
    <div className="mt-4 rounded-xl border border-white/5 p-4 flex flex-col gap-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Custo Direto Total — última compra</p>
      <p className="text-[10px] text-gray-500">
        {u.pedido}{u.fornecedor ? ` · ${u.fornecedor}` : ''}{u.recebido_em ? ` · recebido em ${dataBR(u.recebido_em)}` : ''}
      </p>
      <div className="flex flex-col text-xs">
        {linhas.map(([rot, v, nota]) => (
          <div key={rot} className="flex items-baseline gap-2 py-1 border-b border-white/5">
            <span className="text-gray-300">{rot}</span>
            {nota && <span className="text-[10px] text-gray-500 truncate min-w-0">{nota}</span>}
            <span className="ml-auto tabular-nums text-gray-200">{brl(v)}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-2 pt-2">
          <span className="font-bold text-gray-100">= Custo direto por unidade</span>
          <span className="ml-auto tabular-nums font-bold text-gray-100">{brl(u.custo_direto_unit)}</span>
        </div>
      </div>
      {dados.custo_medio != null && Math.abs(Number(dados.custo_medio) - u.custo_direto_unit) >= 0.005 && (
        <p className="text-[10px] text-gray-500 leading-snug">
          O custo do cadastro ({brl(Number(dados.custo_medio))}) é a média ponderada com o que já estava no estoque — é ele
          que vai para o CMV e para o preço sugerido.
        </p>
      )}
    </div>
  );
}
