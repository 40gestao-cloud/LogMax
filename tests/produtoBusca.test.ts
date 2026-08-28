import { describe, it, expect } from 'vitest';
import { produtoCasa, produtoRank, buscarProdutos, normalizarBusca, separarQtdETermo } from '../src/lib/produtoBusca';

// Regressão do bug relatado no PDV SuperMax: a busca usava `.includes()`, então
// digitar "ca" trazia ma[ca]rrão junto com café, e "c" trazia quase tudo.

const CATALOGO = [
  { nome: 'Café Torrado 500g',   codigo: 'SM-001', ean: '7891000100103' },
  { nome: 'Macarrão Espaguete',  codigo: 'SM-002', ean: '7891000200104' },
  { nome: 'Leite Condensado',    codigo: 'SM-003', ean: '7891000300105' },
  { nome: 'Chocolate ao Leite',  codigo: 'SM-004', ean: '7891000400106' },
  { nome: 'Arroz Branco 5kg',    codigo: 'SM-005', ean: '7891000500107' },
];

const nomes = (lista: Array<{ nome?: string | null }>) => lista.map(p => p.nome);

describe('normalizarBusca', () => {
  it('remove acento e baixa a caixa', () => {
    expect(normalizarBusca('Café')).toBe('cafe');
    expect(normalizarBusca('FEIJÃO')).toBe('feijao');
  });

  it('trata null e undefined sem estourar', () => {
    expect(normalizarBusca(null)).toBe('');
    expect(normalizarBusca(undefined)).toBe('');
  });
});

describe('produtoCasa — o bug relatado', () => {
  it('"ca" acha café mas NÃO macarrão', () => {
    const t = normalizarBusca('ca');
    expect(produtoCasa(CATALOGO[0], t, 'ca')).toBe(true);  // Café
    expect(produtoCasa(CATALOGO[1], t, 'ca')).toBe(false); // Macarrão
  });

  it('"c" não varre o catálogo inteiro', () => {
    const achados = buscarProdutos(CATALOGO, 'c', 50);
    // Casam: Café e Chocolate (nome começa com C) e Leite Condensado (a palavra
    // "Condensado" começa com C — é o mesmo mecanismo que faz "cond" achá-lo).
    // Não casam: Macarrão (o "c" está no miolo) nem Arroz.
    expect(nomes(achados)).toEqual([
      'Café Torrado 500g',
      'Chocolate ao Leite',
      'Leite Condensado',
    ]);
    expect(nomes(achados)).not.toContain('Macarrão Espaguete');
    expect(nomes(achados)).not.toContain('Arroz Branco 5kg');
  });

  it('acento é indiferente nos dois sentidos', () => {
    expect(nomes(buscarProdutos(CATALOGO, 'café', 50))).toEqual(['Café Torrado 500g']);
    expect(nomes(buscarProdutos(CATALOGO, 'cafe', 50))).toEqual(['Café Torrado 500g']);
  });
});

describe('produtoCasa — prefixo de palavra', () => {
  it('"cond" acha "Leite Condensado" (senão a busca ficaria inútil)', () => {
    expect(nomes(buscarProdutos(CATALOGO, 'cond', 50))).toEqual(['Leite Condensado']);
  });

  it('"leite" acha os dois que têm a palavra', () => {
    expect(nomes(buscarProdutos(CATALOGO, 'leite', 50)))
      .toEqual(['Leite Condensado', 'Chocolate ao Leite']);
  });

  it('miolo de palavra não casa', () => {
    // "arra" existe dentro de "macARRAo", mas não inicia nenhuma palavra.
    expect(buscarProdutos(CATALOGO, 'arra', 50)).toEqual([]);
  });
});

describe('produtoCasa — código e EAN', () => {
  it('casa por prefixo de código', () => {
    expect(nomes(buscarProdutos(CATALOGO, 'SM-003', 50))).toEqual(['Leite Condensado']);
  });

  it('casa por prefixo de EAN', () => {
    expect(nomes(buscarProdutos(CATALOGO, '789100010', 50))).toEqual(['Café Torrado 500g']);
  });

  it('sufixo de EAN não casa', () => {
    expect(buscarProdutos(CATALOGO, '100103', 50)).toEqual([]);
  });
});

describe('ordenação', () => {
  it('nome inteiro vem antes de palavra do meio', () => {
    expect(produtoRank(CATALOGO[2], normalizarBusca('leite'))).toBe(0); // Leite Condensado
    expect(produtoRank(CATALOGO[3], normalizarBusca('leite'))).toBe(1); // Chocolate ao Leite
    expect(nomes(buscarProdutos(CATALOGO, 'leite', 50))[0]).toBe('Leite Condensado');
  });
});

describe('termo vazio', () => {
  it('devolve a lista na ordem original, só truncada', () => {
    expect(nomes(buscarProdutos(CATALOGO, '', 3))).toEqual(nomes(CATALOGO.slice(0, 3)));
  });

  it('espaço em branco conta como vazio', () => {
    expect(buscarProdutos(CATALOGO, '   ', 50)).toHaveLength(CATALOGO.length);
  });
});

describe('limite', () => {
  it('respeita o teto de resultados', () => {
    expect(buscarProdutos(CATALOGO, 'leite', 1)).toHaveLength(1);
  });
});

// Gramática do multiplicador do PDV. Nasceu de uma pergunta do professor: sem
// código e sem leitor, como se vende 2 do mesmo produto? A resposta é a do
// caixa de mercado — a quantidade vem antes e vale para o item que for
// identificado depois, inclusive o escolhido no F8.
describe('separarQtdETermo', () => {
  it('separa quantidade de código', () => {
    expect(separarQtdETermo('3*7891')).toEqual({ qtd: 3, termo: '7891', temMultiplicador: true });
  });

  it('aceita x, X e × como separador', () => {
    for (const sep of ['x', 'X', '×']) {
      expect(separarQtdETermo(`2${sep}feijao`)).toEqual({ qtd: 2, termo: 'feijao', temMultiplicador: true });
    }
  });

  it('aceita nome no lugar do código', () => {
    expect(separarQtdETermo('2*feijao carioca')).toEqual({ qtd: 2, termo: 'feijao carioca', temMultiplicador: true });
  });

  it('lê peso com vírgula decimal', () => {
    expect(separarQtdETermo('0,350*7891')).toEqual({ qtd: 0.35, termo: '7891', temMultiplicador: true });
  });

  it('"2*" sozinho arma a quantidade e devolve termo vazio', () => {
    expect(separarQtdETermo('2*')).toEqual({ qtd: 2, termo: '', temMultiplicador: true });
  });

  it('termo sem multiplicador vale 1', () => {
    expect(separarQtdETermo('feijao')).toEqual({ qtd: 1, termo: 'feijao', temMultiplicador: false });
    expect(separarQtdETermo('7891000100103')).toEqual({ qtd: 1, termo: '7891000100103', temMultiplicador: false });
  });

  it('quantidade zero ou negativa não é multiplicador', () => {
    expect(separarQtdETermo('0*7891').temMultiplicador).toBe(false);
    expect(separarQtdETermo('0*7891').termo).toBe('0*7891');
  });

  it('nulo e vazio não explodem', () => {
    expect(separarQtdETermo(null)).toEqual({ qtd: 1, termo: '', temMultiplicador: false });
    expect(separarQtdETermo('   ')).toEqual({ qtd: 1, termo: '', temMultiplicador: false });
  });

  it('o termo separado alimenta a busca por nome', () => {
    const { qtd, termo } = separarQtdETermo('2*cafe');
    expect(qtd).toBe(2);
    expect(nomes(buscarProdutos(CATALOGO, termo, 10))).toEqual(['Café Torrado 500g']);
  });

  // Regressão: a regex era montada com `new RegExp('...\s*...')`, e dentro de
  // uma string o `\s` vira um "s" literal — o padrão exigia a LETRA s onde
  // devia aceitar espaço. Nenhum caso daqui usava espaço, então o defeito
  // passou. Leitor que emite espaço entre os campos caía fora do multiplicador.
  it('aceita espaço em volta do separador', () => {
    expect(separarQtdETermo('2 * 7891')).toEqual({ qtd: 2, termo: '7891', temMultiplicador: true });
    expect(separarQtdETermo('2* 7891')).toEqual({ qtd: 2, termo: '7891', temMultiplicador: true });
    expect(separarQtdETermo('2 *7891')).toEqual({ qtd: 2, termo: '7891', temMultiplicador: true });
    expect(separarQtdETermo('0,350 * 7891')).toEqual({ qtd: 0.35, termo: '7891', temMultiplicador: true });
  });

  it('"s" não é separador — só espaço em branco de verdade', () => {
    expect(separarQtdETermo('2s*7891').temMultiplicador).toBe(false);
  });
});
