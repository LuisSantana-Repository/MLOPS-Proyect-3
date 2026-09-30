import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/models (T09 / T14).
 * Lista versiones del registry con su llave S3 y el hash de pesos, resolviendo
 * el hash desde el run de origen cuando no está en el tag de la versión.
 */

const searchModelVersions = vi.fn();
const getRun = vi.fn();

vi.mock("@/lib/mlflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mlflow")>("@/lib/mlflow");
  return {
    ...actual, // s3KeyFromSource real (lógica pura que queremos ejercitar)
    searchModelVersions: (...a: unknown[]) => searchModelVersions(...a),
    getRun: (...a: unknown[]) => getRun(...a),
  };
});

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/models", () => {
  it("200: mapea versión, llave S3 y hash desde el tag de la versión", async () => {
    searchModelVersions.mockResolvedValue([
      {
        name: "clasificador",
        version: "1",
        stage: null,
        status: "READY",
        runId: "run-1",
        source: "s3://mlflow/1/run-1/artifacts/model",
        creationTimestamp: 1,
        lastUpdatedTimestamp: 2,
        description: null,
        tags: { weights_sha256: "deadbeef" },
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      name: "clasificador",
      version: "1",
      s3Key: "1/run-1/artifacts/model",
      weightsSha256: "deadbeef",
    });
    // El hash estaba en el tag de la versión: no hace falta consultar el run.
    expect(getRun).not.toHaveBeenCalled();
  });

  it("200: si la versión no trae hash, lo resuelve desde el run de origen", async () => {
    searchModelVersions.mockResolvedValue([
      {
        name: "clasificador",
        version: "2",
        stage: null,
        status: "READY",
        runId: "run-2",
        source: "s3://mlflow/1/run-2/artifacts/model",
        creationTimestamp: 1,
        lastUpdatedTimestamp: 2,
        description: null,
        tags: {},
      },
    ]);
    getRun.mockResolvedValue({ tags: { weights_sha256: "cafef00d" } });
    const res = await GET();
    const body = await res.json();
    expect(body.models[0].weightsSha256).toBe("cafef00d");
    expect(getRun).toHaveBeenCalledWith("run-2");
  });
});
