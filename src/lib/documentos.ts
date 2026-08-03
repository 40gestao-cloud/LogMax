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
