import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

// Aviso sem unidade vai para todas as filiais (migr. 619).
//
// Seis telas chamavam `notificar_setor` direto, e cinco delas sem `p_filial`:
// o Financeiro da TechMax recebia a cotação pendente da SuperMax com item,
// fornecedor e valor. O helper `src/lib/notificar.ts` exige a unidade no tipo;
// este guarda reprova quem voltar a chamar a RPC por fora dele.

const SRC = resolve(__dirname, '../src');
const PERMITIDO = 'lib/notificar.ts';

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.(ts|tsx)$/.test(nome) ? [p] : [];
  });
}

describe('régua do aviso', () => {
  it('só src/lib/notificar.ts chama a RPC notificar_setor', () => {
    const fora = arquivos(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(r => r !== PERMITIDO)
      .filter(r => /rpc\(\s*['"]notificar_setor['"]/.test(readFileSync(join(SRC, r), 'utf8')));
    expect(fora, 'use notificarSetor() de src/lib/notificar.ts — ele exige a filial').toEqual([]);
  });
});
