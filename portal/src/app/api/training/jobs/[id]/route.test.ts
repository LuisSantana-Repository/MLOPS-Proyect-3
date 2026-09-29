import { beforeEach, describe, expect, it, vi } from "vitest";

const getJob = vi.fn();
vi.mock("@/lib/jobs", () => ({ getJob: (...a: unknown[]) => getJob(...a) }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = new Request("http://localhost/api/training/jobs/x");

describe("GET /api/training/jobs/[id]", () => {
  beforeEach(() => getJob.mockReset());

  it("devuelve el job con estado y logs", async () => {
    getJob.mockResolvedValue({
      id: "job-1",
      status: "running",
      release: "r1",
      params: {},
      runId: "run-abc",
      error: null,
      logs: [{ ts: "2026-09-28T12:00:00Z", level: "info", message: "arrancó" }],
      createdAt: "2026-09-28T12:00:00.000Z",
      updatedAt: "2026-09-28T12:01:00.000Z",
    });

    const res = await GET(req, ctx("job-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("running");
    expect(json.runId).toBe("run-abc");
    expect(json.logs).toHaveLength(1);
  });

  it("devuelve 404 cuando no existe", async () => {
    getJob.mockResolvedValue(null);
    const res = await GET(req, ctx("nope"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("not_found");
  });
});
