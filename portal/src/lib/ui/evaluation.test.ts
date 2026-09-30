import { describe, expect, it } from "vitest";
import type { ModelVersionInfo, TestPrediction } from "@/contracts";
import {
  cropUrl,
  filterErrors,
  formatPercent,
  heatmapRows,
  modelKey,
  pickDefaultModel,
} from "./evaluation";

function model(version: string, created: number | null, name = "clasificador"): ModelVersionInfo {
  return {
    name,
    version,
    stage: null,
    status: "READY",
    runId: `run-${version}`,
    s3Key: null,
    weightsSha256: null,
    creationTimestamp: created,
    lastUpdatedTimestamp: created,
    description: null,
  };
}

function err(annId: string, yTrue: string, yPred: string): TestPrediction {
  return {
    cropPath: `crops/${annId}_${annId}.jpg`,
    annId,
    imageId: annId,
    yTrue,
    yPred,
    confidence: 0.8,
    probabilities: { [yPred]: 0.8, [yTrue]: 0.2 },
  };
}

describe("modelos", () => {
  it("modelKey usa la forma nombre:version del endpoint", () => {
    expect(modelKey(model("3", 1))).toBe("clasificador:3");
  });

  it("por defecto elige la versión publicada más reciente", () => {
    expect(pickDefaultModel([model("1", 100), model("3", 300), model("2", 200)])).toBe(
      "clasificador:3",
    );
  });

  it("sin fechas, la versión numérica más alta", () => {
    expect(pickDefaultModel([model("2", null), model("10", null), model("9", null)])).toBe(
      "clasificador:10",
    );
  });

  it("sin modelos -> null", () => {
    expect(pickDefaultModel([])).toBeNull();
  });
});

describe("formato y rutas", () => {
  it("formatPercent", () => {
    expect(formatPercent(0.97777)).toBe("97.8%");
    expect(formatPercent(1, 0)).toBe("100%");
  });

  it("cropUrl apunta a /api/crops con cada segmento codificado", () => {
    expect(cropUrl("crops/12_345.jpg")).toBe("/api/crops/crops/12_345.jpg");
    expect(cropUrl("crops/a b.jpg")).toBe("/api/crops/crops/a%20b.jpg");
  });
});

describe("heatmapRows", () => {
  it("proporción por fila real y marca la diagonal", () => {
    const rows = heatmapRows({
      labels: ["person", "car"],
      matrix: [
        [8, 2],
        [0, 0],
      ],
    });
    expect(rows[0]).toMatchObject({ label: "person", total: 10 });
    expect(rows[0].cells).toEqual([
      { predicted: "person", value: 8, share: 0.8, correct: true },
      { predicted: "car", value: 2, share: 0.2, correct: false },
    ]);
    expect(rows[1].cells.every((c) => c.share === 0)).toBe(true); // fila vacía, sin NaN
  });
});

describe("filterErrors", () => {
  const errors = [err("1", "person", "car"), err("2", "car", "person"), err("3", "car", "dog")];

  it("sin filtros devuelve todos", () => {
    expect(filterErrors(errors, { yTrue: "", yPred: "" })).toHaveLength(3);
  });

  it("filtra por clase real, predicha o ambas", () => {
    expect(filterErrors(errors, { yTrue: "car", yPred: "" }).map((e) => e.annId)).toEqual([
      "2",
      "3",
    ]);
    expect(filterErrors(errors, { yTrue: "", yPred: "person" }).map((e) => e.annId)).toEqual(["2"]);
    expect(filterErrors(errors, { yTrue: "car", yPred: "dog" }).map((e) => e.annId)).toEqual(["3"]);
  });
});
