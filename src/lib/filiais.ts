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

// Identidade visual da unidade — logo, cor e a cor da PLACA onde o logo
// assenta.
//
// A placa existe porque os PNGs vieram com fundo queimado, cada um diferente: o
// SuperMax é arte que só fecha sobre claro, o TechMax vem com branco chapado e
// o MaxLook com preto chapado. Enquanto os três não vierem transparentes, a
// placa não tem como ser a mesma cor nos três — é a mesma constatação que o
// FilialSelector já fazia, agora num lugar onde outras telas alcançam.
//
// `cor` é o tom que identifica a unidade à distância (moldura, anel da foto,
// selo). Vem das mesmas famílias do FILIAL_COLOR acima, em hex, porque aqui
// entra em gradiente e em borda inline — classe Tailwind dinâmica não existe.
export const FILIAL_IDENTIDADE: Record<FilialHolding, {
  logo: string;
  cor: string;
  /** Fundo da plaquinha do logo. `null` = o PNG já é transparente. */
  plate: string | null;
}> = {
  SuperMax: { logo: '/icon-supermax-view.png', cor: '#608CFF', plate: '#ffffff' },
  MaxLook:  { logo: '/icon-maxlook.png',       cor: '#E8CDA8', plate: '#000000' },
  TechMax:  { logo: '/icon-techmax.png',       cor: '#FF9646', plate: '#ffffff' },
  Matriz:   { logo: '/icon-logmax.png',        cor: '#F0B429', plate: null },
};

/** Identidade da unidade, com a da holding como rede de segurança: filial nula
 *  ou desconhecida (cadastro antigo, dado de outra turma) não pode derrubar a
 *  tela nem sair sem logo. */
export const identidadeDaFilial = (filial: string | null | undefined) =>
  (isFilialHolding(filial) ? FILIAL_IDENTIDADE[filial] : FILIAL_IDENTIDADE.Matriz);

// Uma conta de `caixa_bancos` pertence à unidade quando a filial casa. O
// literal 'Matriz' é a holding (migr. 325); `filial = null` é a conta
// global/legada de antes da coluna existir e continua valendo pra todas as
// unidades — a policy `caixa_bancos_select` (migr. 196) trata NULL assim, e
// há turma cujo único banco cadastrado está nesse estado.
export const bancoDaUnidade = (banco: { filial?: string | null }, unidade: string) =>
  banco.filial == null || banco.filial === unidade;
