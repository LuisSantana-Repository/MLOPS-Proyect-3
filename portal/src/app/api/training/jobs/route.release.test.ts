import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-1 — POST /api/training/jobs valida el release ANTES de crear la fila.
 * No se simula la validación: lee los artefactos reales del repo (release_info.json,
 * manifiesto, registro y compuerta de calidad del Proyecto 2).
 */

const createJob = vi.fn();
const enqueueTrainingJob = vi.fn();
vi.mock("@/lib/jobs", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
vi.mock("@/lib/queue", () => ({
  enqueueTrainingJob: (...a: unknown[]) => enqueueTrainingJob(...a),
}));

import { POST } from "./route";

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

describe("P1-1: POST /api/training/jobs", () => {
  it("400: un release no aprobado no crea fila en training_jobs ni se encola", async () => {
    const res = await POST(req({ release: "v9.9.9@noaprobado" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toContain("v9.9.9@noaprobado");
    expect(body.error.details).toHaveProperty("release");
    expect(createJob).not.toHaveBeenCalled();
    expect(enqueueTrainingJob).not.toHaveBeenCalled();
  });

  it("201: el release aprobado por la compuerta de calidad sí crea el job", async () => {
    const res = await POST(req({ release: "proyecto2 v1.1.0@dc9376e" }));
    expect(res.status).toBe(201);
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob.mock.calls[0][0]).toBe("proyecto2 v1.1.0@dc9376e");
  });
});
