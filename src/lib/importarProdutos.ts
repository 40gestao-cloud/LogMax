// Import da planilha de produtos — a volta que faltava no "Modelo de planilha".
//
// O modelo existe desde 2026-08-04 e sempre foi só ida: a turma montava o
// cadastro no Excel e depois digitava tudo de novo no LogMax. Com o catálogo
// nascendo do zero (abertura de catálogo na implantação — 56 itens só na turma
// de Contabilidade), a volta digitada é o que trava o ciclo inteiro.
//
// REGRA QUE NÃO SE NEGOCIA: o arquivo não é autoridade sobre nada. Ele é texto
// que alguém digitou fora do sistema. Toda linha passa pelas MESMAS validações
// do formulário, e a gravação passa pelas mesmas tabelas, RLS e RPCs — o import
// é um digitador rápido, não uma porta de serviço. É o que o cabeçalho de
// `modelosPlanilha.ts` já avisava que teria de ser.
//
// As colunas NÃO são declaradas aqui. Vêm de `getModelo('produtos', filial)`,
// a mesma função que gera o arquivo — assim o import não pode divergir do
// modelo, que é o defeito clássico deste tipo de recurso: alguém acrescenta um
// campo no gerador e o leitor continua lendo o layout velho, em silêncio.

import { getModelo, carregarListasDoLogMax, type ModeloCampo } from './modelosPlanilha';
import { ATRIBUTOS_PRODUTO, rotuloParaCliente, type AtributoDef } from './atributosProduto';
import {
  UNIDADES_FRACIONARIAS, UNIDADES_CONTEUDO, EMBALAGENS_COMPRA,
  normalizarUnidade, unidadesDeProduto, temConteudoDeEmbalagem,
} from './unidades';
import { normalizeEan13, gerarEanInterno } from './barcode';
import { TIPOS_PRODUTO, TIPO_LABEL, ehVendavel, temEstoque, type TipoProduto } from './tipoProduto';
import { formatBRL } from './viewUtils';
import { todayBR } from './dates';
import { supabase } from './supabase';

/** Uma linha lida do arquivo, já validada e pronta (ou recusada). */
export type LinhaImport = {
  /** Linha no arquivo, como o Excel numera — é o que o aluno procura na tela. */
  linhaNoArquivo: number;
  nome: string;
  /** Vazio quando a linha passou. */
  erros: string[];
  /** Coisas que não impedem, mas que quem confere precisa ver. */
  avisos: string[];
  /** Payload de `produtos`, no formato que o formulário monta. */
  payload: Record<string, any> | null;
  /** Vai para `produtos_custo` depois do insert (a FK exige o produto). */
  precoCusto: number;
  /** Vira UMA movimentação de Entrada, se > 0. Nunca é compra. */
  saldoAbertura: number;
};

export type ResultadoLeitura = {
  linhas: LinhaImport[];
  /** Erro que impede ler o arquivo inteiro (layout errado, aba não encontrada). */
  erroGeral: string | null;
  /** Cabeçalhos esperados que não foram achados — ajuda a explicar o erroGeral. */
  colunasFaltando: string[];
};

const norm = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Texto da célula. exceljs devolve objeto em fórmula, hyperlink e rich text. */
function celulaTexto(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) {
      const iso = v.toISOString();
      return iso.slice(0, 10);
    }
    if ('text' in v)   return String((v as any).text ?? '');
    if ('result' in v) return String((v as any).result ?? '');
    if ('richText' in v) return ((v as any).richText ?? []).map((r: any) => r.text).join('');
    return '';
  }
  return String(v);
}

/** Campos da ficha do nicho (perecivel, tamanho, cor, requer_imei...). */
const fichaDaFilial = (filial: string): AtributoDef[] => ATRIBUTOS_PRODUTO[filial] ?? [];

/**
 * Número de uma célula. A célula NUMÉRICA vem como número e é usada como está:
 * o Excel grava 24,90 digitado como 24.9, e passar isso por `parseBRL` (que
 * junta os dígitos e divide por 100) dava R$ 2,49 — e 18 virava R$ 0,18.
 * Texto (CSV, célula formatada como texto) é lido no formato brasileiro:
 * "1.234,56", "R$ 18,90", "12,5". Sem vírgula, o ponto é decimal ("12.5").
 * Devolve NaN quando há algo escrito que não é número.
 */
export function numeroDaCelula(bruto: unknown): number {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : NaN;
  let t = celulaTexto(bruto).replace(/R\$/gi, '').replace(/\s+/g, '');
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** "UN — unidade" (o rótulo da lista do modelo) → "UN". */
const siglaDaUnidade = (texto: string): string =>
  normalizarUnidade(texto.split('—')[0].split(' - ')[0], '');

/**
 * Lê o arquivo e devolve uma linha por produto, cada uma já dizendo se entra ou
 * por quê não. NÃO grava nada — quem grava é `gravarProdutosImportados`, depois
 * de a pessoa ver a conferência na tela.
 *
 * A régua é a do Salvar do formulário (`handleSave` em ProdutosView), regra por
 * regra: o que depende da Classificação ou da Unidade é cobrado aqui do mesmo
 * jeito. Mexeu lá, mexe aqui.
 */
export async function lerPlanilhaProdutos(
  file: File,
  filial: string,
  /** Catálogo atual da filial, para achar categoria/subcategoria e acusar repetido. */
  contexto: {
    categorias: Array<{ id: string; nome: string }>;
    subcategorias: Array<{ id: string; nome: string; categoria_id: string }>;
    /** Com id: o produto grava `fornecedor_id`, como no formulário. */
    fornecedores: Array<{ id: string; nome: string }>;
    codigosExistentes: string[];
    nomesExistentes: string[];
    /**
     * A unidade nunca recebeu compra de verdade? Só então mercadoria nasce sem
     * requisição (mesma régua do "Cadastro sem requisição" da tela).
     */
    emImplantacao: boolean;
  },
): Promise<ResultadoLeitura> {
  const vazio = (erro: string): ResultadoLeitura =>
    ({ linhas: [], erroGeral: erro, colunasFaltando: [] });

  const nomesDaColuna = (c: ModeloCampo) => [c.col, ...(c.aliases ?? [])].map(norm);

  let abas: any[] = [];
  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) {
      // csv() do exceljs quer stream em Node; no browser lemos o texto e
      // montamos a aba na mão. Separador: vírgula ou ponto e vírgula (o Excel
      // pt-BR exporta com ponto e vírgula, e é o caso mais comum na turma).
      const texto = new TextDecoder('utf-8').decode(buf);
      const sep = (texto.split('\n')[0].match(/;/g) ?? []).length >
                  (texto.split('\n')[0].match(/,/g) ?? []).length ? ';' : ',';
      const csv = wb.addWorksheet('csv');
      texto.split(/\r?\n/).forEach(linha => {
        if (linha.trim() === '') { csv.addRow([]); return; }
        csv.addRow(linha.split(sep).map(c => c.replace(/^"|"$/g, '')));
      });
      abas = [csv];
    } else {
      await wb.xlsx.load(buf);
      abas = wb.worksheets;
    }
  } catch (e: any) {
    return vazio(`Não consegui abrir o arquivo: ${e?.message ?? 'formato não reconhecido'}. Use o .xlsx do "Modelo de planilha" ou um .csv com os mesmos cabeçalhos.`);
  }
  if (abas.length === 0) return vazio('A planilha está vazia.');

  const listas = await carregarListasDoLogMax('produtos', filial).catch(() => ({}));
  const campos = getModelo('produtos', filial, listas).campos;

  // ── Acha a aba e a linha de cabeçalho ─────────────────────────────────────
  // O modelo tem título, linha em branco, cabeçalho e linha de exemplo antes
  // dos dados. Planilha refeita à mão pode ter o cabeçalho na linha 1. Vale a
  // linha, de QUALQUER aba, que contém o maior número de colunas conhecidas.
  //
  // Por aba e não "a primeira aba que cita uma coluna": a aba Instruções do
  // próprio modelo vem antes e traz cada nome de coluna no dicionário, uma
  // por linha — o leitor parava nela e recusava o arquivo que ele mesmo gerou.
  // A turma também renomeia aba (e o Google Planilhas renomeia ao exportar),
  // então o nome da aba não serve de pista.
  let ws: any = null;
  const colDe = new Map<number, ModeloCampo>();
  let linhaCabecalho = 0;
  let melhorAcerto = 0;
  for (const aba of abas) {
    aba.eachRow({ includeEmpty: false }, (row: any, n: number) => {
      const mapa = new Map<number, ModeloCampo>();
      (row.values ?? []).forEach((v: any, i: number) => {
        const t = norm(celulaTexto(v)).replace(/\s*\*$/, '');
        if (!t) return;
        const campo = campos.find(c => nomesDaColuna(c).includes(t));
        if (campo) mapa.set(i, campo);
      });
      if (mapa.size > melhorAcerto) {
        melhorAcerto = mapa.size;
        linhaCabecalho = n;
        ws = aba;
        colDe.clear();
        mapa.forEach((c, i) => colDe.set(i, c));
      }
    });
  }

  const obrigatorias = campos.filter(c => c.obrigatorio).map(c => c.col);
  const achadas = new Set([...colDe.values()].map(c => c.col));
  const faltando = obrigatorias.filter(c => !achadas.has(c));

  if (linhaCabecalho === 0 || melhorAcerto < 3) {
    return {
      linhas: [], colunasFaltando: obrigatorias,
      erroGeral: 'Não achei a linha de cabeçalho. O arquivo precisa ter as colunas do modelo — baixe o "Modelo de planilha" desta unidade e preencha nele.',
    };
  }
  if (faltando.length > 0) {
    return {
      linhas: [], colunasFaltando: faltando,
      erroGeral: `Faltam colunas obrigatórias: ${faltando.join(', ')}. Baixe o "Modelo de planilha" desta unidade — a ficha muda de uma unidade para outra.`,
    };
  }

  /** Valor cru da célula — número continua número (ver `numeroDaCelula`). */
  const cruDe = (row: any, col: string): unknown => {
    for (const [i, campo] of colDe) if (campo.col === col) return row.getCell(i).value;
    return null;
  };

  const catPorNome = new Map(contexto.categorias.map(c => [norm(c.nome), c]));
  const subPorNome = new Map(contexto.subcategorias.map(s => [norm(s.nome), s]));
  // Dentro da categoria primeiro: uma subcategoria Própria pode repetir o nome
  // de uma da lista padrão noutra categoria (migr. 629), e o mapa só por nome
  // ficaria com a última.
  const subPorCatENome = new Map(contexto.subcategorias.map(s => [`${s.categoria_id}|${norm(s.nome)}`, s]));
  const fornPorNome = new Map(contexto.fornecedores.map(f => [norm(f.nome), f]));
  const codigosJa  = new Set(contexto.codigosExistentes.map(norm));
  const nomesJa    = new Set(contexto.nomesExistentes.map(norm));
  const unidadesOk = new Set(unidadesDeProduto(filial).map(u => normalizarUnidade(u)));
  const ficha      = fichaDaFilial(filial);
  const isSuper    = filial === 'SuperMax';

  // Repetido DENTRO do arquivo é tão erro quanto repetido no catálogo, e é o
  // mais comum: a turma copia a linha de cima e esquece de trocar o código.
  const codigosNoArquivo = new Set<string>();
  const nomesNoArquivo   = new Set<string>();

  const linhas: LinhaImport[] = [];

  ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
    if (n <= linhaCabecalho) return;

    const cru: Record<string, unknown> = {};
    const bruto: Record<string, string> = {};
    campos.forEach(c => {
      cru[c.col] = cruDe(row, c.col);
      bruto[c.col] = celulaTexto(cru[c.col]).trim();
    });

    // Linha inteira em branco: o modelo vem com 100 linhas formatadas.
    if (Object.values(bruto).every(v => v === '')) return;

    // Linha de exemplo do modelo: bate com os exemplos declarados. Só pulamos
    // quando bate em TUDO que tem exemplo — assim um produto de verdade nunca
    // é confundido com ela. Comparação numérica para as colunas de número:
    // "18,90" do exemplo chega como 18.9.
    const comExemplo = campos.filter(c => c.exemplo);
    const bateExemplo = (c: ModeloCampo) =>
      norm(bruto[c.col]) === norm(c.exemplo)
      || (typeof cru[c.col] === 'number' && cru[c.col] === numeroDaCelula(c.exemplo));
    if (comExemplo.length > 0 && comExemplo.every(bateExemplo)) return;

    const erros: string[] = [];
    const avisos: string[] = [];
    const exige = (col: string, motivo = 'é obrigatório') => { if (!bruto[col]) erros.push(`${col} ${motivo}`); };
    /** Número da coluna: 0 em branco, NaN (e erro) quando o texto não é número. */
    const num = (col: string): number => {
      if (!bruto[col]) return 0;
      const v = numeroDaCelula(cru[col]);
      if (Number.isNaN(v)) { erros.push(`${col}: "${bruto[col]}" não é um número`); return 0; }
      return v;
    };

    // Só as colunas que são obrigatórias SEMPRE (Nome, Código, Fornecedor). O
    // resto depende da Classificação ou da Unidade e é cobrado abaixo.
    campos.filter(c => c.obrigatorio).forEach(c => exige(c.col));

    // ── Classificação (Tipo) ────────────────────────────────────────────────
    const tipoTexto = bruto['Classificação (Tipo)'] ?? '';
    let tipo: TipoProduto = 'estoque_venda';
    if (tipoTexto) {
      const achado = TIPOS_PRODUTO.find(t => norm(TIPO_LABEL[t]) === norm(tipoTexto));
      if (achado) tipo = achado;
      else erros.push(`Classificação "${tipoTexto}" não existe — use ${TIPOS_PRODUTO.map(t => TIPO_LABEL[t]).join(', ')}`);
    } else {
      avisos.push(`Classificação em branco — entrou como ${TIPO_LABEL.estoque_venda}`);
    }
    const vendavel = ehVendavel(tipo);
    const comEstoque = temEstoque(tipo);
    const isPatrimonio = tipo === 'patrimonio';

    // Mercadoria nova sem requisição só existe na implantação da unidade: fora
    // dela, a tela desabilita "Cadastro sem requisição" e o item entra pela
    // fila de Compras. O import não é porta lateral para essa regra.
    if (vendavel && !contexto.emImplantacao) {
      erros.push('Fora da implantação, mercadoria nova é cadastrada pela tela, a partir da requisição (Cadastro com requisição)');
    }

    const nome   = bruto['Nome do produto'] ?? '';
    const codigo = bruto['Código'] ?? '';

    if (codigo) {
      if (codigosJa.has(norm(codigo)))      erros.push(`Código ${codigo} já existe no catálogo`);
      if (codigosNoArquivo.has(norm(codigo))) erros.push(`Código ${codigo} repetido no arquivo`);
      codigosNoArquivo.add(norm(codigo));
    }
    if (nome) {
      if (nomesJa.has(norm(nome)))        erros.push('Já existe produto com este nome nesta unidade');
      if (nomesNoArquivo.has(norm(nome))) erros.push('Nome repetido no arquivo');
      nomesNoArquivo.add(norm(nome));
    }

    // ── Unidade de estoque ──────────────────────────────────────────────────
    // Vem antes do resto porque Marca, Peso e as frações dependem dela.
    // Patrimônio não tem a seção Estoque na tela: fica UN.
    const unidade = comEstoque ? (siglaDaUnidade(bruto['Unidade de estoque'] ?? '') || 'UN') : 'UN';
    if (!unidadesOk.has(unidade)) {
      erros.push(`Unidade de estoque "${bruto['Unidade de estoque']}" não vale nesta unidade de negócio (use ${[...unidadesOk].join(', ')}). A quantidade vai em "Saldo de abertura (qtd)".`);
    }
    const frac = UNIDADES_FRACIONARIAS.has(unidade);
    const embalado = temConteudoDeEmbalagem(unidade);

    // ── Categoria e subcategoria ────────────────────────────────────────────
    if (vendavel) exige('Categoria', 'é obrigatória em Mercadoria');
    const cat = catPorNome.get(norm(bruto['Categoria']));
    if (bruto['Categoria'] && !cat) {
      erros.push(`Categoria "${bruto['Categoria']}" não existe — cadastre em Cadastros > Categorias antes`);
    }
    let sub = bruto['Subcategoria']
      ? (cat && subPorCatENome.get(`${cat.id}|${norm(bruto['Subcategoria'])}`)) || subPorNome.get(norm(bruto['Subcategoria']))
      : undefined;
    if (bruto['Subcategoria'] && !sub) {
      avisos.push(`Subcategoria "${bruto['Subcategoria']}" não existe — o produto entra sem ela`);
    } else if (sub && (!cat || sub.categoria_id !== cat.id)) {
      avisos.push(`Subcategoria "${sub.nome}" não é da categoria escolhida — o produto entra sem ela`);
      sub = undefined;
    }

    // ── Marca ───────────────────────────────────────────────────────────────
    // Mesma régua da tela: só mercadoria em embalagem declara marca.
    if (vendavel && embalado) exige('Marca', `é obrigatória em Mercadoria vendida em ${unidade}`);

    // ── Fornecedor ──────────────────────────────────────────────────────────
    // O formulário só aceita fornecedor cadastrado (grava o id). Nome fora da
    // lista era aceito com aviso e o produto nascia sem `fornecedor_id`.
    const forn = fornPorNome.get(norm(bruto['Fornecedor']));
    if (bruto['Fornecedor'] && !forn) {
      erros.push(`Fornecedor "${bruto['Fornecedor']}" não está cadastrado nesta unidade — escolha da lista ou cadastre antes`);
    }

    // ── EAN ─────────────────────────────────────────────────────────────────
    // Só mercadoria passa pelo leitor do caixa. Em branco, gera o interno (o
    // "Gerar" da tela); fora da mercadoria o valor é ignorado, como lá.
    let ean = '';
    const eanBruto = (bruto['Cód. Barras EAN'] ?? '').replace(/\D/g, '');
    if (vendavel) {
      if (!eanBruto) {
        ean = gerarEanInterno();
        avisos.push(`Sem código de barras — gerado um interno da loja (${ean})`);
      } else {
        const n13 = normalizeEan13(eanBruto);
        if (!n13.valid) erros.push(`Cód. Barras EAN inválido (${eanBruto}) — precisa de 12 ou 13 dígitos com verificador correto`);
        else ean = n13.value;
      }
    } else if (eanBruto) {
      avisos.push(`${TIPO_LABEL[tipo]} não passa pelo caixa — o código de barras foi ignorado`);
    }

    // ── Preços ──────────────────────────────────────────────────────────────
    const custoInformado = !!bruto['Preço de Custo (R$)'];
    const custo = num('Preço de Custo (R$)');
    const venda = num('Preço de Venda (R$)');
    if (custoInformado && !(custo > 0)) erros.push('Preço de Custo tem de ser maior que zero');
    // Consumo e patrimônio pagam valor de aquisição: sem ele não há custo nem
    // depreciação. Mercadoria em branco fica "a apurar" até o recebimento.
    if (!vendavel && !custoInformado) {
      erros.push(`Preço de Custo é obrigatório em ${TIPO_LABEL[tipo]} (é o valor de aquisição)`);
    }
    if (vendavel) {
      exige('Preço de Venda (R$)', 'é obrigatório em Mercadoria');
      if (bruto['Preço de Venda (R$)'] && !(venda > 0)) erros.push('Preço de Venda tem de ser maior que zero');
      // A tela BLOQUEIA venda abaixo do custo (só passa com a caixa marcada) —
      // foi o que pegou a turma que lançou os dois campos trocados.
      if (custo > 0 && venda > 0 && venda < custo) {
        erros.push(`Preço de venda (R$ ${formatBRL(venda)}) abaixo do custo (R$ ${formatBRL(custo)}) — confira se não estão trocados. Se for proposital, cadastre pela tela`);
      }
    } else if (bruto['Preço de Venda (R$)']) {
      avisos.push(`${TIPO_LABEL[tipo]} não se vende — o Preço de Venda foi ignorado e o item não aparece no PDV`);
    }

    // ── Quantidades ─────────────────────────────────────────────────────────
    const minimo = num('Estoque mínimo (qtd)');
    let saldo = num('Saldo de abertura (qtd)');
    if (comEstoque) {
      exige('Estoque mínimo (qtd)', `é obrigatório em ${TIPO_LABEL[tipo]}`);
      if (minimo < 0) erros.push('Estoque mínimo negativo');
      if (!frac && minimo % 1 !== 0) erros.push(`Estoque mínimo com fração, mas ${unidade} não aceita meia`);
      if (saldo < 0) erros.push('Saldo de abertura negativo');
      if (!frac && saldo % 1 !== 0) erros.push(`Saldo de abertura com fração, mas ${unidade} não aceita meia`);
      // Saldo de abertura só existe na implantação — o banco recusa a Entrada
      // depois disso, e o import descobria só DEPOIS de gravar o produto
      // (que ficava com 0). Recusar aqui deixa a linha para corrigir inteira.
      if (saldo > 0 && !contexto.emImplantacao) {
        erros.push('Saldo de abertura só na implantação da unidade — deixe em branco; a quantidade entra por Estoque > Recebimentos');
      }
      // A tela pergunta antes de gravar com zero; aqui não dá para perguntar,
      // então quem confere vê. Fora da implantação, zero é o certo.
      if (saldo === 0 && contexto.emImplantacao) avisos.push('Nasce com 0 em estoque — sem saldo, o PDV recusa a venda até alguém dar entrada');
    } else {
      // Patrimônio não tem saldo nem ponto de reposição: não se repõe um freezer.
      if (saldo > 0) avisos.push('Patrimônio não tem saldo de estoque — o Saldo de abertura foi ignorado');
      if (bruto['Estoque mínimo (qtd)']) avisos.push('Patrimônio não tem estoque mínimo — a coluna foi ignorada');
      saldo = 0;
    }

    // ── Conteúdo da embalagem (só mercearia, só fora do granel) ─────────────
    let peso: number | null = null;
    let pesoUnidade: string | null = null;
    if (isSuper) {
      const mostraPeso = comEstoque && embalado;
      const pTxt = bruto['Peso / Volume por embalagem'];
      const medida = normalizarUnidade(bruto['Medida do conteúdo'] ?? '', '');
      if (!mostraPeso) {
        if (pTxt || medida) avisos.push(comEstoque
          ? `Granel (${unidade}) não tem conteúdo por embalagem — Peso / Volume ignorado`
          : 'Patrimônio não tem conteúdo por embalagem — Peso / Volume ignorado');
      } else if (vendavel || pTxt) {
        // Obrigatório em mercadoria (vai na etiqueta); em consumo, se vier,
        // vem com medida. Mesmos três erros da tela.
        if (!pTxt) erros.push('Peso / Volume por embalagem é obrigatório em Mercadoria vendida em embalagem');
        else {
          peso = num('Peso / Volume por embalagem');
          if (!(peso > 0)) erros.push('Peso / Volume tem de ser maior que zero');
          if (!medida) erros.push('Peso / Volume sem a Medida do conteúdo (G, KG, ML, L ou UN)');
          else if (!(UNIDADES_CONTEUDO as readonly string[]).includes(medida)) {
            erros.push(`Medida do conteúdo "${bruto['Medida do conteúdo']}" inválida — use ${UNIDADES_CONTEUDO.join(', ')}`);
          } else if (medida === 'UN' && unidade === 'UN') {
            // Migr. 593: "1 UN contém N UN" não descreve nada.
            erros.push('Conteúdo em UN só quando a Unidade de estoque for embalagem (PCT, CX, PC)');
          }
          pesoUnidade = medida || null;
        }
      }
    }

    // ── Embalagem de compra (migr. 589) ─────────────────────────────────────
    // As duas colunas andam juntas, como no cadastro e como o CHECK do banco
    // exige. Patrimônio não tem: freezer não vem em fardo.
    let embNome: string | null = null;
    let embQtd: number | null = null;
    if (comEstoque) {
      const nomeEmb = normalizarUnidade(bruto['Compra em'] ?? '', '');
      const qtdEmbTxt = bruto['Qtd por embalagem'];
      if (nomeEmb !== '' || qtdEmbTxt) {
        if (nomeEmb === '') erros.push('"Qtd por embalagem" preenchida sem "Compra em"');
        else if (!EMBALAGENS_COMPRA.includes(nomeEmb as any)) {
          erros.push(`"Compra em" inválido: use ${EMBALAGENS_COMPRA.join(', ')}`);
        } else if (!qtdEmbTxt) {
          erros.push(`"Compra em" preenchido sem "Qtd por embalagem" — quantas ${unidade} vêm em um ${nomeEmb.toLowerCase()}?`);
        } else {
          embNome = nomeEmb;
          embQtd = num('Qtd por embalagem');
          if (!(embQtd > 1)) erros.push('"Qtd por embalagem" tem de ser maior que 1 — embalagem com uma unidade é a própria unidade');
          else if (!frac && embQtd % 1 !== 0) {
            erros.push(`"Qtd por embalagem" com fração, mas ${unidade} não aceita meia`);
          }
        }
      }
    } else if (bruto['Compra em'] || bruto['Qtd por embalagem']) {
      avisos.push('Patrimônio não tem embalagem de compra — as colunas foram ignoradas');
    }

    // ── Patrimônio ──────────────────────────────────────────────────────────
    let vidaUtil: number | null = null;
    if (isPatrimonio && bruto['Vida útil (meses)']) {
      vidaUtil = num('Vida útil (meses)');
      if (!(vidaUtil >= 1) || vidaUtil % 1 !== 0) { erros.push('Vida útil tem de ser um número inteiro de meses'); vidaUtil = null; }
    }

    // ── Ficha do nicho ──────────────────────────────────────────────────────
    // Só mercadoria, como na tela: um manequim cadastrado como patrimônio na
    // MaxLook não tem Tamanho nem Cor. O cabeçalho da coluna é
    // `rotuloParaCliente(def.label)` — a MESMA função que o gerador usa.
    const atributos: Record<string, any> = {};
    if (vendavel) {
      ficha.forEach(def => {
        const bruta = (bruto[rotuloParaCliente(def.label)] ?? '').trim();
        if (!bruta) return;
        // Bool aceita o que a turma escreve: Sim, S, X, 1, true.
        if (def.type === 'bool') atributos[def.key] = /^(sim|s|true|x|1)$/i.test(bruta);
        else atributos[def.key] = bruta;
      });
      // Obrigatoriedade da ficha, incluindo a condicional. Na tela o campo filho
      // só aparece quando o pai responde 'Sim'; na planilha, que é plana, a mesma
      // regra vira verificação aqui — senão perecível entra sem prazo e a fila de
      // Validades nasce cega (migr. 424).
      ficha.forEach(def => {
        const rotulo = rotuloParaCliente(def.label);
        const preenchido = atributos[def.key] !== undefined
          && String(atributos[def.key]).trim() !== '';
        if (def.req && !preenchido) {
          erros.push(`${rotulo} é obrigatório nesta unidade`);
          return;
        }
        if (def.reqSe && def.dependeDe && !preenchido) {
          const pai = atributos[def.dependeDe];
          const paiMarcado = def.dependeDeValor !== undefined
            ? String(pai ?? '').toLowerCase() === String(def.dependeDeValor).toLowerCase() || (pai === true && /^sim$/i.test(def.dependeDeValor))
            : pai === true;
          if (paiMarcado) {
            const rotuloPai = rotuloParaCliente(
              ficha.find(x => x.key === def.dependeDe)?.label ?? def.dependeDe);
            erros.push(`${rotulo} é obrigatório quando "${rotuloPai}" é Sim`);
          }
        }
      });
      // Foto de capa é obrigatória na tela e não cabe na planilha.
      avisos.push('Sem foto de capa — adicione pelo cadastro, é ela que aparece no PDV e no Catálogo');
    }

    const payload = erros.length > 0 ? null : {
      codigo,
      nome,
      categoria: cat?.nome ?? '',
      categoria_id: cat?.id ?? null,
      subcategoria_id: sub?.id ?? null,
      ean,
      fornecedor: forn?.nome ?? bruto['Fornecedor'],
      fornecedor_id: forn?.id ?? null,
      marca: bruto['Marca'] || null,
      // Zero, não o que veio digitado: mesma régua do formulário — item que
      // não se vende não carrega etiqueta de venda.
      preco: vendavel ? venda : 0,
      estoque: 0,
      estoque_minimo: comEstoque ? minimo : 0,
      unidade,
      peso,
      peso_unidade: peso !== null ? pesoUnidade : null,
      embalagem_compra: embNome,
      embalagem_qtd: embNome ? embQtd : null,
      filial,
      status: 'Ativo',
      tipo,
      patrimonio_numero:          isPatrimonio ? (bruto['Nº de Patrimônio (tag)'] || null) : null,
      patrimonio_responsavel:     isPatrimonio ? (bruto['Responsável'] || null) : null,
      patrimonio_localizacao:     isPatrimonio ? (bruto['Localização'] || null) : null,
      patrimonio_vida_util_meses: isPatrimonio ? vidaUtil : null,
      elegivel_beneficios: vendavel && isSuper && /^(sim|s|true|x|1)$/i.test(bruto['Elegível a benefícios'] ?? ''),
      atributos,
    };

    linhas.push({
      linhaNoArquivo: n,
      nome: nome || `(sem nome, linha ${n})`,
      erros, avisos, payload,
      precoCusto: custoInformado ? custo : 0,
      saldoAbertura: saldo,
    });
  });

  if (linhas.length === 0) {
    return { linhas: [], colunasFaltando: [], erroGeral: 'Achei o cabeçalho, mas nenhuma linha preenchida — só o exemplo e linhas em branco.' };
  }
  return { linhas, erroGeral: null, colunasFaltando: [] };
}

export type ResultadoGravacao = {
  criados: number;
  falhas: Array<{ linhaNoArquivo: number; nome: string; motivo: string }>;
};

/**
 * Grava as linhas válidas, uma a uma, pelo mesmo caminho do formulário:
 * `produtos` com estoque 0, `produtos_custo` pelo upsert e — quando há saldo de
 * abertura — UMA movimentação de Entrada de implantação (que não é compra e não
 * gera conta a pagar).
 *
 * Uma a uma, e não em lote, de propósito: o insert em bloco falha inteiro por
 * causa de uma linha, e a turma não descobre qual. Aqui a linha ruim fica com o
 * motivo dela e as outras entram.
 */
export async function gravarProdutosImportados(
  linhas: LinhaImport[],
  onProgresso?: (feitas: number, total: number) => void,
): Promise<ResultadoGravacao> {
  const validas = linhas.filter(l => l.payload && l.erros.length === 0);
  const falhas: ResultadoGravacao['falhas'] = [];
  let criados = 0;

  for (let i = 0; i < validas.length; i++) {
    const l = validas[i];
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const { data: novo, error } = await supabase
        .from('produtos').insert(l.payload as any).select().single();
      if (error) throw new Error(error.message);

      if (novo?.id && l.precoCusto > 0) {
        const { error: errCusto } = await supabase.from('produtos_custo').upsert(
          { produto_id: novo.id, preco_custo: l.precoCusto, origem: 'manual', updated_at: new Date().toISOString() },
          { onConflict: 'produto_id' },
        );
        if (errCusto) falhas.push({ linhaNoArquivo: l.linhaNoArquivo, nome: l.nome,
          motivo: `Produto criado, mas o custo não gravou: ${errCusto.message}` });
      }

      if (novo?.id && l.saldoAbertura > 0) {
        // Dia do Acre: o ISO em UTC já é amanhã depois das 19h daqui.
        const hoje = todayBR();
        const { error: errMov } = await supabase.from('movimentacoes_estoque').insert({
          produto_id: novo.id,
          tipo: 'Entrada',
          qtd: l.saldoAbertura,
          origem: 'Saldo Inicial de Implantação',
          destino: 'Almoxarifado',
          data: hoje,
          filial: (l.payload as any).filial,
        } as any);
        if (errMov) falhas.push({ linhaNoArquivo: l.linhaNoArquivo, nome: l.nome,
          motivo: `Produto criado, mas o saldo de abertura não entrou: ${errMov.message}` });
      }

      criados++;
    } catch (e: any) {
      falhas.push({ linhaNoArquivo: l.linhaNoArquivo, nome: l.nome, motivo: e?.message ?? 'erro desconhecido' });
    }
    onProgresso?.(i + 1, validas.length);
  }

  return { criados, falhas };
}
