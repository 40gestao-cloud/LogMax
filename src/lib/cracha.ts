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

const PREFIXO_LONGO = 'LOGMAX:CRACHA';
const VERSAO_LONGA = '1';

// Formato curto, usado para GERAR desde 2026-08-27. Motivo é legibilidade
// óptica, não estética: `LOGMAX:CRACHA:1:<uuid com hífens>` são 50 caracteres
// em minúsculas, o que joga o QR para a versão 4 (33×33 módulos). Sem os
// hífens e em MAIÚSCULAS, a string cabe no modo alfanumérico do QR e desce
// para a versão 2 (25×25) — no mesmo tamanho em pixels, cada módulo fica ~30%
// maior, e é isso que decide se a câmera lê a tela de um telemóvel a meio
// metro.
const PREFIXO_CURTO = 'LMX1:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

/** Devolve o uuid com hífens a partir dos 32 dígitos hexadecimais. */
const comHifens = (hex: string): string => {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Conteúdo do QR impresso no crachá de um funcionário. */
export function montarCracha(funcionarioId: string): string {
  return `${PREFIXO_CURTO}${funcionarioId.replace(/-/g, '').toUpperCase()}`;
}

/**
 * Lê o que a câmera capturou. Devolve o id do funcionário, ou `null` quando o
 * QR não é um crachá nosso (o chamador transforma isso em "isto não é um
 * crachá", que é uma mensagem útil — diferente de um erro de banco).
 *
 * Aceita os DOIS formatos: o curto, que é o que se gera hoje, e o longo, que
 * saiu na primeira versão. Crachá impresso ou salvo na galeria do telemóvel não
 * se atualiza sozinho — trocar o formato sem aceitar o antigo transformaria
 * cada crachá já distribuído em papel morto.
 */
export function lerCracha(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const texto = String(bruto).trim();

  if (texto.toUpperCase().startsWith(PREFIXO_CURTO)) {
    const hex = texto.slice(PREFIXO_CURTO.length);
    return HEX32_RE.test(hex) ? comHifens(hex) : null;
  }

  const partes = texto.split(':');
  // LOGMAX : CRACHA : versao : uuid
  if (partes.length !== 4) return null;
  if (`${partes[0]}:${partes[1]}` !== PREFIXO_LONGO) return null;
  if (partes[2] !== VERSAO_LONGA) return null;
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
