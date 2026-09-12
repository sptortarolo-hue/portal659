import { getPool } from "@/lib/db";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const vars = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };

  let db = false;
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    db = true;
  } catch (e) {
    logApiError("health", e);
    db = false;
  }

  const ok = vars.DATABASE_URL && db;

  return Response.json(
    { status: ok ? "ok" : "missing vars", vars, db },
    { status: ok ? 200 : 503 }
  );
}