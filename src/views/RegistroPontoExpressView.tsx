import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { CheckCircle, AlertCircle, Loader2, ExternalLink, Clock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from '../components/LoginScreen';

type Result =
  | { ok: true; label: string; hora: string; status: string }
  | { ok: false; msg: string };

// Rota pública /p?t=<token> — destino do QR lido pela câmera nativa do celular.
// - Sem sessão: mostra LoginScreen; assim que autenticar, o useEffect dispara
//   o POST com o token preservado na URL.
// - Com sessão: chama /api/register-ponto-qr imediatamente e mostra o resultado.
// - O token é o mesmo HMAC validado em api/register-ponto-qr.ts; janela curta
//   de validade (já é responsabilidade do servidor).
export function RegistroPontoExpressView() {
  const { session, isLoading: authLoading, isAuthenticated } = useAuth();
  const [result, setResult] = useState<Result | null>(null);
  const [registrando, setRegistrando] = useState(false);
  // Evita registrar duas vezes em ambientes que re-renderizam (StrictMode em dev,
  // refresh de token, etc.) — o backend devolveria 409, mas o flash de erro
  // na UI seria confuso.
  const disparado = useRef(false);

  const token = (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('t');
    } catch { return null; }
  })();

  useEffect(() => {
    if (!isAuthenticated || !session?.access_token || !token) return;
    if (disparado.current) return;
    disparado.current = true;

    setRegistrando(true);
    setResult(null);

    fetch('/api/register-ponto-qr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({ ok: false, msg: json.error ?? `Erro ao registrar ponto (HTTP ${res.status}).` });
        } else {
          setResult({ ok: true, label: json.label, hora: json.hora, status: json.status });
        }
      })
      .catch(() => setResult({ ok: false, msg: 'Erro de conexão. Verifique sua internet.' }))
      .finally(() => setRegistrando(false));
  }, [isAuthenticated, session?.access_token, token]);

  if (!token) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle size={40} className="text-red-500" />
          <p className="text-base font-bold text-gray-200">Link inválido</p>
          <p className="text-sm text-gray-500 max-w-xs">
            Esta página espera um token na URL. Escaneie novamente o QR Code do ponto.
          </p>
          <a href="/" className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white transition-colors flex items-center gap-2">
            <ExternalLink size={12} /> Ir para o LogMax
          </a>
        </div>
      </Frame>
    );
  }

  if (authLoading) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="text-accent animate-spin" />
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Verificando sessão...</p>
        </div>
      </Frame>
    );
  }

  if (!isAuthenticated) {
    // Reaproveita a tela de login padrão; ela troca o tema pra premium e,
    // ao concluir, useAuth re-renderiza e o useEffect acima dispara.
    return (
      <>
        <BannerTopo />
        <LoginScreen onLoginSuccess={() => { /* useEffect cuida do resto */ }} />
      </>
    );
  }

  if (registrando) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="text-accent animate-spin" />
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Registrando ponto...</p>
        </div>
      </Frame>
    );
  }

  if (result?.ok) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle size={32} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-300">Ponto registrado!</p>
            <p className="text-sm text-gray-400 mt-1 flex items-center justify-center gap-2">
              <Clock size={12} /> {result.label} às <span className="tabular-nums font-bold text-gray-200">{result.hora}</span>
            </p>
            {result.status && (
              <span className={`mt-3 inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${result.status === 'Atrasado' ? 'bg-red-950/60 text-red-500' : 'bg-emerald-900/40 text-emerald-400'}`}>
                {result.status}
              </span>
            )}
          </div>
          <a href="/" className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white transition-colors flex items-center gap-2">
            <ExternalLink size={12} /> Abrir o LogMax
          </a>
        </div>
      </Frame>
    );
  }

  if (result && result.ok === false) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="w-16 h-16 rounded-full bg-red-900/30 border border-red-500/30 flex items-center justify-center">
            <AlertCircle size={32} className="text-red-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-red-300">Falha no registro</p>
            <p className="text-sm text-gray-400 mt-1 max-w-xs">{result.msg}</p>
          </div>
          <div className="flex gap-2">
            <a href="/" className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white transition-colors flex items-center gap-2">
              <ExternalLink size={12} /> Ir para o LogMax
            </a>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <Loader2 size={28} className="text-accent animate-spin" />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="neu-flat rounded-3xl p-8 border border-white/5 w-full max-w-md flex flex-col items-center gap-2">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">LogMax — Ponto Eletrônico</p>
        {children}
      </motion.div>
    </div>
  );
}

function BannerTopo() {
  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500/10 border-b border-amber-500/20 backdrop-blur px-4 py-2.5 text-center">
      <p className="text-[11px] sm:text-xs text-amber-300 font-bold">
        Faça login para registrar seu ponto. O registro será disparado automaticamente após autenticar.
      </p>
    </div>
  );
}
