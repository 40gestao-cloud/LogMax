import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

// `confirm` existe de graça no navegador, e é aí que mora a armadilha.
//
// O app tem o seu, assíncrono, vindo do `ConfirmContext` — um modal no tema
// do produto, que ainda destaca verbo destrutivo. Mas quem esquece o
// `const confirm = useConfirm();` não recebe erro nenhum: o `window.confirm`
// global aceita string, devolve boolean, o `await` funciona em cima de um
// boolean e o `tsc --noEmit` aprova em silêncio. O sintoma só aparece em
// runtime, como o diálogo cinza do navegador no meio da tela.
//
// E `confirm` é resolvido por ESCOPO LÉXICO: não basta o hook existir no
// componente de fora do arquivo. Foi assim que `PainelCategorias` e
// `PainelSubcategorias` (Cadastros → Categorias) e `ModalProdutos` (Campanhas)
// passaram meses chamando o diálogo do navegador enquanto o resto do app
// usava o modal.
//
// Este teste lê o fonte porque não há como um teste de runtime cobrir isso: o
// componente teria que ser montado e o botão clicado, um a um.

const SRC = resolve(__dirname, '../src');

// Início de bloco de topo: `function X(`, `const X = (`, `export const X = (`.
const INICIO_DE_BLOCO = /^(?:export\s+)?(?:const\s+(\w+)\s*[:=]|function\s+(\w+)\s*\()/;
// Cada diálogo do app tem o seu hook. A regra é a mesma nos dois: usar o nome
// sem ter chamado o hook no corpo do componente cai no global do navegador.
const DIALOGOS = [
  { nome: 'confirm', uso: /(?<![.\w])confirm\s*\(/, hook: /useConfirm\s*\(\s*\)/, contexto: 'ConfirmContext' },
  { nome: 'prompt',  uso: /(?<![.\w])prompt\s*\(/,  hook: /usePrompt\s*\(\s*\)/,  contexto: 'PromptContext'  },
] as const;

function arquivosDeFonte(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeFonte(caminho);
    return /\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Componentes do arquivo que usam um diálogo sem ter o hook no próprio corpo. */
function componentesComDialogoNativo(caminho: string): string[] {
  const linhas = readFileSync(caminho, 'utf-8').split('\n');

  const blocos: Array<{ linha: number; nome: string }> = [];
  linhas.forEach((l, i) => {
    const m = INICIO_DE_BLOCO.exec(l);
    if (m) blocos.push({ linha: i, nome: m[1] ?? m[2] });
  });

  const dono = (i: number) => {
    let atual = '<topo do arquivo>';
    for (const b of blocos) if (b.linha <= i) atual = b.nome;
    return atual;
  };

  return DIALOGOS.flatMap(({ nome, uso, hook }) => {
    const comHook = new Set<string>();
    const comUso = new Set<string>();
    linhas.forEach((l, i) => {
      if (hook.test(l)) comHook.add(dono(i));
      else if (uso.test(l)) comUso.add(dono(i));
    });
    return [...comUso].filter(c => !comHook.has(c)).map(c => `${c} (${nome})`);
  });
}

describe('diálogos do app', () => {
  it('nenhum componente cai no confirm()/prompt() do navegador', () => {
    const infratores = arquivosDeFonte(SRC).flatMap(caminho => {
      const relativo = caminho.slice(caminho.indexOf('src'));
      return componentesComDialogoNativo(caminho).map(c => `${relativo} → ${c}`);
    });

    // A mensagem tem que dizer o conserto, senão quem quebrar o teste daqui a
    // seis meses vai só olhar para uma lista de nomes.
    expect(
      infratores,
      `Estes componentes usam um diálogo sem ter chamado o hook no próprio ` +
      `corpo, então caem no diálogo do navegador. Conserto: adicionar no topo ` +
      `do corpo de cada um a linha do hook correspondente —\n` +
      DIALOGOS.map(d => `    const ${d.nome} = use${d.nome[0].toUpperCase()}${d.nome.slice(1)}();  // contexts/${d.contexto}`).join('\n') +
      `\n  ` + infratores.join('\n  '),
    ).toEqual([]);
  });

  // `alert` não tem hook equivalente porque não deveria ter: mensagem curta é
  // toast, e texto que o usuário precisa reler é modal. O ban é chapado.
  it('ninguém usa alert()', () => {
    const USO_DE_ALERT = /(?<![.\w])alert\s*\(/;
    const infratores = arquivosDeFonte(SRC).flatMap(caminho => {
      const linhas = readFileSync(caminho, 'utf-8').split('\n');
      const relativo = caminho.slice(caminho.indexOf('src'));
      return linhas
        .map((l, i) => ({ l, n: i + 1 }))
        // Comentário citando `alert()` não conta — os consertos explicam o que
        // saiu dali, e seria perverso que a explicação quebrasse o teste.
        .filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l) && USO_DE_ALERT.test(l))
        .map(({ n }) => `${relativo}:${n}`);
    });

    expect(
      infratores,
      `alert() do navegador é diálogo cinza, fora do tema e com o domínio no ` +
      `título. Use showToast(msg, 'error') para aviso curto, ou <TextoModal> ` +
      `(components/ui) para texto que precisa ficar na tela.\n  ` +
      infratores.join('\n  '),
    ).toEqual([]);
  });
});
