import { defineConfig } from 'vitest/config';

// Dois grupos com necessidades opostas:
//
//   • integracao — fala com o Supabase de verdade. Precisa de `.env.test` e
//     roda serial: os testes disputam o mesmo produto sentinel.
//   • estatico   — só lê arquivos-fonte (consistência de rotas/menu). Não pode
//     exigir credenciais: um guarda que só roda com banco à mão é um guarda
//     que ninguém roda, e este existe justamente para pegar divergência de
//     menu no CI.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'estatico',
          include: ['tests/rotas.test.ts', 'tests/aulaFluxos.test.ts', 'tests/aulaPapel.test.ts', 'tests/confirm.test.ts', 'tests/schemaDrift.test.ts', 'tests/sessaoGuard.test.ts', 'tests/unidadesConteudo.test.ts', 'tests/tipoProduto.test.ts', 'tests/precificacao.test.ts', 'tests/perecivel.test.ts', 'tests/fichaProduto.test.ts'],
        },
      },
      {
        test: {
          name: 'integracao',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/rotas.test.ts', 'tests/aulaFluxos.test.ts', 'tests/aulaPapel.test.ts', 'tests/confirm.test.ts', 'tests/schemaDrift.test.ts', 'tests/sessaoGuard.test.ts', 'tests/unidadesConteudo.test.ts', 'tests/tipoProduto.test.ts', 'tests/precificacao.test.ts', 'tests/perecivel.test.ts', 'tests/fichaProduto.test.ts'],
          setupFiles: ['./tests/setup.ts'],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
