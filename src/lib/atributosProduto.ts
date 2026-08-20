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
  /**
   * Valor do pai que libera este campo. Sem isto, o pai precisa ser `true`
   * (checkbox). Existe desde que "Produto perecível" deixou de ser checkbox:
   * caixa desmarcada nunca distinguiu "não é perecível" de "ninguém respondeu".
   */
  dependeDeValor?: string;
  /** Restringe a digitação a dígitos (prazo em dias, garantia). */
  soDigitos?: boolean;
  /**
   * Valor com que o campo NASCE num cadastro novo. Para o caso em que a lei ou
   * a prática já respondem a pergunta e deixar em branco só produz variação
   * sem informação — a garantia de 90 dias do CDC é o exemplo. Continua
   * editável: é padrão, não trava.
   */
  padrao?: string;
  /**
   * Só para `type='select'`: além das opções, oferece "Outro" e abre um campo
   * de texto. Existe para o caso em que a lista cobre 95% e engessar o resto
   * seria pior — tamanho de peça importada, cor de coleção. Sem isto a escolha
   * é entre lista fechada (que trava) e texto livre (que multiplica grafia).
   */
  livre?: boolean;
};

export const ATRIBUTOS_PRODUTO: Record<string, AtributoDef[]> = {
  MaxLook: [
    // Texto livre aqui era o que estragava a grade: "M", "Média" e "Medio"
    // viram três variantes do mesmo tamanho, e o índice único da migr. 445 não
    // tem como saber que são a mesma coisa (ele normaliza caixa e espaço, não
    // vocabulário). Lista + "Outro" para o que a lista não cobre.
    { key: 'tamanho', label: 'Tamanho *', type: 'select', req: true, livre: true,
      options: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único',
                '36', '38', '40', '42', '44', '46', '48'] as const,
      dica: 'A grade se monta a partir daqui — escrever o mesmo tamanho de dois jeitos cria duas variantes.' },
    { key: 'cor', label: 'Cor *', type: 'select', req: true, livre: true,
      options: ['Preto', 'Branco', 'Cinza', 'Bege', 'Marrom', 'Azul', 'Azul Marinho',
                'Vermelho', 'Verde', 'Amarelo', 'Rosa', 'Roxo', 'Estampado'] as const },
    { key: 'genero',   label: 'Gênero *',    type: 'select', req: true,
      options: ['Feminino', 'Masculino', 'Unissex', 'Infantil'] as const },
    { key: 'colecao',  label: 'Coleção',     placeholder: 'Ex: Verão 2026' },
    { key: 'material', label: 'Composição / Material', placeholder: 'Ex: 100% Algodão' },
  ],
  TechMax: [
    { key: 'modelo',        label: 'Modelo *',        placeholder: 'Ex: iPhone 13, Galaxy S23', req: true },
    // Estava sendo escrito à mão em "Informações adicionais", onde nada
    // consegue ler. Novo, seminovo e vitrine mudam preço, garantia e a conversa
    // da venda — e o seminovo é justamente o caso em que saber QUAL aparelho
    // saiu (migr. 444) vale mais.
    { key: 'estado', label: 'Estado *', type: 'select', req: true,
      options: ['Novo', 'Seminovo', 'Vitrine', 'Recondicionado'] as const,
      dica: 'Vitrine é aparelho novo que ficou exposto. Recondicionado passou por reparo do fabricante.' },
    { key: 'cor',           label: 'Cor',             placeholder: 'Ex: Meia-noite, Titânio' },
    { key: 'memoria',       label: 'Memória',         placeholder: 'Ex: 128 GB, 256 GB' },
    { key: 'tela',          label: 'Tela',            placeholder: 'Ex: 6.1"' },
    { key: 'bateria',       label: 'Bateria',         placeholder: 'Ex: 3240 mAh' },
    { key: 'camera',        label: 'Câmera',          placeholder: 'Ex: 12 MP + 12 MP' },
    // Era texto livre: entrava "1 ano", "12 meses" e "90 dias" na mesma coluna,
    // e aí nada consegue calcular data nenhuma. Só dígitos, como `validade_dias`
    // da mercearia — é o que faz o recibo de venda saber até quando o aparelho
    // está coberto.
    // Opcional era ficção: no Brasil não existe eletrônico sem garantia — o CDC
    // dá 90 dias a todo produto durável, independente do que a loja escreva. O
    // campo em branco não significava "sem garantia", significava "ninguém
    // preencheu", e o recibo saía calado sobre um direito que o cliente tem de
    // qualquer jeito. Nasce com 90 e é obrigatório; quem dá mais, aumenta.
    { key: 'garantia_dias', label: 'Garantia (dias) *', placeholder: 'Ex: 90, 365',
      type: 'text', soDigitos: true, req: true, padrao: '90',
      dica: 'Em dias, contados da data da venda. 90 é o mínimo legal do CDC para produto durável — a garantia do fabricante costuma ser 365. O recibo mostra a data-limite a partir daqui.' },
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
  // "Produto perecível" era checkbox e nenhum campo era obrigatório, porque 149
  // produtos já cadastrados virariam incompletos de um dia para o outro. Com a
  // base zerada para a turma nova, esse argumento venceu — e o checkbox tinha um
  // defeito que ele escondia: desmarcado nunca distinguiu "não é perecível" de
  // "ninguém respondeu". Na única filial onde a mercadoria estraga, essa
  // diferença é a fila de Validades inteira: item perecível que ninguém marcou
  // não entra na fila, não é remarcado e a perda aparece no inventário.
  //
  // Vira pergunta de resposta obrigatória. Sim/Não, sem meio-termo.
  SuperMax: [
    { key: 'perecivel', label: 'Produto perecível *', type: 'select', req: true, wide: true,
      options: ['Não', 'Sim'] as const,
      dica: 'Estraga com o tempo? Leite, frios e hortifruti sim; sabão em pó e enlatado não.' },
    // Os dois passam a depender do checkbox, e a validade vira obrigatória
    // quando ele está marcado: perecível sem prazo é o cadastro que impede o
    // recebimento de calcular a data e devolve o problema para a digitação à
    // mão — que é de onde a migr. 424 estava tentando sair.
    { key: 'validade_dias', label: 'Validade (dias)', placeholder: 'Ex: 5, 30, 180',
      dependeDe: 'perecivel', dependeDeValor: 'Sim', reqSe: true, soDigitos: true,
      dica: 'Prazo desde o recebimento. O Recebimento usa isto para calcular a data de vencimento do lote, e é ela que ordena a fila de Validades.' },
    // Obrigatória junto com a validade, e pela mesma razão: quem recebe a carga
    // precisa saber ANTES de guardar se aquilo vai para a câmara fria, para o
    // freezer ou para a prateleira seca. Perecível sem armazenagem devolve a
    // decisão para o palpite de quem está na doca — e leite fora da geladeira
    // não espera a próxima aula.
    { key: 'armazenagem', label: 'Armazenagem', type: 'select',
      dependeDe: 'perecivel', dependeDeValor: 'Sim', reqSe: true,
      options: ['Ambiente', 'Refrigerado', 'Congelado'] as const,
      dica: 'Aparece como selo na fila de Validades — é o que decide o que se resolve primeiro.' },
  ],
};

/**
 * Ficha inicial de um cadastro NOVO nesta filial — só os campos que têm
 * `padrao`. Vazio para quem não tem nenhum, que é o caso das outras duas.
 *
 * Não se aplica ao editar: produto antigo com o campo em branco continua em
 * branco até alguém responder. Preencher retroativamente seria inventar
 * garantia que a loja nunca deu.
 */
export const atributosPadrao = (filial: string): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const d of ATRIBUTOS_PRODUTO[filial] ?? []) {
    if (d.padrao !== undefined) out[d.key] = d.padrao;
  }
  return out;
};

/**
 * Rótulo do campo na tela, com o asterisco de obrigatório.
 *
 * Campo de `req` fixo já traz o asterisco escrito no próprio label. O de
 * `reqSe` não pode: ele só é obrigatório quando o pai libera, e o asterisco
 * precisa aparecer junto com o campo. Sem isto o asterisco saía só nos inputs
 * de texto — "Armazenagem", que é `select`, ficava sem marca nenhuma e cobrava
 * no Salvar.
 */
export const rotuloAtributo = (d: AtributoDef): string =>
  d.reqSe && !d.label.trimEnd().endsWith('*') ? `${d.label} *` : d.label;

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
