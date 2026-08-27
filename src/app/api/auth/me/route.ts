import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name || user.email,
      firstName: "",
      lastName: "",
      whatsapp: "",
    },
  });
}