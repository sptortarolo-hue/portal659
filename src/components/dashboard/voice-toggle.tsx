"use client";

import { useState } from "react";
import { useVoiceAnnouncement } from "@/hooks/use-voice-announcement";

interface VoiceToggleProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

export function VoiceToggle({ enabled, onToggle }: VoiceToggleProps) {
  const { speak } = useVoiceAnnouncement(enabled);

  const handleTest = () => {
    speak("Esta es una prueba de anuncio de transferencia ingresada");
  };

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm">🔊 Anunciar transferencias por voz</span>
      </label>
      <button
        onClick={handleTest}
        className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80"
      >
        Probar voz
      </button>
    </div>
  );
}