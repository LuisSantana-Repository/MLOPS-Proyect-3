import { NextResponse } from "next/server";
import { z } from "zod";
import type { EvaluationMetrics, EvaluationResponse } from "@/contracts";
import { badRequest, handleRouteError, notFound, parseOrThrow } from "@/lib/http";
import { getModelVersion, getRun, type NormalizedRun } from "@/lib/mlflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/evaluation/[modelVersion]
 *
 * `modelVersion` identifica una versión del registry. Acepta dos formas:
 *   - "modelo:3"        → nombre y versión juntos (recomendado)
 *   - "3" + ?name=modelo → versión en la ruta, nombre por query
 *
 * Devuelve las métricas de evaluación (test/eval) del run de origen, más matriz
 * de confusión y clases si el run las publicó.
 */

const paramSchema = z.object({
  name: z.string().trim().min(1),
  version: z.string().trim().regex(/^\d+$/, "la versión debe ser un entero"),
});

function resolveNameVersion(segment: string, nameQuery: string | null) {
  const decoded = decodeURIComponent(segment);
  if (decoded.includes(":")) {
    const idx = decoded.lastIndexOf(":");
    return { name: decoded.slice(0, idx), version: decoded.slice(idx + 1) };
  }
  if (nameQuery) return { name: nameQuery, version: decoded };
  throw badRequest('Indica el modelo como "nombre:version" en la ruta o pasa ?name=<modelo>');
}

/** Extrae accuracy, macro-F1 y demás métricas de evaluación del run. */
function evaluationMetrics(run: NormalizedRun): EvaluationMetrics {
  const m = run.metrics;
  const pick = (...names: string[]) => {
    for (const n of names) {
      if (typeof m[n] === "number") return m[n];
    }
    return null;
  };
  const extra: Record<string, number> = {};
  for (const [key, value] of Object.entries(m)) {
    if (/^(test_|eval_)/.test(key)) extra[key] = value;
  }
  return {
    accuracy: pick("test_accuracy", "eval_accuracy", "test_acc", "accuracy"),
    macroF1: pick("test_macro_f1", "test_f1_macro", "eval_macro_f1", "macro_f1"),
    extra,
  };
}

/** Lee la matriz de confusión y clases desde tags/params JSON del run. */
function confusionAndClasses(run: NormalizedRun): {
  confusionMatrix: number[][] | null;
  classes: string[] | null;
} {
  const parseJson = <T>(raw: string | undefined): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  const confusionMatrix =
    parseJson<number[][]>(run.tags.confusion_matrix ?? run.params.confusion_matrix) ?? null;
  const classes = parseJson<string[]>(run.tags.classes) ?? null;
  return { confusionMatrix, classes };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelVersion: string }> },
): Promise<NextResponse> {
  try {
    const { modelVersion } = await params;
    const nameQuery = new URL(request.url).searchParams.get("name");
    const parsed = parseOrThrow(
      paramSchema,
      resolveNameVersion(modelVersion, nameQuery),
      "identificador de modelo",
    );

    const mv = await getModelVersion(parsed.name, parsed.version);
    if (!mv) {
      throw notFound(`No existe la versión ${parsed.version} del modelo "${parsed.name}"`);
    }

    const run = mv.runId ? await getRun(mv.runId) : null;
    if (!run) {
      throw notFound(
        `La versión ${parsed.version} de "${parsed.name}" no tiene run de origen con métricas`,
      );
    }

    const { confusionMatrix, classes } = confusionAndClasses(run);
    const body: EvaluationResponse = {
      modelName: parsed.name,
      modelVersion: parsed.version,
      runId: mv.runId,
      metrics: evaluationMetrics(run),
      confusionMatrix,
      classes,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
