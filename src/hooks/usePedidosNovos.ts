// Pedidos da loja online esperando atendimento.
//
// O sino conta a história depois do fato: o pedido chegou, virou uma linha na
// lista e espera alguém abrir o popover. Numa dinâmica de aula com comprador do
// outro lado, isso é tarde — daí o FAB, no mesmo padrão dos Avisos da Matriz.
//
// QUEM VÊ É A RLS QUEM DECIDE, e de propósito. `pedidos_online_all` já é
// `auth_opera_loja(filial)`: setor vendas ou gerente da filial, e só a própria
// filial (migr. 293). Repetir essa régua aqui em TypeScript criaria duas fontes
// da verdade que divergem no primeiro ajuste de RBAC. Colaborador da SuperMax
// recebe SuperMax; admin e CEO recebem tudo, que é o que já acontece no sino.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';

export type PedidoNovo = {
  id: string;
  codigo: string;
  filial: string;
  comprador_apelido: string;
  forma_desejada: string;
  total_final: number;
  origem_pedidos_24h: number | null;
  created_at: string;
};

export function usePedidosNovos(ativo: boolean) {
  const [pendentes, setPendentes] = useState<PedidoNovo[]>([]);
  const loadRef = useRef<() => void>(() => {});

  const carregar = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !ativo) { setPendentes([]); return; }

    const { data, error } = await supabase
      .from('pedidos_online')
      .select('id,codigo,filial,comprador_apelido,forma_desejada,total_final,origem_pedidos_24h,created_at')
      .eq('status', 'Novo')
      .eq('ativo', true)
      .order('created_at', { ascending: true });

    // Silêncio no erro: este é um FAB acessório. Se a consulta falhar, a fila
    // continua inteira em Vendas → Pedidos Online, e um toast de erro em cima
    // de qualquer tela do sistema seria pior que a ausência do atalho.
    if (error) { setPendentes([]); return; }
    setPendentes((data ?? []) as PedidoNovo[]);
  }, [ativo]);

  loadRef.current = carregar;

  useEffect(() => { void carregar(); }, [carregar]);

  // Recarrega em qualquer mudança da tabela: pedido novo entra na fila,
  // confirmado ou cancelado sai. A janela do `assinarRealtime` agrupa a rajada
  // de pedidos de uma dinâmica de aula e espalha as leituras entre as máquinas.
  useEffect(() => {
    if (!isSupabaseConfigured || !ativo) return;
    return assinarRealtime({
      nome: 'rt-pedidos-novos',
      alvos: ['pedidos_online'],
      aoMudar: () => { void loadRef.current(); },
    });
  }, [ativo]);

  return { pendentes, recarregar: carregar };
}
