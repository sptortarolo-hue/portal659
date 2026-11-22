import { useRef, useCallback, useEffect } from "react";

export function useVoiceAnnouncement(enabled: boolean) {
  const queue = useRef<string[]>([]);
  const speaking = useRef(false);

  const playDing = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }, []);

  const processQueue = useCallback(() => {
    if (speaking.current || queue.current.length === 0) return;
    if (!("speechSynthesis" in window)) return;

    speaking.current = true;
    const text = queue.current.shift()!;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-AR";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const arVoice =
      voices.find((v) => v.lang === "es-AR") ||
      voices.find((v) => v.lang.startsWith("es"));
    if (arVoice) utterance.voice = arVoice;

    playDing();

    utterance.onend = () => {
      speaking.current = false;
      setTimeout(processQueue, 1000);
    };
    utterance.onerror = () => {
      speaking.current = false;
      setTimeout(processQueue, 1000);
    };

    window.speechSynthesis.speak(utterance);
  }, [playDing]);

  const speak = useCallback(
    (text: string) => {
      if (!enabled) return;
      queue.current.push(text);
      processQueue();
    },
    [enabled, processQueue]
  );

  // Pre-cargar voces
  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  return { speak };
}