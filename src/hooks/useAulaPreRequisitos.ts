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
  /** Não deu para consultar (tabela ausente, RLS, rede). NÃO é o mesmo que ok. */
  indefinido?: boolean;
  /** Filiais operacionais sem nenhuma linha, quando o requisito é por filial. */
  filiaisVazias?: string[];
};

// Só as unidades que operam: a Matriz é administrativa e não precisa de
// produto nem de cliente para a aula rodar.
const FILIAIS_OPERACIONAIS = ['SuperMax', 'MaxLook', 'TechMax'];

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
        const filtrar = (q: any) => {
          let out = q;
          if (r.filtroAtivo) out = out.eq('ativo', true);
          for (const [col, val] of Object.entries(r.eq ?? {})) out = out.eq(col, val);
          for (const col of r.naoNulo ?? []) out = out.not(col, 'is', null);
          return out;
        };

        // Por filial: o total da holding engana. 219 produtos com zero na
        // MaxLook dão um check verde e uma turma sem nada para vender.
        if (r.porFilial) {
          const { data, error } = await filtrar(supabase!.from(r.tabela).select('filial'));
          if (error) {
            return { ...r, quantidade: -1, ok: false, indefinido: true };
          }
          const porFilial = new Map<string, number>();
          for (const row of (data ?? []) as { filial: string | null }[]) {
            if (!row.filial) continue;
            porFilial.set(row.filial, (porFilial.get(row.filial) ?? 0) + 1);
          }
          const vazias = FILIAIS_OPERACIONAIS.filter(
            f => (porFilial.get(f) ?? 0) < r.minimo,
          );
          return {
            ...r,
            quantidade: (data ?? []).length,
            ok: vazias.length === 0,
            filiaisVazias: vazias,
          };
        }

        const { count, error } = await filtrar(
          supabase!.from(r.tabela).select('id', { count: 'exact', head: true }),
        );
        // Erro de consulta não pode virar verde: um requisito que ninguém
        // conseguiu checar é justamente o que precisa aparecer. Também não
        // derruba o painel — os outros requisitos seguem sendo mostrados.
        if (error) return { ...r, quantidade: -1, ok: false, indefinido: true };
        const quantidade = count ?? 0;
        return { ...r, quantidade, ok: quantidade >= r.minimo };
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
