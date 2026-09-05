import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  if (!pathSegments || pathSegments.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const rel = pathSegments.join(path.sep);
  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const full = path.resolve(uploadRoot, rel);

  // Evitar path traversal
  if (!full.startsWith(path.resolve(uploadRoot))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const data = await readFile(full);
    const ext = (path.extname(full) || "").replace(".", "").toLowerCase();
    // nosniff: si el navegador huele un tipo de contenido distinto, no lo usa.
    const headers: Record<string, string> = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    // SVG: por las dudas (un SVG con script sería XSS del mismo origen) no se
    // renderiza inline, sino que fuerza descarga.
    if (ext === "svg") {
      headers["Content-Type"] = "image/svg+xml";
      headers["Content-Disposition"] = "attachment; filename=\"file.svg\"";
    }
    return new NextResponse(data, { headers });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}