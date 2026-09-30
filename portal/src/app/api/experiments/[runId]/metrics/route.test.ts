import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/experiments/[runId]/metrics (T09 / T14).
 * Historial por época; por defecto train_loss y val_loss, ordenado por step.
 * 404 si el run no existe.
 */

const getRun = vi.fn();
const getMetricHistory = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getRun: (...a: unknown[]) => getRun(...a),
  getMetricHistory: (...a: unknown[]) => getMetricHistory(...a),
}));

import { GET } from "./route";

const ctx = (runId: string) => ({ params: Promise.resolve({ runId }) });
const req = (qs = "") => new Request(`http://localhost/api/experiments/run-1/metrics${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  getRun.mockResolvedValue({ runId: "run-1" });
  // Devuelve puntos desordenados para comprobar que el handler los ordena por step.
  getMetricHistory.mockImplementation(async (_runId: string, key: string) => [
    { key, value: 0.2, timestamp: 20, step: 2 },
    { key, value: 0.9, timestamp: 10, step: 0 },
    { key, value: 0.5, timestamp: 15, step: 1 },
  ]);
});

describe("GET /api/experiments/[runId]/metrics", () => {
  it("200: por defecto devuelve train_loss y val_loss ordenados por step", async () => {
    const res = await GET(req(), ctx("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.metrics).sort()).toEqual(["train_loss", "val_loss"]);
    expect(body.metrics.train_loss.map((p: { step: number }) => p.step)).toEqual([0, 1, 2]);
  });

  it("200: respeta ?keys=train_acc,val_acc", async () => {
    const res = await GET(req("?keys=train_acc,val_acc"), ctx("run-1"));
    const body = await res.json();
    expect(Object.keys(body.metrics).sort()).toEqual(["train_acc", "val_acc"]);
    expect(getMetricHistory).toHaveBeenCalledWith("run-1", "train_acc");
    expect(getMetricHistory).toHaveBeenCalledWith("run-1", "val_acc");
  });

  it("404: el run no existe", async () => {
    getRun.mockResolvedValue(null);
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
