let audioCtx: AudioContext | null = null;

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

export function resumeAudioContext() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
