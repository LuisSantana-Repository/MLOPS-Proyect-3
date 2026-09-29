import { beforeEach, describe, expect, it, vi } from "vitest";

const searchModelVersions = vi.fn();
const getRun = vi.fn();

vi.mock("@/lib/mlflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mlflow")>();
  return {
    ...actual,
    searchModelVersions: (...a: unknown[]) => searchModelVersions(...a),
    getRun: (...a: unknown[]) => getRun(...a),
  };
});

import { GET } from "./route";

describe("GET /api/models", () => {
  beforeEach(() => {
    searchModelVersions.mockReset();
    getRun.mockReset();
  });

  it("devuelve versiones con run de origen, llave S3 y hash", async () => {
    searchModelVersions.mockResolvedValue([
      {
        name: "clasificador",
        version: "3",
        stage: "Production",
        status: "READY",
        runId: "run-1",
        source: "s3://mlflow/7/run-1/artifacts/model",
        creationTimestamp: 1,
        lastUpdatedTimestamp: 2,
        description: "cand",
        tags: {},
      },
    ]);
    // El hash vive en el run de origen.
    getRun.mockResolvedValue({
      runId: "run-1",
      tags: { weights_sha256: "abc123" },
      metrics: {},
      params: {},
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const m = json.models[0];
    expect(m.version).toBe("3");
    expect(m.runId).toBe("run-1");
    expect(m.s3Key).toBe("7/run-1/artifacts/model");
    expect(m.weightsSha256).toBe("abc123");
  });

  it("usa el tag de la propia versión si ya trae weights_sha256", async () => {
    searchModelVersions.mockResolvedValue([
      {
        name: "clasificador",
        version: "1",
        stage: null,
        status: "READY",
        runId: "run-9",
        source: "s3://mlflow/1/run-9/artifacts/model",
        creationTimestamp: null,
        lastUpdatedTimestamp: null,
        description: null,
        tags: { weights_sha256: "deadbeef" },
      },
    ]);

    const res = await GET();
    const json = await res.json();
    expect(json.models[0].weightsSha256).toBe("deadbeef");
    expect(getRun).not.toHaveBeenCalled();
  });
});
