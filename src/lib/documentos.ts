// Como o documento se chama na tela.
//
// A requisição de compra tem número de verdade desde a migr. 335
// (REQ-SM-2026-0001, sequencial por filial e ano). O fallback existe para o
// intervalo entre o deploy do frontend e a migração rodar em cada turma: até
// lá, o id curto mantém o documento identificável em vez de mostrar vazio —
// e é o mesmo formato que a Auditoria e o histórico já usam.

const curto = (id: any) => String(id ?? '').slice(-6).toUpperCase();

export const numeroRequisicao = (r: { numero?: string | null; id?: any } | null | undefined): string =>
  r?.numero?.trim() || (r?.id ? `REQ-${curto(r.id)}` : '—');

export const numeroCotacao = (c: { numero?: string | null; id?: any } | null | undefined): string =>
  c?.numero?.trim() || (c?.id ? `COT-${curto(c.id)}` : '—');

export const numeroPedido = (p: { numero?: string | null; id?: any } | null | undefined): string =>
  p?.numero?.trim() || (p?.id ? `PC-${curto(p.id)}` : '—');

export const numeroPedidoVenda = (p: { numero?: string | null; id?: any } | null | undefined): string =>
  p?.numero?.trim() || (p?.id ? `PV-${curto(p.id)}` : '—');

export const numeroOrcamento = (o: { numero?: string | null; id?: any } | null | undefined): string =>
  o?.numero?.trim() || (o?.id ? `ORC-${curto(o.id)}` : '—');
