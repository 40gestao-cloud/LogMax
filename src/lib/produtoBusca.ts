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

/**
 * Gramática do multiplicador do PDV: `N*termo`, `N×termo`, `NxTermo` — com
 * decimal por vírgula para item de balança (`0,350*7891`).
 *
 * Mora aqui, e não dentro de uma tela, porque as DUAS formas de identificar o
 * item têm de aceitar a mesma coisa: o campo CÓDIGO e a busca do F8. Enquanto
 * a regex vivia solta no `processCode`, quem não tinha o código na mão (nem
 * leitor) não tinha como vender 2 do mesmo produto sem bipar duas vezes.
 *
 * `termo` volta vazio em "2*" sozinho — que não é erro: é o operador ARMANDO a
 * quantidade antes de escolher o item, como se faz no caixa de mercado.
 */
export interface QtdETermo {
  qtd: number;
  termo: string;
  temMultiplicador: boolean;
}

// `\\s` e não `\s`: dentro de uma string, `\s` não é escape reconhecido e o
// JS o reduz a um "s" literal — o padrão passava a exigir a LETRA s no lugar
// do espaço, e "2 * 7891" (leitor que emite espaço entre os campos) não
// casava. As demais regex deste arquivo já usavam a forma escapada.
const MULTIPLICADOR = new RegExp('^([0-9.,]+)\\s*[*xX×]\\s*(.*)$');

export function separarQtdETermo(raw: string | null | undefined): QtdETermo {
  const t = String(raw ?? '').trim();
  const m = t.match(MULTIPLICADOR);
  if (!m) return { qtd: 1, termo: t, temMultiplicador: false };
  const n = parseFloat(m[1].replace(',', '.'));
  if (!(n > 0)) return { qtd: 1, termo: t, temMultiplicador: false };
  return { qtd: n, termo: m[2].trim(), temMultiplicador: true };
}
