// Guarda das duas medidas do produto — a confusão que a migr. 438 desfez.
//
// O cadastro tratava "unidade de estoque" e "medida do conteúdo" como a mesma
// coisa, então arroz de 5 kg vendido em pacote não tinha como ser cadastrado: o
// campo Peso/Volume herdava o rótulo da unidade de estoque e lia "(UN)". Nas
// quatro turmas isso produziu peso 900 e peso 0,5 na mesma coluna.
//
// Teste estático (sem banco): são funções puras, e é justamente a regra que
// ninguém lembra de conferir à mão quando mexe no formulário.

import { describe, it, expect } from 'vitest';
import {
  conteudoNoNome,
  divergenciaDeConteudo,
  UNIDADES_CONTEUDO,
  UNIDADES_DISCRETAS,
  UNIDADES_FRACIONARIAS,
  temConteudoDeEmbalagem,
  formatarConteudo,
  unidadesDeProduto,
} from '../src/lib/unidades';
import { formatQtd, parseQtd, qtdBR, handleQtdKeyDown } from '../src/lib/viewUtils';

describe('conteúdo da embalagem x unidade de estoque', () => {
  it('embalagem fechada tem conteúdo a declarar', () => {
    for (const u of UNIDADES_DISCRETAS) {
      expect(temConteudoDeEmbalagem(u)).toBe(true);
    }
  });

  it('granel não tem: a unidade de estoque já é a medida', () => {
    for (const u of UNIDADES_FRACIONARIAS) {
      expect(temConteudoDeEmbalagem(u)).toBe(false);
    }
  });

  it('normaliza a caixa antes de decidir', () => {
    expect(temConteudoDeEmbalagem('kg')).toBe(false);
    expect(temConteudoDeEmbalagem(' UN ')).toBe(true);
  });

  it('as medidas de conteúdo não se confundem com as de estoque', () => {
    // G e ML só existem como conteúdo — ninguém estoca em grama nesta operação.
    expect(UNIDADES_CONTEUDO).toContain('G');
    expect(UNIDADES_CONTEUDO).toContain('ML');
    expect(unidadesDeProduto('SuperMax')).not.toContain('G');
    expect(unidadesDeProduto('SuperMax')).not.toContain('ML');
  });

  it('o caso do arroz: 5 KG de conteúdo, estoque em UN', () => {
    expect(temConteudoDeEmbalagem('UN')).toBe(true);
    expect(formatarConteudo(5, 'KG')).toBe('5 KG');
  });
});

describe('formatarConteudo', () => {
  it('mostra a fração com vírgula', () => {
    expect(formatarConteudo(1.5, 'KG')).toBe('1,5 KG');
    expect(formatarConteudo('0,35', 'L')).toBe('0,35 L');
  });

  it('admite não saber a medida em vez de fingir', () => {
    // É o passivo herdado: peso gravado quando o campo não tinha unidade.
    expect(formatarConteudo(900, null)).toBe('900 (unidade não informada)');
    expect(formatarConteudo(900, '')).toBe('900 (unidade não informada)');
  });

  it('sem conteúdo, sem rótulo', () => {
    expect(formatarConteudo(null, 'KG')).toBe('');
    expect(formatarConteudo(0, 'KG')).toBe('');
    expect(formatarConteudo('', '')).toBe('');
  });
});

describe('máscara de quantidade', () => {
  it('unidade fracionária aceita vírgula e até 3 decimais', () => {
    expect(formatQtd('12,5', true)).toBe('12,5');
    expect(formatQtd('12,5678', true)).toBe('12,567');
    // Ponto do teclado numérico vira vírgula — é o mesmo separador aqui.
    expect(formatQtd('12.5', true)).toBe('12,5');
  });

  it('unidade discreta TRUNCA no separador — nunca o apaga', () => {
    // Apagar daria "125": um zero a mais no estoque. É o caminho real de quem
    // preenche 12,5 em KG e depois troca a unidade para UN.
    expect(formatQtd('12,5', false)).toBe('12');
    expect(formatQtd('12.5', false)).toBe('12');
    expect(formatQtd('40', false)).toBe('40');
  });

  it('não perde o inteiro ao remascarar na troca de unidade', () => {
    // KG → UN → KG: o saldo pode encolher (12,5 → 12), nunca inflar.
    expect(parseQtd(formatQtd('12,5', false))).toBeLessThan(parseQtd('12,5'));
    expect(parseQtd(formatQtd('12,5', true))).toBe(12.5);
  });

  it('descarta lixo em vez de zerar o campo', () => {
    // `type=number` devolvia '' quando a vírgula chegava. Era metade do motivo
    // de o cadastro só aceitar inteiro.
    expect(formatQtd('12kg', true)).toBe('12');
    expect(formatQtd('abc', true)).toBe('');
  });

  it('parseQtd não trunca o que o parseInt truncava', () => {
    expect(parseQtd('12,5')).toBe(12.5);
    expect(parseQtd('12.5')).toBe(12.5);
    expect(parseQtd('')).toBe(0);
    expect(parseQtd(null)).toBe(0);
    expect(parseQtd(2.5)).toBe(2.5);
  });
});

describe('qtdBR — numeric do Postgres na tela', () => {
  it('derruba a escala fixa e devolve a vírgula', () => {
    // É assim que `numeric(15,3)` chega do PostgREST. Sem tratar, o leitor
    // brasileiro vê "12.500" e entende doze mil e quinhentos (migr. 439).
    expect(qtdBR('12.500')).toBe('12,5');
    expect(qtdBR('0.350')).toBe('0,35');
    expect(qtdBR('40.000')).toBe('40');
    expect(qtdBR(2.5)).toBe('2,5');
  });

  it('não inventa valor para vazio', () => {
    expect(qtdBR(null)).toBe('');
    expect(qtdBR(undefined)).toBe('');
    expect(qtdBR('')).toBe('');
  });

  it('ida e volta preserva o número', () => {
    for (const v of ['12.500', '0.350', '1', '999.999']) {
      expect(parseQtd(qtdBR(v))).toBe(Number(v));
    }
  });
});

describe('handleQtdKeyDown', () => {
  const tecla = (key: string, valorAtual: string) => {
    let barrado = false;
    handleQtdKeyDown(true)({
      key, ctrlKey: false, metaKey: false, altKey: false,
      currentTarget: { value: valorAtual },
      preventDefault: () => { barrado = true; },
    } as any);
    return barrado;
  };
  const teclaDiscreta = (key: string) => {
    let barrado = false;
    handleQtdKeyDown(false)({
      key, ctrlKey: false, metaKey: false, altKey: false,
      currentTarget: { value: '12' },
      preventDefault: () => { barrado = true; },
    } as any);
    return barrado;
  };

  it('fracionária aceita o primeiro separador e barra o segundo', () => {
    expect(tecla(',', '12')).toBe(false);
    expect(tecla('.', '12')).toBe(false);
    expect(tecla(',', '12,5')).toBe(true);
  });

  it('discreta barra o separador — é o que evita "12,5" virar 125 tecla a tecla', () => {
    expect(teclaDiscreta(',')).toBe(true);
    expect(teclaDiscreta('.')).toBe(true);
    expect(teclaDiscreta('7')).toBe(false);
  });

  it('deixa passar dígito e teclas de controle', () => {
    expect(tecla('5', '12')).toBe(false);
    expect(tecla('Backspace', '12')).toBe(false);
    expect(tecla('ArrowLeft', '12')).toBe(false);
  });

  it('barra letra em qualquer caso', () => {
    expect(tecla('a', '12')).toBe(true);
    expect(teclaDiscreta('a')).toBe(true);
  });
});

// ── Leitura da medida anunciada no nome (migr. 456) ────────────────────────
//
// O aluno escreve "Arroz Tio João 1kg" e depois preenche os dois campos ao
// lado. Quando discordam, um dos dois está errado. A heurística existe para
// perguntar na hora — e o risco dela é o falso positivo, então é isso que
// estes casos guardam.
describe('conteúdo anunciado no nome', () => {
  it('lê a medida escrita no nome, com e sem espaço', () => {
    expect(conteudoNoNome('Arroz Tio João 1kg')).toEqual({ valor: 1, unidade: 'KG' });
    expect(conteudoNoNome('Refrigerante 2 L')).toEqual({ valor: 2, unidade: 'L' });
    expect(conteudoNoNome('Shampoo 500ml')).toEqual({ valor: 500, unidade: 'ML' });
    expect(conteudoNoNome('Café 250 G')).toEqual({ valor: 250, unidade: 'G' });
  });

  it('aceita decimal com vírgula', () => {
    expect(conteudoNoNome('Óleo 0,9 L')).toEqual({ valor: 0.9, unidade: 'L' });
  });

  // Os dois falsos positivos que derrubariam a TechMax inteira, ambos achados
  // por este teste: "256GB" (o  depois da medida resolve) e "5G", que passou
  // pelo  e virava cinco gramas em todo celular do catálogo.
  it('não confunde armazenamento nem geração de rede com grama', () => {
    expect(conteudoNoNome('Iphone 17 Pro Max 256GB')).toBeNull();
    expect(conteudoNoNome('Samsung Galaxy A56 5G 256 GB')).toBeNull();
    expect(conteudoNoNome('Notebook 8GB RAM 512GB SSD')).toBeNull();
    expect(conteudoNoNome('Modem 4G')).toBeNull();
  });

  // O outro lado da mesma régua: grama de verdade continua sendo lida, com
  // espaço em qualquer valor, e colada quando o número não é de geração.
  it('ainda lê grama de verdade', () => {
    expect(conteudoNoNome('Fermento 5 G')).toEqual({ valor: 5, unidade: 'G' });
    expect(conteudoNoNome('Café 500G')).toEqual({ valor: 500, unidade: 'G' });
  });

  it('devolve null quando o nome não anuncia medida', () => {
    expect(conteudoNoNome('Camiseta Básica Feminina')).toBeNull();
    expect(conteudoNoNome('')).toBeNull();
    expect(conteudoNoNome(null)).toBeNull();
  });
});

describe('divergência entre o nome e o que foi preenchido', () => {
  it('cala quando batem', () => {
    expect(divergenciaDeConteudo('Arroz 1kg', '1', 'KG')).toBeNull();
    expect(divergenciaDeConteudo('Refrigerante 2L', 2, 'L')).toBeNull();
  });

  it('avisa quando a medida difere — grama no lugar de quilo', () => {
    const aviso = divergenciaDeConteudo('Arroz Tio João 1kg', '1', 'G');
    expect(aviso).toContain('1 KG');
    expect(aviso).toContain('1 G');
  });

  it('avisa quando o número difere', () => {
    expect(divergenciaDeConteudo('Arroz 5kg', '1', 'KG')).toContain('5 KG');
  });

  // Formulário pela metade não é erro: o aviso só aparece quando há os dois
  // lados para comparar.
  it('cala com o campo em branco, zerado ou sem medida', () => {
    expect(divergenciaDeConteudo('Arroz 1kg', '', '')).toBeNull();
    expect(divergenciaDeConteudo('Arroz 1kg', '1', '')).toBeNull();
    expect(divergenciaDeConteudo('Arroz 1kg', '0', 'KG')).toBeNull();
  });

  it('cala quando o nome não anuncia nada', () => {
    expect(divergenciaDeConteudo('Arroz Branco', '5', 'KG')).toBeNull();
  });
});
