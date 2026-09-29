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
