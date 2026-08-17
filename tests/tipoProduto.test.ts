// Guarda do tipo do produto — e, principalmente, da FORMA da pergunta.
//
// O defeito que a migr. 440 desfez não foi "faltava um valor no CHECK": foi que
// toda checagem era BLACKLIST (`tipo !== 'patrimonio'`). Blacklist faz coisa
// nova nascer permitida — acrescentar 'consumo' sem mais nada teria posto resma
// de papel no caixa, exatamente como antes.
//
// Por isso o teste mais importante deste arquivo não é sobre os valores: é o
// que varre as views de venda procurando a forma antiga voltar. Ele falha no
// dia em que alguém escrever `tipo !== 'patrimonio'` de novo.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TIPOS_PRODUTO,
  TIPO_LABEL,
  TIPO_AJUDA,
  normalizarTipo,
  ehVendavel,
  temEstoque,
} from '../src/lib/tipoProduto';

describe('os três destinos', () => {
  it('tem exatamente os três que o CHECK do banco aceita', () => {
    expect([...TIPOS_PRODUTO]).toEqual(['estoque_venda', 'consumo', 'patrimonio']);
  });

  it('todo tipo tem rótulo e ajuda — o aluno decide nesta tela', () => {
    for (const t of TIPOS_PRODUTO) {
      expect(TIPO_LABEL[t]?.length).toBeGreaterThan(0);
      expect(TIPO_AJUDA[t]?.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizarTipo', () => {
  it('legado sem tipo vale como mercadoria — sempre foi na prática', () => {
    expect(normalizarTipo(null)).toBe('estoque_venda');
    expect(normalizarTipo(undefined)).toBe('estoque_venda');
    expect(normalizarTipo('')).toBe('estoque_venda');
  });

  it('não inventa tipo a partir de lixo', () => {
    expect(normalizarTipo('mercadoria')).toBe('estoque_venda');
    expect(normalizarTipo('PATRIMONIO')).toBe('estoque_venda');
  });

  it('preserva consumo — era o bug do openEdit', () => {
    // `item.tipo === 'patrimonio' ? 'patrimonio' : 'estoque_venda'` reclassificava
    // todo item de consumo como mercadoria só por abri-lo para editar.
    expect(normalizarTipo('consumo')).toBe('consumo');
    expect(normalizarTipo('patrimonio')).toBe('patrimonio');
  });
});

describe('ehVendavel — só mercadoria vai ao caixa', () => {
  it('resma de papel não se vende', () => {
    expect(ehVendavel('consumo')).toBe(false);
  });

  it('freezer não se vende', () => {
    expect(ehVendavel('patrimonio')).toBe(false);
  });

  it('mercadoria e legado sem tipo, sim', () => {
    expect(ehVendavel('estoque_venda')).toBe(true);
    expect(ehVendavel(null)).toBe(true);
  });
});

describe('temEstoque — consumo tem saldo, patrimônio não', () => {
  it('consumo tem: a resma entra, é requisitada e sai', () => {
    expect(temEstoque('consumo')).toBe(true);
  });

  it('patrimônio não: um freezer não se repõe', () => {
    expect(temEstoque('patrimonio')).toBe(false);
  });

  it('é mais largo que ehVendavel, e essa é a diferença que importa', () => {
    // Reposição, requisição de material, lote de validade e sugestão de compra
    // usam `temEstoque`; PDV, catálogo, orçamento e loja usam `ehVendavel`.
    const comEstoque = TIPOS_PRODUTO.filter(temEstoque);
    const vendaveis  = TIPOS_PRODUTO.filter(ehVendavel);
    expect(comEstoque.length).toBeGreaterThan(vendaveis.length);
    expect(vendaveis.every(t => comEstoque.includes(t))).toBe(true);
  });
});

describe('as telas de venda não voltam a perguntar por exclusão', () => {
  // Uma linha por arquivo que decide o que pode ser vendido/publicado.
  const TELAS_DE_VENDA = [
    'src/views/PDVView.tsx',
    'src/views/PDVViewSupermax.tsx',
    'src/views/CatalogoProdutosView.tsx',
    'src/views/OrcamentosView.tsx',
    'src/views/PedidosOnlineView.tsx',
  ];

  /**
   * Tira comentários antes de procurar. A regra é sobre o que EXECUTA: os
   * comentários destas telas citam a forma antiga de propósito, explicando por
   * que ela saiu, e um teste que proíbe explicar o passado empurra a explicação
   * para fora do arquivo — que é onde ela não é lida.
   */
  const semComentarios = (fonte: string) =>
    fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it.each(TELAS_DE_VENDA)('%s não usa blacklist de tipo', (arquivo) => {
    const codigo = semComentarios(readFileSync(arquivo, 'utf-8'));
    // Qualquer comparação por diferença contra um tipo literal é a forma antiga.
    const blacklist = /tipo\s*!==\s*['"](patrimonio|consumo)['"]/;
    expect(codigo).not.toMatch(blacklist);
  });

  it.each(TELAS_DE_VENDA)('%s decide pela régua única', (arquivo) => {
    const fonte = readFileSync(arquivo, 'utf-8');
    expect(fonte).toContain('ehVendavel');
  });
});
