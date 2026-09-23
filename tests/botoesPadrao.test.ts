import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// Botão-ícone fora da família de classes do design system.
//
// O ERP tem uma família para isto: `.action-btn-*` (ação de linha: editar,
// excluir, reabrir, PDF…), `.modal-close-btn` (o X do canto do modal) e
// `.neu-button` (o resto do chrome). Mesmo assim um molde antigo — `w-7 h-7
// rounded-md` com borda `white/5`, sem fundo — sobreviveu em 8 telas por meses,
// porque cada botão novo era copiado do vizinho errado e ninguém revisa CSS
// linha a linha. O sintoma que chegou foi "esses botões estão fora do padrão de
// qualidade do sistema", e a correção custou uma varredura manual do repo
// inteiro.
//
// Este guarda existe para essa varredura não precisar acontecer de novo: se um
// botão cujo conteúdo é só um ícone nascer sem classe da família, o teste
// aponta arquivo e linha.
//
// Só olha botão SEM TEXTO. Botão com rótulo ("Exportar", "Salvar") é outra
// família — pílula com `neu-button` e padding —, e forçá-lo na caixa de 2rem
// seria pior que o problema.

const RAIZ = resolve(__dirname, '../src');

/** Classes que marcam o botão como pertencente ao design system. */
const FAMILIA = ['action-btn-', 'modal-close-btn', 'neu-button'];

/**
 * Superfícies com chrome próprio, onde a família NÃO se aplica — cada uma com
 * o motivo. Allowlist por arquivo, e não por linha: linha muda a cada edição e
 * um guarda que quebra sozinho é um guarda que alguém desliga.
 */
const FORA_DA_FAMILIA: Record<string, string> = {
  // ── Superfície com tema próprio ──
  'components/ProdutoDetalheModal.tsx':
    'ficha da loja online: `bg-white` fixo, fora do tema do ERP. `.modal-close-btn` pinta o fundo com var(--color-bg-base) e ficaria preto sobre o card branco.',
  'components/PwaUpdatePrompt.tsx':
    'prompt de atualização do PWA: estilo inline de propósito, para não depender do CSS da versão que está sendo trocada.',

  // ── Chrome de tela cheia / editor ──
  'views/AulaFluxoProjecao.tsx':
    'projeção em tela cheia para exibir na aula: os controles são grandes de propósito, para serem vistos de longe.',
  'views/MaxShowEditor.tsx':
    'editor de apresentação com canvas e chrome próprios.',
  'views/PDVViewSupermax.tsx':
    'PDV roda em layout de operação, fora da grade de telas administrativas.',
  'views/PDVView.tsx':
    'idem PDVViewSupermax: layout de operação.',
  // Modais que saíram do PDVViewSupermax (etapa 3 do plano de divisão): mesmo
  // chrome MaxPOS de lá — X branco sobre a faixa navy, ou redondo sobre a amarela.
  'components/pdv/ManualPdv.tsx':
    'modal do PDVViewSupermax, chrome MaxPOS.',
  'components/pdv/ConsultaPrecoModal.tsx':
    'modal do PDVViewSupermax, chrome MaxPOS.',
  'components/pdv/ReimpressaoModal.tsx':
    'modal do PDVViewSupermax, chrome MaxPOS.',
  'components/pdv/BuscaProdutoModal.tsx':
    'modal do PDVViewSupermax, chrome MaxPOS.',
  'components/pdv/ClientePickerModal.tsx':
    'modal do PDVViewSupermax, chrome MaxPOS.',
  'components/ArteLightbox.tsx':
    'visor de arte em tela cheia sobre `bg-black/95`: os controles (tela cheia, fechar, anterior/próxima) são chrome do visor — redondos e translúcidos sobre a foto. `.modal-close-btn` pinta var(--color-bg-base) e viraria um quadrado opaco no meio da arte.',
  'components/CrachaVirtual.tsx':
    'a fileira de controles do crachá flutua direto no fundo escuro, fora do cartão (para não sair na impressão): não há painel de modal onde o X do design system se apoie, e ele acompanha o botão Imprimir ao lado.',

  // ── Chip sobre imagem: o botão flutua na miniatura, não numa fileira ──
  'components/ImagemCadastro.tsx':
    'o X limpa a imagem escolhida — chip sobre a miniatura.',
  'views/AvaliacoesView.tsx':
    'chip de remover anexo, posicionado sobre a miniatura.',
  'views/RequerimentosView.tsx':
    'idem: chip de remover anexo sobre a miniatura.',
  'views/FuncionariosView.tsx':
    'overlay de trocar foto: cobre o avatar inteiro (`absolute inset-0`, redondo como ele).',
  'views/UsuariosView.tsx':
    'overlay de trocar foto, e os ícones inline de ver/copiar senha, que moram dentro da célula de texto.',

  // ── Ícone inline dentro de texto ou de item compacto ──
  'components/PDISection.tsx':
    'remover meta dentro do item de PDI: linha compacta, ícone de 10px. A caixa de 2rem quebraria a altura da linha.',
  'views/DesenvolvimentoIAView.tsx':
    'estrela de avaliar participante, inline ao lado do nome.',
  'views/RecrutamentoView.tsx':
    'cancelar convite, inline dentro do span do badge de status.',

  // ── Não é ação: é controle de estado/filtro ──
  'views/FrequenciaTrabalhoView.tsx':
    'marcador de presença da linha: tamanho casado com o botão Salvar ao lado, decisão registrada no próprio componente.',
  'views/MatrizRequerimentosView.tsx':
    'filtro de status em pílula (ícone + rótulo dinâmico), não ação de linha.',
};

function arquivosTsx(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = resolve(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTsx(caminho, achados);
    else if (nome.endsWith('.tsx')) achados.push(caminho);
  }
  return achados;
}

const ICONE = /<[A-Z][A-Za-z0-9]*\s+size=\{/;
/** Sobra texto depois de remover as tags? Então o botão tem rótulo. */
const temRotulo = (corpo: string) => /[A-Za-zÀ-ú]{3,}/.test(corpo.replace(/<[^>]*>/g, ''));

type Achado = { arquivo: string; linha: number; classes: string };

/**
 * Fim da tag de abertura, a partir do `<`.
 *
 * Não dá para usar `indexOf('>')`: em `<button onClick={() => x()} className=…>`
 * o primeiro `>` é o da arrow function, e a tag sairia cortada antes da
 * className — todo botão com `() =>` (isto é, quase todos) escaparia do guarda
 * em silêncio. Anda caractere a caractere ignorando o que está entre aspas e
 * contando `{}` para achar o `>` que fecha a tag de verdade.
 */
function fimDaTag(src: string, ini: number): number {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = ini + 1; i < src.length; i++) {
    const c = src[i];
    if (aspas) {
      if (c === aspas) aspas = null;
    } else if (c === '"' || c === "'" || c === '`') {
      aspas = c;
    } else if (c === '{') profundidade++;
    else if (c === '}') profundidade--;
    else if (c === '>' && profundidade === 0) return i;
  }
  return -1;
}

function botoesForaDaFamilia(caminho: string): Achado[] {
  // Normaliza CRLF pelo mesmo motivo de tests/rotas.test.ts: no Windows a cópia
  // de trabalho vem com \r\n e a contagem de linha sairia deslocada.
  const src = readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n');
  const arquivo = relative(RAIZ, caminho).replace(/\\/g, '/');
  const achados: Achado[] = [];

  for (const m of src.matchAll(/<button/g)) {
    const ini = m.index!;
    const fimTag = fimDaTag(src, ini);
    if (fimTag < 0) continue;
    const tag = src.slice(ini, fimTag + 1);
    if (FAMILIA.some(c => tag.includes(c))) continue;

    // Corpo do botão: só interessa quando é um ícone solto.
    const resto = src.slice(fimTag + 1, fimTag + 400);
    const fimCorpo = resto.indexOf('</button>');
    if (fimCorpo < 0) continue;
    const corpo = resto.slice(0, fimCorpo);
    if (!ICONE.test(corpo) || temRotulo(corpo)) continue;

    const classes = /className=["{]([^"}]*)/.exec(tag)?.[1] ?? '(sem className)';
    achados.push({ arquivo, linha: src.slice(0, ini).split('\n').length, classes: classes.trim().slice(0, 60) });
  }
  return achados;
}

describe('botões-ícone seguem a família de classes do design system', () => {
  const todos = arquivosTsx(RAIZ).flatMap(botoesForaDaFamilia);

  it('nenhum botão-ícone novo fora de .action-btn-* / .modal-close-btn / .neu-button', () => {
    const infratores = todos.filter(a => !(a.arquivo in FORA_DA_FAMILIA));
    const relatorio = infratores
      .map(a => `  ${a.arquivo}:${a.linha}  className="${a.classes}"`)
      .join('\n');

    expect(
      infratores.length,
      infratores.length === 0 ? '' :
        `\n${infratores.length} botão(ões)-ícone fora da família:\n${relatorio}\n\n` +
        'Use `.action-btn-edit` / `-delete` / `-warning` / `-neutral` / `-success` / `-blue` / `-pdf`\n' +
        'para ação de linha, `.modal-close-btn` para o X do modal. Se a tela tem chrome próprio\n' +
        'e a família não se aplica, registre o arquivo em FORA_DA_FAMILIA com o motivo.\n',
    ).toBe(0);
  });

  it('a allowlist não guarda arquivo que já foi padronizado', () => {
    // Entrada que não corresponde mais a nada é permissão esquecida: ela deixa
    // de proteger uma exceção real e passa a esconder um botão novo.
    const comAchado = new Set(todos.map(a => a.arquivo));
    const ociosas = Object.keys(FORA_DA_FAMILIA).filter(f => !comAchado.has(f));

    expect(ociosas, `Remova de FORA_DA_FAMILIA: ${ociosas.join(', ')}`).toEqual([]);
  });
});
