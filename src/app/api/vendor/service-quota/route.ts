import { getVendorByRequest } from "@/lib/vendor-utils";
import { getServiceQuota } from "@/lib/service-quota";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Contador de solicitudes del mes para mostrar en el panel ("3 de 5"). */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const quota = await getServiceQuota(vendor.id);
  return NextResponse.json(quota);
}
