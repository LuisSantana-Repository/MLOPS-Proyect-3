/**
 * Configuración leída del entorno. Falla temprano solo cuando un valor es
 * requerido y no hay default razonable, con un mensaje claro.
 */

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
} as const;
