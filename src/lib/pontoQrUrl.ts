// Constrói a URL pública usada no QR Code de ponto eletrônico.
// Permite que o celular leia o QR direto pela câmera nativa (sem app aberto):
// o sistema operacional reconhece a URL e oferece abrir → cai no /p, que
// dispara o registro automaticamente após login (ou imediatamente, se a
// sessão já estiver ativa no PWA).
//
// `/p` é a rota curta; mantemos `?t=<token>` como query pra evitar caracteres
// não-URL-safe ainda que o HMAC já seja base64url + hex.
const PONTO_QR_PATH = '/p';

export function buildPontoQrUrl(token: string): string {
  if (typeof window === 'undefined') return `${PONTO_QR_PATH}?t=${token}`;
  return `${window.location.origin}${PONTO_QR_PATH}?t=${encodeURIComponent(token)}`;
}

// Aceita tanto o token cru (formato antigo do QR) quanto a URL nova
// `https://.../p?t=<token>`. Usado pelo scanner in-app para conviver com
// QRs gerados antes e depois da mudança.
export function extractPontoToken(scanned: string): string | null {
  if (!scanned) return null;
  const trimmed = scanned.trim();
  if (trimmed.includes('?t=') || trimmed.startsWith('http')) {
    try {
      const url = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const t = url.searchParams.get('t');
      if (t) return t;
    } catch {
      // não era URL válida — cai no fallback de token cru.
    }
  }
  // Token cru tem o formato `<base64url>.<hex>`. Se bate, devolve direto.
  if (/^[A-Za-z0-9_-]+\.[a-f0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export function isPontoQrRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname === PONTO_QR_PATH;
}
