import { NextResponse } from "next/server";
import type { ListModelsResponse } from "@/contracts";
import { handleRouteError } from "@/lib/http";
import { listPublishedModels } from "@/lib/published-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models
 * Versiones publicadas (tabla `published_models` de T10), cada una con su run de
 * origen, release DVC, llave S3, hash de pesos, fecha y estado verificado en S3.
 * Completa con el Model Registry de MLflow (stage/estado) cuando existe.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const body: ListModelsResponse = { models: await listPublishedModels() };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
