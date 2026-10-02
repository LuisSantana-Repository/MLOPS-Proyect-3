import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTrainingJobSchema } from "@/contracts";
import { defaultFormValues, toRequestBody, validateTrainingForm } from "@/lib/ui/training-form";
import { TrainingForm } from "./TrainingForm";

/** P1-2 — /training tiene controles de early stopping y de backbone entrenable. */

const RELEASE = "proyecto2 v1.1.0@dc9376e";

describe("P1-2: formulario de /training", () => {
  it("muestra los controles de early stopping, backbone y weight decay", () => {
    const html = renderToStaticMarkup(<TrainingForm release={RELEASE} onLaunched={() => {}} />);
    for (const id of ["monitor", "patience", "min_delta", "trainable_backbone", "weight_decay"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Early stopping");
    expect(html).toContain("Backbone entrenable");
    for (const option of ["val_loss", "val_acc", "none", "layer4", "all"]) {
      expect(html).toContain(`<option value="${option}"`);
    }
  });

  it("los valores iniciales son los defaults del contrato", () => {
    const defaults = createTrainingJobSchema.parse({ release: "x" });
    expect(defaultFormValues()).toMatchObject({
      monitor: defaults.monitor,
      patience: String(defaults.patience),
      min_delta: String(defaults.min_delta),
      trainable_backbone: defaults.trainable_backbone,
      weight_decay: String(defaults.weight_decay),
    });
  });

  it("envía lo que el usuario eligió en esos controles", () => {
    const body = toRequestBody(RELEASE, {
      ...defaultFormValues(),
      monitor: "val_acc",
      patience: "1",
      min_delta: "0.5",
      trainable_backbone: "none",
      weight_decay: "0.01",
    });
    expect(body).toMatchObject({
      monitor: "val_acc",
      patience: 1,
      min_delta: 0.5,
      trainable_backbone: "none",
      weight_decay: 0.01,
    });
  });

  it("valida esos controles con las reglas del backend", () => {
    const result = validateTrainingForm(RELEASE, { ...defaultFormValues(), patience: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.patience).toBeTruthy();
  });
});
