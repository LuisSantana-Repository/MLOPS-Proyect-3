import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/training/jobs/[id] (T09 / T14).
 * Devuelve el job con sus logs, o 404 si no existe.
 */

const getJob = vi.fn();
vi.mock("@/lib/jobs", () => ({ getJob: (...a: unknown[]) => getJob(...a) }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/training/jobs/x");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/training/jobs/[id]", () => {
  it("200: devuelve el job persistido con sus logs", async () => {
    getJob.mockResolvedValue({
      id: "job-1",
      status: "running",
      release: "proyecto2 v1.1.0@dc9376e",
      params: {},
      runId: "run-abc",
      error: null,
      logs: [{ ts: "2026-01-01T00:00:00.000Z", level: "info", message: "arrancó" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    const res = await GET(req(), ctx("job-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("job-1");
    expect(body.status).toBe("running");
    expect(body.logs).toHaveLength(1);
    expect(getJob).toHaveBeenCalledWith("job-1");
  });

  it("404: el job no existe", async () => {
    getJob.mockResolvedValue(null);
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
