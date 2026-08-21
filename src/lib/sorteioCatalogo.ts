// Sorteio determinístico sobre o catálogo semente (`catalogoNicho.ts`).
//
// Determinístico de propósito: o professor gera a folha, o aluno perde a
// folha, o professor pede de novo — precisa sair a MESMA lista, não uma
// nova. A semente vai impressa no rodapé do PDF (ver `catalogoNichoPdf.ts`)
// e reproduz o sorteio exato via `sortear({ ...  semente })`.
//
// PRNG: mulberry32. Não é criptográfico — não precisa ser, é sorteio de
// enunciado de aula, não geração de token.

import { CATALOGO_NICHO, type ItemCatalogoNicho } from './catalogoNicho';

export type NichoCatalogo = keyof typeof CATALOGO_NICHO;

export type ItemSorteado = ItemCatalogoNicho & { nicho: NichoCatalogo };

export type SorteioOpts = {
  nichos: NichoCatalogo[];
  qtd: number;
  categoria?: string;
  /** Nome+marca (case-insensitive) a excluir da urna — já cadastrado na turma. */
  excluir?: Set<string>;
  /** Semente explícita — informe para reproduzir um sorteio já feito. */
  semente?: number;
};

export type ResultadoSorteio = {
  semente: number;
  itens: ItemSorteado[];
};

const chaveItem = (i: ItemCatalogoNicho): string => `${i.nome}|${i.marca}`.toLowerCase();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gera uma semente nova de 32 bits — usar quando o professor não informa uma. */
export function gerarSemente(): number {
  return Math.floor(Math.random() * 0x100000000);
}

/** A urna já filtrada, na ordem do catálogo (antes de embaralhar). */
function montarUrna(opts: Pick<SorteioOpts, 'nichos' | 'categoria' | 'excluir'>): ItemSorteado[] {
  const urna: ItemSorteado[] = [];
  for (const nicho of opts.nichos) {
    for (const item of CATALOGO_NICHO[nicho]) {
      if (opts.categoria && item.categoria !== opts.categoria) continue;
      if (opts.excluir?.has(chaveItem(item))) continue;
      urna.push({ ...item, nicho });
    }
  }
  return urna;
}

/**
 * Quantos itens o filtro atual deixa sorteáveis. A tela usa para não oferecer
 * um teto que o catálogo não tem — pedir 40 de um nicho com 37 devolveria 37
 * em silêncio, e o professor leria isso como filtro quebrado.
 */
export function contarDisponiveis(
  opts: Pick<SorteioOpts, 'nichos' | 'categoria' | 'excluir'>,
): number {
  return montarUrna(opts).length;
}

/**
 * Sorteia `qtd` itens (sem repetição) dentre os nichos pedidos, filtrando por
 * categoria e excluindo o que a turma já cadastrou. Se a urna filtrada tiver
 * menos itens que `qtd`, devolve a urna inteira — não é erro, é a turma ter
 * um nicho pequeno ou já ter cadastrado quase tudo.
 */
export function sortear(opts: SorteioOpts): ResultadoSorteio {
  const semente = opts.semente ?? gerarSemente();
  const rng = mulberry32(semente);

  const urna = montarUrna(opts);

  // Fisher-Yates com o PRNG da semente — reprodutível.
  for (let i = urna.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [urna[i], urna[j]] = [urna[j], urna[i]];
  }

  return { semente, itens: urna.slice(0, Math.max(0, opts.qtd)) };
}

/** Categorias disponíveis nos nichos pedidos, para popular o select de filtro. */
export function categoriasDisponiveis(nichos: NichoCatalogo[]): string[] {
  const set = new Set<string>();
  for (const nicho of nichos) {
    for (const item of CATALOGO_NICHO[nicho]) set.add(item.categoria);
  }
  return [...set].sort();
}
