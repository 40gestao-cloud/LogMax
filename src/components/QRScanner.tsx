import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CameraOff } from 'lucide-react';

export const QRScanner = ({ onResult, onClose }: { onResult: (v: string) => void; onClose: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const onResultRef = useRef(onResult);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(tick);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const jsQR = (await import('jsqr')).default;
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code?.data) { onResultRef.current(code.data); return; }
    animRef.current = requestAnimationFrame(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        animRef.current = requestAnimationFrame(tick);
      })
      .catch(() => setCamError('Permissão de câmera negada. Verifique as configurações do navegador.'));
    return () => {
      cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [tick]);

  return (
    <div className="flex flex-col items-center gap-4">
      {camError ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <CameraOff size={40} className="text-red-500/50" />
          <p className="text-sm text-red-500 text-center max-w-xs">{camError}</p>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden neu-pressed" style={{ width: 280, height: 280 }}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-yellow-400/60 rounded-2xl" />
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500">Aponte para o QR Code exibido pelo administrador</p>
      <button onClick={onClose} className="text-xs text-gray-500 hover:text-white transition-colors">Cancelar</button>
    </div>
  );
};
