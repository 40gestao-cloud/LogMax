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
    { key: 'garantia_dias', label: 'Garantia (dias)', placeholder: 'Ex: 90, 365', type: 'text' },
    { key: 'requer_imei',   label: 'Requer IMEI/Serial no fechamento', type: 'bool', wide: true },
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
