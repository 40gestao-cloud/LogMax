import { describe, it, expect } from 'vitest';
import { podeVerModulo, SETOR_MODULES } from '../src/lib/sectorAccess';

// `podeVerModulo` existe para decidir se uma tela oferece atalho para outro
// módulo. Errar para MAIS é o caso ruim: o botão aparece, o aluno clica e a
// tela abre negada — parece que o sistema quebrou. Estes testes cobrem a
// régua que a Cotação usa para mostrar (ou não) o botão de cadastrar
// fornecedor, que vive em Cadastros › Fornecedores.
describe('podeVerModulo', () => {
  it('libera o módulo do próprio setor', () => {
    expect(podeVerModulo({ setor: 'logistica' }, 'cadastros')).toBe(true);
    expect(podeVerModulo({ setor: 'financeiro' }, 'financeiro')).toBe(true);
  });

  it('nega módulo fora do setor', () => {
    // Financeiro aprova cotação mas não cadastra fornecedor.
    expect(podeVerModulo({ setor: 'financeiro' }, 'cadastros')).toBe(false);
    expect(podeVerModulo({ setor: 'vendas' }, 'cadastros')).toBe(false);
  });

  it('considera setores_extras, não só o setor principal', () => {
    expect(podeVerModulo({ setor: 'vendas', setores_extras: ['logistica'] }, 'cadastros')).toBe(true);
  });

  it('gerente vê todos os módulos (RLS recorta a filial)', () => {
    expect(podeVerModulo({ role: 'gerente', setor: 'vendas' }, 'cadastros')).toBe(true);
  });

  it('setor desconhecido não derruba nem libera nada', () => {
    expect(podeVerModulo({ setor: 'setor_que_nao_existe' }, 'cadastros')).toBe(false);
    expect(podeVerModulo(null, 'cadastros')).toBe(false);
    expect(podeVerModulo(undefined, 'cadastros')).toBe(false);
  });

  it('bate com o mapa que a sidebar usa', () => {
    // Se alguém tirar 'cadastros' da logística, o atalho da Cotação some
    // junto — e é melhor descobrir aqui do que na aula.
    expect(SETOR_MODULES.logistica).toContain('cadastros');
  });
});
