import type { ExperimentRun } from "@/contracts";

/** Columnas de la tabla de /experiments. `param:` y `metric:` leen de MLflow. */
// audit-ok: definición de columnas de la tabla, no datos
export const RUN_COLUMNS = [
  { key: "runName", label: "Run" },
  { key: "param:optimizer", label: "optimizer" },
  { key: "param:batch_size", label: "batch" },
  { key: "param:max_epochs", label: "épocas" },
  { key: "param:lr", label: "lr" },
  { key: "param:img_size", label: "img" },
  { key: "param:hidden_layers", label: "capas ocultas" },
  { key: "param:dropout", label: "dropout" },
  { key: "metric:best_val_loss", label: "mejor val_loss" },
  { key: "metric:best_val_acc", label: "val_acc" },
] as const;

export type RunColumnKey = (typeof RUN_COLUMNS)[number]["key"];
export type SortDirection = "asc" | "desc";

/** Valor de una celda (número si se puede, para ordenar bien). */
export function cellValue(run: ExperimentRun, key: RunColumnKey): string | number | null {
  if (key === "runName") return run.runName ?? run.runId;
  const [kind, name] = key.split(":") as ["param" | "metric", string];
  if (kind === "metric") return run.metrics[name] ?? null;
  const raw = run.params[name];
  if (raw === undefined) return null;
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
}

/** Orden estable; los valores faltantes siempre al final. */
export function sortRuns(
  runs: ExperimentRun[],
  key: RunColumnKey,
  dir: SortDirection,
): ExperimentRun[] {
  const sign = dir === "asc" ? 1 : -1;
  return runs
    .map((run, index) => ({ run, index, value: cellValue(run, key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const cmp =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), "es", { numeric: true });
      return cmp !== 0 ? sign * cmp : a.index - b.index;
    })
    .map((x) => x.run);
}

/** Siguiente orden al hacer clic en un encabezado. */
export function nextSort(
  current: { key: RunColumnKey; dir: SortDirection },
  clicked: RunColumnKey,
): { key: RunColumnKey; dir: SortDirection } {
  if (current.key !== clicked) return { key: clicked, dir: "asc" };
  return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function formatCell(value: string | number | null, key: RunColumnKey): string {
  if (value === null) return "—";
  if (typeof value !== "number") return value;
  if (key === "metric:best_val_acc") return `${(value * 100).toFixed(1)}%`;
  if (key.startsWith("metric:")) return value.toFixed(4);
  return String(value);
}
