import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import jsQR from 'jsqr';
import {
  Camera, CameraOff, CheckCircle2, Loader2, ShieldCheck, X, ArrowRight, AlertTriangle, Building2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type Stage = 'scanning' | 'confirming' | 'paying' | 'success' | 'error';

const PIX_REGEX = /^LOGMAX-PIX-([0-9a-f-]{36})$/i;

// Identidade própria de PWA ("Banco Simulado": manifest, ícone, theme,
// document.title) é aplicada via script inline no <head> do index.html
// ANTES do React montar. Sem isso, Chrome lê o manifest da LogMax antes
// do swap e mostra "Esse app já está instalado".

export const SimuladorPagamentoView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [stage, setStage] = useState<Stage>('scanning');
  const [errorMsg, setErrorMsg] = useState('');
  const [pendente, setPendente] = useState<{ id: string; valor: number } | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg('');
    setStage('scanning');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }
    } catch (err: any) {
      const name = err?.name ?? '';
      const msg =
        name === 'NotAllowedError' ? 'Permissão de câmera negada. Autorize o acesso nas configurações do navegador.'
        : name === 'NotFoundError'  ? 'Nenhuma câmera encontrada neste dispositivo.'
        : 'Não foi possível acessar a câmera. Verifique se está em HTTPS e tente novamente.';
      setErrorMsg(msg);
      setStage('error');
    }
  }, []);

  // Loop de leitura: captura frames do <video>, desenha no canvas e passa para jsQR.
  useEffect(() => {
    if (stage !== 'scanning') return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          try {
            const imageData = ctx.getImageData(0, 0, w, h);
            // attemptBoth lê QRs tanto escuro/claro como claro/escuro — robustez.
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
            if (code?.data) {
              const raw = code.data.trim();
              const match = PIX_REGEX.exec(raw);
              if (!match) {
                console.warn('[Simulador] QR detectado mas formato inválido:', raw);
              }
              if (match) {
                const pixId = match[1];
                stopCamera();
                if (!supabase) {
                  setErrorMsg('Sistema indisponível. Tente novamente em instantes.');
                  setStage('error');
                  return;
                }
                const { data, error } = await supabase
                  .from('pix_pendentes')
                  .select('id, valor, status')
                  .eq('id', pixId)
                  .maybeSingle();
                if (error || !data) {
                  setErrorMsg('QR Code inválido ou expirado. Peça um novo no caixa.');
                  setStage('error');
                  return;
                }
                if (data.status !== 'aguardando') {
                  setErrorMsg(data.status === 'pago' ? 'Este pagamento já foi confirmado.' : 'Este Pix foi cancelado.');
                  setStage('error');
                  return;
                }
                setPendente({ id: data.id, valor: Number(data.valor) });
                setStage('confirming');
                return;
              }
            }
          } catch {
            // jsQR/getImageData ocasionalmente falham em primeiros frames; ignorar
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    startCamera().then(() => {
      if (!cancelled) rafRef.current = requestAnimationFrame(tick);
    });

    return () => { cancelled = true; stopCamera(); };
  }, [stage, startCamera, stopCamera]);

  const confirmarPagamento = async () => {
    if (!pendente || !supabase) return;
    setStage('paying');
    // RPC SECURITY DEFINER faz a transição aguardando → pago sem depender de
    // policy de UPDATE pra anon. A função valida o estado atual no servidor
    // e retorna erro se o pendente já foi processado ou não existe.
    const { error } = await supabase.rpc('confirmar_pix_pendente', { p_id: pendente.id });
    if (error) {
      setErrorMsg(`Falha ao confirmar: ${error.message}`);
      setStage('error');
      return;
    }
    setStage('success');
  };

  const novaLeitura = () => {
    setPendente(null);
    setErrorMsg('');
    setStage('scanning');
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center"
      style={{ background: '#0A0A0A', color: '#e5e7eb', minHeight: '100dvh' }}
    >
      {/* Header "app do banco" */}
      <header className="w-full max-w-md px-5 pt-6 pb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)', boxShadow: '0 8px 20px rgba(59,130,246,0.35)' }}>
          <Building2 size={20} className="text-white" />
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Demonstração</p>
          <h1 className="text-lg font-black text-gray-100">Banco Simulado</h1>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
          <ShieldCheck size={12} /> Seguro
        </div>
      </header>

      <main className="w-full max-w-md flex-1 flex flex-col px-5 pb-8 gap-5">
        <AnimatePresence mode="wait">
          {/* ── SCANNING ── */}
          {stage === 'scanning' && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Pagar com Pix</p>
                <h2 className="text-xl font-bold text-gray-100 mt-1">Aponte para o QR Code</h2>
                <p className="text-xs text-gray-500 mt-1">Posicione o código gerado no PDV dentro da moldura.</p>
              </div>

              <div className="relative rounded-3xl overflow-hidden aspect-square"
                style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)' }}>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Moldura de mira */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="relative w-3/4 aspect-square">
                    {[
                      'top-0 left-0 border-l-2 border-t-2 rounded-tl-2xl',
                      'top-0 right-0 border-r-2 border-t-2 rounded-tr-2xl',
                      'bottom-0 left-0 border-l-2 border-b-2 rounded-bl-2xl',
                      'bottom-0 right-0 border-r-2 border-b-2 rounded-br-2xl',
                    ].map((c, i) => (
                      <span key={i} className={`absolute w-10 h-10 ${c}`} style={{ borderColor: '#3B82F6' }} />
                    ))}
                    {/* Linha de scan animada */}
                    <motion.span
                      className="absolute left-0 right-0 h-[2px]"
                      style={{ background: 'linear-gradient(90deg, transparent, #3B82F6, transparent)', boxShadow: '0 0 12px #3B82F6' }}
                      animate={{ top: ['8%', '92%', '8%'] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                </div>

                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-2 text-[10px] text-gray-300 font-bold uppercase tracking-widest backdrop-blur px-3 py-1.5 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.45)' }}>
                  <Camera size={11} /> Procurando QR Code…
                </div>
              </div>

              <p className="text-[11px] text-gray-600 text-center">
                Em uso de demonstração — não há débito real em conta.
              </p>
            </motion.div>
          )}

          {/* ── CONFIRMING ── */}
          {stage === 'confirming' && pendente && (
            <motion.div
              key="confirming"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex flex-col gap-5"
            >
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Confirmar pagamento</p>
                <h2 className="text-xl font-bold text-gray-100 mt-1">Você está a pagar</h2>
              </div>

              <div className="rounded-3xl p-6 flex flex-col items-center gap-2"
                style={{ background: 'linear-gradient(160deg, rgba(59,130,246,0.12), rgba(29,78,216,0.06))', border: '1px solid rgba(59,130,246,0.25)' }}>
                <p className="text-[10px] text-blue-300 uppercase tracking-widest font-bold">Valor a debitar</p>
                <p className="text-4xl font-black tabular-nums text-white tracking-tight">
                  {pendente.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-2 font-mono">
                  <span className="text-gray-600">ID</span>
                  <span>{pendente.id.slice(0, 8)}…{pendente.id.slice(-4)}</span>
                </div>
              </div>

              <div className="rounded-2xl px-4 py-3 flex flex-col gap-2 text-xs"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex justify-between">
                  <span className="text-gray-500">Beneficiário</span>
                  <span className="font-bold text-gray-200">LogMax PDV</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tipo</span>
                  <span className="font-bold text-gray-200">Pix instantâneo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Conta de origem</span>
                  <span className="font-bold text-gray-200">Demo •• 1234</span>
                </div>
              </div>

              <button
                onClick={confirmarPagamento}
                className="w-full py-4 rounded-2xl text-sm font-black text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                  boxShadow: '0 8px 24px rgba(59,130,246,0.35)',
                }}
              >
                <CheckCircle2 size={16} /> Confirmar Pagamento
                <ArrowRight size={14} className="ml-1" />
              </button>

              <button onClick={novaLeitura}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1.5">
                <X size={12} /> Cancelar e ler outro QR
              </button>
            </motion.div>
          )}

          {/* ── PAYING ── */}
          {stage === 'paying' && (
            <motion.div
              key="paying"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 py-20"
            >
              <Loader2 size={36} className="animate-spin text-blue-400" />
              <p className="text-sm text-gray-300 font-bold">A processar pagamento…</p>
              <p className="text-xs text-gray-600">Notificando o caixa em tempo real</p>
            </motion.div>
          )}

          {/* ── SUCCESS ── */}
          {stage === 'success' && pendente && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              className="flex-1 flex flex-col items-center justify-center gap-5 py-12"
            >
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 18 }}
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: 'radial-gradient(circle at 30% 30%, #10B981, #047857)', boxShadow: '0 12px 32px rgba(16,185,129,0.45)' }}
              >
                <CheckCircle2 size={40} className="text-white" strokeWidth={2.5} />
              </motion.div>
              <div className="text-center">
                <h2 className="text-2xl font-black text-white">Pagamento Aprovado</h2>
                <p className="text-sm text-gray-400 mt-1.5">
                  {pendente.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} debitado da Demo •• 1234
                </p>
                <p className="text-[11px] text-gray-600 mt-3">O caixa já está a finalizar a sua venda.</p>
              </div>
              <button onClick={novaLeitura}
                className="mt-4 px-6 py-2.5 rounded-2xl text-xs font-bold text-gray-300 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Ler outro QR Code
              </button>
            </motion.div>
          )}

          {/* ── ERROR ── */}
          {stage === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center"
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {errorMsg.includes('câmera') ? <CameraOff size={28} className="text-red-400" /> : <AlertTriangle size={28} className="text-red-400" />}
              </div>
              <div>
                <p className="text-sm font-bold text-red-400">Não foi possível continuar</p>
                <p className="text-xs text-gray-400 mt-2 max-w-xs">{errorMsg}</p>
              </div>
              <button onClick={novaLeitura}
                className="mt-2 px-5 py-2.5 rounded-2xl text-xs font-bold text-gray-300 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Tentar novamente
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="w-full max-w-md px-5 pb-6 pt-2">
        <p className="text-[10px] text-gray-700 text-center tracking-widest uppercase font-bold">
          LogMax — Simulação Pix • Sem débito real
        </p>
      </footer>
    </div>
  );
};
