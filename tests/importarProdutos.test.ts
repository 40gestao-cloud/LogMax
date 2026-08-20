import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { getModelo } from '../src/lib/modelosPlanilha';
import { lerPlanilhaProdutos } from '../src/lib/importarProdutos';

// O import é a única porta do sistema por onde entra dado que ninguém digitou
// numa tela do LogMax. O que estes testes guardam é que ele recusa o que o
// formulário recusaria — e que continua lendo o modelo mesmo quando alguém
// acrescentar um campo no gerador, porque as colunas saem do MESMO getModelo.

const FILIAL = 'SuperMax';

/** Monta um arquivo com o cabeçalho do modelo e as linhas dadas. */
async function planilha(linhas: Array<Record<string, string>>, opts?: { comExemplo?: boolean }) {
  const modelo = getModelo('produtos', FILIAL, {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produto');
  // O modelo real tem título e linha em branco antes do cabeçalho: reproduzimos
  // para o detector de cabeçalho ser exercitado de verdade.
  ws.addRow([modelo.titulo]);
  ws.addRow([]);
  ws.addRow(modelo.campos.map(c => (c.obrigatorio ? `${c.col} *` : c.col)));
  if (opts?.comExemplo !== false) ws.addRow(modelo.campos.map(c => c.exemplo ?? ''));
  linhas.forEach(l => ws.addRow(modelo.campos.map(c => l[c.col] ?? '')));

  const buf = await wb.xlsx.writeBuffer();
  return {
    name: 'produtos.xlsx',
    arrayBuffer: async () => buf as ArrayBuffer,
  } as unknown as File;
}

const CONTEXTO = {
  categorias:    [{ id: 'cat-1', nome: 'Mercearia' }],
  subcategorias: [{ id: 'sub-1', nome: 'Grãos', categoria_id: 'cat-1' }],
  fornecedores:  ['Atacadão Central'],
  codigosExistentes: ['999'],
  nomesExistentes:   ['Produto Que Já Existe'],
};

const LINHA_BOA: Record<string, string> = {
  'Código': '001',
  'Nome do produto': 'Arroz Branco Tipo 1 5kg',
  'Categoria': 'Mercearia',
  'Subcategoria': 'Grãos',
  'Cód. Barras EAN': '7891234567895',
  'Fornecedor': 'Atacadão Central',
  'Marca': 'Tio João',
  'Preço de Custo (R$)': '18,90',
  'Preço de Venda (R$)': '24,90',
  'Unidade': 'UN',
  'Estoque Mínimo': '10',
  'Saldo de Abertura': '40',
  'Produto perecível': 'Não',
};

describe('lerPlanilhaProdutos', () => {
  it('lê a linha boa e monta o payload com saldo de abertura separado', async () => {
    const r = await lerPlanilhaProdutos(await planilha([LINHA_BOA]), FILIAL, CONTEXTO);
    expect(r.erroGeral).toBeNull();
    expect(r.linhas).toHaveLength(1);
    const l = r.linhas[0];
    expect(l.erros).toEqual([]);
    expect(l.payload).toMatchObject({
      codigo: '001',
      categoria_id: 'cat-1',
      subcategoria_id: 'sub-1',
      unidade: 'UN',
      estoque: 0,          // produto nasce zerado, sempre
      estoque_minimo: 10,
      filial: FILIAL,
    });
    expect(l.precoCusto).toBe(18.9);
    expect(l.saldoAbertura).toBe(40);   // não entra no payload: vira movimentação
  });

  it('ignora a linha de exemplo do modelo', async () => {
    const r = await lerPlanilhaProdutos(await planilha([LINHA_BOA]), FILIAL, CONTEXTO);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].nome).toBe('Arroz Branco Tipo 1 5kg');
  });

  it('recusa EAN com verificador errado', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Cód. Barras EAN': '7891234567891' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/EAN inválido/i);
    expect(r.linhas[0].payload).toBeNull();
  });

  it('gera EAN interno quando a coluna vem vazia, e avisa', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Cód. Barras EAN': '' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros).toEqual([]);
    expect(r.linhas[0].avisos.join(' ')).toMatch(/interno/i);
    expect(String(r.linhas[0].payload?.ean)).toMatch(/^2\d{12}$/);
  });

  it('recusa categoria que não existe no LogMax', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Categoria': 'Bazar' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/Categoria "Bazar" não existe/);
  });

  it('recusa código repetido no catálogo e dentro do próprio arquivo', async () => {
    const r = await lerPlanilhaProdutos(await planilha([
      { ...LINHA_BOA, 'Código': '999' },
      { ...LINHA_BOA, 'Código': '002', 'Nome do produto': 'Feijão Carioca 1kg' },
      { ...LINHA_BOA, 'Código': '002', 'Nome do produto': 'Feijão Preto 1kg' },
    ]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/já existe no catálogo/);
    expect(r.linhas[1].erros).toEqual([]);
    expect(r.linhas[2].erros.join(' ')).toMatch(/repetido no arquivo/);
  });

  it('recusa fração em unidade que não aceita meia', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Unidade': 'UN', 'Estoque Mínimo': '10,5' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/fração/i);
  });

  it('aceita fração quando a unidade é KG', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Unidade': 'KG', 'Estoque Mínimo': '10,5', 'Saldo de Abertura': '12,5' }]),
      FILIAL, CONTEXTO);
    expect(r.linhas[0].erros).toEqual([]);
    expect(r.linhas[0].saldoAbertura).toBe(12.5);
  });

  // A ficha da mercearia é o caso que a migr. 424 depende: perecível sem prazo
  // entra no estoque e nunca aparece na fila de Validades.
  it('cobra validade quando o produto é perecível', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Produto perecível': 'Sim' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/Validade \(dias\)/i);
  });

  // Armazenagem entrou para o mesmo time da validade: quem recebe a carga
  // precisa saber, antes de guardar, se vai para a câmara fria ou para a
  // prateleira seca.
  it('cobra armazenagem quando o produto é perecível', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Produto perecível': 'Sim', 'Validade (dias)': '30' }]),
      FILIAL, CONTEXTO);
    expect(r.linhas[0].erros.join(' ')).toMatch(/Armazenagem/i);
  });

  it('aceita perecível com prazo e guarda a ficha em atributos', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Produto perecível': 'Sim',
                       'Validade (dias)': '30', 'Armazenagem': 'Refrigerado' }]),
      FILIAL, CONTEXTO);
    expect(r.linhas[0].erros).toEqual([]);
    expect(r.linhas[0].payload?.atributos).toMatchObject({
      perecivel: 'Sim', validade_dias: '30', armazenagem: 'Refrigerado' });
  });

  it('avisa (sem impedir) preço de venda abaixo do custo', async () => {
    const r = await lerPlanilhaProdutos(
      await planilha([{ ...LINHA_BOA, 'Preço de Venda (R$)': '9,90' }]), FILIAL, CONTEXTO);
    expect(r.linhas[0].erros).toEqual([]);
    expect(r.linhas[0].avisos.join(' ')).toMatch(/abaixo do custo/i);
  });

  it('explica quando o arquivo não tem o cabeçalho do modelo', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Plan1');
    ws.addRow(['produto', 'quantidade']);
    ws.addRow(['arroz', '10']);
    const buf = await wb.xlsx.writeBuffer();
    const file = { name: 'errado.xlsx', arrayBuffer: async () => buf as ArrayBuffer } as unknown as File;
    const r = await lerPlanilhaProdutos(file, FILIAL, CONTEXTO);
    expect(r.linhas).toHaveLength(0);
    expect(r.erroGeral).toMatch(/Modelo de planilha/);
  });
});
