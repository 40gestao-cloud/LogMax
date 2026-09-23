import { supabase } from '../supabase';

// Cobrança pendente do PDV: o Pix (`pix_pendentes`) ou a maquininha
// (`cartao_pendentes`) esperando o MaxBank/MaxPay. Usado pelos dois PDVs.
//
// A venda só é gravada quando a linha muda para o status de confirmado. Quem
// muda é o MaxBank, e a MaxPay casa a cobrança por VALOR — por isso as
// pendentes velhas do mesmo operador são canceladas antes de criar outra.

export type TabelaCobranca = 'pix_pendentes' | 'cartao_pendentes';

export const STATUS_CONFIRMADO: Record<TabelaCobranca, string> = {
  pix_pendentes:    'pago',
  cartao_pendentes: 'autorizado',
};

// Cancela as pendentes 'aguardando' do operador com mais de 30s, para o
// MaxPay/MaxBank não confundir com a cobrança nova. Sem operador, não faz nada.
export async function cancelarAguardandoAntigas(tabela: TabelaCobranca, operadorId: string | null | undefined): Promise<void> {
  if (!supabase || !operadorId) return;
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  await supabase
    .from(tabela)
    .update({ status: 'cancelado' })
    .eq('operador_id', operadorId)
    .eq('status', 'aguardando')
    .lt('created_at', cutoff);
}

// `filial` é a do CAIXA, não a do perfil — admin/CEO operam pelo hub com
// perfil 'Matriz', que não vende (migr. 414).
export async function inserirPixPendente(p: {
  valor: number; clienteId: string | null; operadorId: string | null; filial: string;
}): Promise<{ id: string; valor: number }> {
  if (!supabase) throw new Error('Supabase indisponível.');
  const { data, error } = await supabase
    .from('pix_pendentes')
    .insert({
      valor:       p.valor,
      cliente_id:  p.clienteId,
      status:      'aguardando',
      operador_id: p.operadorId,
      filial:      p.filial,
    })
    .select('id, valor')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Falha ao gerar Pix.');
  return { id: data.id, valor: Number(data.valor) };
}

export async function inserirCartaoPendente(p: {
  valor: number; metodo: 'debito' | 'credito'; parcelas: number; operadorId: string | null; filial: string;
}): Promise<{ id: string; valor: number; metodo: 'debito' | 'credito'; parcelas: number }> {
  if (!supabase) throw new Error('Supabase indisponível.');
  const { data, error } = await supabase
    .from('cartao_pendentes')
    .insert({
      valor:       p.valor,
      metodo:      p.metodo,
      parcelas:    p.parcelas,
      status:      'aguardando',
      operador_id: p.operadorId,
      filial:      p.filial,
    })
    .select('id, valor, metodo, parcelas')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Falha ao criar cobrança de cartão.');
  return { id: data.id, valor: Number(data.valor), metodo: data.metodo, parcelas: data.parcelas };
}

// Marca a pendente como cancelada. Devolve o erro para quem quiser avisar; o
// desfecho local (fechar o modal) é o mesmo nos dois casos.
export async function cancelarCobranca(tabela: TabelaCobranca, id: string): Promise<Error | null> {
  if (!supabase) return null;
  const { error } = await supabase.from(tabela).update({ status: 'cancelado' }).eq('id', id);
  return error ? new Error(error.message) : null;
}

/**
 * Espera a confirmação de uma cobrança: realtime na linha E polling de 2s,
 * porque o WebSocket às vezes atrasa no plano free do Supabase.
 *
 * `aoConfirmar` dispara UMA vez — realtime e polling chegam juntos com
 * frequência, e duas chamadas eram duas vendas. Se ele devolver (ou resolver)
 * `false`, a trava se solta e o próximo aviso tenta de novo: é o que o Pix da
 * SuperMax faz quando o registro falha com o Pix já pago.
 *
 * Devolve a função que para de escutar. Depois dela, nada mais dispara —
 * nem uma consulta de polling que já estava a caminho.
 */
export function aguardarCobranca(
  tabela: TabelaCobranca,
  id: string,
  canal: string,
  aoConfirmar: () => unknown,
): () => void {
  if (!supabase) return () => {};
  const sb = supabase;
  const confirmado = STATUS_CONFIRMADO[tabela];
  let travado = false;
  let parado = false;

  const tentar = () => {
    if (travado || parado) return;
    travado = true;
    Promise.resolve(aoConfirmar()).then(
      ok => { if (ok === false) travado = false; },
      () => {},
    );
  };

  const channel = sb
    .channel(canal)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: tabela, filter: `id=eq.${id}` },
      (payload: any) => { if (payload?.new?.status === confirmado) tentar(); },
    )
    .subscribe();

  const timer = setInterval(async () => {
    if (travado || parado) return;
    const { data } = await sb.from(tabela).select('status').eq('id', id).maybeSingle();
    if (data?.status === confirmado) tentar();
  }, 2000);

  return () => { parado = true; sb.removeChannel(channel); clearInterval(timer); };
}
