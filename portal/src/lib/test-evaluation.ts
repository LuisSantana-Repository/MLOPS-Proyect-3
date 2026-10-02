import { env } from "@/lib/env";
import { upstreamError } from "@/lib/http";

/**
 * predictions.csv de T08 como artefacto del run en MLflow (T12): el servidor lo lee del
 * artifact store con `/get-artifact`.
 *
 * El respaldo `reports/t08/` del repo vive en `evaluation-origin.ts` y siempre se verifica
 * contra la versión publicada (run, SHA-256 de pesos y selección de T07). Aquí no hay
 * ningún camino que use el repo comparando solo el `run_id` (P1-3).
 */

export const PREDICTIONS_ARTIFACT = "test/predictions.csv";
export const REPO_REPORT_DIR = "reports/t08";

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
