export const dynamic = "force-dynamic";

export async function GET() {
  const vars = {
    SUPABASE_URL: !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    ),
    ANON_KEY: !!(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    ),
    SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };

  const ok = vars.SUPABASE_URL && vars.ANON_KEY;

  return Response.json(
    { status: ok ? "ok" : "missing vars", vars },
    { status: ok ? 200 : 503 }
  );
}
