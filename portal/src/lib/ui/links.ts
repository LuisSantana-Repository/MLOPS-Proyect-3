import type { ExperimentRun, ModelVersionInfo } from "@/contracts";

/**
 * Enlaces entre páginas para seguir el recorrido de la demo (T16):
 * release DVC → run de MLflow → versión publicada en S3 → predicción.
 */

export function experimentsRunHref(runId: string | null): string | null {
  return runId ? `/experiments?run=${encodeURIComponent(runId)}` : null;
}

export function evaluationHref(model: Pick<ModelVersionInfo, "name" | "version">): string {
  return `/evaluation?model=${encodeURIComponent(`${model.name}:${model.version}`)}`;
}

export function modelsHref(version: string): string {
  return `/models?version=${encodeURIComponent(version)}`;
}

/** Enlace a la UI de MLflow del run; null si no hay URL de MLflow configurada. */
export function mlflowRunUrl(
  uiUrl: string | undefined,
  experimentId: string,
  runId: string,
): string | null {
  if (!uiUrl) return null;
  const base = uiUrl.replace(/\/+$/, "");
  return `${base}/#/experiments/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}`;
}

export function withMlflowRunUrls(
  runs: ExperimentRun[],
  uiUrl: string | undefined,
): ExperimentRun[] {
  return runs.map((run) => ({
    ...run,
    mlflowRunUrl: mlflowRunUrl(uiUrl, run.experimentId, run.runId),
  }));
}
