// Sintetizador ligero de sonido de papel usando Web Audio API nativa (sin archivos externos)
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playPaperFlipSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const duration = 0.22;
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    // Ruido rosa suavizado para simular fricción orgánica del papel
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < sampleCount; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      output[i] = (b0 + b1 + b2 + white * 0.18) * 1.4;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.setValueAtTime(1.3, now);
    bandpass.frequency.setValueAtTime(1100, now);
    bandpass.frequency.exponentialRampToValueAtTime(2400, now + 0.07);
    bandpass.frequency.exponentialRampToValueAtTime(850, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
  } catch {
    // Ignorar silenciosamente si el navegador bloquea reproducción previa a interacción
  }
}
