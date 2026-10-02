import type { TestEvaluation } from "./evaluation";

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
  // --- Publicación (T10 → T13) ---------------------------------------------
  /** Release DVC del dataset con que se entrenó. Es la versión de los DATOS, no del modelo. */
  dvcRelease: string | null;
  /** Bucket y URI del paquete publicado (`s3://<bucket>/models/<name>/<version>`). */
  s3Bucket: string | null;
  s3Uri: string | null;
  /** Fecha de publicación (ISO 8601), de `published_models.created_at`. */
  publishedAt: string | null;
  /** Estado verificado en S3; un paquete con archivos faltantes nunca se muestra como publicado. */
  publication: ModelPublication;
  /** Archivos del paquete que se pueden descargar. */
  files: string[];
  /** Hay `model_card.md` publicado; si no, la tarjeta se genera desde `summary.json`. */
  hasModelCard: boolean;
  /** Enlace a la UI de MLflow del run de origen. */
  mlflowRunUrl: string | null;
  /** Métricas del run de origen: validación (T07) y test (T08), si existen. */
  metrics: ModelMetrics;
}

export const PUBLICATION_STATUSES = ["published", "incomplete", "unverified"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export interface ModelPublication {
  /** published = todos los archivos existen en S3; incomplete = falta alguno; unverified = no se pudo consultar S3. */
  status: PublicationStatus;
  missingFiles: string[];
  checkedAt: string;
  message: string | null;
}

export interface ModelMetrics {
  bestValLoss: number | null;
  bestValAcc: number | null;
  testAccuracy: number | null;
  testF1Macro: number | null;
}

/** Respuesta de GET /api/models/[version]/card. */
export interface ModelCardResponse {
  version: string;
  /** model_card.md publicado (T15) o tarjeta generada desde summary.json. */
  source: "model_card.md" | "summary.json";
  markdown: string;
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
  /**
   * De dónde salió la evaluación (P1-3): "mlflow" (el run está en el tracking server) o
   * "repo" (respaldo verificado: `reports/t08` con el mismo run y SHA-256 de pesos).
   */
  source: "mlflow" | "repo";
  metrics: EvaluationMetrics;
  /** Matriz de confusión si el run la publicó como artefacto/param JSON. */
  confusionMatrix: number[][] | null;
  classes: string[] | null;
  /** Evaluación de test calculada desde predictions.csv de T08; null si el run aún no se evalúa (T12). */
  test: TestEvaluation | null;
}
