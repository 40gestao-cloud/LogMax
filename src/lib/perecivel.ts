// Ficha de perecível da mercearia — a leitura que faltava.
//
// A migr. 360 criou os três campos em `produtos.atributos` (perecivel,
// validade_dias, armazenagem) com uma dica que prometia muito: "Prazo desde o
// recebimento. É o que decide remarcação e ordem de saída."
//
// Nada lia. O cadastro gravava, e ponto. A migr. 424 deu tela à validade meses
// depois, mas por outro caminho: `vencimentos_estoque` com data digitada à mão,
// lote a lote, sem nunca perguntar ao produto quantos dias ele dura. As duas
// metades existiam e não se encontravam — o aluno preenchia "Validade: 5 dias"
// no cadastro e depois digitava a data do iogurte de novo, no recebimento.
//
// Este arquivo é o encontro: transforma a ficha em data prevista de vencimento.
// A conta é a que a dica sempre descreveu — data de entrada + validade_dias.

/** Chaves da ficha dentro de `produtos.atributos`. */
export const ATR_PERECIVEL = 'perecivel';
export const ATR_VALIDADE_DIAS = 'validade_dias';
export const ATR_ARMAZENAGEM = 'armazenagem';

export type Armazenagem = 'Ambiente' | 'Refrigerado' | 'Congelado';

export const ARMAZENAGENS: readonly Armazenagem[] = ['Ambiente', 'Refrigerado', 'Congelado'];

const atr = (produto: any): Record<string, any> =>
  produto?.atributos && typeof produto.atributos === 'object' ? produto.atributos : {};

/**
 * A resposta da ficha. Aceita as duas formas: o checkbox antigo (`true`) e a
 * pergunta Sim/Não que o substituiu — turma que ainda não recadastrou continua
 * com booleano gravado, e ler só uma das duas apagaria metade da fila de
 * Validades sem avisar.
 *
 * Produto sem ficha continua não sendo perecível aqui — mas agora isso é
 * "ninguém respondeu", e a listagem acusa a ficha vazia.
 */
export const ehPerecivel = (produto: any): boolean => {
  const v = atr(produto)[ATR_PERECIVEL];
  return v === true || String(v ?? '').trim().toLowerCase() === 'sim';
};

/**
 * Prazo em dias, ou null. O campo é texto no cadastro (a turma digita "30",
 * mas também "30 dias" e "5"), então a leitura é tolerante e a escrita é que
 * ficou restrita a dígitos.
 */
export const validadeDias = (produto: any): number | null => {
  const bruto = String(atr(produto)[ATR_VALIDADE_DIAS] ?? '').trim();
  if (!bruto) return null;
  const n = parseInt(bruto.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const armazenagemDe = (produto: any): Armazenagem | null => {
  const v = String(atr(produto)[ATR_ARMAZENAGEM] ?? '').trim();
  return (ARMAZENAGENS as readonly string[]).includes(v) ? (v as Armazenagem) : null;
};

/**
 * Data prevista de vencimento: entrada + validade_dias, em ISO (YYYY-MM-DD).
 *
 * Aritmética em UTC ao meio-dia de propósito — somar dias com `new Date()` local
 * erra na borda do fuso, e a operação roda no Acre (UTC-5). É a mesma precaução
 * que `diasAte` já toma em Validades.
 *
 * Devolve null quando o produto não tem prazo: sugerir data para item sem ficha
 * seria inventar a informação que esta função existe para parar de inventar.
 */
export const vencimentoPrevisto = (produto: any, dataEntradaISO: string): string | null => {
  const dias = validadeDias(produto);
  if (dias === null || !/^\d{4}-\d{2}-\d{2}$/.test(dataEntradaISO)) return null;
  const base = Date.parse(`${dataEntradaISO}T12:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
};

/** Cor do selo de armazenagem. Ambiente não ganha selo: é o caso comum. */
export const ARMAZENAGEM_ESTILO: Record<Armazenagem, string> = {
  Ambiente:   '',
  Refrigerado: 'bg-sky-900/40 text-sky-300 border border-sky-600/30',
  Congelado:   'bg-indigo-900/40 text-indigo-300 border border-indigo-500/30',
};

/**
 * Perecível que entrou no estoque sem lote é o buraco que a 424 quis fechar e
 * que a ficha, sozinha, não fechava: a perda por validade só existe se alguém
 * tiver registrado a data.
 */
export const avisoPerecivelSemValidade = (produto: any): string | null => {
  if (!ehPerecivel(produto)) return null;
  const dias = validadeDias(produto);
  return dias === null
    ? 'Produto marcado como perecível, mas sem prazo de validade no cadastro — informe a data à mão.'
    : null;
};
