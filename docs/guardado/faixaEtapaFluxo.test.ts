// Testes da faixa de etapa, guardados junto com o componente (24/09).
// Para voltar: mover este arquivo para tests/ e o componente para
// src/components/ — ver docs/guardado/README.md.
import { describe, it, expect } from 'vitest';
import { AULA_FLUXOS } from '../src/lib/aulaFluxos';
import { posicoesDaView, fluxosQueSeApoiamEm } from '../src/components/FaixaEtapaFluxo';

// A faixa de etapa (src/components/FaixaEtapaFluxo.tsx) responde, dentro da
// tela, "em que passo eu estou e qual é o próximo". Ela lê ESTA lista — se
// divergisse, a tela ensinaria o que a projeção do professor desmente.
//
// O pedido veio da aula de 2026-09-15: a turma não segurava a ordem
// Requisição → Cotação → Cadastro do produto → Pedido → Recebimento, abria
// Recebimentos, não via nada e concluía que o sistema estava quebrado.
describe('faixa de etapa — o que a tela mostra ao aluno', () => {
  it('a cotação sabe de onde veio e para onde vai', () => {
    const [pos] = posicoesDaView('compras-cotações');
    expect(pos.fluxo.id).toBe('compra');
    expect(pos.indice).toBeGreaterThan(1);
    expect(pos.indice).toBeLessThan(pos.total);
    expect(pos.anterior?.view).toBe('compras-requisiçõesdecompra');
    expect(pos.proxima?.view).toBe('financeiro-aprovaçõesdecotação');
  });

  it('recebimento é etapa da compra e tem quem executa', () => {
    const [pos] = posicoesDaView('estoque-recebimentos');
    expect(pos.fluxo.id).toBe('compra');
    expect(pos.etapa.quem).toMatch(/Estoque|Logística/);
    expect(pos.anterior?.view).toBe('compras-pedidos');
  });

  it('a tela que abre duas cadeias mostra as duas', () => {
    // Pedir material e pedir compra começam na mesma tela, em abas diferentes —
    // é o contraste que a aula quer, e esconder um dos dois o desfaz.
    const ids = posicoesDaView('requisicoes-dosetor').map(p => p.fluxo.id);
    expect(ids).toContain('compra');
    expect(ids).toContain('material');
  });

  it('cadastro de produto aparece como apoio, não como etapa', () => {
    // Pós-migr. 480 o produto existe antes do pedido, e a turma trata isso como
    // passo do processo. É apoio: aparece na faixa como tal, e continua fora da
    // numeração da cadeia.
    expect(posicoesDaView('cadastros-produtos')).toHaveLength(0);
    expect(fluxosQueSeApoiamEm('cadastros-produtos').map(f => f.id)).toContain('compra');
    expect(fluxosQueSeApoiamEm('cadastros-fornecedores').map(f => f.id)).toContain('compra');
  });

  it('tela fora de cadeia não ganha faixa', () => {
    expect(posicoesDaView('meu-cracha')).toHaveLength(0);
    expect(fluxosQueSeApoiamEm('meu-cracha')).toHaveLength(0);
  });

  it('toda etapa clicável aponta para uma tela real', () => {
    for (const f of AULA_FLUXOS) {
      for (const e of f.etapas) {
        if (!e.view) continue;
        expect(posicoesDaView(e.view).length, `${f.id} › ${e.titulo}`).toBeGreaterThan(0);
      }
    }
  });
});
