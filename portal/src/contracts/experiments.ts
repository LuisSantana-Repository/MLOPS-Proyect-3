import { z } from "zod";

/**
 * Contrato de experimentos y curvas (T09), servido desde la REST API de MLflow.
 *
 * Los nombres de métricas siguen el contrato de `trainer/tracking.py`:
 * por época `train_loss`, `val_loss`, `train_acc`, `val_acc`; finales
 * `best_val_loss`, `best_val_acc`, `best_epoch`, `duration_seconds`.
 */

/**
 * Query de GET /api/experiments.
 *
 * Por defecto lista solo runs de selección (contrato T06/T07): los del sweep
 * indicado, en estado FINISHED y sin los de humo (`smoke`). El orden es por
 * `best_val_loss` ascendente (métrica de selección acordada), no por el último
 * `val_loss`. Se puede desactivar el filtro con `?onlySelected=false`.
 */
export const listExperimentsQuerySchema = z.object({
  experiment: z.string().trim().min(1).optional(),
  maxResults: z.coerce.number().int().min(1).max(1000).default(50),
  pageToken: z.string().trim().min(1).optional(),
  /** Tag `sweep` a filtrar cuando `onlySelected` está activo. */
  sweep: z.string().trim().min(1).default("t07"),
  /** Si es true, aplica sweep + FINISHED + sin smoke y ordena por best_val_loss. */
  onlySelected: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type ListExperimentsQuery = z.output<typeof listExperimentsQuerySchema>;

/** Un run resumido: parámetros y métricas finales. */
export interface ExperimentRun {
  runId: string;
  runName: string | null;
  experimentId: string;
  status: string;
  startTime: number | null;
  endTime: number | null;
  params: Record<string, string>;
  metrics: Record<string, number>;
  tags: Record<string, string>;
  /** Enlace a la UI de MLflow del run (T16). */
  mlflowRunUrl?: string | null;
}

/** Respuesta de GET /api/experiments. */
export interface ListExperimentsResponse {
  experiment: string;
  runs: ExperimentRun[];
  nextPageToken: string | null;
  /** Filtro aplicado (para que el frontend sepa qué está viendo). */
  selection: {
    onlySelected: boolean;
    sweep: string | null;
    /** Métrica y sentido de orden usados. */
    orderedBy: string;
  };
}

/** Un punto de una curva por época. */
export interface MetricPoint {
  step: number;
  value: number;
  timestamp: number;
}

/** Query de GET /api/experiments/[runId]/metrics. */
export const metricsQuerySchema = z.object({
  keys: z
    .string()
    .trim()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : undefined,
    ),
});

export type MetricsQuery = z.output<typeof metricsQuerySchema>;

/**
 * Respuesta de GET /api/experiments/[runId]/metrics.
 * Historial por época; por defecto `train_loss` y `val_loss`.
 */
export interface RunMetricsResponse {
  runId: string;
  metrics: Record<string, MetricPoint[]>;
}
