import { describe, expect, it } from "vitest";
import type { ExperimentRun } from "@/contracts";
import { cellValue, formatCell, nextSort, sortRuns } from "./runs";

function run(
  id: string,
  params: Record<string, string>,
  metrics: Record<string, number>,
): ExperimentRun {
  return {
    runId: id,
    runName: `run-${id}`,
    experimentId: "1",
    status: "FINISHED",
    startTime: null,
    endTime: null,
    params,
    metrics,
    tags: {},
  };
}

const runs = [
  run("a", { lr: "0.01", optimizer: "sgd" }, { best_val_loss: 0.06 }),
  run("b", { lr: "0.001", optimizer: "adamw" }, { best_val_loss: 0.046 }),
  run("c", { lr: "0.0003", optimizer: "adamw" }, {}),
];

describe("sortRuns", () => {
  it("ordena métricas numéricamente y deja faltantes al final", () => {
    expect(sortRuns(runs, "metric:best_val_loss", "asc").map((r) => r.runId)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortRuns(runs, "metric:best_val_loss", "desc").map((r) => r.runId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ordena parámetros como números aunque MLflow los guarde como texto", () => {
    expect(sortRuns(runs, "param:lr", "asc").map((r) => r.runId)).toEqual(["c", "b", "a"]);
  });

  it("es estable con empates", () => {
    expect(sortRuns(runs, "param:optimizer", "asc").map((r) => r.runId)).toEqual(["b", "c", "a"]);
  });

  it("no modifica el arreglo original", () => {
    sortRuns(runs, "param:lr", "asc");
    expect(runs.map((r) => r.runId)).toEqual(["a", "b", "c"]);
  });
});

describe("helpers", () => {
  it("cellValue usa runId si no hay nombre", () => {
    expect(cellValue({ ...runs[0], runName: null }, "runName")).toBe("a");
  });

  it("nextSort alterna asc/desc en la misma columna", () => {
    const s = nextSort({ key: "param:lr", dir: "asc" }, "param:lr");
    expect(s).toEqual({ key: "param:lr", dir: "desc" });
    expect(nextSort(s, "runName")).toEqual({ key: "runName", dir: "asc" });
  });

  it("formatCell", () => {
    expect(formatCell(0.977777, "metric:best_val_acc")).toBe("97.8%");
    expect(formatCell(0.0463251, "metric:best_val_loss")).toBe("0.0463");
    expect(formatCell(null, "param:lr")).toBe("—");
  });
});
