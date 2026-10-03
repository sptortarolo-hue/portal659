import { queryOne } from "@/lib/db";
import { notFound } from "next/navigation";
import { FichaPublicForm } from "./ficha-form";

export const dynamic = "force-dynamic";

async function loadEntry(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  try {
    const row = await queryOne<any>(
      `SELECT e.id AS entry_id, e.answers, e.session_no, e.status,
              e.vendor_id::text AS vendor_id, v.store_name,
              t.name AS template_name, t.fields
       FROM customer_form_entries e
       JOIN customer_form_templates t ON t.id = e.template_id
       JOIN vendors v ON v.id = e.vendor_id
       WHERE e.public_token = $1 LIMIT 1`,
      [token]
    );
    if (!row) return null;
    return {
      answers: row.answers && typeof row.answers === "object" ? row.answers : {},
      sessionNo: Number(row.session_no) || 1,
      status: String(row.status || "draft"),
      vendorId: String(row.vendor_id),
      storeName: String(row.store_name ?? ""),
      templateName: String(row.template_name ?? "Ficha"),
      fields: Array.isArray(row.fields) ? row.fields : [],
    };
  } catch {
    return null;
  }
}

/** Página pública de ficha (sin cuenta): la clienta completa y firma. */
export default async function FichaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await loadEntry(token);
  if (!entry) notFound();

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="text-center">
            <p className="text-2xl">📋</p>
            <h1 className="font-display text-xl font-semibold mt-1">{entry.templateName}</h1>
            <p className="text-sm text-muted-foreground">
              {entry.storeName} · Sesión {entry.sessionNo}
            </p>
          </div>
          <FichaPublicForm
            token={token}
            vendorId={entry.vendorId}
            fields={entry.fields}
            initialAnswers={entry.answers}
            initialStatus={entry.status}
          />
          <p className="text-[11px] text-muted-foreground text-center">
            Registro interno del local. Al enviar aceptás que estos datos queden en tu ficha.
          </p>
        </div>
      </div>
    </main>
  );
}
