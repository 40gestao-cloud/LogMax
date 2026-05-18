// Unidades de Negócio da Holding. Single source of truth — usado em forms,
// filtros, badges e no payload do RPC criar_venda_pdv.
//
// Para renomear ou adicionar uma unidade, basta editar esta lista. Cadastros
// existentes não migram automaticamente — admin precisa reatribuir manualmente.

export const FILIAIS_HOLDING = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'] as const;

export type FilialHolding = typeof FILIAIS_HOLDING[number];

export const FILIAL_DEFAULT: FilialHolding = 'Matriz';

// Estilo de badge por filial — usado em FilialBadge nas listagens.
// Mapeamento estável: cada unidade tem cor própria pra identificação visual.
export const FILIAL_COLOR: Record<FilialHolding, { bg: string; text: string; border: string }> = {
  SuperMax: { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/20' },
  MaxLook:  { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400', border: 'border-fuchsia-500/20' },
  TechMax:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  Matriz:   { bg: 'bg-gray-500/10',    text: 'text-gray-400',    border: 'border-gray-500/20' },
};

export const isFilialHolding = (v: any): v is FilialHolding =>
  typeof v === 'string' && (FILIAIS_HOLDING as readonly string[]).includes(v);
