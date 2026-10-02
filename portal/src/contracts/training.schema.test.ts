import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrainingJobSchema } from "./training";

/**
 * Blindaje del contrato: los rangos/enums/defaults de Zod deben coincidir con
 * `configs/train-config.schema.json` (fuente de verdad que exporta el trainer,
 * indicada por el equipo de T06/T07). Si el trainer cambia un límite, este test
 * falla hasta alinear el portal.
 */

// biome-ignore lint/suspicious/noExplicitAny: el JSON Schema es dinámico.
type JsonSchema = { properties: Record<string, any> };

const schemaPath = resolve(__dirname, "../../../configs/train-config.schema.json");
const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf-8")) as JsonSchema;
const props = jsonSchema.properties;

describe("Zod vs configs/train-config.schema.json", () => {
  it("acepta un cuerpo con los defaults del schema JSON y los preserva", () => {
    const parsed = createTrainingJobSchema.parse({ release: "proyecto2 v1.1.0@dc9376e" });
    // Los 7 hiperparámetros toman el default del JSON Schema.
    expect(parsed.optimizer).toBe(props.optimizer.default);
    expect(parsed.batch_size).toBe(props.batch_size.default);
    expect(parsed.max_epochs).toBe(props.max_epochs.default);
    expect(parsed.lr).toBe(props.lr.default);
    expect(parsed.img_size).toBe(props.img_size.default);
    expect(parsed.dropout).toBe(props.dropout.default);
    // Semillas y early stopping.
    expect(parsed.shuffle_seed).toBe(props.shuffle_seed.default);
    expect(parsed.aug_seed).toBe(props.aug_seed.default);
    expect(parsed.init_seed).toBe(props.init_seed.default);
    expect(parsed.monitor).toBe(props.monitor.default);
    expect(parsed.patience).toBe(props.patience.default);
    // min_delta sigue la línea base (configs/baseline.yaml), no el default genérico del
    // JSON Schema: ver "defaults = línea base" en training.params.test.ts.
    expect(parsed.min_delta).toBeGreaterThanOrEqual(props.min_delta.minimum);
  });

  it("comparte los mismos enums que el schema JSON", () => {
    const optimizer = createTrainingJobSchema.parse({
      release: "r",
      optimizer: props.optimizer.enum.at(-1),
    });
    expect(props.optimizer.enum).toContain(optimizer.optimizer);
    expect(props.monitor.enum).toContain("val_loss");
    expect(props.trainable_backbone.enum).toEqual(["none", "layer4", "all"]);
  });

  it("rechaza valores fuera de los límites numéricos del schema JSON", () => {
    // batch_size <= maximum
    expect(
      createTrainingJobSchema.safeParse({ release: "r", batch_size: props.batch_size.maximum + 1 })
        .success,
    ).toBe(false);
    // batch_size >= minimum
    expect(
      createTrainingJobSchema.safeParse({ release: "r", batch_size: props.batch_size.minimum - 1 })
        .success,
    ).toBe(false);
    // lr <= maximum (1) y > 0
    expect(
      createTrainingJobSchema.safeParse({ release: "r", lr: props.lr.maximum + 0.1 }).success,
    ).toBe(false);
    expect(createTrainingJobSchema.safeParse({ release: "r", lr: 0 }).success).toBe(false);
    // img_size dentro de [32, 512]
    expect(
      createTrainingJobSchema.safeParse({ release: "r", img_size: props.img_size.minimum - 1 })
        .success,
    ).toBe(false);
    expect(
      createTrainingJobSchema.safeParse({ release: "r", img_size: props.img_size.maximum + 1 })
        .success,
    ).toBe(false);
  });

  it("respeta maxItems de hidden_layers", () => {
    const tooMany = Array(props.hidden_layers.maxItems + 1).fill(128);
    expect(
      createTrainingJobSchema.safeParse({ release: "r", hidden_layers: tooMany }).success,
    ).toBe(false);
  });
});
