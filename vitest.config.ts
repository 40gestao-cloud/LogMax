import { defineConfig } from 'vitest/config';

// Dois grupos com necessidades opostas:
//
//   • integracao — fala com o Supabase de verdade. Precisa de `.env.test` e
//     roda serial: os testes disputam o mesmo produto sentinel. Sem `.env.test`
//     as suítes se pulam sozinhas (ver tests/setup.ts) — mas não no CI, onde
//     pular em silêncio seria um verde mentiroso.
//   • estatico   — só lê arquivos-fonte (consistência de rotas/menu, padrão de
//     botões, regras de domínio puras). Não pode exigir credenciais: um guarda
//     que só roda com banco à mão é um guarda que ninguém roda, e este existe
//     justamente para pegar divergência no CI.
//
// A lista mora numa constante só: quando estava duplicada em `include` e
// `exclude`, acrescentar um teste puro e esquecer da segunda lista o mandava
// para o grupo errado — foi o que aconteceu com produtoBusca.test.ts, que não
// toca no banco e mesmo assim exigia `.env.test` para rodar.
const ESTATICOS = [
  'tests/rotas.test.ts',
  'tests/aulaFluxos.test.ts',
  'tests/aulaPapel.test.ts',
  'tests/botoesPadrao.test.ts',
  'tests/catalogoNichoPdf.test.ts',
  'tests/confirm.test.ts',
  // Puro: só `src/lib/disjuntor`, com `fetch` de mentira. Estava caindo no
  // grupo `integracao` — a mesma armadilha do produtoBusca descrita acima.
  'tests/disjuntor.test.ts',
  'tests/falhaConexao.test.ts',
  'tests/fichaProduto.test.ts',
  'tests/horaServidor.test.ts',
  'tests/imei.test.ts',
  'tests/importarProdutos.test.ts',
  // Puro desde que o "maior número de NF" passou para o banco (migr. 618): só
  // sobrou aritmética de padding. Também estava no grupo errado.
  'tests/notaFiscal.test.ts',
  'tests/orcamentoFases.test.ts',
  'tests/perecivel.test.ts',
  // Puros: lógica do PDV em src/lib/pdv, com Supabase de mentira na cobrança.
  'tests/pdvCobranca.test.ts',
  'tests/pdvLogica.test.ts',
  'tests/precificacao.test.ts',
  'tests/produtoBusca.test.ts',
  'tests/realtimeAgrupado.test.ts',
  'tests/reguaRealtime.test.ts',
  'tests/reguaRls.test.ts',
  'tests/reservasTrabalho.test.ts',
  'tests/schemaDrift.test.ts',
  'tests/sectorAccess.test.ts',
  'tests/sessaoGuard.test.ts',
  'tests/sorteioCatalogo.test.ts',
  'tests/tipoProduto.test.ts',
  'tests/unidadesConteudo.test.ts',
];

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'estatico',
          include: ESTATICOS,
        },
      },
      {
        test: {
          name: 'integracao',
          include: ['tests/**/*.test.ts'],
          exclude: ESTATICOS,
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
