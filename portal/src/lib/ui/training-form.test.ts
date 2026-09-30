import { describe, expect, it } from "vitest";
import { createTrainingJobSchema } from "@/contracts";
import {
  defaultFormValues,
  FORM_FIELDS,
  fieldErrorsFrom,
  parseHiddenLayers,
  toRequestBody,
  validateTrainingForm,
} from "./training-form";

const RELEASE = "proyecto2 v1.1.0@dc9376e";

describe("defaultFormValues", () => {
  it("usa los defaults del schema del backend", () => {
    const v = defaultFormValues();
    expect(v).toMatchObject({
      optimizer: "adamw",
      batch_size: "32",
      lr: "0.001",
      hidden_layers: "256",
    });
    expect(Object.keys(v).sort()).toEqual([...FORM_FIELDS].sort());
  });

  it("los defaults son válidos para el backend", () => {
    const body = toRequestBody(RELEASE, defaultFormValues());
    expect(createTrainingJobSchema.safeParse(body).success).toBe(true);
  });
});

describe("parseHiddenLayers", () => {
  it("acepta comas y espacios", () => {
    expect(parseHiddenLayers("512, 128")).toEqual([512, 128]);
    expect(parseHiddenLayers("512 128")).toEqual([512, 128]);
  });

  it("vacío es cabeza lineal", () => {
    expect(parseHiddenLayers("  ")).toEqual([]);
  });

  it("texto no numérico queda como NaN para que Zod lo rechace", () => {
    expect(parseHiddenLayers("256, abc")[1]).toBeNaN();
  });
});

describe("validateTrainingForm", () => {
  it("acepta el formulario por defecto", () => {
    const r = validateTrainingForm(RELEASE, defaultFormValues());
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.body).toMatchObject({ release: RELEASE, batch_size: 32, hidden_layers: [256] });
  });

  it("rechaza lo mismo que el backend: lr fuera de rango, batch decimal, 5 capas", () => {
    const r = validateTrainingForm(RELEASE, {
      ...defaultFormValues(),
      lr: "2",
      batch_size: "3.5",
      hidden_layers: "8,8,8,8,8",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["batch_size", "hidden_layers", "lr"]);
    }
  });

  it("campo vacío es un error, no un 0", () => {
    const r = validateTrainingForm(RELEASE, { ...defaultFormValues(), dropout: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.dropout).toBeTruthy();
  });

  it("exige release", () => {
    const r = validateTrainingForm("  ", defaultFormValues());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.release).toMatch(/release/);
  });
});

describe("fieldErrorsFrom", () => {
  it("mapea details de la API a campos y el resto a 'form'", () => {
    expect(fieldErrorsFrom({ lr: ["a", "b"], momentum: ["c"] })).toEqual({ lr: "a", form: "c" });
  });
});
