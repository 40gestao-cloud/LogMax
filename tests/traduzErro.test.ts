import { describe, it, expect } from 'vitest';
import { traduzErroDeGravacao } from '../src/hooks/useSupabaseData';

describe('traduzErroDeGravacao', () => {
  it('categoria apagada com o formulário aberto vira instrução, não texto do Postgres', () => {
    const msg = traduzErroDeGravacao({
      code: '23503',
      message: 'insert or update on table "produtos" violates foreign key constraint "produtos_categoria_id_fkey"',
    });
    expect(msg).toMatch(/outra pessoa o apagou/);
    expect(msg).not.toMatch(/foreign key/);
  });

  it('apagar registro em uso explica o vínculo', () => {
    const msg = traduzErroDeGravacao({
      code: '23503',
      message: 'update or delete on table "categorias_produto" violates foreign key constraint "produtos_categoria_id_fkey" on table "produtos"',
    });
    expect(msg).toMatch(/sendo usado em outro lugar/);
  });

  it('índice único conhecido continua com a frase dele', () => {
    const msg = traduzErroDeGravacao({
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_produtos_nome_filial_ativo"',
    });
    expect(msg).toMatch(/Já existe um produto ativo com este nome/);
  });
});
