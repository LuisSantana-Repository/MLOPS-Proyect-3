import { index, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import type {
  AnnotationStatus,
  CreateTrainingJobParams,
  ImageRef,
  JobLogEntry,
  JobStatus,
} from "@/contracts";
import { JOB_STATUSES } from "@/contracts";

/**
 * Tabla de jobs de entrenamiento (T09).
 *
 * Vive en el mismo MariaDB que usa MLflow como backend store. La cola real la
 * maneja Redis (`ml_jobs`); esta tabla es la fuente de verdad del estado y los
 * logs persistentes que expone GET /api/training/jobs/[id].
 */
export const trainingJobs = mysqlTable("training_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  status: varchar("status", { length: 16 }).$type<JobStatus>().notNull().default(JOB_STATUSES[0]),
  release: varchar("release_tag", { length: 255 }).notNull(),
  params: json("params").$type<CreateTrainingJobParams>().notNull(),
  runId: varchar("run_id", { length: 64 }),
  error: varchar("error", { length: 2048 }),
  logs: json("logs").$type<JobLogEntry[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type TrainingJobRow = typeof trainingJobs.$inferSelect;
export type NewTrainingJobRow = typeof trainingJobs.$inferInsert;

/**
 * Versiones de modelo publicadas (T10).
 *
 * La escribe `publish_model.py` al versionar el run ganador: cada fila liga una
 * versión semántica con su run de origen, el release DVC, la llave S3 (bucket AWS,
 * prefijo `models/clasificador/<version>/`) y el SHA-256 de los pesos. La fuente
 * de verdad del esquema es Drizzle; Python solo inserta.
 *
 * Nota: el nombre es `published_models` (no `model_versions`) porque el backend
 * store de MLflow ya usa una tabla `model_versions` en esta misma base de datos.
 */
export const publishedModels = mysqlTable("published_models", {
  version: varchar("version", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull().default("clasificador"),
  runId: varchar("run_id", { length: 64 }).notNull(),
  dvcRelease: varchar("dvc_release", { length: 255 }),
  s3Key: varchar("s3_key", { length: 512 }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PublishedModelRow = typeof publishedModels.$inferSelect;
export type NewPublishedModelRow = typeof publishedModels.$inferInsert;

/**
 * Cola de anotación (T13).
 *
 * Mismo concepto que las imágenes `pending` del portal del Proyecto 2: imágenes
 * que un anotador debe revisar. Cada fila guarda de dónde viene la imagen (subida
 * a MinIO o recorte de T03), la versión de modelo que la clasificó y su sugerencia.
 */
export const annotationQueue = mysqlTable(
  "annotation_queue",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    status: varchar("status", { length: 16 })
      .$type<AnnotationStatus>()
      .notNull()
      .default("pending"),
    imageKind: varchar("image_kind", { length: 16 }).$type<ImageRef["kind"]>().notNull(),
    /** Llave en el bucket de MinIO (subidas) o `crop_path` de T03 (recortes). */
    imageKey: varchar("image_key", { length: 512 }).notNull(),
    imageSha256: varchar("image_sha256", { length: 64 }),
    imageContentType: varchar("image_content_type", { length: 32 }),
    modelVersion: varchar("model_version", { length: 32 }).notNull(),
    suggestedClass: varchar("suggested_class", { length: 128 }).notNull(),
    probabilities: json("probabilities").$type<Record<string, number>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("annotation_queue_status_idx").on(table.status),
    index("annotation_queue_created_at_idx").on(table.createdAt),
  ],
);

export type AnnotationQueueRow = typeof annotationQueue.$inferSelect;
export type NewAnnotationQueueRow = typeof annotationQueue.$inferInsert;
