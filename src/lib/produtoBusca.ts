// Busca de produto compartilhada entre os PDVs (SuperMax, MaxLook, TechMax).
//
// Existe porque as duas telas de PDV filtravam com `.includes()`, que casa
// substring em QUALQUER posição: digitar "ca" trazia ma[ca]rrão junto com café,
// e "c" trazia quase todo o catálogo. Num PDV isso é ruído puro — o operador
// digita o começo do nome ou bipa o código, nunca o miolo da palavra.
//
// Regra aqui: casamento por PREFIXO — de nome, de palavra do nome, de código
// ou de EAN.

// Acentos: "feijão" digitado precisa casar com "FEIJAO" cadastrado, e vice-versa.
// Regex via constructor pra evitar dúvida de encoding do arquivo.
const ACCENT_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');

/** lowercase + sem acento, para comparação de busca. */
export const normalizarBusca = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(ACCENT_REGEX, '').toLowerCase();

// Separadores de palavra em nome de produto: espaço, hífen, barra, ponto,
// vírgula e parênteses. "Leite Integral 1L" -> ['leite','integral','1l'].
const PALAVRA_SPLIT = new RegExp('[\\s\\-/.,()]+');

export interface ProdutoBuscavel {
  nome?: string | null;
  codigo?: string | null;
  ean?: string | null;
}

/**
 * O produto casa com o termo?
 *
 * `termoNorm` deve vir de normalizarBusca(); `termoRaw` é o texto cru, usado só
 * no EAN — que é numérico e não ganha nada em ser normalizado.
 *
 * O caso "alguma palavra começa com o termo" é intencional: sem ele, "cond"
 * deixaria de encontrar "Leite Condensado", que é busca legítima de operador.
 */
export function produtoCasa(p: ProdutoBuscavel, termoNorm: string, termoRaw: string): boolean {
  if (!termoNorm) return false;
  const nome = normalizarBusca(p.nome);
  if (nome.startsWith(termoNorm)) return true;
  if (nome.split(PALAVRA_SPLIT).some(w => w.startsWith(termoNorm))) return true;
  if (normalizarBusca(p.codigo).startsWith(termoNorm)) return true;
  if (termoRaw && String(p.ean ?? '').startsWith(termoRaw)) return true;
  return false;
}

/** 0 = nome começa com o termo, 1 = alguma palavra começa, 2 = casou por código/EAN. */
export function produtoRank(p: ProdutoBuscavel, termoNorm: string): number {
  const nome = normalizarBusca(p.nome);
  if (nome.startsWith(termoNorm)) return 0;
  if (nome.split(PALAVRA_SPLIT).some(w => w.startsWith(termoNorm))) return 1;
  return 2;
}

/**
 * Filtra por prefixo e ordena: nome inteiro > palavra > código/EAN, depois A-Z.
 * Termo vazio devolve a lista original (só truncada), preservando a ordem que
 * a tela já tinha — busca vazia não deve reordenar a grade.
 */
export function buscarProdutos<T extends ProdutoBuscavel>(
  lista: T[],
  termoRaw: string,
  limite: number,
): T[] {
  const t = normalizarBusca(termoRaw.trim());
  if (!t) return lista.slice(0, limite);
  const raw = termoRaw.trim();
  return lista
    .filter(p => produtoCasa(p, t, raw))
    .sort((a, b) => {
      const ra = produtoRank(a, t);
      const rb = produtoRank(b, t);
      if (ra !== rb) return ra - rb;
      return String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
    })
    .slice(0, limite);
}
