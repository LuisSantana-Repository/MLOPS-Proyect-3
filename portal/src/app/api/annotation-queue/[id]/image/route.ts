import type { NextResponse } from "next/server";
import { z } from "zod";
import { getAnnotationItem, readItemImage } from "@/lib/annotation-queue";
import { handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/annotation-queue/[id]/image — la imagen de un elemento de la cola. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response | NextResponse> {
  try {
    const id = parseOrThrow(z.uuid(), (await params).id, "Id");
    const { bytes, contentType } = await readItemImage(await getAnnotationItem(id));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
