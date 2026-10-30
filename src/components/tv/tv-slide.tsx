import { TvItemRow } from "./tv-item-row";
import { TV_TYPE } from "@/lib/tv-layout";
import type { TvSlide as TvSlideModel } from "@/lib/tv-layout";
import type { TvItem, TvSection } from "@/lib/tv-snapshot";

type Props = {
  slide: TvSlideModel;
  sections: TvSection[];
  photoStyle: "none" | "thumb";
  vertical?: string | null;
};

/** Bloque de categoría dentro de una columna (nombre + "continúa ›"). */
function CategoryHeader({ name, count, continued }: { name: string; count: number; continued: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-3" style={{ paddingBottom: 10 }}>
      <span
        className="shrink-0 rounded-full"
        style={{ width: 10, height: 44, background: "var(--tv-accent)" }}
      />
      <h3
        className="font-display truncate font-black uppercase tracking-wide"
        style={{ fontSize: TV_TYPE.category * 0.55, lineHeight: 1 }}
      >
        {name}
      </h3>
      <span
        className="shrink-0 rounded-full px-2.5 py-0.5 font-bold tabular-nums"
        style={{ fontSize: 20, background: "var(--tv-scrim)", color: "var(--tv-muted)" }}
      >
        {count}
      </span>
      {continued && (
        <span className="ml-auto shrink-0 font-semibold" style={{ fontSize: 23, color: "var(--tv-accent)" }}>
          continúa ›
        </span>
      )}
    </div>
  );
}

/**
 * Una slide del tablero: columnas de categorías, sin scroll y sin recortes.
 *
 * Los ítems entran escalonados (stagger) para que la slide "se arme" sola en
 * vez de aparecer de golpe: da sensación de vivo sin recargar la página.
 */
export function TvSlideView({ slide, sections, photoStyle, vertical }: Props) {
  const byId = new Map<string, TvItem>();
  for (const s of sections) for (const it of s.items) byId.set(it.id, it);
  const bySection = new Map(sections.map((s) => [s.id, s] as const));

  // Índice global de la slide: el escalonado corre a lo largo de las columnas.
  let order = 0;

  return (
    <div className="flex h-full w-full gap-8">
      {slide.columns.map((col, i) => {
        const section = bySection.get(col.sectionId);
        return (
          <div key={`${col.sectionId}-${i}`} className="flex min-w-0 flex-1 flex-col">
            <CategoryHeader
              name={section?.name ?? col.sectionName}
              count={col.itemIds.length}
              continued={col.continued}
            />
            <div className="min-h-0 flex-1">
              {col.itemIds.map((id) => {
                const item = byId.get(id);
                if (!item) return null;
                const delay = Math.min(order, 10) * 45;
                order += 1;
                return (
                  <div
                    key={id}
                    className="tv-item-enter"
                    style={{ animationDelay: `${delay}ms` }}
                  >
                    <TvItemRow item={item} photoStyle={photoStyle} vertical={vertical} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
