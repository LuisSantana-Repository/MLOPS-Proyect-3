import { beforeEach, describe, expect, it, vi } from "vitest";

/** P1-2 — POST /api/training/jobs: lo que se acepta se encola tal cual; lo demás es 400. */

const createJob = vi.fn();
const enqueueTrainingJob = vi.fn();
vi.mock("@/lib/jobs", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
vi.mock("@/lib/queue", () => ({
  enqueueTrainingJob: (...a: unknown[]) => enqueueTrainingJob(...a),
}));

import { POST } from "./route";

const RELEASE = "proyecto2 v1.1.0@dc9376e";

function req(body: unknown): Request {
  return new Request("http://localhost/api/training/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createJob.mockImplementation(async (release: string, params: unknown) => ({
    id: "job-1",
    status: "queued",
    release,
    params,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  enqueueTrainingJob.mockResolvedValue(undefined);
});

describe("P1-2: POST /api/training/jobs", () => {
  it("encola para el worker los parámetros de early stopping y backbone tal como se pidieron", async () => {
    const res = await POST(
      req({
        release: RELEASE,
        monitor: "val_acc",
        patience: 1,
        min_delta: 0.5,
        trainable_backbone: "none",
        weight_decay: 0.01,
      }),
    );
    expect(res.status).toBe(201);
    const queued = enqueueTrainingJob.mock.calls[0][0];
    expect(queued.params).toMatchObject({
      release: RELEASE,
      monitor: "val_acc",
      patience: 1,
      min_delta: 0.5,
      trainable_backbone: "none",
      weight_decay: 0.01,
    });
  });

  it("400: un parámetro no soportado se rechaza, sin crear el job ni encolarlo", async () => {
    const res = await POST(req({ release: RELEASE, label_smoothing: 0.1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details).toHaveProperty("label_smoothing");
    expect(createJob).not.toHaveBeenCalled();
    expect(enqueueTrainingJob).not.toHaveBeenCalled();
  });
});
