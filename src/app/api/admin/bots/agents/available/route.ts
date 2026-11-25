import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";
import { AGENT_DEFAULTS } from "../../../../../../../services/wa-bot/src/agent-defaults.mjs";
import llmModels from "../../../../../../../services/wa-bot/src/llm-models.json";

const TEMPLATES = [
  { id: "gastronomia", label: "Gastronomía", emoji: "🥟", description: "Menú, pedidos y delivery" },
  { id: "comercio", label: "Comercio de barrio", emoji: "🏪", description: "Vidriera y venta online" },
  { id: "moda", label: "Moda e indumentaria", emoji: "👗", description: "Talles, colores y pedidos" },
  { id: "servicio", label: "Servicios / oficios", emoji: "🔧", description: "Presupuestos y turnos" },
  { id: "estetica", label: "Peluquería y estética", emoji: "💇", description: "Turnos, consultas y packs" },
  { id: "taller", label: "Talleres y reparaciones", emoji: "🛠️", description: "Órdenes y presupuestos" },
  { id: "portal", label: "Portal central", emoji: "🌐", description: "Descubre comercios del barrio" },
];

/** GET /api/admin/bots/agents/available — datos para el wizard de nuevo agente. */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const vendors = await queryMany<{ id: string; store_name: string; vertical: string | null; slug: string | null }>(
    `SELECT v.id, v.store_name, v.vertical, v.slug
     FROM vendors v
     WHERE NOT EXISTS (SELECT 1 FROM bot_agents b WHERE b.vendor_id = v.id)
     ORDER BY v.store_name ASC LIMIT 300`
  ).catch(() => []);

  const all = AGENT_DEFAULTS as Record<string, any>;
  const templates = TEMPLATES.map((t) => ({
    ...t,
    greeting: all[t.id]?.greeting || "",
    brief: all[t.id]?.brief || {},
  }));

  return NextResponse.json({ vendors, templates, models: llmModels.models });
}
