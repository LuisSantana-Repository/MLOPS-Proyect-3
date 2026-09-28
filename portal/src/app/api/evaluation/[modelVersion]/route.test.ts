import { beforeEach, describe, expect, it, vi } from "vitest";

const getModelVersion = vi.fn();
const getRun = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getModelVersion: (...a: unknown[]) => getModelVersion(...a),
  getRun: (...a: unknown[]) => getRun(...a),
}));

import { GET } from "./route";

const ctx = (modelVersion: string) => ({ params: Promise.resolve({ modelVersion }) });
const call = (seg: string, qs = "") =>
  GET(new Request(`http://localhost/api/evaluation/${seg}${qs}`), ctx(seg));

describe("GET /api/evaluation/[modelVersion]", () => {
  beforeEach(() => {
    getModelVersion.mockReset();
    getRun.mockReset();
  });

  it("devuelve métricas de evaluación con nombre:version", async () => {
    getModelVersion.mockResolvedValue({ name: "clasificador", version: "3", runId: "run-1" });
    getRun.mockResolvedValue({
      runId: "run-1",
      params: {},
      tags: { classes: '["person","car"]', confusion_matrix: "[[10,1],[2,8]]" },
      metrics: { test_accuracy: 0.9, test_macro_f1: 0.88, test_loss: 0.2, other: 1 },
    });

    const res = await call("clasificador:3");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.modelName).toBe("clasificador");
    expect(json.modelVersion).toBe("3");
    expect(json.metrics.accuracy).toBe(0.9);
    expect(json.metrics.macroF1).toBe(0.88);
    expect(json.metrics.extra.test_loss).toBe(0.2);
    expect(json.metrics.extra.other).toBeUndefined();
    expect(json.confusionMatrix).toEqual([
      [10, 1],
      [2, 8],
    ]);
    expect(json.classes).toEqual(["person", "car"]);
  });

  it("acepta versión en la ruta con ?name=", async () => {
    getModelVersion.mockResolvedValue({ name: "clasificador", version: "2", runId: "run-2" });
    getRun.mockResolvedValue({ runId: "run-2", params: {}, tags: {}, metrics: {} });
    const res = await call("2", "?name=clasificador");
    expect(res.status).toBe(200);
    expect(getModelVersion).toHaveBeenCalledWith("clasificador", "2");
  });

  it("400 si no se puede resolver el nombre del modelo", async () => {
    const res = await call("2");
    expect(res.status).toBe(400);
    expect(getModelVersion).not.toHaveBeenCalled();
  });

  it("404 si la versión no existe", async () => {
    getModelVersion.mockResolvedValue(null);
    const res = await call("clasificador:99");
    expect(res.status).toBe(404);
  });
});
