// Dois textos livres descrevem o mesmo item?
//
// Só existe porque a compra EVENTUAL é texto livre por definição: o item ainda
// não está no catálogo, então não há código para comparar. Onde há código
// (`produto_id`), é ele que manda — esta régua nem é consultada. Ver
// `vivasDoItem` em RequisicoesSetorView e `irmasVivas` em AprovacoesComprasView.
//
// O caso que originou tudo, na turma ERP de 24/08: "Sal Refinado 1kg" foi
// devolvida para correção e "Sal Refinado 1kg Cisne" foi aberta em seguida —
// mesmo sal, dois documentos, e o gerente decidindo a mesma compra duas vezes.
// Igualdade de texto não pega isso; a marca no fim muda a string inteira.
//
// ── Por que não é "quanto mais parecido melhor" ─────────────────────────────
// O risco de apertar demais é pior que o de errar por falta: aviso que dispara
// em item legitimamente diferente ensina a turma a clicar "sim" sem ler, e aí
// ele para de valer nos casos em que está certo. Por isso a régua é
// conservadora e explícita, em vez de um número de similaridade solto:
//
//   1. MEDIDA divergente barra tudo. "Sabão Omo 500g" e "Sabão Omo 1kg" são
//      itens diferentes de prateleira, por mais parecido que o texto seja.
//   2. CONTINÊNCIA é o sinal forte: um conjunto de palavras dentro do outro é
//      o padrão "mesmo item + marca a mais", que é exatamente o caso do sal.
//   3. DIFERENÇA DOS DOIS LADOS encerra: se cada nome tem ao menos uma palavra
//      própria que não é medida, são duas especificações diferentes.
//      "Macarrão Espaguete 500 g Dona Benta" x "Macarrão Parafuso 500 g Dona
//      Benta" divide marca, medida e substantivo — o Dice dava 0.83 e a régua
//      avisava —, mas espaguete e parafuso são dois produtos. Marca igual não
//      é item igual, e é por isso que a continência (diferença de um lado só)
//      continua valendo enquanto esta barra.
//   4. Sobreposição alta (Dice) cobre o resto — troca de ordem, palavra a mais
//      no meio —, exigindo ao menos duas palavras em comum para não casar
//      "Sal Refinado" com "Açúcar Refinado" pelo adjetivo.

/** Ruído gramatical: não identifica item nenhum sozinho. */
const VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'pra', 'e', 'em',
  'a', 'o', 'as', 'os', 'un', 'und', 'unid', 'unidade', 'pct', 'pacote',
]);

/** Medida: o que separa o 500g do 1kg. */
const RE_MEDIDA = /^(\d+(?:[.,]\d+)?)(g|kg|mg|ml|l|cm|mm|m|pol|w|v|gb|tb|mb)$/;

/** Número puro — "500" de "500 g", "12" de "12 unidades". */
const RE_NUMERO = /^\d+(?:[.,]\d+)?$/;

/**
 * Unidade escrita separada do número. A turma digita "500 g" tanto quanto
 * "500g", e sem isto a medida simplesmente não era vista: `RE_MEDIDA` exige os
 * dois colados. Efeito prático do buraco: "Sabão Omo 500 g" e "Sabão Omo 1 kg"
 * passavam pela trava de medida como se ninguém tivesse declarado nada.
 */
const UNIDADES_SOLTAS: Record<string, string> = {
  g: 'g', grama: 'g', gramas: 'g',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg',
  mg: 'mg',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', litro: 'l', litros: 'l',
  cm: 'cm', mm: 'mm', m: 'm', metro: 'm', metros: 'm',
  pol: 'pol', polegada: 'pol', polegadas: 'pol',
  w: 'w', v: 'v', gb: 'gb', tb: 'tb', mb: 'mb',
};

/**
 * Token que NÃO identifica produto: número solto, unidade solta ou medida
 * completa. Usado para decidir o que conta como "diferença de verdade" entre
 * dois nomes — ver a regra 4 no cabeçalho.
 */
const ehMedidaOuNumero = (t: string): boolean =>
  RE_MEDIDA.test(t) || RE_NUMERO.test(t) || t in UNIDADES_SOLTAS;

const semAcento = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palavras que identificam o item, já sem acento, pontuação e ruído. */
export function palavrasDoItem(nome: string | null | undefined): string[] {
  return semAcento(String(nome ?? '').toLowerCase())
    // Mantém dígitos colados à unidade ("500g"), separa o resto.
    .replace(/["'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0 && !VAZIAS.has(t));
}

/**
 * Medidas declaradas no texto, normalizadas para uma base comum.
 * "1kg" e "1000g" são a mesma coisa e precisam comparar igual — senão a régua
 * barraria por divergência justamente onde os dois textos concordam.
 */
export function medidasDoItem(nome: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const tokens = palavrasDoItem(nome);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let valorTxt: string | undefined;
    let un: string | undefined;

    const m = RE_MEDIDA.exec(t);
    if (m) {
      valorTxt = m[1];
      un = m[2];
    } else if (RE_NUMERO.test(t)) {
      // "500 g": o número está num token e a unidade no seguinte.
      const proxima = tokens[i + 1] !== undefined ? UNIDADES_SOLTAS[tokens[i + 1]] : undefined;
      if (proxima) { valorTxt = t; un = proxima; i++; }
    }
    if (!valorTxt || !un) continue;

    const valor = Number(valorTxt.replace(',', '.'));
    if (!Number.isFinite(valor)) continue;
    // Massa em gramas, volume em mililitros, comprimento em milímetros.
    if (un === 'kg')      out.add(`massa:${valor * 1000}`);
    else if (un === 'g')  out.add(`massa:${valor}`);
    else if (un === 'mg') out.add(`massa:${valor / 1000}`);
    else if (un === 'l')  out.add(`vol:${valor * 1000}`);
    else if (un === 'ml') out.add(`vol:${valor}`);
    else if (un === 'm')  out.add(`comp:${valor * 1000}`);
    else if (un === 'cm') out.add(`comp:${valor * 10}`);
    else if (un === 'mm') out.add(`comp:${valor}`);
    else out.add(`${un}:${valor}`);
  }
  return out;
}

const mesmaMedida = (a: Set<string>, b: Set<string>): boolean => {
  // Um dos dois não declarou medida: não há divergência a apontar. É o caso de
  // "Detergente Ypê" x "Detergente Ypê 500ml", que é justamente o que se quer
  // pegar.
  if (a.size === 0 || b.size === 0) return true;
  // Basta uma medida em comum: o texto costuma trazer uma só, e quando traz
  // duas ("500ml 12un") a que importa aparece nos dois lados.
  for (const m of a) if (b.has(m)) return true;
  return false;
};

/** Dice sobre conjuntos de palavras — tolerante a ordem, que é o que varia. */
const dice = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let comuns = 0;
  for (const t of a) if (b.has(t)) comuns++;
  return (2 * comuns) / (a.size + b.size);
};

export type Semelhanca = 'igual' | 'contido' | 'parecido' | 'nao';

/**
 * O quanto dois nomes de item livre falam da mesma coisa.
 *
 * Devolve o MOTIVO, e não só um booleano, porque a tela precisa dizer ao aluno
 * se aquilo é o mesmo item ou só parece — a decisão é dele, e ele decide melhor
 * sabendo qual dos dois casos está vendo.
 */
export function semelhancaDeItem(
  a: string | null | undefined,
  b: string | null | undefined,
): Semelhanca {
  const pa = palavrasDoItem(a);
  const pb = palavrasDoItem(b);
  if (pa.length === 0 || pb.length === 0) return 'nao';

  const sa = new Set(pa);
  const sb = new Set(pb);

  if (sa.size === sb.size && [...sa].every(t => sb.has(t))) return 'igual';

  // Medida divergente encerra antes de qualquer conta de parecença.
  if (!mesmaMedida(medidasDoItem(a), medidasDoItem(b))) return 'nao';

  const [menor, maior] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  // Duas palavras é o mínimo para "contido" significar alguma coisa: com uma
  // só, "Sal" estaria contido em "Sal Refinado 1kg Cisne" e em "Salsicha".
  if (menor.size >= 2 && [...menor].every(t => maior.has(t))) return 'contido';

  // Diferença dos DOIS lados = duas especificações diferentes.
  //
  // "Macarrão Espaguete 500 g Dona Benta" e "Macarrão Parafuso 500 g Dona
  // Benta" compartilham marca, medida e o substantivo — 5 palavras de 6 — e o
  // Dice abaixo casava os dois em 0.83. Mas cada lado carrega uma palavra que
  // o outro não tem, e nenhuma delas é medida: são DOIS produtos da mesma
  // marca, não o mesmo produto escrito de dois jeitos. A continência acima já
  // cobre o caso legítimo ("mesmo item + marca a mais"), onde a diferença
  // existe de um lado só.
  //
  // Medida e número não contam como diferença aqui: quem separa "500g" de
  // "1kg" é a régua 1, e "1kg" x "1000g" é a MESMA medida escrita diferente —
  // tratá-los como especificação distinta desfaria o caso do sal.
  const exclusivasA = [...sa].filter(t => !sb.has(t) && !ehMedidaOuNumero(t));
  const exclusivasB = [...sb].filter(t => !sa.has(t) && !ehMedidaOuNumero(t));
  if (exclusivasA.length > 0 && exclusivasB.length > 0) return 'nao';

  // Sobreposição alta com pelo menos duas palavras em comum. O 0.72 sai da
  // régua acima: 3 de 4 palavras em comum passa (0.75), 2 de 4 não (0.5).
  let comuns = 0;
  for (const t of sa) if (sb.has(t)) comuns++;
  if (comuns >= 2 && dice(sa, sb) >= 0.72) return 'parecido';

  return 'nao';
}

/** Atalho para quem só quer saber se vale avisar. */
export const pareceMesmoItem = (a: string | null | undefined, b: string | null | undefined): boolean =>
  semelhancaDeItem(a, b) !== 'nao';
