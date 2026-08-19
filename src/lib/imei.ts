// IMEI de aparelho — validação e geração para a TechMax.
//
// O número existe no mundo real impresso na caixa, e é por isso que quem pede
// ele é o RECEBIMENTO (migr. 444): é ali que a caixa está aberta na frente do
// conferente. Só que numa aula ninguém tem 30 caixas na mão — e digitar 30
// números de 15 dígitos à mão não ensina nada, só cansa. Daí o "Gerar", irmão
// do "Gerar" do EAN em Cadastros: o lugar continua certo, o trabalho braçal
// sai.
//
// Gerar aqui, e NÃO no cadastro do produto, é o ponto: no cadastro existe o
// MODELO ("Tablet Lenovo M10"), não os 30 aparelhos. Eles passam a existir
// quando a carga chega — e podem chegar 8 de 10, que é o que "Parcial"
// significa. Unidade criada antes disso ficaria "Em estoque" com o saldo do
// produto em zero, e o PDV acharia aparelho que não entrou.

/**
 * Dígito verificador de Luhn — o mesmo algoritmo do cartão de crédito, e é o
 * que o IMEI usa de verdade. Sem ele o número passa a ser 15 dígitos
 * quaisquer, e aí não há o que conferir quando alguém digita errado.
 */
export function luhnCheckDigit(digits14: string): number {
  let soma = 0;
  // Da direita para a esquerda, dobrando as posições ímpares (a partir de 1).
  for (let i = digits14.length - 1, pos = 1; i >= 0; i--, pos++) {
    let d = parseInt(digits14[i], 10);
    if (pos % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
  }
  return (10 - (soma % 10)) % 10;
}

/** 15 dígitos com Luhn fechando. Espaço e hífen entram — é o que sai de leitor. */
export function validarImei(entrada: string | null | undefined): boolean {
  const d = String(entrada ?? '').replace(/\D/g, '');
  if (d.length !== 15) return false;
  return luhnCheckDigit(d.slice(0, 14)) === parseInt(d[14], 10);
}

/**
 * TAC — os 8 primeiros dígitos. No IMEI de verdade o TAC identifica o MODELO,
 * então dois aparelhos iguais compartilham os 8 primeiros dígitos e diferem só
 * no serial. Reproduzir isso é o que faz a lista gerada parecer o que sai de
 * uma caixa: derivamos o TAC do id do produto, de forma estável — a segunda
 * carga do mesmo tablet nasce com o mesmo TAC da primeira.
 *
 * '35' é o prefixo de corpo relator mais comum em aparelho de mercado.
 */
function tacDoProduto(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return '35' + String(h % 1_000_000).padStart(6, '0');
}

/**
 * `n` IMEIs válidos e distintos entre si, todos do mesmo modelo.
 *
 * Não consulta o banco: a RPC `registrar_unidades_recebidas` é quem recusa
 * colisão com aparelho que já está na casa, e ela é a autoridade porque enxerga
 * o que outra turma gravou há dois segundos. Com 10^6 seriais por modelo, a
 * chance de bater é pequena — e se bater, a mensagem da RPC diz qual número
 * repetiu e o conferente gera de novo.
 */
export function gerarImeis(n: number, seedProduto?: string | null): string[] {
  const quantos = Math.max(0, Math.min(Math.floor(n) || 0, 500));
  if (quantos === 0) return [];
  const tac = tacDoProduto(String(seedProduto ?? 'logmax'));
  const vistos = new Set<string>();
  const saida: string[] = [];
  // O limite de voltas evita laço infinito num caso patológico (n perto do
  // espaço de seriais); na prática sai na primeira tentativa.
  let voltas = 0;
  while (saida.length < quantos && voltas < quantos * 20) {
    voltas++;
    const serial = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const base = tac + serial;
    if (vistos.has(base)) continue;
    vistos.add(base);
    saida.push(base + luhnCheckDigit(base));
  }
  return saida;
}
