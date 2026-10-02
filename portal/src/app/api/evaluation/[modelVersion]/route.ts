import { NextResponse } from "next/server";
import { z } from "zod";
import { loadEvaluation, resolveNameVersion } from "@/lib/evaluation-origin";
import { handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/evaluation/[modelVersion]
 *
 * `modelVersion` identifica una versión del registry. Acepta dos formas:
 *   - "modelo:3"        → nombre y versión juntos (recomendado)
 *   - "3" + ?name=modelo → versión en la ruta, nombre por query
 * La versión puede ser la del Model Registry ("3") o la semántica publicada por
 * T10 ("1.0.0", tabla `published_models`), que es la que lista GET /api/models (T13).
 *
 * Devuelve las métricas de evaluación (test/eval) del run de origen, más matriz
 * de confusión y clases si el run las publicó.
 *
 * T12: `test` trae la evaluación calculada desde `test/predictions.csv` de T08
 * (accuracy, F1 macro, métricas por clase, matriz y errores por muestra), o null
 * si el run todavía no se evalúa sobre test.
 *
 * P1-3: `source` dice de dónde salió: "mlflow" (fuente principal) o "repo" (respaldo
 * verificado: `reports/t08` con el mismo `run_id` y `weights_sha256` que la versión
 * publicada). Si el reporte del repo es de otros pesos responde 409.
 */

const modelParamSchema = z.object({
  name: z.string().trim().min(1),
  version: z
    .string()
    .trim()
    .regex(
      /^\d+$|^\d+\.\d+\.\d+$/,
      "la versión debe ser un entero (registry) o MAJOR.MINOR.PATCH (publicada)",
    ),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelVersion: string }> },
): Promise<NextResponse> {
  try {
    const { modelVersion } = await params;
    const nameQuery = new URL(request.url).searchParams.get("name");
    const parsed = parseOrThrow(
      modelParamSchema,
      resolveNameVersion(modelVersion, nameQuery),
      "identificador de modelo",
    );
    return NextResponse.json(await loadEvaluation(parsed.name, parsed.version));
  } catch (err) {
    return handleRouteError(err);
  }
}
