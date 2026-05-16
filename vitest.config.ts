import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Carrega .env.test antes dos testes (cliente Supabase precisa das vars)
    setupFiles: ['./tests/setup.ts'],
    // RPCs + cleanup levam alguns segundos por teste em rede normal
    testTimeout: 30_000,
    // Serial: cada teste usa o mesmo produto sentinel; rodar em paralelo
    // poderia disputar o estoque do produto
    fileParallelism: false,
  },
});
