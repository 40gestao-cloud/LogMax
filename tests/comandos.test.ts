import { describe, it, expect } from 'vitest';
import { listaDeComandos, filtrarComandos, casarComando, normalizar } from '../src/lib/comandos';

const todos = listaDeComandos(true);
const semPrivilegio = listaDeComandos(false);

const id = (texto: string) => casarComando(texto, todos)?.id ?? null;

describe('normalizar', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizar('Eletrônicos, informática!')).toBe('eletronicos informatica');
  });
});

describe('casarComando', () => {
  it('casa o nome cru', () => {
    expect(id('supermax')).toBe('unidade:SuperMax');
    expect(id('TechMax')).toBe('unidade:TechMax');
    expect(id('matriz')).toBe('unidade:Matriz');
  });

  it('casa dentro da frase', () => {
    expect(id('ir para a supermax agora')).toBe('unidade:SuperMax');
    expect(id('quero sair do sistema')).toBe('sair');
    expect(id('abrir max look por favor')).toBe('unidade:MaxLook');
  });

  it('casa a grafia separada', () => {
    expect(id('super max')).toBe('unidade:SuperMax');
    expect(id('tec max')).toBe('unidade:TechMax');
  });

  it('recusa em vez de chutar', () => {
    expect(id('')).toBeNull();
    expect(id('abrir o relatório de vendas')).toBeNull();
  });

  it('sem privilégio, nome de unidade não vira comando', () => {
    expect(casarComando('supermax', semPrivilegio)).toBeNull();
    expect(casarComando('sair', semPrivilegio)?.id).toBe('sair');
  });
});

describe('listaDeComandos', () => {
  it('quem não pode trocar de unidade só recebe o sair', () => {
    expect(semPrivilegio.map(c => c.id)).toEqual(['sair']);
  });

  it('quem pode recebe as quatro unidades, o seletor e o sair', () => {
    expect(todos.map(c => c.id)).toEqual([
      'unidade:Matriz', 'unidade:SuperMax', 'unidade:MaxLook', 'unidade:TechMax', 'seletor', 'sair',
    ]);
  });
});

describe('filtrarComandos', () => {
  it('busca vazia devolve tudo', () => {
    expect(filtrarComandos('', todos)).toHaveLength(todos.length);
  });

  it('filtra por nicho, não só por nome', () => {
    expect(filtrarComandos('moda', todos).map(c => c.id)).toEqual(['unidade:MaxLook']);
    expect(filtrarComandos('supermerc', todos).map(c => c.id)).toEqual(['unidade:SuperMax']);
  });

  it('prefixo ambíguo mostra as opções em vez de escolher', () => {
    expect(filtrarComandos('max', todos).length).toBeGreaterThan(1);
    expect(id('max')).toBeNull();
  });
});
