/**
 * Rutas por defecto del pipeline de calidad, relativas al directorio
 * `backend/` (donde corre el servidor en desarrollo).
 *
 * Viven en su propio módulo, sin leer el entorno, para que el servidor MCP y
 * el demo del Copilot las usen sin cargar `env.ts` (que exige credenciales de
 * MariaDB y MinIO que esos procesos no necesitan).
 *
 * `reports/` es donde escribe `dvc.yaml` (`release.json`, `embeddings.json`) y
 * donde `pipeline/register_version.py` deja `versions.json`. La prueba
 * `pipeline-portal-wiring.test.ts` falla si este valor se desvía de `dvc.yaml`.
 */
export const DEFAULT_QUALITY_ARTIFACTS_DIR = '../reports';

/** Política que Settings edita y que `dvc.yaml` lee como `params`. */
export const DEFAULT_QUALITY_CONFIG_PATH = '../quality/quality.yaml';
