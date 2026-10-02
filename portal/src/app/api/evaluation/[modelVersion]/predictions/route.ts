import { NextResponse } from "next/server";
import { z } from "zod";
import { loadPredictionsCsv, resolveNameVersion } from "@/lib/evaluation-origin";
import { handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramSchema = z.object({
  name: z.string().trim().min(1),
  version: z
    .string()
    .trim()
    .regex(/^\d+$|^\d+\.\d+\.\d+$/, "la versión debe ser un entero o MAJOR.MINOR.PATCH"),
});

/**
 * GET /api/evaluation/[modelVersion]/predictions
 * Exporta el `predictions.csv` de test de la versión (el mismo que alimenta la página):
 * del run en MLflow o, si no está disponible, del repo verificado (P1-3).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelVersion: string }> },
): Promise<NextResponse> {
  try {
    const { modelVersion } = await params;
    const nameQuery = new URL(request.url).searchParams.get("name");
    const { name, version } = parseOrThrow(
      paramSchema,
      resolveNameVersion(modelVersion, nameQuery),
      "identificador de modelo",
    );
    const { csv, source, runId } = await loadPredictionsCsv(name, version);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="predictions-${name}-${version}.csv"`,
        "X-Evaluation-Source": source,
        "X-Run-Id": runId,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
