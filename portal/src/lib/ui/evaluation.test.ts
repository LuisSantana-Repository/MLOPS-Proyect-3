import { describe, expect, it } from "vitest";
import type { ModelVersionInfo, TestPrediction } from "@/contracts";
import {
  chooseDefaultModel,
  cropUrl,
  filterErrors,
  formatPercent,
  heatmapRows,
  isWinner,
  modelKey,
} from "./evaluation";

const WINNER_RUN = "fe32e1388dbd465cae714a69bf80f685";

function model(
  version: string,
  created: number | null,
  options: { runId?: string; status?: string; name?: string } = {},
): ModelVersionInfo {
  return {
    name: options.name ?? "clasificador",
    version,
    stage: null,
    status: options.status ?? "READY",
    runId: options.runId ?? `run-${version}`,
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

describe("modelKey e isWinner", () => {
  it("modelKey usa la forma nombre:version del endpoint", () => {
    expect(modelKey(model("3", 1))).toBe("clasificador:3");
  });

  it("isWinner compara con el run de selection.json", () => {
    expect(isWinner(WINNER_RUN, WINNER_RUN)).toBe(true);
    expect(isWinner("otro", WINNER_RUN)).toBe(false);
    expect(isWinner(null, WINNER_RUN)).toBe(false);
    expect(isWinner(WINNER_RUN, null)).toBe(false);
  });
});

describe("chooseDefaultModel", () => {
  it("el default elige el ganador aunque haya una versión más nueva", () => {
    const models = [model("1", 100, { runId: WINNER_RUN }), model("2", 200, { runId: "reentreno" })];
    expect(chooseDefaultModel(models, WINNER_RUN, null)).toEqual({
      key: "clasificador:1",
      reason: "winner",
      winnerKey: "clasificador:1",
      newerNonWinnerKey: "clasificador:2",
    });
  });

  it("sin aviso si la versión más reciente es la ganadora", () => {
    const models = [model("1", 100), model("2", 200, { runId: WINNER_RUN })];
    const choice = chooseDefaultModel(models, WINNER_RUN, null);
    expect(choice.key).toBe("clasificador:2");
    expect(choice.newerNonWinnerKey).toBeNull();
  });

  it("si el run ganador tiene varias versiones registradas, usa la más reciente de ellas", () => {
    const models = [model("1", 100, { runId: WINNER_RUN }), model("4", 400, { runId: WINNER_RUN })];
    expect(chooseDefaultModel(models, WINNER_RUN, null).key).toBe("clasificador:4");
  });

  it("sin selección, se usa la más reciente en READY", () => {
    const models = [model("2", 200), model("3", 300, { status: "PENDING_REGISTRATION" }), model("1", 100)];
    expect(chooseDefaultModel(models, null, null)).toEqual({
      key: "clasificador:2",
      reason: "latest-ready",
      winnerKey: null,
      newerNonWinnerKey: null,
    });
  });

  it("si el ganador no está registrado, también usa la más reciente en READY", () => {
    const choice = chooseDefaultModel([model("1", 100), model("2", 200)], WINNER_RUN, null);
    expect(choice).toMatchObject({ key: "clasificador:2", reason: "latest-ready", winnerKey: null });
  });

  it("sin fechas, ordena por la versión numérica más alta", () => {
    const models = [model("2", null), model("10", null), model("9", null)];
    expect(chooseDefaultModel(models, null, null).key).toBe("clasificador:10");
  });

  it("?model= tiene prioridad sobre el default", () => {
    const models = [model("1", 100, { runId: WINNER_RUN }), model("2", 200)];
    expect(chooseDefaultModel(models, WINNER_RUN, " clasificador:2 ")).toEqual({
      key: "clasificador:2",
      reason: "requested",
      winnerKey: "clasificador:1",
      newerNonWinnerKey: "clasificador:2",
    });
  });

  it("sin ganador ni versiones READY no elige nada", () => {
    const choice = chooseDefaultModel([model("1", 100, { status: "FAILED_REGISTRATION" })], null, null);
    expect(choice).toMatchObject({ key: null, reason: "none" });
    expect(chooseDefaultModel([], null, null).reason).toBe("none");
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
    expect(filterErrors(errors, { yTrue: "car", yPred: "" }).map((e) => e.annId)).toEqual(["2", "3"]);
    expect(filterErrors(errors, { yTrue: "", yPred: "person" }).map((e) => e.annId)).toEqual(["2"]);
    expect(filterErrors(errors, { yTrue: "car", yPred: "dog" }).map((e) => e.annId)).toEqual(["3"]);
  });
});
