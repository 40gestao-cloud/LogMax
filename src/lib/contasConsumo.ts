// Contas de consumo e tipo de fornecedor (migr. 679) — régua única para as
// telas de Fornecedores, Contas a Pagar e os selects de compra.
import { gruposDeCadastro } from './cadastrosSelect';
import type { SelectBuscaGrupo } from '../components/SelectBusca';

export type TipoFornecedor = 'mercadoria' | 'servico' | 'concessionaria';

export const TIPOS_FORNECEDOR: ReadonlyArray<{ valor: TipoFornecedor; rotulo: string; dica: string }> = [
  { valor: 'mercadoria',     rotulo: 'Mercadoria',     dica: 'Vende o que a loja revende ou consome (entra por pedido de compra).' },
  { valor: 'servico',        rotulo: 'Serviço',        dica: 'Presta serviço contratado: manutenção, dedetização, frete, contador.' },
  { valor: 'concessionaria', rotulo: 'Concessionária', dica: 'Energia, água, internet, telefone, gás — conta direto em Contas a Pagar.' },
];

export const rotuloTipoFornecedor = (t?: string | null) =>
  TIPOS_FORNECEDOR.find(x => x.valor === t)?.rotulo ?? 'Mercadoria';

// Sugestões de categoria por tipo (o campo continua livre — é só o datalist).
export const CATEGORIAS_SUGERIDAS: Record<TipoFornecedor, string[]> = {
  mercadoria:     ['Alimentos', 'Bebidas', 'Limpeza e higiene', 'Moda', 'Calçados', 'Eletrônicos', 'Acessórios', 'Material de escritório'],
  servico:        ['Manutenção', 'Limpeza e conservação', 'Segurança', 'Transporte / frete', 'Contabilidade', 'Marketing', 'TI e suporte'],
  concessionaria: ['Energia elétrica', 'Água e esgoto', 'Internet', 'Telefonia', 'Gás'],
};

// Concessionária não entra em compra (cotação, pedido, nota, fornecedor
// habitual de produto). O banco recusa do mesmo jeito (gatilho da 679).
export const fornecedoresDeCompra = <T extends { tipo?: string | null }>(rows: T[]): T[] =>
  (rows ?? []).filter(f => f.tipo !== 'concessionaria');

// Atalhos de conta de consumo no Contas a Pagar: preenchem descrição,
// natureza e o centro de custo que leva a conta à linha certa do DRE.
export type AtalhoConsumo = { rotulo: string; descricao: string; centro: string; variavel: boolean };
export const ATALHOS_CONSUMO: ReadonlyArray<AtalhoConsumo> = [
  { rotulo: 'Energia',           descricao: 'Energia elétrica',     centro: 'Ocupação',       variavel: true },
  { rotulo: 'Água',              descricao: 'Água e esgoto',        centro: 'Ocupação',       variavel: true },
  { rotulo: 'Internet/Telefone', descricao: 'Internet e telefonia', centro: 'Tecnologia',     variavel: false },
  { rotulo: 'Aluguel',           descricao: 'Aluguel do imóvel',    centro: 'Ocupação',       variavel: false },
  { rotulo: 'Contador',          descricao: 'Honorários contábeis', centro: 'Administrativo', variavel: false },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
export const centroPorNome = (centros: any[], nome: string): string =>
  (centros ?? []).find((c: any) => norm(c.nome ?? '') === norm(nome))?.id ?? '';

// Select de fornecedor no Contas a Pagar: separado por tipo, concessionária
// primeiro (é o caso mais comum de conta avulsa).
export const gruposFornecedorPorTipo = (rows: any[]): SelectBuscaGrupo[] =>
  (['concessionaria', 'servico', 'mercadoria'] as TipoFornecedor[]).flatMap(t => {
    const doTipo = (rows ?? []).filter(f => (f.tipo ?? 'mercadoria') === t);
    if (doTipo.length === 0) return [];
    return gruposDeCadastro(doTipo).map(g => ({ ...g, label: [rotuloTipoFornecedor(t), g.label].filter(Boolean).join(' · ') }));
  });
