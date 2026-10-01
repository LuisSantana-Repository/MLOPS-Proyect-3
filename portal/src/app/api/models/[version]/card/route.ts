import { NextResponse } from "next/server";
import { modelVersionSchema } from "@/contracts";
import { handleRouteError, parseOrThrow } from "@/lib/http";
import { getModelCard } from "@/lib/model-card";
import { requirePublishedRow, runDetails } from "@/lib/published-models";
import { modelStore } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models/[version]/card
 * Tarjeta del modelo en Markdown, leída del paquete publicado en S3
 * (`model_card.md` o, si aún no existe, generada desde `summary.json`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string }> },
): Promise<NextResponse> {
  try {
    const version = parseOrThrow(modelVersionSchema, (await params).version, "Versión");
    const row = await requirePublishedRow(version);
    const { metrics } = await runDetails(row.runId);
    return NextResponse.json(await getModelCard(modelStore(), row, metrics));
  } catch (err) {
    return handleRouteError(err);
  }
}
