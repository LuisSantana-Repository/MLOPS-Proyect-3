import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/models (T09, extendido en T13).
 * Las versiones salen de `published_models` (T10) con su trazabilidad y estado en S3;
 * la lógica de combinación se prueba en `lib/published-models.test.ts`.
 */

const listPublishedModels = vi.fn();
vi.mock("@/lib/published-models", () => ({
  listPublishedModels: (...a: unknown[]) => listPublishedModels(...a),
}));

import { ApiError } from "@/lib/http";
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/models", () => {
  it("200: devuelve las versiones publicadas con la forma del contrato", async () => {
    listPublishedModels.mockResolvedValue([
      {
        name: "clasificador",
        version: "1.0.0",
        runId: "run-1",
        s3Key: "models/clasificador/1.0.0",
        weightsSha256: "deadbeef",
        dvcRelease: "proyecto2 v1.1.0@dc9376e",
        publication: { status: "published", missingFiles: [], checkedAt: "x", message: null },
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      version: "1.0.0",
      runId: "run-1",
      s3Key: "models/clasificador/1.0.0",
      weightsSha256: "deadbeef",
      dvcRelease: "proyecto2 v1.1.0@dc9376e",
    });
  });

  it("200 con lista vacía cuando no hay nada publicado", async () => {
    listPublishedModels.mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body).toEqual({ models: [] });
  });

  it("500 con mensaje accionable si falta la tabla", async () => {
    listPublishedModels.mockRejectedValue(
      new ApiError(
        500,
        "schema_missing",
        "La tabla published_models no existe: corre las migraciones",
      ),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("schema_missing");
  });
});
