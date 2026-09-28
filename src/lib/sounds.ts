let audioCtx: AudioContext | null = null;

/**
 * Vibración default para avisos de venta (Android; iOS la ignora).
 * Vive acá (módulo client-safe, sin `pg`/`web-push`) para poder usarse
 * desde componentes client; `src/lib/push.ts` la re-exporta en el server.
 */
export const VENDOR_ALERT_VIBRATE = [200, 100, 200, 100, 400];

function getAudioContext(): AudioContext | null {
  if (!audioCtx || audioCtx.state !== "running") return null;
  return audioCtx;
}

function playTone(frequencies: { time: number; freq: number }[], duration: number, volume = 0.3) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    frequencies.forEach(({ time, freq }) => osc.frequency.setValueAtTime(freq, ctx.currentTime + time));
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

export function playNewOrderSound() {
  playTone([
    { time: 0, freq: 880 },
    { time: 0.1, freq: 1100 },
    { time: 0.2, freq: 880 },
  ], 0.4);
}

export function playOrderReadySound() {
  playTone([
    { time: 0, freq: 660 },
    { time: 0.15, freq: 880 },
    { time: 0.3, freq: 1100 },
  ], 0.5);
}

export function playUrgentSound() {
  playTone([
    { time: 0, freq: 440 },
    { time: 0.12, freq: 440 },
    { time: 0.24, freq: 660 },
    { time: 0.36, freq: 660 },
  ], 0.6, 0.4);
}

/**
 * Alerta de pedido nuevo: repite el beep N veces (cocina ruidosa).
 * Solo suena con la pestaña abierta; con el celu bloqueado el aviso
 * llega por push del sistema (service worker).
 */
export function playNewOrderAlert(repeats = 3, gapMs = 700) {
  for (let i = 0; i < Math.max(1, Math.min(repeats, 5)); i++) {
    setTimeout(() => playNewOrderSound(), i * gapMs);
  }
}

let titleFlashTimer: ReturnType<typeof setInterval> | null = null;
let titleFlashStop: ReturnType<typeof setTimeout> | null = null;
let originalTitle: string | null = null;

/**
 * Hace parpadear el título de la pestaña ("🛎️ ¡Pedido nuevo!") hasta que
 * se llame a stopTitleFlash o pasen `maxMs` (default 2 min). Útil cuando
 * el panel está abierto en otra pestaña/minimizado (desktop).
 */
export function startTitleFlash(text = "🛎️ ¡Pedido nuevo! 🛎️", maxMs = 120000) {
  try {
    if (typeof document === "undefined" || titleFlashTimer) return;
    originalTitle = document.title;
    let on = false;
    titleFlashTimer = setInterval(() => {
      on = !on;
      document.title = on ? text : (originalTitle || "Portal 659");
    }, 1000);
    titleFlashStop = setTimeout(() => stopTitleFlash(), maxMs);
  } catch {}
}

export function stopTitleFlash() {
  try {
    if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null; }
    if (titleFlashStop) { clearTimeout(titleFlashStop); titleFlashStop = null; }
    if (originalTitle != null && typeof document !== "undefined") {
      document.title = originalTitle;
      originalTitle = null;
    }
  } catch {}
}

export function resumeAudioContext() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
