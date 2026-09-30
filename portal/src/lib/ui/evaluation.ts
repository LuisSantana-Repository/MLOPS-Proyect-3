import type { ModelVersionInfo, TestEvaluation, TestPrediction } from "@/contracts";

/** Identificador que acepta GET /api/evaluation/[modelVersion]. */
export function modelKey(model: Pick<ModelVersionInfo, "name" | "version">): string {
  return `${model.name}:${model.version}`;
}

/** Versión publicada más reciente (por fecha; sin fechas, la versión numérica más alta). */
export function pickDefaultModel(models: ModelVersionInfo[]): string | null {
  if (models.length === 0) return null;
  const sorted = [...models].sort(
    (a, b) =>
      (b.creationTimestamp ?? -1) - (a.creationTimestamp ?? -1) ||
      Number(b.version) - Number(a.version),
  );
  return modelKey(sorted[0]);
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
