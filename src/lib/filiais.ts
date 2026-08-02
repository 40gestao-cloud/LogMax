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
  SuperMax: { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/20' },
  MaxLook:  { bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'border-violet-500/20' },
  TechMax:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/20' },
  Matriz:   { bg: 'bg-gray-500/10',    text: 'text-gray-400',    border: 'border-gray-500/20' },
};

export const isFilialHolding = (v: any): v is FilialHolding =>
  typeof v === 'string' && (FILIAIS_HOLDING as readonly string[]).includes(v);

// Uma conta de `caixa_bancos` pertence à unidade quando a filial casa. O
// literal 'Matriz' é a holding (migr. 325); `filial = null` é a conta
// global/legada de antes da coluna existir e continua valendo pra todas as
// unidades — a policy `caixa_bancos_select` (migr. 196) trata NULL assim, e
// há turma cujo único banco cadastrado está nesse estado.
export const bancoDaUnidade = (banco: { filial?: string | null }, unidade: string) =>
  banco.filial == null || banco.filial === unidade;
