import { beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
vi.mock("@/lib/s3", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
  return { ...actual, getObjectBytes: (...a: unknown[]) => getObjectBytes(...a) };
});

import type { S3Store } from "@/lib/s3";
import { getModelCard, summaryToMarkdown } from "./model-card";

const store = { bucket: "b", label: "s3://b", client: {} } as unknown as S3Store;
const row = {
  name: "clasificador",
  version: "1.0.0",
  runId: "fe32e1388dbd465cae714a69bf80f685",
  dvcRelease: "proyecto2 v1.1.0@dc9376e",
  sha256: "e5aa4f73",
  s3Key: "models/clasificador/1.0.0",
  createdAt: new Date(),
};
const metrics = {
  bestValLoss: 0.0463,
  bestValAcc: 0.9778,
  testAccuracy: 0.9481,
  testF1Macro: 0.9458,
};
const summary = {
  best_epoch: 10,
  stopped_epoch: 15,
  stop_reason: "early_stopping",
  data: {
    classes: ["person", "car"],
    manifest_sha256: "0bdfd6d7",
    counts: { train: { person: 569, car: 375 } },
  },
  model: { arch: { backbone: "resnet18", hidden_layers: [256], dropout: 0.3 } },
};
const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => vi.clearAllMocks());

describe("summaryToMarkdown", () => {
  it("incluye trazabilidad, arquitectura y métricas de validación y test", () => {
    const md = summaryToMarkdown(row, summary, metrics);
    for (const text of [
      "# clasificador 1.0.0",
      row.runId,
      "proyecto2 v1.1.0@dc9376e",
      "0bdfd6d7",
      "resnet18",
      "| person | 569 |",
      "94.81 %",
      "0.0463",
    ]) {
      expect(md).toContain(text);
    }
  });
});

describe("getModelCard", () => {
  it("usa model_card.md cuando está publicado", async () => {
    getObjectBytes.mockImplementation(async (_s: unknown, key: string) =>
      key.endsWith("model_card.md") ? enc("# Tarjeta oficial") : null,
    );
    const card = await getModelCard(store, row, metrics);
    expect(card).toEqual({
      version: "1.0.0",
      source: "model_card.md",
      markdown: "# Tarjeta oficial",
    });
  });

  it("si no, la genera desde summary.json del paquete", async () => {
    getObjectBytes.mockImplementation(async (_s: unknown, key: string) =>
      key.endsWith("summary.json") ? enc(JSON.stringify(summary)) : null,
    );
    const card = await getModelCard(store, row, metrics);
    expect(card.source).toBe("summary.json");
    expect(card.markdown).toContain("Mejor época 10");
    expect(getObjectBytes).toHaveBeenCalledWith(store, "models/clasificador/1.0.0/summary.json");
  });

  it("404 si el paquete no tiene ninguna de las dos", async () => {
    getObjectBytes.mockResolvedValue(null);
    await expect(getModelCard(store, row, metrics)).rejects.toMatchObject({ status: 404 });
  });
});
