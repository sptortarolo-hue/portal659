/**
 * Paleta semántica del panel (spec v2).
 *
 * Cada estado tiene su color y su tinte al 15% (mismo patrón que los
 * badges). Los íconos redondos de los KPIs y los avatares usan estos
 * tintes, así el panel no se ve con todos los círculos del mismo color.
 *
 * Los colores vienen de los tokens del panel:
 *   - `--color-primary`: azul de acciones del spec
 *   - `--ts-success` / `--ts-warning` / `--ts-danger` / `--ts-info`:
 *     estados semánticos (ver src/app/styles/tasty-station.css)
 */
export type PanelTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Fondo con tinte + texto/ícono en el color fuerte. */
export const TONE_CHIP: Record<PanelTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-[var(--color-primary)]/15 text-[var(--color-primary)]",
  success: "bg-[var(--ts-success)]/15 text-[var(--ts-success)]",
  warning: "bg-[var(--ts-warning)]/15 text-[var(--ts-warning)]",
  danger: "bg-[var(--ts-danger)]/15 text-[var(--ts-danger)]",
  info: "bg-[var(--ts-info)]/15 text-[var(--ts-info)]",
};

/** Solo el color fuerte (para íconos o bordes). */
export const TONE_COLOR: Record<PanelTone, string> = {
  neutral: "var(--color-muted-foreground)",
  primary: "var(--color-primary)",
  success: "var(--ts-success)",
  warning: "var(--ts-warning)",
  danger: "var(--ts-danger)",
  info: "var(--ts-info)",
};
