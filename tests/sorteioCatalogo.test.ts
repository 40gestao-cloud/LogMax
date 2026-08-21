import { describe, it, expect } from 'vitest';
import { sortear, categoriasDisponiveis, contarDisponiveis } from '../src/lib/sorteioCatalogo';

describe('sortear', () => {
  it('mesma semente devolve a mesma lista', () => {
    const a = sortear({ nichos: ['SuperMax'], qtd: 10, semente: 12345 });
    const b = sortear({ nichos: ['SuperMax'], qtd: 10, semente: 12345 });
    expect(a.itens.map(i => i.nome)).toEqual(b.itens.map(i => i.nome));
    expect(a.semente).toBe(12345);
  });

  it('sementes diferentes tendem a divergir', () => {
    const a = sortear({ nichos: ['SuperMax', 'MaxLook', 'TechMax'], qtd: 20, semente: 1 });
    const b = sortear({ nichos: ['SuperMax', 'MaxLook', 'TechMax'], qtd: 20, semente: 2 });
    expect(a.itens.map(i => i.nome)).not.toEqual(b.itens.map(i => i.nome));
  });

  it('não repete item dentro do mesmo sorteio', () => {
    const { itens } = sortear({ nichos: ['SuperMax', 'MaxLook', 'TechMax'], qtd: 500, semente: 7 });
    const chaves = itens.map(i => `${i.nome}|${i.marca}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('qtd maior que a urna devolve a urna inteira, sem estourar', () => {
    const { itens } = sortear({ nichos: ['SuperMax'], qtd: 10_000, semente: 3 });
    const urnaCheia = sortear({ nichos: ['SuperMax'], qtd: 10_000, semente: 99 }).itens.length;
    expect(itens.length).toBe(urnaCheia);
  });

  it('respeita a exclusão por nome+marca', () => {
    const primeiro = sortear({ nichos: ['SuperMax'], qtd: 1000, semente: 42 }).itens[0];
    const excluir = new Set([`${primeiro.nome}|${primeiro.marca}`.toLowerCase()]);
    const { itens } = sortear({ nichos: ['SuperMax'], qtd: 1000, semente: 42, excluir });
    expect(itens.some(i => i.nome === primeiro.nome && i.marca === primeiro.marca)).toBe(false);
  });

  it('contarDisponiveis casa com o teto que o sorteio entrega', () => {
    const nichos = ['SuperMax', 'MaxLook'] as const;
    const n = contarDisponiveis({ nichos: [...nichos] });
    expect(sortear({ nichos: [...nichos], qtd: 10_000, semente: 5 }).itens.length).toBe(n);

    // E acompanha os filtros, que é o ponto de existir.
    const cat = categoriasDisponiveis([...nichos])[0];
    const comCat = contarDisponiveis({ nichos: [...nichos], categoria: cat });
    expect(comCat).toBeGreaterThan(0);
    expect(comCat).toBeLessThanOrEqual(n);
  });

  it('filtra por categoria', () => {
    const categorias = categoriasDisponiveis(['SuperMax']);
    expect(categorias.length).toBeGreaterThan(0);
    const cat = categorias[0];
    const { itens } = sortear({ nichos: ['SuperMax'], qtd: 1000, categoria: cat, semente: 1 });
    expect(itens.every(i => i.categoria === cat)).toBe(true);
  });
});
