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
import { UNIDADES_FRACIONARIAS, normalizarUnidade, EMBALAGENS_COMPRA } from './unidades';
import { unidadesDeProduto } from './unidades';
import { normalizeEan13, gerarEanInterno } from './barcode';
import { parseBRL, parseQtd } from './viewUtils';
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
 * Lê o arquivo e devolve uma linha por produto, cada uma já dizendo se entra ou
 * por quê não. NÃO grava nada — quem grava é `gravarProdutosImportados`, depois
 * de a pessoa ver a conferência na tela.
 */
export async function lerPlanilhaProdutos(
  file: File,
  filial: string,
  /** Catálogo atual da filial, para achar categoria/subcategoria e acusar repetido. */
  contexto: {
    categorias: Array<{ id: string; nome: string }>;
    subcategorias: Array<{ id: string; nome: string; categoria_id: string }>;
    fornecedores: string[];
    codigosExistentes: string[];
    nomesExistentes: string[];
  },
): Promise<ResultadoLeitura> {
  const vazio = (erro: string): ResultadoLeitura =>
    ({ linhas: [], erroGeral: erro, colunasFaltando: [] });

  let ws: any;
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
      ws = wb.addWorksheet('csv');
      texto.split(/\r?\n/).forEach(linha => {
        if (linha.trim() === '') { ws.addRow([]); return; }
        ws.addRow(linha.split(sep).map(c => c.replace(/^"|"$/g, '')));
      });
    } else {
      await wb.xlsx.load(buf);
      // A aba de preenchimento é a que tem o cabeçalho; procuramos por conteúdo
      // e não por nome, porque a turma renomeia aba (e o Google Planilhas
      // renomeia sozinho ao exportar).
      ws = wb.worksheets[0];
      const modeloTmp = getModelo('produtos', filial, {});
      const alvo = norm(modeloTmp.campos[0].col);
      for (const cand of wb.worksheets) {
        let achou = false;
        cand.eachRow({ includeEmpty: false }, (row: any) => {
          if (achou) return;
          const vals = (row.values ?? []).map((v: any) => norm(celulaTexto(v)).replace(/ \*$/, ''));
          if (vals.includes(alvo)) achou = true;
        });
        if (achou) { ws = cand; break; }
      }
    }
  } catch (e: any) {
    return vazio(`Não consegui abrir o arquivo: ${e?.message ?? 'formato não reconhecido'}. Use o .xlsx do "Modelo de planilha" ou um .csv com os mesmos cabeçalhos.`);
  }
  if (!ws) return vazio('A planilha está vazia.');

  const listas = await carregarListasDoLogMax('produtos', filial).catch(() => ({}));
  const modelo = getModelo('produtos', filial, listas);
  const campos = modelo.campos;

  // ── Acha a linha de cabeçalho ─────────────────────────────────────────────
  // O modelo tem título, linha em branco, cabeçalho e linha de exemplo antes
  // dos dados. Planilha refeita à mão pode ter o cabeçalho na linha 1. Achamos
  // pela linha que contém o maior número de colunas conhecidas.
  const colDe = new Map<number, ModeloCampo>();
  let linhaCabecalho = 0;
  let melhorAcerto = 0;
  ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
    const mapa = new Map<number, ModeloCampo>();
    (row.values ?? []).forEach((v: any, i: number) => {
      const t = norm(celulaTexto(v)).replace(/\s*\*$/, '');
      if (!t) return;
      const campo = campos.find(c => norm(c.col) === t);
      if (campo) mapa.set(i, campo);
    });
    if (mapa.size > melhorAcerto) {
      melhorAcerto = mapa.size;
      linhaCabecalho = n;
      colDe.clear();
      mapa.forEach((c, i) => colDe.set(i, c));
    }
  });

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

  const valorDe = (row: any, col: string): string => {
    for (const [i, campo] of colDe) if (campo.col === col) return celulaTexto(row.getCell(i).value).trim();
    return '';
  };

  const catPorNome = new Map(contexto.categorias.map(c => [norm(c.nome), c]));
  const subPorNome = new Map(contexto.subcategorias.map(s => [norm(s.nome), s]));
  const fornSet    = new Set(contexto.fornecedores.map(norm));
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

    const bruto: Record<string, string> = {};
    campos.forEach(c => { bruto[c.col] = valorDe(row, c.col); });

    // Linha inteira em branco: o modelo vem com 100 linhas formatadas.
    if (Object.values(bruto).every(v => v === '')) return;

    // Linha de exemplo do modelo: bate com os exemplos declarados. Só pulamos
    // quando bate em TUDO que tem exemplo — assim um produto de verdade nunca
    // é confundido com ela.
    const comExemplo = campos.filter(c => c.exemplo);
    if (comExemplo.length > 0 && comExemplo.every(c => norm(bruto[c.col]) === norm(c.exemplo))) return;

    const erros: string[] = [];
    const avisos: string[] = [];
    const exige = (col: string) => { if (!bruto[col]) erros.push(`${col} é obrigatório`); };

    // EAN fica de fora da checagem genérica: ele é obrigatório no sentido de
    // TER de existir, não de vir preenchido. O formulário resolve isso com o
    // botão "Gerar" (prefixo 2, interno da loja), e a própria dica da coluna no
    // modelo promete o mesmo — "sem o código do fabricante, o cadastro gera um
    // interno". Cobrar aqui recusaria a roupa sem etiqueta, que é o caso em que
    // a promessa vale. O tratamento dele está logo abaixo.
    campos
      .filter(c => c.obrigatorio && c.col !== 'Cód. Barras EAN')
      .forEach(c => exige(c.col));

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

    // ── Categoria e subcategoria ────────────────────────────────────────────
    const cat = catPorNome.get(norm(bruto['Categoria']));
    if (bruto['Categoria'] && !cat) {
      erros.push(`Categoria "${bruto['Categoria']}" não existe — cadastre em Cadastros > Categorias antes`);
    }
    let sub = bruto['Subcategoria'] ? subPorNome.get(norm(bruto['Subcategoria'])) : undefined;
    if (bruto['Subcategoria'] && !sub) {
      avisos.push(`Subcategoria "${bruto['Subcategoria']}" não existe — o produto entra sem ela`);
    } else if (sub && cat && sub.categoria_id !== cat.id) {
      avisos.push(`Subcategoria "${sub.nome}" é de outra categoria — o produto entra sem ela`);
      sub = undefined;
    }

    // ── Fornecedor ──────────────────────────────────────────────────────────
    // Coluna de texto no banco, como no formulário. Fora da lista não impede:
    // avisa, porque pode ser fornecedor novo digitado com outra grafia.
    if (bruto['Fornecedor'] && !fornSet.has(norm(bruto['Fornecedor']))) {
      avisos.push(`Fornecedor "${bruto['Fornecedor']}" não está cadastrado nesta unidade`);
    }

    // ── EAN ─────────────────────────────────────────────────────────────────
    let ean = '';
    const eanBruto = (bruto['Cód. Barras EAN'] ?? '').replace(/\D/g, '');
    if (!eanBruto) {
      ean = gerarEanInterno();
      avisos.push(`Sem código de barras — gerado um interno da loja (${ean})`);
    } else {
      const n13 = normalizeEan13(eanBruto);
      if (!n13.valid) erros.push(`Cód. Barras EAN inválido (${eanBruto}) — precisa de 12 ou 13 dígitos com verificador correto`);
      else ean = n13.value;
    }

    // ── Unidade, preços e quantidades ───────────────────────────────────────
    const unidade = normalizarUnidade(bruto['Unidade'] || 'UN');
    if (!unidadesOk.has(unidade)) {
      erros.push(`Unidade "${bruto['Unidade']}" não vale nesta unidade de negócio (use ${[...unidadesOk].join(', ')})`);
    }
    const frac = UNIDADES_FRACIONARIAS.has(unidade);

    const custo = parseBRL(bruto['Preço de Custo (R$)']);
    const venda = parseBRL(bruto['Preço de Venda (R$)']);
    if (bruto['Preço de Custo (R$)'] && !(custo > 0)) erros.push('Preço de Custo inválido');
    if (bruto['Preço de Venda (R$)'] && !(venda > 0)) erros.push('Preço de Venda inválido');
    // Mesmo aviso do formulário: existe queima de estoque e isca de vitrine,
    // então não impede — mas quem confere tem de ver.
    if (custo > 0 && venda > 0 && venda < custo) avisos.push('Preço de venda abaixo do custo');

    const minimo = parseQtd(bruto['Estoque Mínimo']);
    if (bruto['Estoque Mínimo'] && !(minimo >= 0)) erros.push('Estoque Mínimo inválido');
    if (!frac && minimo % 1 !== 0) erros.push(`Estoque Mínimo com fração, mas a unidade ${unidade} não aceita meia`);

    const saldo = parseQtd(bruto['Saldo de Abertura'] ?? '');
    if (saldo < 0) erros.push('Saldo de Abertura negativo');
    if (!frac && saldo % 1 !== 0) erros.push(`Saldo de Abertura com fração, mas a unidade ${unidade} não aceita meia`);

    // ── Conteúdo da embalagem (só mercearia) ────────────────────────────────
    let peso: number | null = null;
    let pesoUnidade: string | null = null;
    if (isSuper) {
      const p = bruto['Peso / Volume por embalagem'];
      if (p) {
        peso = parseQtd(p);
        pesoUnidade = bruto['Medida do conteúdo'] || null;
        // O CHECK chk_produtos_peso_unidade_orfa (migr. 438) recusa no banco;
        // acusar aqui evita o insert que morre com erro de constraint.
        if (!pesoUnidade) erros.push('Peso / Volume preenchido sem a Medida do conteúdo');
        if (!(peso > 0)) erros.push('Peso / Volume inválido');
      }
    }

    // ── Embalagem de compra (migr. 589) ─────────────────────────────────────
    // Vale nas três filiais: caixa de camiseta e caixa de fone são tão reais
    // quanto o fardo de arroz. As duas colunas andam juntas, como no cadastro
    // e como o CHECK do banco exige.
    let embNome: string | null = null;
    let embQtd: number | null = null;
    {
      const nome = normalizarUnidade(bruto['Compra em'] ?? '', '');
      const qtdEmb = bruto['Qtd por embalagem'];
      if (nome !== '' || qtdEmb) {
        if (nome === '') erros.push('"Qtd por embalagem" preenchida sem "Compra em"');
        else if (!EMBALAGENS_COMPRA.includes(nome as any)) {
          erros.push(`"Compra em" inválido: use ${EMBALAGENS_COMPRA.join(', ')}`);
        } else if (!qtdEmb) {
          erros.push('"Compra em" preenchido sem "Qtd por embalagem"');
        } else {
          embNome = nome;
          embQtd = parseQtd(qtdEmb);
          // Espelha chk_produtos_embalagem_qtd: embalagem com uma unidade é a
          // própria unidade, e a requisição não teria o que converter.
          if (!(embQtd > 1)) erros.push('"Qtd por embalagem" tem de ser maior que 1');
          else if (!frac && embQtd % 1 !== 0) {
            erros.push(`"Qtd por embalagem" com fração, mas a unidade ${unidade} não aceita meia`);
          }
        }
      }
    }

    // ── Ficha do nicho ──────────────────────────────────────────────────────
    // O cabeçalho da coluna é `rotuloParaCliente(def.label)` — a MESMA função
    // que o gerador usa (`campoDaFicha`). Reescrever o rótulo aqui seria criar
    // a terceira cópia da ficha, que é justamente o que `atributosProduto.ts`
    // existe para impedir.
    const atributos: Record<string, any> = {};
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
        const pai = String(atributos[def.dependeDe] ?? '').trim().toLowerCase();
        if (pai === String(def.dependeDeValor ?? '').toLowerCase()) {
          const rotuloPai = rotuloParaCliente(
            ficha.find(x => x.key === def.dependeDe)?.label ?? def.dependeDe);
          erros.push(`${rotulo} é obrigatório quando "${rotuloPai}" é ${def.dependeDeValor}`);
        }
      }
    });

    const payload = erros.length > 0 ? null : {
      codigo,
      nome,
      categoria: cat?.nome ?? bruto['Categoria'],
      categoria_id: cat?.id ?? null,
      subcategoria_id: sub?.id ?? null,
      ean,
      fornecedor: bruto['Fornecedor'],
      marca: bruto['Marca'] || null,
      preco: venda,
      estoque: 0,
      estoque_minimo: minimo,
      unidade,
      peso,
      peso_unidade: pesoUnidade,
      embalagem_compra: embNome,
      embalagem_qtd: embQtd,
      filial,
      status: 'Ativo',
      tipo: 'estoque_venda',
      elegivel_beneficios: isSuper && /^(sim|s|true|x|1)$/i.test(bruto['Elegível a benefícios'] ?? ''),
      atributos,
    };

    linhas.push({
      linhaNoArquivo: n,
      nome: nome || `(sem nome, linha ${n})`,
      erros, avisos, payload,
      precoCusto: custo,
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
        const hoje = new Date().toISOString().slice(0, 10);
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
