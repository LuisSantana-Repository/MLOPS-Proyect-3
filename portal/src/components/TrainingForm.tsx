"use client";

import { type FormEvent, useState } from "react";
import type { CreateTrainingJobResponse } from "@/contracts";
import { ApiClientError, errorMessage, fetchJson } from "@/lib/ui/api-client";
import {
  BACKBONE_OPTIONS,
  defaultFormValues,
  FIELD_LABELS,
  type FieldErrors,
  type FormField,
  type FormValues,
  fieldErrorsFrom,
  MONITOR_OPTIONS,
  OPTIMIZER_OPTIONS,
  validateTrainingForm,
} from "@/lib/ui/training-form";

const HINTS: Partial<Record<FormField, string>> = {
  hidden_layers: "Separadas por coma, p. ej. 512, 128. Vacío = cabeza lineal.",
  lr: "Mayor que 0 y hasta 1.",
  dropout: "De 0 a menos de 1.",
  monitor: "Decide la mejor época y cuándo parar.",
  patience: "De 1 a 100.",
  min_delta: "0 o más: cuánto debe mejorar la métrica para contar.",
  trainable_backbone: "none = solo la cabeza; layer4 = último bloque; all = todo.",
  weight_decay: "De 0 a 1.",
};

const HYPERPARAMS: FormField[] = [
  "batch_size",
  "max_epochs",
  "lr",
  "img_size",
  "hidden_layers",
  "dropout",
];
const SEEDS: FormField[] = ["shuffle_seed", "aug_seed", "init_seed"];
const EARLY_STOPPING: FormField[] = ["patience", "min_delta"];

/** Formulario de parámetros validado con el mismo schema Zod del backend. */
export function TrainingForm({
  release,
  onLaunched,
}: {
  release: string | null;
  onLaunched: (job: CreateTrainingJobResponse) => void;
}) {
  const [values, setValues] = useState<FormValues>(defaultFormValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (field: FormField) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateTrainingForm(release ?? "", values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const job = await fetchJson<CreateTrainingJobResponse>("/api/training/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      });
      onLaunched(job);
    } catch (err) {
      const fieldErrors = err instanceof ApiClientError ? fieldErrorsFrom(err.details) : {};
      setErrors({ ...fieldErrors, form: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const input = (field: FormField) => (
    <div key={field} className={`field${errors[field] ? " invalid" : ""}`}>
      <label htmlFor={field}>{FIELD_LABELS[field]}</label>
      <input
        id={field}
        name={field}
        value={values[field]}
        inputMode={field === "hidden_layers" ? "text" : "decimal"}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={`${field}-help`}
        onChange={(e) => set(field)(e.target.value)}
      />
      <small id={`${field}-help`}>{errors[field] ?? HINTS[field] ?? ""}</small>
    </div>
  );

  const select = (field: FormField, options: readonly string[]) => (
    <div key={field} className={`field${errors[field] ? " invalid" : ""}`}>
      <label htmlFor={field}>{FIELD_LABELS[field]}</label>
      <select
        id={field}
        name={field}
        value={values[field]}
        aria-describedby={`${field}-help`}
        onChange={(e) => set(field)(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <small id={`${field}-help`}>{errors[field] ?? HINTS[field] ?? ""}</small>
    </div>
  );

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>2. Parámetros</h2>
      <div className="grid">
        {select("optimizer", OPTIMIZER_OPTIONS)}
        {HYPERPARAMS.map(input)}
        {input("weight_decay")}
      </div>
      <h3>Early stopping</h3>
      <div className="grid">
        {select("monitor", MONITOR_OPTIONS)}
        {EARLY_STOPPING.map(input)}
      </div>
      <h3>Modelo</h3>
      <div className="grid">{select("trainable_backbone", BACKBONE_OPTIONS)}</div>
      <h3>Semillas</h3>
      <div className="grid">{SEEDS.map(input)}</div>

      {errors.release ? <p className="error-text">{errors.release}</p> : null}
      {errors.form ? (
        <p className="error-text" role="alert">
          {errors.form}
        </p>
      ) : null}

      <div className="actions">
        <button type="submit" disabled={submitting || !release}>
          {submitting ? "Lanzando…" : "Lanzar entrenamiento"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setValues(defaultFormValues());
            setErrors({});
          }}
        >
          Restaurar baseline
        </button>
      </div>
    </form>
  );
}
