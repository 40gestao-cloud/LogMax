// A requisição eventual (texto livre + marca) é ESTE produto do catálogo?
//
// Vínculo é fato, nunca palpite (24/09): só nome idêntico conta. O que faltava
// era a marca. Na turma ERP de 05/10, "Óleo de soja 900ml" Liza e "Óleo de
// soja 900ml" Soya ficaram as duas ligadas ao 028 (Liza) — o nome batia, a
// marca ninguém olhava, e o pedido da Soya entraria no saldo da Liza.
//
// Regra do catálogo: a marca vai NO NOME do produto ("Óleo de Soja 900ml
// Liza") — o índice `uq_produtos_nome_filial_ativo` não deixa dois produtos
// com o mesmo nome na unidade. Então o nome da requisição casa com o do
// produto de dois jeitos: o item sozinho, ou o item + marca pedida. E quando a
// requisição pediu marca, o produto tem de ser daquela marca.
//
// Espelho de `vinculo_item_confere` no banco (migr. 676) — mudar os dois juntos.

/** Mesma normalização de `nome_item_normalizado` (migr. 627). */
export const normNome = (t: unknown): string => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * O nome que o cadastro deve receber: o item da requisição com a marca no fim,
 * a não ser que o texto já traga a marca ("Sal Refinado 1kg Cisne").
 */
export function nomeComMarca(item: unknown, marca: unknown): string {
  const nome = String(item ?? '').replace(/\s+/g, ' ').trim();
  const m = String(marca ?? '').replace(/\s+/g, ' ').trim();
  if (!m) return nome;
  const n = ` ${normNome(nome)} `;
  return n.includes(` ${normNome(m)} `) ? nome : `${nome} ${m}`;
}

/** O produto do catálogo atende a requisição de `item` na `marca` pedida? */
export function produtoConfere(
  item: unknown, marca: unknown,
  produto: { nome?: unknown; marca?: unknown },
): boolean {
  const i  = normNome(item);
  const m  = normNome(marca);
  const pn = normNome(produto.nome);
  const pm = normNome(produto.marca);
  if (!i || !pn) return false;
  const comMarca = normNome(nomeComMarca(item, marca));
  const nomeOk = pn === i || pn === comMarca;
  // Sem marca pedida, qualquer marca serve. Com marca, o cadastro tem de ser
  // dela — pela coluna, ou pelo nome quando a coluna ficou em branco.
  const marcaOk = !m || pm === m || (!pm && pn === comMarca);
  return nomeOk && marcaOk;
}
