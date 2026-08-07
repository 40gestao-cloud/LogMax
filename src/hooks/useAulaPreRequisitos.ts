import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AulaPreRequisito } from '../lib/aulaFluxos';

// Checagem dos pré-requisitos de dado de um fluxo de aula.
//
// Módulos certos não bastam: a cadeia de compra não anda sem fornecedor
// cadastrado, o PDV não abre sem caixa do dia, e `decidir_requisicao_compra`
// exige um gerente de filial que talvez ninguém na turma seja. Tudo isso só
// aparecia com a turma parada esperando.
//
// `head: true` + `count: 'exact'`: só o número trafega. Quem abre esta tela é
// admin, então a RLS não recorta a contagem.

export type PreRequisitoStatus = AulaPreRequisito & {
  quantidade: number;
  ok: boolean;
};

export function useAulaPreRequisitos(requisitos: AulaPreRequisito[]) {
  const [status, setStatus] = useState<PreRequisitoStatus[]>([]);
  const [loading, setLoading] = useState(false);

  // Os fluxos compartilham requisitos (produtos aparece em três deles); a
  // chave é a lista de ids, para não refazer a consulta a cada render.
  const chave = requisitos.map(r => r.id).join(',');

  const verificar = useCallback(async () => {
    if (!supabase || requisitos.length === 0) { setStatus([]); return; }
    setLoading(true);
    const unicos = Array.from(new Map(requisitos.map(r => [r.id, r])).values());
    try {
      const resultados = await Promise.all(unicos.map(async r => {
        let q = supabase!.from(r.tabela).select('id', { count: 'exact', head: true });
        if (r.filtroAtivo) q = q.eq('ativo', true);
        for (const [col, val] of Object.entries(r.eq ?? {})) q = q.eq(col, val);
        const { count, error } = await q;
        // Erro de tabela ausente não pode derrubar o painel inteiro: a turma
        // que estiver com uma migração atrasada ainda vê os outros requisitos.
        const quantidade = error ? -1 : (count ?? 0);
        return { ...r, quantidade, ok: quantidade < 0 || quantidade >= r.minimo };
      }));
      setStatus(resultados);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  useEffect(() => { void verificar(); }, [verificar]);

  return { status, loading, verificar };
}
