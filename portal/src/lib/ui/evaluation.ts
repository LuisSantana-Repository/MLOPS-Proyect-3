import type { ModelVersionInfo, TestEvaluation, TestPrediction } from "@/contracts";

/** Identificador que acepta GET /api/evaluation/[modelVersion]. */
export function modelKey(model: Pick<ModelVersionInfo, "name" | "version">): string {
  return `${model.name}:${model.version}`;
}

/** ¿Es el run congelado por T07 en reports/t07/selection.json? */
export function isWinner(runId: string | null, winnerRunId: string | null): boolean {
  return winnerRunId !== null && runId === winnerRunId;
}

/** Más reciente primero: por fecha de registro y, si no hay fecha, por versión numérica. */
function newestFirst(models: ModelVersionInfo[]): ModelVersionInfo[] {
  return [...models].sort(
    (a, b) =>
      (b.creationTimestamp ?? -1) - (a.creationTimestamp ?? -1) ||
      Number(b.version) - Number(a.version),
  );
}

/**
 * Por qué se abre una versión:
 * - requested: la pidió el usuario (`?model=` o el selector).
 * - winner: es la del run ganador de T07 (el único que T08 evalúa sobre test).
 * - latest-ready: no hay ganador congelado o no está registrado; se usa la más reciente en READY.
 * - none: no hay ninguna versión que abrir.
 */
export type DefaultModelReason = "requested" | "winner" | "latest-ready" | "none";

export interface DefaultModelChoice {
  key: string | null;
  reason: DefaultModelReason;
  /** Versión del run ganador, si está registrada. */
  winnerKey: string | null;
  /** Versión registrada más reciente cuando es más nueva que la ganadora y no lo es. */
  newerNonWinnerKey: string | null;
}

/**
 * Versión que abre /evaluation. Por defecto el ganador de T07, no la más reciente:
 * comparar versiones sobre test sería elegir modelo con el test (eso va en /experiments).
 */
export function chooseDefaultModel(
  models: ModelVersionInfo[],
  winnerRunId: string | null,
  requested: string | null,
): DefaultModelChoice {
  const sorted = newestFirst(models);
  const winner = sorted.find((m) => isWinner(m.runId, winnerRunId)) ?? null;
  const winnerKey = winner ? modelKey(winner) : null;
  const latest = sorted[0] ?? null;
  const newerNonWinnerKey =
    winner && latest && !isWinner(latest.runId, winnerRunId) ? modelKey(latest) : null;

  const requestedKey = requested?.trim() || null;
  if (requestedKey) return { key: requestedKey, reason: "requested", winnerKey, newerNonWinnerKey };
  if (winnerKey) return { key: winnerKey, reason: "winner", winnerKey, newerNonWinnerKey };

  const ready = sorted.find((m) => m.status === "READY");
  if (ready)
    return {
      key: modelKey(ready),
      reason: "latest-ready",
      winnerKey: null,
      newerNonWinnerKey: null,
    };
  return { key: null, reason: "none", winnerKey: null, newerNonWinnerKey: null };
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** URL de /api/crops para un crop_path de T03. */
export function cropUrl(cropPath: string): string {
  return `/api/crops/${cropPath.split("/").map(encodeURIComponent).join("/")}`;
}

export interface HeatmapCell {
  predicted: string;
  value: number;
  /** Proporción dentro de la fila real (0..1); define la intensidad del color. */
  share: number;
  correct: boolean;
}

/** Filas del heatmap: una por clase real, con la proporción de cada celda en su fila. */
export function heatmapRows(confusion: TestEvaluation["confusionMatrix"]) {
  return confusion.labels.map((label, i) => {
    const row = confusion.matrix[i] ?? [];
    const total = row.reduce((a, b) => a + b, 0);
    const cells: HeatmapCell[] = confusion.labels.map((predicted, j) => ({
      predicted,
      value: row[j] ?? 0,
      share: total === 0 ? 0 : (row[j] ?? 0) / total,
      correct: i === j,
    }));
    return { label, total, cells };
  });
}

/** Filtro de la galería: "" = todas las clases. */
export function filterErrors(
  errors: TestPrediction[],
  filter: { yTrue: string; yPred: string },
): TestPrediction[] {
  return errors.filter(
    (e) =>
      (filter.yTrue === "" || e.yTrue === filter.yTrue) &&
      (filter.yPred === "" || e.yPred === filter.yPred),
  );
}
