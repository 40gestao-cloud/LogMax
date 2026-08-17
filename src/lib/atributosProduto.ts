// Ficha de produto por nicho — a régua única de `produtos.atributos`.
//
// Vivia dentro de ProdutosView, que é quem preenche a ficha. Saiu para cá
// quando o PDV passou a EXIBIR a mesma ficha no modal de detalhes do produto:
// duas cópias da lista divergiriam no primeiro campo novo, e o campo que o
// cadastro grava e a venda não mostra é pior que campo nenhum.
//
// `key` é a propriedade dentro do JSONB. `req=true` marca obrigatório no
// cadastro. `type='select'` exige `options`; `type='bool'` vira checkbox;
// `type='textarea'` ocupa o rodapé da ficha.

export type AtributoDef = {
  key: string;
  label: string;
  placeholder?: string;
  req?: boolean;
  type?: 'text' | 'select' | 'bool' | 'textarea';
  options?: readonly string[];
  wide?: boolean; // ocupa linha inteira no grid
  /** Explica o campo quando o rótulo não basta. Vai abaixo do input. */
  dica?: string;
  /**
   * Só aparece quando o campo booleano nomeado aqui estiver marcado. Nasceu da
   * ficha de perecível: "Validade (dias)" e "Armazenagem" ficavam habilitados
   * mesmo com "Produto perecível" desmarcado, e a turma preenchia validade de
   * detergente. Ao desmarcar o pai, o formulário limpa os filhos.
   */
  dependeDe?: string;
  /** Obrigatório apenas quando o campo de `dependeDe` está marcado. */
  reqSe?: boolean;
  /** Restringe a digitação a dígitos (prazo em dias, garantia). */
  soDigitos?: boolean;
};

export const ATRIBUTOS_PRODUTO: Record<string, AtributoDef[]> = {
  MaxLook: [
    { key: 'tamanho',  label: 'Tamanho *',   placeholder: 'Ex: P, M, G, 38, 40', req: true },
    { key: 'cor',      label: 'Cor *',       placeholder: 'Ex: Preto, Azul Marinho', req: true },
    { key: 'genero',   label: 'Gênero *',    type: 'select', req: true,
      options: ['Feminino', 'Masculino', 'Unissex', 'Infantil'] as const },
    { key: 'colecao',  label: 'Coleção',     placeholder: 'Ex: Verão 2026' },
    { key: 'material', label: 'Composição / Material', placeholder: 'Ex: 100% Algodão' },
  ],
  TechMax: [
    { key: 'modelo',        label: 'Modelo *',        placeholder: 'Ex: iPhone 13, Galaxy S23', req: true },
    { key: 'cor',           label: 'Cor',             placeholder: 'Ex: Meia-noite, Titânio' },
    { key: 'memoria',       label: 'Memória',         placeholder: 'Ex: 128 GB, 256 GB' },
    { key: 'tela',          label: 'Tela',            placeholder: 'Ex: 6.1"' },
    { key: 'bateria',       label: 'Bateria',         placeholder: 'Ex: 3240 mAh' },
    { key: 'camera',        label: 'Câmera',          placeholder: 'Ex: 12 MP + 12 MP' },
    // Era texto livre: entrava "1 ano", "12 meses" e "90 dias" na mesma coluna,
    // e aí nada consegue calcular data nenhuma. Só dígitos, como `validade_dias`
    // da mercearia — é o que faz o recibo de venda saber até quando o aparelho
    // está coberto.
    { key: 'garantia_dias', label: 'Garantia (dias)', placeholder: 'Ex: 90, 365',
      type: 'text', soDigitos: true,
      dica: 'Em dias, contados da data da venda. O recibo mostra a data-limite da garantia a partir daqui.' },
    // O rótulo dizia "no fechamento" e prometia o que o PDV não faz: quem pede
    // o número é o RECEBIMENTO, um por aparelho, e a venda baixa o mais antigo
    // sozinha (migr. 444). O PDV não escolhe IMEI pela mesma razão que não
    // escolhe lote (migr. 424) — fila do caixa não é lugar de decidir isso.
    { key: 'requer_imei', label: 'Cada unidade tem IMEI/Serial', type: 'bool', wide: true,
      dica: 'Marque para aparelho com número de série. O Recebimento passa a pedir um número por unidade, e a venda registra qual aparelho saiu.' },
    // Eletrônico raramente cabe nos campos fixos: acessório que acompanha,
    // estado de seminovo, restrição de operadora, condição da assistência.
    // Campo livre no fim da ficha em vez de mais seis colunas fixas.
    { key: 'informacoes_adicionais', label: 'Informações adicionais', type: 'textarea', wide: true,
      placeholder: 'Ex: acompanha carregador e capa; aparelho de vitrine com pequena marca na traseira; garantia de bateria não coberta.' },
  ],
  // Mercearia era a única filial sem ficha — e é a que tem 61% do catálogo.
  // Estava invertido: no varejo alimentar o cadastro de produto é o mais
  // exigente dos três, porque é o único onde a mercadoria estraga. É isto que
  // faz o supermercado trabalhar com PEPS e a loja de roupa não precisar.
  //
  // Nenhum campo é obrigatório de propósito: 149 produtos já estão cadastrados
  // e virariam incompletos de um dia para o outro. Campo que trava sem informar
  // é como nasce o "nao temos ou acabou" da migr. 358 — a listagem avisa quem
  // está sem ficha, e isso basta.
  SuperMax: [
    { key: 'perecivel', label: 'Produto perecível', type: 'bool', wide: true },
    // Os dois passam a depender do checkbox, e a validade vira obrigatória
    // quando ele está marcado: perecível sem prazo é o cadastro que impede o
    // recebimento de calcular a data e devolve o problema para a digitação à
    // mão — que é de onde a migr. 424 estava tentando sair.
    { key: 'validade_dias', label: 'Validade (dias)', placeholder: 'Ex: 5, 30, 180',
      dependeDe: 'perecivel', reqSe: true, soDigitos: true,
      dica: 'Prazo desde o recebimento. O Recebimento usa isto para calcular a data de vencimento do lote, e é ela que ordena a fila de Validades.' },
    { key: 'armazenagem', label: 'Armazenagem', type: 'select', dependeDe: 'perecivel',
      options: ['Ambiente', 'Refrigerado', 'Congelado'] as const,
      dica: 'Aparece como selo na fila de Validades — é o que decide o que se resolve primeiro.' },
  ],
};

/**
 * `'P / Preto'` — o que distingue esta variante das outras do mesmo modelo
 * (migr. 445), ou null quando o produto não tem grade.
 *
 * Existe para a etiqueta e para a listagem: sem isto, as 6 etiquetas de uma
 * camiseta P/M/G × 2 cores saem idênticas, porque a etiqueta imprime nome e
 * preço e os dois são iguais nas 6.
 */
export const rotuloVariante = (produto: unknown): string | null => {
  const a = (produto as any)?.atributos ?? {};
  const partes = [a.tamanho, a.cor].map(v => String(v ?? '').trim()).filter(Boolean);
  return partes.length ? partes.join(' / ') : null;
};

/**
 * True quando cada unidade do produto tem número próprio (IMEI/serial).
 *
 * Marcado no cadastro da TechMax, o campo passou a significar alguma coisa na
 * migr. 444: o Recebimento pede um número por aparelho e a venda baixa o mais
 * antigo (FIFO), gravando em `produto_unidades`. Antes disso o campo existia e
 * não fazia nada — não havia onde guardar cinco IMEIs de cinco iPhones.
 */
export const requerImei = (produto: unknown): boolean =>
  (produto as any)?.atributos?.requer_imei === true;

/**
 * Dias de garantia da ficha do produto, ou null quando não há número utilizável.
 *
 * A ficha guardava texto livre e a turma escrevia "1 ano", "12 meses" e "90".
 * O campo passou a aceitar só dígitos (`soDigitos`), mas o histórico continua
 * no banco — daí o parse tolerante aqui em vez de `Number()` seco.
 */
export const garantiaDias = (atributos: unknown): number | null => {
  const bruto = String((atributos as any)?.garantia_dias ?? '').trim();
  const m = bruto.match(/^\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Data-limite da garantia: data da venda + dias da ficha, em `dd/mm/aaaa`.
 * Null quando o produto não tem garantia cadastrada — e aí o recibo não fala
 * de garantia nenhuma, em vez de imprimir uma linha vazia.
 */
export const garantiaAte = (atributos: unknown, dataVenda: string | Date): string | null => {
  const dias = garantiaDias(atributos);
  if (dias === null) return null;
  const base = dataVenda instanceof Date ? dataVenda : new Date(dataVenda);
  if (Number.isNaN(base.getTime())) return null;
  const fim = new Date(base.getTime());
  fim.setDate(fim.getDate() + dias);
  return fim.toLocaleDateString('pt-BR');
};

/** Rótulo sem o asterisco de obrigatório — o cliente não precisa ver a regra do cadastro. */
export const rotuloParaCliente = (label: string): string => label.replace(/\s*\*\s*$/, '');

/**
 * Valor da ficha como se mostra a um cliente.
 *
 * A turma cadastra em CAIXA ALTA com frequência ("PRETO DETALHES EM LARANJA",
 * "100% ALGODÃO"), e grito na tela vira grito na frente do cliente. Só desce
 * a caixa quando a string é inteiramente maiúscula e tem palavra longa —
 * assim "P", "M", "GG", "5G" e "128 GB" ficam como estão.
 *
 * `garantia_dias` aceita número puro no cadastro; sem unidade, "365" não diz
 * nada no balcão.
 */
export const valorParaCliente = (key: string, valor: unknown): string => {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return '';

  if (key === 'garantia_dias' && /^\d+$/.test(bruto)) {
    return bruto === '1' ? '1 dia' : `${bruto} dias`;
  }

  const temPalavraLonga = /[A-ZÀ-Ú]{4,}/.test(bruto);
  if (bruto === bruto.toLocaleUpperCase('pt-BR') && temPalavraLonga) {
    const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para']);
    return bruto
      .toLocaleLowerCase('pt-BR')
      .split(' ')
      .map((p, i) => (i > 0 && minusculas.has(p)) || p.length === 0
        ? p
        : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1))
      .join(' ');
  }
  return bruto;
};
