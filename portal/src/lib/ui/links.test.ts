import { describe, expect, it } from "vitest";
import type { ExperimentRun } from "@/contracts";
import {
  evaluationHref,
  experimentsRunHref,
  mlflowRunUrl,
  modelsHref,
  withMlflowRunUrls,
} from "./links";

describe("enlaces entre páginas (T16)", () => {
  it("experimentsRunHref abre las curvas del run", () => {
    expect(experimentsRunHref("fe32e138")).toBe("/experiments?run=fe32e138");
    expect(experimentsRunHref(null)).toBeNull();
  });

  it("evaluationHref usa la forma nombre:versión", () => {
    expect(evaluationHref({ name: "clasificador", version: "1.0.0" })).toBe(
      "/evaluation?model=clasificador%3A1.0.0",
    );
  });

  it("modelsHref abre una versión publicada", () => {
    expect(modelsHref("1.0.0")).toBe("/models?version=1.0.0");
  });

  it("mlflowRunUrl arma el enlace a la UI de MLflow", () => {
    expect(mlflowRunUrl("http://localhost:5000/", "3", "abc")).toBe(
      "http://localhost:5000/#/experiments/3/runs/abc",
    );
    expect(mlflowRunUrl(undefined, "3", "abc")).toBeNull();
    expect(mlflowRunUrl("", "3", "abc")).toBeNull();
  });

  it("withMlflowRunUrls agrega el enlace a cada run sin perder lo demás", () => {
    const run: ExperimentRun = {
      runId: "abc",
      runName: "exp-07",
      experimentId: "1",
      status: "FINISHED",
      startTime: null,
      endTime: null,
      params: { lr: "0.001" },
      metrics: { best_val_loss: 0.04 },
      tags: { dvc_release: "proyecto2 v1.1.0@dc9376e" },
    };
    const [withUrl] = withMlflowRunUrls([run], "http://mlflow:5000");
    expect(withUrl).toEqual({
      ...run,
      mlflowRunUrl: "http://mlflow:5000/#/experiments/1/runs/abc",
    });
    expect(withMlflowRunUrls([run], undefined)[0].mlflowRunUrl).toBeNull();
  });
});
