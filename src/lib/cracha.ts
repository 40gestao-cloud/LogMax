// Crachá virtual — o QR que identifica o aluno na leitura do ponto.
//
// O conteúdo do QR é só o `funcionarios.id`, com um prefixo que diz o que ele
// é. NÃO é credencial e não autoriza nada: quem grava a presença é a RPC
// `registrar_ponto_manual`, que exige RH ou gerente da filial (migr. 559).
// Forjar um destes não dá a ninguém um poder que quem está com o leitor na mão
// já não tivesse — o crachá substitui a DIGITAÇÃO do nome, não a autorização.
//
// A defesa contra "mostrar o crachá do colega que faltou" não é criptográfica,
// é humana: a tela de confirmação mostra a FOTO em tamanho grande antes de
// gravar, e quem lê está olhando para a pessoa.
//
// O prefixo existe para o leitor recusar de cara o que não é crachá — código
// de barras de produto, QR de Pix, link de wi-fi — em vez de tentar resolver
// um id que não existe e devolver "funcionário não encontrado".

const PREFIXO = 'LOGMAX:CRACHA';
const VERSAO = '1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Conteúdo do QR impresso no crachá de um funcionário. */
export function montarCracha(funcionarioId: string): string {
  return `${PREFIXO}:${VERSAO}:${funcionarioId}`;
}

/**
 * Lê o que a câmera capturou. Devolve o id do funcionário, ou `null` quando o
 * QR não é um crachá nosso (o chamador transforma isso em "isto não é um
 * crachá", que é uma mensagem útil — diferente de um erro de banco).
 */
export function lerCracha(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const partes = String(bruto).trim().split(':');
  // LOGMAX : CRACHA : versao : uuid
  if (partes.length !== 4) return null;
  if (`${partes[0]}:${partes[1]}` !== PREFIXO) return null;
  if (partes[2] !== VERSAO) return null;
  return UUID_RE.test(partes[3]) ? partes[3].toLowerCase() : null;
}

/**
 * Código curto legível, impresso no canto do crachá. Serve para conferência a
 * olho ("o crachá que li é o 4F2A9C mesmo?") e para achar a pessoa numa lista
 * — não para autenticar nada.
 */
export function codigoCracha(funcionarioId: string): string {
  return funcionarioId.replace(/-/g, '').slice(0, 6).toUpperCase();
}
