import { getSupabase } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

const CATEGORY_META: Record<string, { label: string; icon: string; accent: string }> = {
  transporte: { label: "Transporte", icon: "🚌", accent: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  utilidades: { label: "Utilidades", icon: "☎️", accent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  horarios: { label: "Horarios del barrio", icon: "🕐", accent: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  noticias: { label: "Avisos", icon: "📢", accent: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
};

const CATEGORY_ORDER = ["transporte", "utilidades", "horarios", "noticias"];

type InfoItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  tags: string[] | null;
  sort: number;
  updated_at: string;
};

export default async function BarrioPage() {
  const supabase = getSupabase();
  const { data } = supabase
    ? await supabase
        .from("info_items")
        .select("id, category, title, body, tags, sort, updated_at")
        .eq("active", true)
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] as InfoItem[] };

  const items = (data || []) as InfoItem[];

  const grouped = CATEGORY_ORDER.map((cat) => ({
    meta: CATEGORY_META[cat],
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 sm:py-12 max-w-3xl">
        <div className="mb-8 text-center">
          <span className="text-3xl">🏘️</span>
          <h1 className="font-display text-3xl font-semibold mt-2">Info del barrio</h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            La Alerta Vecinal de Sicardi y Garibaldi: transporte, utilidades, horarios y avisos
            curados por la comunidad.
          </p>
        </div>

        <div className="space-y-10">
          {grouped.map((section) => (
            <section key={section.meta.label}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{section.meta.icon}</span>
                <h2 className="font-display text-lg font-semibold">{section.meta.label}</h2>
              </div>
              <div className="space-y-3">
                {section.items.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-border bg-card p-4">
                    <h3 className="font-medium text-sm">{item.title}</h3>
                    {item.body && <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{item.body}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      {(item.tags || []).map((tag) => (
                        <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${section.meta.accent}`}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            ¿Tenés un dato útil para el barrio? {" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Sumá tu comercio
            </Link>{" "}
            y ayudá a que todos pidan en la zona.
          </p>
        </div>
      </div>
    </main>
  );
}