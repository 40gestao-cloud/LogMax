// Efeitos sonoros do LogMax — camada de UX sensorial usada na simulação em
// sala de aula. Beep e Plim são sintetizados via Web Audio API (sem
// dependência de assets externos); Ka-ching usa um MP3 servido em /sounds.
//
// Toda função é não-bloqueante e silenciosa em caso de falha — políticas de
// autoplay de Chrome/Safari exigem interação do utilizador antes do primeiro
// som, então o AudioContext é criado preguiçosamente e qualquer erro é
// engolido para nunca quebrar o fluxo da venda.

let audioCtx: AudioContext | null = null;
let kachingAudio: HTMLAudioElement | null = null;

// Caminho do MP3 da caixa registradora. O arquivo deve ser colocado em
// public/sounds/kaching.mp3 — se estiver ausente, a função simplesmente
// falha em silêncio (catch no .play()).
const KACHING_URL = '/sounds/kaching.mp3';

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

// Helper genérico para tocar um envelope ADSR simples num oscilador.
// gain começa em 0, sobe rápido (attack), decai (decay/release) — evita
// estalos audíveis no início e no fim do bip.
function playTone(opts: {
  freq: number;
  durationMs: number;
  type?: OscillatorType;
  peakGain?: number;
  startDelayMs?: number;
}) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    // Alguns navegadores suspendem o contexto até interação do utilizador.
    // resume() é idempotente; ignoramos a promise se rejeitar.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime + (opts.startDelayMs ?? 0) / 1000;
    const dur = opts.durationMs / 1000;
    const peak = opts.peakGain ?? 0.18;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    // Engolir: falha de áudio não pode afectar a venda.
  }
}

// Bip curto e agudo — leitor de código de barras. Tocado a cada produto
// adicionado ao carrinho no PDV.
export function playBeep(): void {
  playTone({ freq: 1760, durationMs: 90, type: 'square', peakGain: 0.12 });
}

// Plim suave — duas notas ascendentes (E5 → A5) em onda senoidal. Usado em
// confirmações: Pix aprovado em tempo real e aprovação de orçamento pelo
// Financeiro.
export function playPlim(): void {
  playTone({ freq: 659.25, durationMs: 140, type: 'sine', peakGain: 0.16 });
  playTone({ freq: 880.00, durationMs: 220, type: 'sine', peakGain: 0.16, startDelayMs: 90 });
}

// Caixa registradora — som de venda concluída (dinheiro/cartão/fiado).
// Carrega lazy o HTMLAudio e cai em silêncio se o ficheiro não existir ou
// o navegador bloquear o autoplay.
export function playKaching(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!kachingAudio) {
      kachingAudio = new Audio(KACHING_URL);
      kachingAudio.preload = 'auto';
      kachingAudio.volume = 0.55;
    }
    // currentTime = 0 garante que vendas em sequência rápida tocam o som
    // do início, não retomam de onde parou.
    kachingAudio.currentTime = 0;
    const p = kachingAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Engolir: ausência do MP3 ou bloqueio de autoplay não pode quebrar a UI.
  }
}
