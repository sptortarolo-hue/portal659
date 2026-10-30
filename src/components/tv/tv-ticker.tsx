import { TV_TYPE } from "@/lib/tv-layout";

type Props = { text: string };

/**
 * Cinta inferior (opcional): un solo mensaje por comercio, estático y con
 * respiración muy lenta. Nunca titila (límite de 3 destellos por segundo) y
 * respeta `prefers-reduced-motion`.
 */
export function TvTicker({ text }: Props) {
  if (!text.trim()) return null;
  return (
    <footer
      className="flex items-center justify-center overflow-hidden border-t-2"
      style={{ height: 90, borderColor: "var(--tv-line)", fontSize: TV_TYPE.meta, color: "var(--tv-muted)" }}
    >
      <p className="px-6 text-center motion-safe:animate-[tv-breathe_6s_ease-in-out_infinite]">{text}</p>
    </footer>
  );
}
