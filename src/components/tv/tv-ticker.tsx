import { TV_TYPE } from "@/lib/tv-layout";

type Props = { text: string };

/**
 * Cinta inferior (opcional): mensaje del comercio en marquesina continua.
 *
 * Antes era texto estático con "respiración"; ahora corre (loop) para que la
 * pantalla nunca esté quieta. Duplica el texto y anima -50% para que el
 * bucle sea invisible. Respeta `prefers-reduced-motion` (queda quieto).
 */
export function TvTicker({ text }: Props) {
  const clean = text.trim();
  if (!clean) return null;
  return (
    <footer
      className="relative flex items-center overflow-hidden"
      style={{
        height: 92,
        background: "var(--tv-card)",
        boxShadow: "inset 0 2px 0 var(--tv-line)",
        fontSize: TV_TYPE.meta + 6,
        color: "var(--tv-fg)",
      }}
    >
      <span
        className="absolute inset-y-0 left-0 z-10 w-[120px]"
        style={{ background: "linear-gradient(90deg, var(--tv-card), transparent)" }}
      />
      <span
        className="absolute inset-y-0 right-0 z-10 w-[120px]"
        style={{ background: "linear-gradient(270deg, var(--tv-card), transparent)" }}
      />
      <div className="tv-marquee-track flex w-max shrink-0 items-center gap-16 whitespace-nowrap pl-16">
        {[0, 1].map((k) => (
          <span key={k} className="flex items-center gap-16 font-semibold tracking-wide">
            <span>{clean}</span>
            <span style={{ color: "var(--tv-accent)" }}>★</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
