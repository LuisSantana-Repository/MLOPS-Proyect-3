import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ANNOTATION_STATUSES,
  type AnnotationQueueItem,
  createAnnotationItemSchema,
  type ListAnnotationQueueResponse,
} from "@/contracts";
import { createAnnotationItem, listAnnotationItems } from "@/lib/annotation-queue";
import { badRequest, handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  status: z.enum(ANNOTATION_STATUSES).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** GET /api/annotation-queue?status=pending&limit=100 — elementos más recientes primero. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const params = new URL(request.url).searchParams;
    const query = parseOrThrow(
      listQuerySchema,
      { status: params.get("status"), limit: params.get("limit") ?? undefined },
      "Consulta",
    );
    const body: ListAnnotationQueueResponse = await listAnnotationItems(query.status, query.limit);
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/annotation-queue
 * Envía una imagen clasificada a la cola con la predicción sugerida (estado `pending`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.json().catch(() => {
      throw badRequest("El cuerpo debe ser JSON");
    });
    const input = parseOrThrow(createAnnotationItemSchema, raw, "Elemento de anotación");
    const item: AnnotationQueueItem = await createAnnotationItem(input);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
