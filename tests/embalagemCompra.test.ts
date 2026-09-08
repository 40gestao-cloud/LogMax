// Guarda da TERCEIRA medida do produto — a embalagem de compra (migr. 589).
//
// As outras duas já têm guarda em `unidadesConteudo.test.ts`:
//
//   unidade              como o item entra e sai do estoque   (UN)
//   peso/peso_unidade    o conteúdo da embalagem de venda     (1 KG)
//   embalagem de compra  como o fornecedor vende              (fardo com 30)
//
// A conta que este arquivo protege é a que atravessa quatro telas — requisição,
// cotação, recebimento e sugestão de compra — e que, errada, some por semanas:
// o estoque fica 30× menor ou 30× maior, e o erro só aparece no inventário.
//
// Teste estático (sem banco): são funções puras.

import { describe, it, expect } from 'vitest';
import {
  EMBALAGENS_COMPRA,
  embalagemDoProduto,
  pluralEmbalagem,
  rotuloEmbalagem,
  rotuloUnidade,
  NOME_UNIDADE,
  UNIDADES_PRODUTO,
} from '../src/lib/unidades';
import { qtdEmEstoque } from '../src/components/QuantidadeEmbalagem';

describe('leitura da embalagem do cadastro', () => {
  it('lê nome e fator do produto', () => {
    expect(embalagemDoProduto({ embalagem_compra: 'FARDO', embalagem_qtd: 30 }))
      .toEqual({ nome: 'FARDO', fator: 30 });
  });

  it('aceita o numeric do Postgres, que chega como texto com escala', () => {
    // `numeric(15,3)` volta "30.000" pelo PostgREST — Number() dá conta, mas o
    // caminho tem de estar coberto: foi assim que `peso` virou 900 sem medida.
    expect(embalagemDoProduto({ embalagem_compra: 'CAIXA', embalagem_qtd: '24.000' as any }))
      .toEqual({ nome: 'CAIXA', fator: 24 });
  });

  it('produto sem embalagem não oferece a conversão', () => {
    expect(embalagemDoProduto({ embalagem_compra: null, embalagem_qtd: null })).toBeNull();
    expect(embalagemDoProduto(null)).toBeNull();
    expect(embalagemDoProduto(undefined)).toBeNull();
  });

  it('fardo com 1 é a própria unidade, não embalagem', () => {
    // Espelha `chk_produtos_embalagem_qtd` (migr. 589): deixar passar faria a
    // tela oferecer "pedir em FARDO" para converter 20 em 20.
    expect(embalagemDoProduto({ embalagem_compra: 'FARDO', embalagem_qtd: 1 })).toBeNull();
    expect(embalagemDoProduto({ embalagem_compra: 'FARDO', embalagem_qtd: 0 })).toBeNull();
  });

  it('metade do par não vale — nome sem fator, fator sem nome', () => {
    expect(embalagemDoProduto({ embalagem_compra: 'FARDO', embalagem_qtd: null })).toBeNull();
    expect(embalagemDoProduto({ embalagem_compra: '', embalagem_qtd: 30 })).toBeNull();
  });
});

describe('conversão para a unidade de estoque', () => {
  const fardo = { nome: 'FARDO', fator: 30 };

  it('20 fardos de 30 são 600 unidades', () => {
    expect(qtdEmEstoque('20', fardo, true)).toBe(600);
  });

  it('em unidade solta o número passa inteiro', () => {
    expect(qtdEmEstoque('20', fardo, false)).toBe(20);
    expect(qtdEmEstoque('20', null, true)).toBe(20);
  });

  it('aceita a vírgula do teclado pt-BR', () => {
    // Saco de 60 KG de café: granel também se compra em embalagem fechada.
    expect(qtdEmEstoque('2,5', { nome: 'SACO', fator: 60 }, true)).toBe(150);
  });

  it('campo vazio é zero, não NaN — a tela recusa antes de gravar', () => {
    expect(qtdEmEstoque('', fardo, true)).toBe(0);
  });
});

describe('arredondamento para embalagem fechada', () => {
  // A régua da sugestão de compra: fornecedor não abre fardo, e pedir a menos
  // deixaria a ruptura de pé.
  const emFardos = (falta: number, fator: number) => {
    const n = Math.ceil(falta / fator);
    return { embalagens: n, unidades: n * fator };
  };

  it('faltando 250 com fardo de 30, pede 9 fardos (270)', () => {
    expect(emFardos(250, 30)).toEqual({ embalagens: 9, unidades: 270 });
  });

  it('múltiplo exato não sobe uma embalagem à toa', () => {
    expect(emFardos(240, 30)).toEqual({ embalagens: 8, unidades: 240 });
  });

  it('faltando menos que um fardo, pede um fardo', () => {
    expect(emFardos(3, 30)).toEqual({ embalagens: 1, unidades: 30 });
  });
});

describe('o estoque nunca conta embalagem de compra', () => {
  // A régua está escrita no topo de `src/lib/unidades.ts`. Estes três casos
  // são o que impede alguém de desfazê-la sem perceber.

  it('nenhuma embalagem de compra é oferecida como unidade de estoque', () => {
    // Se 'FARDO' (ou 'CX' como apelido de caixa de compra) entrar na lista de
    // unidades, o saldo passa a poder ser contado em fardo — e é aí que a
    // divergência de inventário nasce.
    for (const e of EMBALAGENS_COMPRA) {
      expect(UNIDADES_PRODUTO as readonly string[]).not.toContain(e);
    }
  });

  it('a conversão sempre devolve unidade de estoque, nunca embalagem', () => {
    const fardo = { nome: 'FARDO', fator: 30 };
    // 20 fardos entram como 600 unidades: o 20 não sobrevive à conversão.
    expect(qtdEmEstoque('20', fardo, true)).toBe(600);
    // E sem embalagem o número passa como está — não há multiplicação oculta.
    expect(qtdEmEstoque('20', fardo, false)).toBe(20);
  });

  it('embalagem de uma unidade não vira fator', () => {
    // Seria a porta dos fundos: fator 1 passaria despercebido e faria a tela
    // oferecer conversão onde não há conversão nenhuma.
    expect(embalagemDoProduto({ embalagem_compra: 'CAIXA', embalagem_qtd: 1 })).toBeNull();
  });
});

describe('rótulos', () => {
  it('plural de prateleira', () => {
    expect(pluralEmbalagem('FARDO', 1)).toBe('FARDO');
    expect(pluralEmbalagem('FARDO', 2)).toBe('FARDOS');
    expect(pluralEmbalagem('CAIXA', 3)).toBe('CAIXAS');
    // Todas as seis pluralizam com S — se entrar uma que não pluralize assim,
    // este teste é onde se descobre.
    for (const e of EMBALAGENS_COMPRA) {
      expect(pluralEmbalagem(e, 2)).toBe(`${e}S`);
    }
  });

  it('a ficha diz a embalagem na unidade de estoque do produto', () => {
    expect(rotuloEmbalagem({ nome: 'FARDO', fator: 30 }, 'UN')).toBe('FARDO com 30 UN');
    expect(rotuloEmbalagem({ nome: 'SACO', fator: 60 }, 'KG')).toBe('SACO com 60 KG');
    expect(rotuloEmbalagem(null, 'UN')).toBe('');
  });

  it('toda unidade oferecida no cadastro tem nome por extenso', () => {
    // "PC" e "PCT" a um caractere de distância eram peça e pacote sem nada que
    // dissesse qual é qual. Unidade nova sem nome cai aqui.
    for (const u of UNIDADES_PRODUTO) {
      expect(NOME_UNIDADE[u], `falta o nome de ${u}`).toBeTruthy();
      expect(rotuloUnidade(u)).toBe(`${u} — ${NOME_UNIDADE[u]}`);
    }
    expect(rotuloUnidade('SV')).toBe('SV — serviço');
  });

  it('sigla desconhecida aparece sozinha, sem inventar nome', () => {
    expect(rotuloUnidade('XPTO')).toBe('XPTO');
    expect(rotuloUnidade('')).toBe('');
  });
});
