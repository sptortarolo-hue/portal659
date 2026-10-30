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
    <div className="mb-2 flex items-baseline gap-3 border-b-2 pb-2" style={{ borderColor: "var(--tv-line)" }}>
      <h3 className="font-bold uppercase tracking-wide" style={{ fontSize: TV_TYPE.category * 0.55 }}>
        {name}
      </h3>
      <span style={{ fontSize: 24, color: "var(--tv-muted)" }}>{count}</span>
      {continued && (
        <span className="ml-auto" style={{ fontSize: 24, color: "var(--tv-accent)" }}>
          continúa ›
        </span>
      )}
    </div>
  );
}

/** Una slide del tablero: columnas de categorías, sin scroll y sin recortes. */
export function TvSlideView({ slide, sections, photoStyle, vertical }: Props) {
  const byId = new Map<string, TvItem>();
  for (const s of sections) for (const it of s.items) byId.set(it.id, it);
  const bySection = new Map(sections.map((s) => [s.id, s] as const));

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
                return <TvItemRow key={id} item={item} photoStyle={photoStyle} vertical={vertical} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
