import { z } from "zod";

/**
 * Contrato de entrenamiento (T09).
 *
 * Los rangos replican `trainer/config.py::TrainConfig` (Pydantic) para que la
 * validación del portal y la del worker coincidan. Si cambias un límite aquí,
 * cámbialo también allí. El worker consume estos `params` desde la cola Redis
 * `ml_jobs` como `{ id, params }`.
 */

export const MAX_SEED = 2 ** 32 - 1;

export const OPTIMIZERS = ["sgd", "adam", "adamw"] as const;
export const MONITORS = ["val_loss", "val_acc"] as const;
export const TRAINABLE_BACKBONES = ["none", "layer4", "all"] as const;

/** Los 7 hiperparámetros de la rúbrica. */
export const hyperparametersSchema = z.object({
  optimizer: z.enum(OPTIMIZERS).default("adamw"),
  batch_size: z.int().min(1).max(1024).default(32),
  max_epochs: z.int().min(1).max(500).default(30),
  lr: z.number().gt(0).max(1).default(0.001),
  img_size: z.int().min(32).max(512).default(224),
  hidden_layers: z
    .array(z.int().min(1).max(4096))
    .max(4, "hidden_layers admite como máximo 4 capas")
    .default([256]),
  dropout: z.number().min(0).lt(1).default(0.3),
});

/** Semillas separadas para shuffle, augmentation e inicialización. */
export const seedsSchema = z.object({
  shuffle_seed: z.int().min(0).max(MAX_SEED).default(42),
  aug_seed: z.int().min(0).max(MAX_SEED).default(43),
  init_seed: z.int().min(0).max(MAX_SEED).default(44),
});

/**
 * Parámetros de entrenamiento (sin `release`): 7 hiperparámetros, 3 semillas y
 * ajustes secundarios de early stopping y modelo con defaults del baseline.
 * Es lo que se persiste como `params` del job y viaja al worker.
 *
 * El objeto es ESTRICTO: un campo que no esté aquí se rechaza con 400 en vez de
 * aceptarse y perderse. Y todo campo de aquí lo aplica el worker (`TRAINER_FIELDS`
 * en worker.py): ningún parámetro aceptado se ignora (P1-2).
 */
export const trainingParamsSchema = z
  .strictObject({
    monitor: z.enum(MONITORS).default("val_loss"),
    patience: z.int().min(1).max(100).default(5),
    // default 0.0 según configs/train-config.schema.json (fuente de verdad del contrato).
    min_delta: z.number().min(0).default(0),
    pretrained: z.boolean().default(true),
    trainable_backbone: z.enum(TRAINABLE_BACKBONES).default("layer4"),
    momentum: z.number().min(0).lt(1).default(0.9),
    weight_decay: z.number().min(0).max(1).default(0),
  })
  .extend(hyperparametersSchema.shape)
  .extend(seedsSchema.shape);

export type CreateTrainingJobParams = z.output<typeof trainingParamsSchema>;

/**
 * Cuerpo de POST /api/training/jobs.
 *
 * `release` es el tag del release DVC aprobado en el Proyecto 2
 * (p. ej. "proyecto2 v1.1.0@dc9376e"); el resto son los parámetros de arriba.
 */
export const createTrainingJobSchema = trainingParamsSchema.extend({
  release: z.string().trim().min(1, "release es obligatorio (tag del release DVC del Proyecto 2)"),
});

export type CreateTrainingJobInput = z.input<typeof createTrainingJobSchema>;

/** Estados posibles de un job (persistidos en MariaDB vía Drizzle). */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Respuesta de POST /api/training/jobs. */
export interface CreateTrainingJobResponse {
  id: string;
  status: JobStatus;
  release: string;
  params: CreateTrainingJobParams;
  createdAt: string;
}

/** Una línea de log persistida del job. */
export interface JobLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

/** Respuesta de GET /api/training/jobs/[id]. */
export interface TrainingJobResponse {
  id: string;
  status: JobStatus;
  release: string;
  params: CreateTrainingJobParams;
  runId: string | null;
  error: string | null;
  logs: JobLogEntry[];
  createdAt: string;
  updatedAt: string;
}
