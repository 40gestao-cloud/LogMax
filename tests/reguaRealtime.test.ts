import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// Assinatura de realtime crua faz a turma inteira ler no mesmo instante.
//
// Cada hook assinava a tabela e relia na hora. Com a sala cheia, um INSERT de
// um aluno virava uma leitura em cada máquina no mesmo segundo, repetida a cada
// movimento de qualquer um. Em 15/09 esse padrão esgotou a logmax-contabilidade
// (504 em tudo por seis minutos, login incluído) e, mesmo depois de baratear a
// RLS, o p95 seguia em 3 s com rajadas de 16 s.
//
// `src/lib/realtimeAgrupado.ts` é a régua: janela de 1,5 s + até 2,5 s
// sorteados por máquina, sem sessão não lê, relê na volta do login e na
// reconexão do websocket. Quem relê tabela passa por ela.
//
// Este guarda existe porque o próximo canal cru não dá erro nenhum: funciona
// bem com duas abas abertas no desenvolvimento e só aparece com 40 máquinas na
// aula. Arquivo novo com `.on('postgres_changes'` reprova até entrar na régua
// ou ganhar uma justificativa aqui.

const RAIZ = resolve(__dirname, '../src');

/**
 * Quem pode assinar na mão, e por quê. Allowlist por arquivo (linha muda a cada
 * edição, e guarda que quebra sozinho é guarda que alguém desliga).
 */
const FORA_DA_REGUA: Record<string, string> = {
  // ── A própria régua ──
  'lib/realtimeAgrupado.ts': 'é a régua.',

  // ── Reagem ao payload do evento: não leem tabela, não formam manada ──
  'hooks/useAulaConfig.ts':
    'aplica o registro que vem no payload (aula_config é uma linha só). Nenhuma leitura.',
  'hooks/useBlackout.ts':
    'idem: aplica o payload de blackout_config, uma linha.',
  'hooks/useComandoRecarga.ts':
    'lê o comando do payload para decidir se recarrega a PWA. Atrasar aqui atrasaria a recarga que o professor pediu.',
  'views/PDVView.tsx':
    'espera a confirmação de UM Pix/cartão do próprio caixa e reage ao payload. A janela da régua atrasaria o pagamento com o cliente na frente.',
  'views/PDVViewSupermax.tsx':
    'idem PDVView: confirmação de pagamento do próprio caixa.',

  // ── Janela própria, mais fina que a da régua ──
  'lib/reservasTrabalho.ts':
    'filtra o evento pela chave antes de decidir (renovação de colega não vira leitura) — régua própria, mesma ideia.',
  'hooks/useSidebarBadges.ts':
    'agrupa por tabela e recalcula só os badges daquela tabela; a régua agrupa por assinatura.',
};

const EXTENSOES = ['.ts', '.tsx'];
/** Só a chamada de código; a string aparece em comentário em vários arquivos. */
const ASSINATURA = /\.on\(\s*['"]postgres_changes['"]/;

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = resolve(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (EXTENSOES.some(e => nome.endsWith(e))) achados.push(caminho);
  }
  return achados;
}

describe('régua de realtime', () => {
  it('quem relê tabela ao ouvir o banco passa por assinarRealtime', () => {
    const crus = arquivos(RAIZ)
      .filter(caminho => ASSINATURA.test(readFileSync(caminho, 'utf8')))
      .map(caminho => relative(RAIZ, caminho).replace(/\\/g, '/'))
      .filter(rel => !(rel in FORA_DA_REGUA));

    expect(
      crus,
      `\nAssinam realtime na mão:\n  ${crus.join('\n  ')}\n\n` +
      'Use `assinarRealtime` de src/lib/realtimeAgrupado.ts. Se este canal reage ao\n' +
      'payload sem ler tabela (ou tem janela própria), acrescente o arquivo em\n' +
      'FORA_DA_REGUA, neste teste, com o motivo.\n',
    ).toEqual([]);
  });

  it('o guarda reprova mesmo — e não confunde comentário com código', () => {
    // Guarda do guarda: regex quebrada passaria sempre.
    expect(ASSINATURA.test(`.on('postgres_changes', { event: '*' }, () => carregar())`)).toBe(true);
    expect(ASSINATURA.test(`.on( "postgres_changes", cfg, cb)`)).toBe(true);
    expect(ASSINATURA.test('// estoura "cannot add postgres_changes callbacks after subscribe()"')).toBe(false);
  });

  it('a allowlist não guarda arquivo que já saiu', () => {
    const existentes = new Set(
      arquivos(RAIZ).map(c => relative(RAIZ, c).replace(/\\/g, '/')),
    );
    const fantasmas = Object.keys(FORA_DA_REGUA).filter(f => !existentes.has(f));
    expect(fantasmas, `\nAllowlist cita arquivo que não existe mais:\n  ${fantasmas.join('\n  ')}\n`).toEqual([]);
  });
});
