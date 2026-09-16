"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "portal659_onboarded";

const SLIDES = [
  {
    emoji: "🏪",
    title: "Bienvenido a tu barrio",
    text: "Encontrá todos los comercios de Sicardi y Garibaldi en un solo lugar.",
  },
  {
    emoji: "📍",
    title: "Descubrí cerca tuyo",
    text: "Explorá por categoría, buscá lo que necesitá y pedí directo por WhatsApp.",
  },
  {
    emoji: "🛒",
    title: "Pedí en segundos",
    text: "Armá tu pedido, revisalo y mandalo. Sin registro, sin comisiones, sin vueltas.",
  },
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {}
  }, []);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in-up">
      <div className="bg-card border border-border rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center">
        <div className="text-6xl mb-6">{slide.emoji}</div>
        <h2 className="font-display text-2xl font-semibold mb-3">{slide.title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">{slide.text}</p>

        <div className="flex gap-2 justify-center mb-6">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? "bg-primary w-6" : "bg-muted w-2"
              }`}
            />
          ))}
        </div>

        <div className="flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              Atrás
            </button>
          )}
          {isLast ? (
            <button
              onClick={dismiss}
              className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Empezar
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Siguiente
            </button>
          )}
        </div>

        {!isLast && (
          <button
            onClick={dismiss}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Saltar
          </button>
        )}
      </div>
    </div>
  );
}
