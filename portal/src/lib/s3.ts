import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { ApiError, upstreamError } from "@/lib/http";

/**
 * Acceso a S3 desde el portal (T13). Dos almacenes:
 *
 * - **Modelos** (`modelStore`): el bucket donde T10 publica `models/<name>/<version>/`.
 *   AWS real por defecto; MinIO con `MODELS_S3_USE_MINIO=1`, igual que `serving/storage.py`.
 * - **Imágenes de anotación** (`annotationStore`): MinIO del stack; ahí se guardan las
 *   imágenes que se suben desde /inference para poder enviarlas a la cola.
 */

export interface S3Store {
  client: S3Client;
  bucket: string;
  /** Descripción legible (`s3://bucket` o `minio://bucket`) para mensajes. */
  label: string;
}

const MODEL_NAME = "clasificador";

/**
 * Archivos mínimos que toda versión publicada tiene, incluida la 1.0.0 congelada
 * (serving/storage.py::REQUIRED_PACKAGE_FILES). La verificación de "published" usa
 * estos: un paquete sin ellos nunca se muestra como publicado.
 */
export const MODEL_PACKAGE_FILES = [
  "weights.pt",
  "classes.json",
  "preprocess.json",
  "summary.json",
] as const;

/**
 * Archivos de entorno del paquete completo (T16/5.1, serving/storage.py::ENV_PACKAGE_FILES).
 * Las versiones nuevas los incluyen; la 1.0.0 congelada no, y por eso NO entran en el
 * criterio de "published" sino en el reporte de completitud del entorno.
 */
export const MODEL_ENV_FILES = ["config.json", "env.json", "requirements.lock"] as const;

/** Tarjeta del modelo en Markdown (T15); opcional en el paquete. */
export const MODEL_CARD_FILE = "model_card.md";

export function modelKey(version: string, file: string, name = MODEL_NAME): string {
  return `models/${name}/${version}/${file}`;
}

export function modelUri(bucket: string, version: string, name = MODEL_NAME): string {
  return `s3://${bucket}/models/${name}/${version}`;
}

const globalForS3 = globalThis as unknown as {
  __modelStore?: S3Store;
  __annotationStore?: S3Store;
  __annotationBucketReady?: Promise<void>;
};

function credentials(id?: string, secret?: string) {
  return id && secret ? { accessKeyId: id, secretAccessKey: secret } : undefined;
}

/** Bucket de modelos publicados; error claro si falta configuración. */
export function modelStore(): S3Store {
  if (globalForS3.__modelStore) return globalForS3.__modelStore;
  let store: S3Store;
  if (env.MODELS_S3_USE_MINIO) {
    const bucket = env.MODELS_S3_BUCKET ?? "mlflow";
    store = {
      bucket,
      label: `minio://${bucket}`,
      client: new S3Client({
        region: "us-east-1",
        endpoint: env.MODELS_S3_ENDPOINT_URL ?? env.MINIO_ENDPOINT,
        forcePathStyle: true,
        credentials: credentials(env.MINIO_ACCESS_KEY, env.MINIO_SECRET_KEY),
      }),
    };
  } else {
    if (!env.MODELS_S3_BUCKET) {
      throw new ApiError(
        500,
        "config_error",
        "Falta S3_BUCKET (o MODELS_S3_BUCKET) para leer los modelos publicados; " +
          "usa MODELS_S3_USE_MINIO=1 para probar contra MinIO",
      );
    }
    store = {
      bucket: env.MODELS_S3_BUCKET,
      label: `s3://${env.MODELS_S3_BUCKET}`,
      client: new S3Client({
        region: env.MODELS_AWS_REGION,
        endpoint: env.MODELS_S3_ENDPOINT_URL,
        credentials: credentials(env.MODELS_AWS_ACCESS_KEY_ID, env.MODELS_AWS_SECRET_ACCESS_KEY),
      }),
    };
  }
  globalForS3.__modelStore = store;
  return store;
}

/** Bucket de MinIO para las imágenes subidas desde /inference. */
export function annotationStore(): S3Store {
  globalForS3.__annotationStore ??= {
    bucket: env.ANNOTATION_BUCKET,
    label: `minio://${env.ANNOTATION_BUCKET}`,
    client: new S3Client({
      region: "us-east-1",
      endpoint: env.MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: credentials(env.MINIO_ACCESS_KEY, env.MINIO_SECRET_KEY),
    }),
  };
  return globalForS3.__annotationStore;
}

function errorName(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (e.$metadata?.httpStatusCode === 404) return "NotFound";
    return e.name ?? e.Code ?? "Error";
  }
  return "Error";
}

function isNotFound(err: unknown): boolean {
  return ["NotFound", "NoSuchKey", "NoSuchBucket"].includes(errorName(err));
}

function wrap(store: S3Store, action: string, err: unknown): ApiError {
  const detail = err instanceof Error ? err.message : String(err);
  return upstreamError(`No se pudo ${action} en ${store.label}: ${detail}`);
}

/** true si el objeto existe; false si no; ApiError 502 si S3 no responde. */
export async function objectExists(store: S3Store, key: string): Promise<boolean> {
  try {
    await store.client.send(new HeadObjectCommand({ Bucket: store.bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw wrap(store, `consultar ${key}`, err);
  }
}

/** Contenido de un objeto como bytes, o null si no existe. */
export async function getObjectBytes(store: S3Store, key: string): Promise<Uint8Array | null> {
  try {
    const out = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: key }));
    return out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw wrap(store, `leer ${key}`, err);
  }
}

export async function putObject(
  store: S3Store,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await store.client.send(
      new PutObjectCommand({
        Bucket: store.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    throw wrap(store, `guardar ${key}`, err);
  }
}

/** URL firmada de descarga (válida unos minutos) para un objeto existente. */
export async function presignedGetUrl(
  store: S3Store,
  key: string,
  filename: string,
  expiresInSeconds = 300,
): Promise<string> {
  try {
    return await getSignedUrl(
      store.client,
      new GetObjectCommand({
        Bucket: store.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
  } catch (err) {
    throw wrap(store, `firmar la descarga de ${key}`, err);
  }
}

/** Crea el bucket de anotación la primera vez que se usa (el compose solo crea el de MLflow). */
export function ensureAnnotationBucket(store: S3Store = annotationStore()): Promise<void> {
  globalForS3.__annotationBucketReady ??= (async () => {
    try {
      await store.client.send(new HeadBucketCommand({ Bucket: store.bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw wrap(store, "consultar el bucket", err);
      try {
        await store.client.send(new CreateBucketCommand({ Bucket: store.bucket }));
      } catch (createErr) {
        if (errorName(createErr) !== "BucketAlreadyOwnedByYou") {
          throw wrap(store, "crear el bucket", createErr);
        }
      }
    }
  })().catch((err) => {
    globalForS3.__annotationBucketReady = undefined; // reintenta en la próxima llamada
    throw err;
  });
  return globalForS3.__annotationBucketReady;
}
