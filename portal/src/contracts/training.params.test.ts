import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrainingJobSchema, trainingParamsSchema } from "./training";

/**
 * P1-2 — Ningún parámetro aceptado por la API se ignora.
 * El contrato es estricto (un campo desconocido es 400) y sus 17 campos son exactamente
 * los que aplica el worker (`TRAINER_FIELDS` en worker.py).
 */

const PARAMS = [
  "aug_seed",
  "batch_size",
  "dropout",
  "hidden_layers",
  "img_size",
  "init_seed",
  "lr",
  "max_epochs",
  "min_delta",
  "momentum",
  "monitor",
  "optimizer",
  "patience",
  "pretrained",
  "shuffle_seed",
  "trainable_backbone",
  "weight_decay",
];

describe("P1-2: contrato de parámetros", () => {
  it("define exactamente los 17 parámetros que aplica el worker", () => {
    expect(Object.keys(trainingParamsSchema.shape).sort()).toEqual(PARAMS);
  });

  it("worker.py declara cada uno de esos parámetros en TRAINER_FIELDS", () => {
    const worker = readFileSync(resolve(__dirname, "../../../worker.py"), "utf-8");
    const block = worker.slice(worker.indexOf("TRAINER_FIELDS = ("));
    const fields = block.slice(0, block.indexOf(")"));
    for (const name of PARAMS) {
      expect(fields, `worker.py no propaga ${name}`).toContain(`"${name}"`);
    }
  });

  it("rechaza un campo que el entrenador no soporta", () => {
    const result = createTrainingJobSchema.safeParse({ release: "r", label_smoothing: 0.1 });
    expect(result.success).toBe(false);
  });

  it("acepta y conserva los parámetros de early stopping y backbone", () => {
    const parsed = createTrainingJobSchema.parse({
      release: "r",
      monitor: "val_acc",
      patience: 1,
      min_delta: 0.5,
      trainable_backbone: "none",
    });
    expect(parsed).toMatchObject({
      monitor: "val_acc",
      patience: 1,
      min_delta: 0.5,
      trainable_backbone: "none",
    });
  });
});
