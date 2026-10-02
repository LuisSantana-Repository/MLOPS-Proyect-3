import { json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { CreateTrainingJobParams, JobLogEntry, JobStatus } from "@/contracts";
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
