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

/**
 * Los defaults del portal son la línea base (configs/baseline.yaml), con la que se
 * corrieron las 10 corridas de T07. Como el worker ya aplica todos los parámetros, un
 * default distinto cambiaría el entrenamiento: un job con el formulario por defecto debe
 * reproducir la línea base.
 */
describe("P1-2: defaults = línea base", () => {
  const baseline = readFileSync(resolve(__dirname, "../../../configs/baseline.yaml"), "utf-8");
  const fromBaseline = (name: string): string | null =>
    baseline.match(new RegExp(`^${name}:\\s*([^#\\n]+)`, "m"))?.[1].trim() ?? null;

  it("cada parámetro que fija baseline.yaml tiene el mismo valor por defecto en el portal", () => {
    const defaults = trainingParamsSchema.parse({}) as Record<string, unknown>;
    const compared: string[] = [];
    for (const name of PARAMS) {
      const expected = fromBaseline(name);
      if (expected === null) continue; // baseline.yaml no lo fija: vale el default del entrenador
      const actual = Array.isArray(defaults[name])
        ? `[${(defaults[name] as number[]).join(", ")}]`
        : String(defaults[name]);
      expect(actual, `default de ${name}`).toBe(expected);
      compared.push(name);
    }
    expect(compared).toEqual(
      expect.arrayContaining(["min_delta", "monitor", "patience", "trainable_backbone", "lr"]),
    );
  });

  it("min_delta por defecto es 0.001, el de las corridas de T07", () => {
    expect(createTrainingJobSchema.parse({ release: "r" }).min_delta).toBe(0.001);
  });
});
