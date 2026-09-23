import { useEffect } from 'react';
import { aguardarCobranca, type TabelaCobranca } from '../lib/pdv/cobranca';

/**
 * Escuta uma cobrança pendente (Pix ou maquininha) enquanto ela existir na
 * tela, e chama `aoConfirmar` uma vez quando o MaxBank confirma. A regra da
 * espera mora em `aguardarCobranca` (lib/pdv/cobranca.ts); o que fazer depois
 * — gravar a venda, virar linha do misto, abrir o recibo — é de cada PDV.
 *
 * `aoConfirmar` é o da renderização em que a cobrança apareceu, como era nos
 * `useEffect` que este hook substitui. Troca de cobrança = outro `id`.
 *
 * `canal` precisa ser único por cobrança: dois canais com o mesmo nome no
 * mesmo cliente se atropelam, e um deles para de receber.
 */
export function usePagamentoPendente(
  cobranca: { tabela: TabelaCobranca; id: string; canal: string } | null,
  aoConfirmar: () => unknown,
): void {
  useEffect(() => {
    if (!cobranca) return;
    return aguardarCobranca(cobranca.tabela, cobranca.id, cobranca.canal, aoConfirmar);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobranca?.tabela, cobranca?.id]);
}
