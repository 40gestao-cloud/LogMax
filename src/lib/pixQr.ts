// Payload do QR de Pix gerado no PDV. Duas formas:
//   1. URL clicável apontando pra Área Cliente do MaxBank (novo, Fase 1):
//      `<VITE_MAXBANK_URL>/pagar/<branchId>/<uuid>`. Cliente escaneia com
//      câmera nativa do celular e cai direto na página de pagamento pública,
//      sem precisar de login.
//   2. Formato antigo `LOGMAX-PIX-<uuid>` — fallback quando as envs não estão
//      setadas (turma que ainda não estreou a integração). MaxBank instalado
//      no operador lê ambos, então rollback é seguro.
export function buildPixQrValue(pixId: string): string {
  const base = (import.meta.env.VITE_MAXBANK_URL as string | undefined)?.replace(/\/$/, '');
  const branchId = import.meta.env.VITE_MAXBANK_BRANCH_ID as string | undefined;
  if (base && branchId) return `${base}/pagar/${branchId}/${pixId}`;
  return `LOGMAX-PIX-${pixId}`;
}
