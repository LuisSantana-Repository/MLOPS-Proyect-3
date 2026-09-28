import { beforeEach, describe, expect, it, vi } from "vitest";

const getRun = vi.fn();
const getMetricHistory = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getRun: (...a: unknown[]) => getRun(...a),
  getMetricHistory: (...a: unknown[]) => getMetricHistory(...a),
}));

import { GET } from "./route";

const ctx = (runId: string) => ({ params: Promise.resolve({ runId }) });
const call = (runId: string, qs = "") =>
  GET(new Request(`http://localhost/api/experiments/${runId}/metrics${qs}`), ctx(runId));

describe("GET /api/experiments/[runId]/metrics", () => {
  beforeEach(() => {
    getRun.mockReset();
    getMetricHistory.mockReset();
  });

  it("devuelve train_loss y val_loss por época, ordenadas", async () => {
    getRun.mockResolvedValue({ runId: "run-1" });
    getMetricHistory.mockImplementation((_run: string, key: string) =>
      Promise.resolve(
        key === "train_loss"
          ? [
              { key, value: 0.5, timestamp: 20, step: 1 },
              { key, value: 0.9, timestamp: 10, step: 0 },
            ]
          : [{ key, value: 0.6, timestamp: 15, step: 0 }],
      ),
    );

    const res = await call("run-1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json.metrics).sort()).toEqual(["train_loss", "val_loss"]);
    // Ordenadas por step ascendente.
    expect(json.metrics.train_loss.map((p: { step: number }) => p.step)).toEqual([0, 1]);
    expect(json.metrics.val_loss[0].value).toBe(0.6);
  });

  it("respeta ?keys=train_acc,val_acc", async () => {
    getRun.mockResolvedValue({ runId: "run-1" });
    getMetricHistory.mockResolvedValue([]);
    const res = await call("run-1", "?keys=train_acc,val_acc");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json.metrics).sort()).toEqual(["train_acc", "val_acc"]);
  });

  it("404 si el run no existe", async () => {
    getRun.mockResolvedValue(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(getMetricHistory).not.toHaveBeenCalled();
  });
});
