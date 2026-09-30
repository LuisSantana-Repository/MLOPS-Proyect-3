import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestEvaluation } from "@/contracts";
import { env } from "@/lib/env";
import { type ApiError, upstreamError } from "@/lib/http";
import { computeTestEvaluation, parsePredictionsCsv } from "./evaluation-metrics";

/**
 * Carga predictions.csv de T08 para un run y calcula su evaluación de test (T12).
 *
 * Fuente principal: el artefacto `test/predictions.csv` del run en MLflow (el servidor
 * lo lee del artifact store con `/get-artifact`). Respaldo: `reports/t08/` del repo,
 * solo si su `metrics.json` dice que es del mismo run.
 */

export const PREDICTIONS_ARTIFACT = "test/predictions.csv";
export const REPO_REPORT_DIR = "reports/t08";

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Texto de un artefacto del run; null si no existe. 502 si MLflow falla. */
export async function fetchMlflowArtifact(
  runId: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(`${env.MLFLOW_TRACKING_URI.replace(/\/$/, "")}/get-artifact`);
  url.searchParams.set("path", path);
  url.searchParams.set("run_uuid", runId);

  let res: Response;
  try {
    res = await fetchImpl(url, { cache: "no-store" });
  } catch (cause) {
    throw upstreamError(
      `No se pudo contactar a MLflow para leer ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (res.status === 404) return null;
  if (!res.ok)
    throw upstreamError(`MLflow respondió ${res.status} al leer ${path} del run ${runId}`);
  return res.text();
}

/** predictions.csv de reports/t08 si su metrics.json corresponde al run; si no, null. */
export async function readRepoPredictions(root: string, runId: string): Promise<string | null> {
  const metricsText = await readOptional(join(root, REPO_REPORT_DIR, "metrics.json"));
  if (metricsText === null) return null;
  let reportRunId: unknown;
  try {
    reportRunId = (JSON.parse(metricsText) as { run_id?: unknown }).run_id;
  } catch {
    return null;
  }
  if (reportRunId !== runId) return null;
  return readOptional(join(root, REPO_REPORT_DIR, "predictions.csv"));
}

/**
 * Evaluación de test del run, o null si todavía no se evalúa (T08 sin correr).
 * Solo consulta MLflow si el run ya tiene métricas `test_*`.
 */
export async function loadTestEvaluation(
  runId: string,
  metrics: Record<string, number>,
  options: { root?: string; fetchImpl?: typeof fetch } = {},
): Promise<TestEvaluation | null> {
  const root = options.root ?? env.REPO_ROOT;
  const evaluated = typeof metrics.test_accuracy === "number";

  let text: string | null = null;
  let source: TestEvaluation["source"] = "mlflow";
  let mlflowError: ApiError | null = null;

  if (evaluated) {
    try {
      text = await fetchMlflowArtifact(runId, PREDICTIONS_ARTIFACT, options.fetchImpl);
    } catch (err) {
      mlflowError = err as ApiError;
    }
  }
  if (text === null) {
    text = await readRepoPredictions(root, runId);
    source = "repo";
  }
  if (text === null) {
    if (mlflowError) throw mlflowError;
    return null;
  }

  const { classes, rows } = parsePredictionsCsv(text);
  return computeTestEvaluation(classes, rows, metrics, source);
}
