/**
 * Configuración leída del entorno. Falla temprano solo cuando un valor es
 * requerido y no hay default razonable, con un mensaje claro.
 */

import { resolve } from "node:path";

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Valor de entorno no numérico: "${value}"`);
  }
  return parsed;
}

export const env = {
  // MariaDB
  DATABASE_URL: process.env.DATABASE_URL?.trim() || undefined,
  MYSQL_HOST: process.env.MYSQL_HOST?.trim() || "127.0.0.1",
  MYSQL_PORT: num(process.env.MYSQL_PORT, 3307),
  MYSQL_USER: process.env.MYSQL_USER?.trim() || "mlflow_user",
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? "mlflow_password",
  MYSQL_DATABASE: process.env.MYSQL_DATABASE?.trim() || "mlflow_db",

  // MLflow
  MLFLOW_TRACKING_URI: process.env.MLFLOW_TRACKING_URI?.trim() || "http://127.0.0.1:5000",
  MLFLOW_EXPERIMENT: process.env.MLFLOW_EXPERIMENT?.trim() || "proyecto3-clasificador",

  // Redis
  REDIS_HOST: process.env.REDIS_HOST?.trim() || "127.0.0.1",
  REDIS_PORT: num(process.env.REDIS_PORT, 6379),
  ML_JOBS_QUEUE: process.env.ML_JOBS_QUEUE?.trim() || "ml_jobs",

  // MLflow UI para enlazar runs (por defecto, el mismo servidor del tracking).
  MLFLOW_UI_URL: (
    process.env.MLFLOW_UI_URL?.trim() ||
    process.env.MLFLOW_TRACKING_URI?.trim() ||
    "http://127.0.0.1:5000"
  ).replace(/\/$/, ""),

  // Servicio de inferencia de T10 (FastAPI, POST /predict).
  INFERENCE_URL: (process.env.INFERENCE_URL?.trim() || "http://127.0.0.1:8000").replace(/\/$/, ""),
  INFERENCE_TIMEOUT_MS: num(process.env.INFERENCE_TIMEOUT_MS, 60_000),

  // Bucket de modelos publicados (T10). Mismas variables que serving/storage.py:
  // AWS real por defecto; MODELS_S3_USE_MINIO=1 para probar contra MinIO.
  MODELS_S3_USE_MINIO: ["1", "true", "yes"].includes(
    (process.env.MODELS_S3_USE_MINIO ?? "").trim().toLowerCase(),
  ),
  MODELS_S3_BUCKET:
    process.env.MODELS_S3_BUCKET?.trim() || process.env.S3_BUCKET?.trim() || undefined,
  MODELS_S3_ENDPOINT_URL: process.env.MODELS_S3_ENDPOINT_URL?.trim() || undefined,
  MODELS_AWS_REGION:
    process.env.MODELS_AWS_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1",
  MODELS_AWS_ACCESS_KEY_ID:
    process.env.MODELS_AWS_ACCESS_KEY_ID?.trim() || process.env.AWS_ACCESS_KEY_ID?.trim(),
  MODELS_AWS_SECRET_ACCESS_KEY:
    process.env.MODELS_AWS_SECRET_ACCESS_KEY?.trim() || process.env.AWS_SECRET_ACCESS_KEY?.trim(),

  // MinIO del stack: imágenes subidas desde /inference (antes de enviarlas a anotación).
  MINIO_ENDPOINT: (process.env.MINIO_ENDPOINT?.trim() || "http://127.0.0.1:9000").replace(
    /\/$/,
    "",
  ),
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY?.trim() || process.env.MINIO_ROOT_USER?.trim(),
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY?.trim() || process.env.MINIO_ROOT_PASSWORD?.trim(),
  ANNOTATION_BUCKET: process.env.ANNOTATION_BUCKET?.trim() || "annotation-images",

  // Backend del portal de anotación (servicio `annotation-api` del compose). Es el mismo
  // al que next.config.mjs reenvía /api/p2/*; aquí lo llama el servidor del portal.
  ANNOTATION_API_URL: (process.env.P2_BACKEND_URL?.trim() || "http://127.0.0.1:3100").replace(
    /\/+$/,
    "",
  ),
  ANNOTATION_API_TIMEOUT_MS: num(process.env.ANNOTATION_API_TIMEOUT_MS, 30_000),

  // Raíz del repo, donde viven los artefactos versionados de T03/T04/T07.
  // `npm run dev` corre dentro de portal/, así que por defecto es la carpeta padre.
  REPO_ROOT: resolve(process.env.REPO_ROOT?.trim() || resolve(process.cwd(), "..")),
} as const;
