/**
 * Contrato de modelos y evaluación (T09), servido desde el Model Registry de MLflow.
 */

/** Una versión de modelo registrada. */
export interface ModelVersionInfo {
  name: string;
  version: string;
  stage: string | null;
  status: string | null;
  /** Run de MLflow que originó la versión. */
  runId: string | null;
  /** Llave/ruta S3 (MinIO) donde vive el artefacto del modelo. */
  s3Key: string | null;
  /** Hash de los pesos (tag `weights_sha256` del run de origen). */
  weightsSha256: string | null;
  creationTimestamp: number | null;
  lastUpdatedTimestamp: number | null;
  description: string | null;
}

/** Respuesta de GET /api/models. */
export interface ListModelsResponse {
  models: ModelVersionInfo[];
}

/** Métricas de evaluación en el conjunto de prueba. */
export interface EvaluationMetrics {
  accuracy: number | null;
  macroF1: number | null;
  /** Métricas adicionales del run (todas las `test_*` / `eval_*`). */
  extra: Record<string, number>;
}

/** Respuesta de GET /api/evaluation/[modelVersion]. */
export interface EvaluationResponse {
  modelName: string;
  modelVersion: string;
  runId: string | null;
  metrics: EvaluationMetrics;
  /** Matriz de confusión si el run la publicó como artefacto/param JSON. */
  confusionMatrix: number[][] | null;
  classes: string[] | null;
}
