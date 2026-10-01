import type { NextResponse } from "next/server";
import { readCropImage } from "@/lib/crops";
import { env } from "@/lib/env";
import { handleRouteError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/crops/[...path]
 * Recorte de T03 (`crops/<image_id>_<ann_id>.jpg`) leído de `data/crops/` del repo,
 * para la galería de errores de /evaluation (T12).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response | NextResponse> {
  try {
    const { path } = await params;
    const bytes = await readCropImage(env.REPO_ROOT, path);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
