// Payload dos QRs de cobrança gerados no PDV. Duas formas cada:
//   1. URL absoluta pra Área Cliente/Visitante do MaxBank:
//      `<VITE_MAXBANK_URL>/pagar/<branchId>/<uuid>`         (Pix)
//      `<VITE_MAXBANK_URL>/pagar-cartao/<branchId>/<uuid>`  (Cartão)
//      Cliente/aluno escaneia com câmera nativa do celular e cai direto
//      na página pública sem cadastro (Modo Visitante ativo na branch).
//   2. Formato antigo `LOGMAX-PIX-<uuid>` / `LOGMAX-CARTAO-<uuid>` —
//      fallback quando as envs não estão setadas. MaxBank instalado no
//      operador continua lendo ambos, então rollback é seguro.
function envBase(): { base: string; branchId: string } | null {
  const base = (import.meta.env.VITE_MAXBANK_URL as string | undefined)?.replace(/\/$/, '');
  const branchId = import.meta.env.VITE_MAXBANK_BRANCH_ID as string | undefined;
  if (base && branchId) return { base, branchId };
  return null;
}

export function buildPixQrValue(pixId: string): string {
  const env = envBase();
  return env ? `${env.base}/pagar/${env.branchId}/${pixId}` : `LOGMAX-PIX-${pixId}`;
}

export function buildCartaoQrValue(cartaoId: string): string {
  const env = envBase();
  return env ? `${env.base}/pagar-cartao/${env.branchId}/${cartaoId}` : `LOGMAX-CARTAO-${cartaoId}`;
}
