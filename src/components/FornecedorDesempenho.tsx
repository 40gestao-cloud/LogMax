// Desempenho de fornecedor — pontualidade ao lado do preço (migr. 421).
//
// Comprar pelo menor preço é metade da decisão. O mapa comparativo de Cotações
// destacava a proposta mais barata e não dizia nada sobre quem entrega no
// prazo — sendo que o fornecedor que atrasa 20 dias custa mais caro que a
// proposta R$ 200 mais alta, porque a loja fica sem o produto na prateleira.
//
// Os números saem de `v_fornecedor_desempenho`, que compara
// `pedidos.prazo_entrega` com `pedidos.recebido_em`. Fornecedor sem entrega
// fechada não tem nota: aparece como "sem histórico", que é diferente de ruim.

import React, { useCallback, useEffect, useState } from 'react';
import { Clock, TriangleAlert, PackageX } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type FornecedorDesempenho = {
  fornecedor_id:     string;
  filial:            string;
  entregas:          number;
  entregas_no_prazo: number;
  /** null quando não há entrega avaliável — não é zero, é "não sei ainda". */
  pontualidade_pct:  number | null;
  atraso_medio_dias: number | null;
  pior_atraso_dias:  number;
  /** Pedidos ainda abertos cuja data prometida já passou. Cobrança de hoje. */
  em_atraso_agora:   number;
  pedidos_em_aberto: number;
  ultima_entrega_em: string | null;
  total_comprado:    number;
  /** Pedidos deste fornecedor que geraram devolução (migr. 428). */
  pedidos_com_devolucao: number;
  devolucoes_valor:      number;
  /** % dos pedidos recebidos que tiveram devolução. null = sem base. */
  taxa_devolucao_pct:    number | null;
};

/**
 * Carrega o desempenho de todos os fornecedores da filial num mapa por id.
 *
 * Consulta direta em vez de `useFetchData`: o hook ordena por `created_at`, que
 * uma view agregada não tem — o retorno viria vazio com um 400 silencioso.
 */
export function useFornecedorDesempenho(filial?: string) {
  const [mapa, setMapa] = useState<Record<string, FornecedorDesempenho>>({});
  const [carregando, setCarregando] = useState(true);
  // Distingue "a view respondeu e este fornecedor não tem histórico" de "a view
  // não existe nesta turma". Sem isso, uma migração pendente faria a tela
  // inteira dizer "sem histórico" — que é uma afirmação, e seria falsa.
  const [disponivel, setDisponivel] = useState(true);

  const recarregar = useCallback(async () => {
    if (!supabase) { setCarregando(false); setDisponivel(false); return; }
    let q = supabase.from('v_fornecedor_desempenho').select('*');
    if (filial) q = q.eq('filial', filial);
    const { data, error } = await q;
    if (error) {
      // Migração pendente nesta turma: some o selo em vez de quebrar a tela.
      console.warn('[desempenho fornecedor] indisponível:', error.message);
      setMapa({});
      setDisponivel(false);
    } else {
      setDisponivel(true);
      const out: Record<string, FornecedorDesempenho> = {};
      for (const linha of data ?? []) {
        out[linha.fornecedor_id] = {
          ...linha,
          pontualidade_pct:  linha.pontualidade_pct  == null ? null : Number(linha.pontualidade_pct),
          atraso_medio_dias: linha.atraso_medio_dias == null ? null : Number(linha.atraso_medio_dias),
          total_comprado:    Number(linha.total_comprado ?? 0),
          // Colunas da migr. 428. Turma que ainda não aplicou devolve undefined
          // e o selo de qualidade simplesmente não aparece.
          pedidos_com_devolucao: Number(linha.pedidos_com_devolucao ?? 0),
          devolucoes_valor:      Number(linha.devolucoes_valor ?? 0),
          taxa_devolucao_pct:    linha.taxa_devolucao_pct == null ? null : Number(linha.taxa_devolucao_pct),
        };
      }
      setMapa(out);
    }
    setCarregando(false);
  }, [filial]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return {
    desempenho: mapa,
    desempenhoDisponivel: disponivel,
    carregandoDesempenho: carregando,
    recarregarDesempenho: recarregar,
  };
}

const fmtData = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Selo compacto: "92% no prazo (12)". Sem histórico vira texto apagado, nunca
 * um número inventado — atribuir 0% a quem nunca entregou seria condenar
 * fornecedor novo por falta de dados.
 */
export const SeloDesempenho = ({ d, compacto = false }: {
  d?: FornecedorDesempenho;
  compacto?: boolean;
}) => {
  const atrasoAgora = d?.em_atraso_agora ?? 0;

  if (!d || d.entregas === 0) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-600" title="Nenhum pedido deste fornecedor foi recebido com prazo registrado. Sem histórico não é o mesmo que histórico ruim.">
          sem histórico
        </span>
        {atrasoAgora > 0 && <SeloAtrasoAgora n={atrasoAgora} />}
      </span>
    );
  }

  const pct = d.pontualidade_pct ?? 0;
  const cor = pct >= 90 ? 'text-emerald-400 border-emerald-400/25 bg-emerald-400/5'
            : pct >= 70 ? 'text-amber-400   border-amber-400/25   bg-amber-400/5'
            :             'text-red-400     border-red-400/25     bg-red-400/5';

  const detalhe = [
    `${d.entregas_no_prazo} de ${d.entregas} entrega(s) no prazo.`,
    d.atraso_medio_dias ? `Atraso médio: ${d.atraso_medio_dias} dia(s).` : 'Nenhum atraso registrado.',
    d.pior_atraso_dias > 0 ? `Pior atraso: ${d.pior_atraso_dias} dia(s).` : null,
    d.ultima_entrega_em ? `Última entrega: ${fmtData(d.ultima_entrega_em)}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span title={detalhe}
        className={`inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-widest border ${cor}`}>
        <Clock size={9} />
        {pct}%{compacto ? '' : ' no prazo'} ({d.entregas})
      </span>
      {atrasoAgora > 0 && <SeloAtrasoAgora n={atrasoAgora} />}
      {/* Pontualidade e qualidade são defeitos diferentes: quem entrega no dia
          e manda avariado tinha selo verde até a migr. 428. */}
      {(d.taxa_devolucao_pct ?? 0) > 0 && (
        <span title={`${d.pedidos_com_devolucao} pedido(s) deste fornecedor geraram devolução, somando ${brl(d.devolucoes_valor)}. Entregar no prazo não é o mesmo que entregar certo.`}
          className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-widest border text-orange-400 border-orange-400/30 bg-orange-400/5">
          <PackageX size={9} />
          {d.taxa_devolucao_pct}% devolvido
        </span>
      )}
    </span>
  );
};

const brl = (v: number) =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pedido em aberto com a data prometida vencida. Fica separado da pontualidade
 * de propósito: um é histórico fechado, o outro é o telefonema de hoje.
 */
const SeloAtrasoAgora = ({ n }: { n: number }) => (
  <span title={`${n} pedido(s) deste fornecedor estão em aberto com o prazo vencido.`}
    className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-widest border text-red-400 border-red-400/30 bg-red-950/40">
    <TriangleAlert size={9} />
    {n} atrasado(s)
  </span>
);
