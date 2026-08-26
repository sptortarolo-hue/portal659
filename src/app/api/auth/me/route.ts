import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ user: null });
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.email,
      firstName: data.user.user_metadata?.first_name || "",
      lastName: data.user.user_metadata?.last_name || "",
      whatsapp: data.user.user_metadata?.whatsapp || "",
    },
  });
}
