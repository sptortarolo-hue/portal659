type Props = {
  /** Slug base del archivo, sin sufijo `-mobile`/`-desktop` ni extensión. */
  base: string;
  alt: string;
};

/**
 * Figura de manual: captura mobile primero y versión de escritorio después,
 * en la misma página.
 */
export function Captura({ base, alt }: Props) {
  return (
    <figure className="my-4 space-y-3">
      <img
        src={`/manuales/capturas/${base}-mobile.jpg`}
        alt={`${alt} (celular)`}
        className="rounded-xl border border-border shadow-sm w-full max-w-sm"
        loading="lazy"
      />
      <details className="rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-sm">
        <summary className="cursor-pointer font-medium text-primary">
          Ver en escritorio 🖥️
        </summary>
        <img
          src={`/manuales/capturas/${base}-desktop.jpg`}
          alt={`${alt} (escritorio)`}
          className="rounded-xl border border-border shadow-sm w-full mt-3"
          loading="lazy"
        />
      </details>
    </figure>
  );
}
