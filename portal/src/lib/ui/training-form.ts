import { z } from "zod";
import {
  type CreateTrainingJobInput,
  createTrainingJobSchema,
  MONITORS,
  OPTIMIZERS,
  TRAINABLE_BACKBONES,
} from "@/contracts";

/**
 * Estado y validación del formulario de /training.
 *
 * Los inputs HTML son texto: aquí se convierten a números y listas y se validan
 * con **el mismo** `createTrainingJobSchema` que usa POST /api/training/jobs, así
 * el formulario no puede aceptar algo que el backend rechace (ni al revés).
 */

export const FORM_FIELDS = [
  "optimizer",
  "batch_size",
  "max_epochs",
  "lr",
  "img_size",
  "hidden_layers",
  "dropout",
  "shuffle_seed",
  "aug_seed",
  "init_seed",
  "monitor",
  "patience",
  "min_delta",
  "trainable_backbone",
  "weight_decay",
] as const;

export type FormField = (typeof FORM_FIELDS)[number];
export type FormValues = Record<FormField, string>;
export type FieldErrors = Partial<Record<FormField | "release" | "form", string>>;

export const FIELD_LABELS: Record<FormField, string> = {
  optimizer: "Optimizador",
  batch_size: "Batch size",
  max_epochs: "Épocas máximas",
  lr: "Learning rate",
  img_size: "Tamaño de imagen (px)",
  hidden_layers: "Capas ocultas",
  dropout: "Dropout",
  shuffle_seed: "Semilla de shuffle",
  aug_seed: "Semilla de augmentation",
  init_seed: "Semilla de inicialización",
  monitor: "Métrica vigilada",
  patience: "Patience (épocas sin mejora)",
  min_delta: "Mejora mínima (min_delta)",
  trainable_backbone: "Backbone entrenable",
  weight_decay: "Weight decay",
};

export const OPTIMIZER_OPTIONS = OPTIMIZERS;
export const MONITOR_OPTIONS = MONITORS;
export const BACKBONE_OPTIONS = TRAINABLE_BACKBONES;

/** Valores iniciales = defaults del schema (baseline de T05). */
export function defaultFormValues(): FormValues {
  const d = createTrainingJobSchema.parse({ release: "x" });
  return {
    optimizer: d.optimizer,
    batch_size: String(d.batch_size),
    max_epochs: String(d.max_epochs),
    lr: String(d.lr),
    img_size: String(d.img_size),
    hidden_layers: d.hidden_layers.join(", "),
    dropout: String(d.dropout),
    shuffle_seed: String(d.shuffle_seed),
    aug_seed: String(d.aug_seed),
    init_seed: String(d.init_seed),
    monitor: d.monitor,
    patience: String(d.patience),
    min_delta: String(d.min_delta),
    trainable_backbone: d.trainable_backbone,
    weight_decay: String(d.weight_decay),
  };
}

/** "256, 128" → [256, 128]; "" → [] (cabeza lineal). Texto no numérico → NaN para que Zod lo rechace. */
export function parseHiddenLayers(text: string): number[] {
  const parts = text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? Number(p) : Number.NaN));
}

function toNumber(text: string): number {
  const t = text.trim();
  return t === "" ? Number.NaN : Number(t);
}

/** Convierte el texto del formulario en el cuerpo de POST /api/training/jobs. */
export function toRequestBody(release: string, values: FormValues): CreateTrainingJobInput {
  return {
    release,
    optimizer: values.optimizer as (typeof OPTIMIZERS)[number],
    batch_size: toNumber(values.batch_size),
    max_epochs: toNumber(values.max_epochs),
    lr: toNumber(values.lr),
    img_size: toNumber(values.img_size),
    hidden_layers: parseHiddenLayers(values.hidden_layers),
    dropout: toNumber(values.dropout),
    shuffle_seed: toNumber(values.shuffle_seed),
    aug_seed: toNumber(values.aug_seed),
    init_seed: toNumber(values.init_seed),
    monitor: values.monitor as (typeof MONITORS)[number],
    patience: toNumber(values.patience),
    min_delta: toNumber(values.min_delta),
    trainable_backbone: values.trainable_backbone as (typeof TRAINABLE_BACKBONES)[number],
    weight_decay: toNumber(values.weight_decay),
  };
}

export type ValidationResult =
  | { ok: true; body: CreateTrainingJobInput }
  | { ok: false; errors: FieldErrors };

/** Valida con el schema del backend y devuelve un error legible por campo. */
export function validateTrainingForm(release: string, values: FormValues): ValidationResult {
  const body = toRequestBody(release, values);
  const result = createTrainingJobSchema.safeParse(body);
  if (result.success) return { ok: true, body };
  return { ok: false, errors: fieldErrorsFrom(z.flattenError(result.error).fieldErrors) };
}

/** Errores por campo de Zod (o de `details` de la API) → primer mensaje de cada campo. */
export function fieldErrorsFrom(
  details: Record<string, string[] | undefined> | undefined,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, messages] of Object.entries(details ?? {})) {
    if (!messages?.length) continue;
    const key =
      (FORM_FIELDS as readonly string[]).includes(field) || field === "release" ? field : "form";
    errors[key as keyof FieldErrors] ??= messages[0];
  }
  return errors;
}
