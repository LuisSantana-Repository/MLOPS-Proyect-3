import { desc, eq } from "drizzle-orm";
import type { ModelMetrics, ModelPublication, ModelVersionInfo } from "@/contracts";
import { getDb } from "@/lib/db/client";
import { type PublishedModelRow, publishedModels } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { ApiError, notFound } from "@/lib/http";
import { getRun, type NormalizedModelVersion, searchModelVersions } from "@/lib/mlflow";
import {
  MODEL_CARD_FILE,
  MODEL_ENV_FILES,
  MODEL_PACKAGE_FILES,
  modelKey,
  modelStore,
  modelUri,
  objectExists,
  type S3Store,
} from "@/lib/s3";

/**
 * Versiones de modelo publicadas (T10 → T13).
 *
 * Fuente de verdad: la tabla `published_models` que escribe `publish_model.py`.
 * Se completa con el run de origen en MLflow (métricas y enlace) y con el Model
 * Registry (stage/estado), y se verifica en S3 que el paquete exista de verdad:
 * una fila sin objetos en S3 nunca se presenta como publicada.
 */

const MODEL_NAME = "clasificador";

/** mysql2 marca la tabla faltante con ER_NO_SUCH_TABLE; Drizzle puede envolverlo en `cause`. */
function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return true;
  return "cause" in err && isMissingTable((err as { cause: unknown }).cause);
}

async function query<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingTable(err)) {
      throw new ApiError(
        500,
        "schema_missing",
        "La tabla published_models no existe: corre las migraciones (cd portal && npm run db:migrate)",
      );
    }
    throw err;
  }
}

export async function readPublishedRows(): Promise<PublishedModelRow[]> {
  return query(() =>
    getDb().select().from(publishedModels).orderBy(desc(publishedModels.createdAt)),
  );
}

export async function readPublishedRow(version: string): Promise<PublishedModelRow | null> {
  const rows = await query(() =>
    getDb().select().from(publishedModels).where(eq(publishedModels.version, version)).limit(1),
  );
  return rows[0] ?? null;
}

/** Fila publicada o 404 claro (versión inexistente = no se puede usar ni descargar). */
export async function requirePublishedRow(version: string): Promise<PublishedModelRow> {
  const row = await readPublishedRow(version);
  if (!row) throw notFound(`La versión de modelo ${version} no está publicada`);
  return row;
}

/**
 * Verifica en S3 el estado de publicación de una versión.
 *
 * El estado "published" exige los archivos MÍNIMOS (los que tiene toda versión, incl. la
 * 1.0.0 congelada). Además reporta la completitud del paquete de entorno (T16/5.1):
 * `envComplete`/`envFiles` dicen si trae config.json, env.json y requirements.lock. Así
 * la 1.0.0 sigue "published" aunque no tenga los de entorno, y las versiones nuevas
 * muestran que el paquete está completo.
 */
export async function checkPublication(store: S3Store, version: string): Promise<ModelPublication> {
  const checkedAt = new Date().toISOString();
  try {
    const [required, env] = await Promise.all([
      Promise.all(MODEL_PACKAGE_FILES.map((f) => objectExists(store, modelKey(version, f)))),
      Promise.all(MODEL_ENV_FILES.map((f) => objectExists(store, modelKey(version, f)))),
    ]);
    const missingFiles = MODEL_PACKAGE_FILES.filter((_, i) => !required[i]);
    const envFiles = MODEL_ENV_FILES.filter((_, i) => env[i]);
    return {
      status: missingFiles.length === 0 ? "published" : "incomplete",
      missingFiles,
      checkedAt,
      message:
        missingFiles.length === 0 ? null : `Faltan en ${store.label}: ${missingFiles.join(", ")}`,
      envComplete: envFiles.length === MODEL_ENV_FILES.length,
      envFiles,
    };
  } catch (err) {
    return {
      status: "unverified",
      missingFiles: [],
      checkedAt,
      message: err instanceof Error ? err.message : String(err),
      envComplete: false,
      envFiles: [],
    };
  }
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function runDetails(
  runId: string,
): Promise<{ metrics: ModelMetrics; url: string | null; tags: Record<string, string> }> {
  const empty: ModelMetrics = {
    bestValLoss: null,
    bestValAcc: null,
    testAccuracy: null,
    testF1Macro: null,
  };
  try {
    const run = await getRun(runId);
    if (!run) return { metrics: empty, url: null, tags: {} };
    return {
      metrics: {
        bestValLoss: numberOrNull(run.metrics.best_val_loss),
        bestValAcc: numberOrNull(run.metrics.best_val_acc),
        testAccuracy: numberOrNull(run.metrics.test_accuracy),
        testF1Macro: numberOrNull(run.metrics.test_f1_macro),
      },
      url: `${env.MLFLOW_UI_URL}/#/experiments/${run.experimentId}/runs/${run.runId}`,
      tags: run.tags,
    };
  } catch {
    // MLflow caído no impide listar lo publicado; solo faltan métricas y enlace.
    return { metrics: empty, url: null, tags: {} };
  }
}

async function registryBySemver(): Promise<Map<string, NormalizedModelVersion>> {
  try {
    const versions = await searchModelVersions(`name='${MODEL_NAME}'`);
    return new Map(versions.filter((v) => v.tags.semver).map((v) => [v.tags.semver, v]));
  } catch {
    return new Map();
  }
}

export async function toModelVersionInfo(
  row: PublishedModelRow,
  store: S3Store | null,
  registry: Map<string, NormalizedModelVersion>,
): Promise<ModelVersionInfo> {
  const [publication, run, hasModelCard] = await Promise.all([
    store
      ? checkPublication(store, row.version)
      : Promise.resolve<ModelPublication>({
          status: "unverified",
          missingFiles: [],
          checkedAt: new Date().toISOString(),
          message: "Bucket de modelos sin configurar (S3_BUCKET o MODELS_S3_USE_MINIO)",
          envComplete: false,
          envFiles: [],
        }),
    runDetails(row.runId),
    store
      ? objectExists(store, modelKey(row.version, MODEL_CARD_FILE)).catch(() => false)
      : Promise.resolve(false),
  ]);
  const reg = registry.get(row.version);
  return {
    name: row.name,
    version: row.version,
    stage: reg?.stage ?? null,
    status: reg?.status ?? null,
    runId: row.runId,
    s3Key: row.s3Key,
    weightsSha256: row.sha256,
    creationTimestamp: reg?.creationTimestamp ?? null,
    lastUpdatedTimestamp: reg?.lastUpdatedTimestamp ?? null,
    description: reg?.description ?? null,
    dvcRelease: row.dvcRelease ?? run.tags.dvc_release ?? null,
    s3Bucket: store?.bucket ?? null,
    s3Uri: store ? modelUri(store.bucket, row.version, row.name) : null,
    publishedAt: row.createdAt.toISOString(),
    publication,
    files: publication.status === "published" ? [...MODEL_PACKAGE_FILES] : [],
    hasModelCard,
    mlflowRunUrl: run.url,
    metrics: run.metrics,
  };
}

function tryModelStore(): S3Store | null {
  try {
    return modelStore();
  } catch {
    return null;
  }
}

/** Todas las versiones publicadas, la más reciente primero. */
export async function listPublishedModels(): Promise<ModelVersionInfo[]> {
  const rows = await readPublishedRows();
  if (rows.length === 0) return [];
  const [registry, store] = [await registryBySemver(), tryModelStore()];
  return Promise.all(rows.map((row) => toModelVersionInfo(row, store, registry)));
}
