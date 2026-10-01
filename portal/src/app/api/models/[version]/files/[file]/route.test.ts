import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/models/[version]/files/[file]: descarga firmada solo de objetos que existen. */

const requirePublishedRow = vi.fn();
const objectExists = vi.fn();
const presignedGetUrl = vi.fn();

vi.mock("@/lib/published-models", () => ({
  requirePublishedRow: (...a: unknown[]) => requirePublishedRow(...a),
}));
vi.mock("@/lib/s3", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
  return {
    ...actual,
    modelStore: () => ({ bucket: "b", label: "s3://b" }),
    objectExists: (...a: unknown[]) => objectExists(...a),
    presignedGetUrl: (...a: unknown[]) => presignedGetUrl(...a),
  };
});

import { GET } from "./route";

const call = (version: string, file: string) =>
  GET(new Request("http://localhost"), { params: Promise.resolve({ version, file }) });

beforeEach(() => {
  vi.clearAllMocks();
  requirePublishedRow.mockResolvedValue({ name: "clasificador", version: "1.0.0" });
  objectExists.mockResolvedValue(true);
  presignedGetUrl.mockResolvedValue("https://s3.example/firmada");
});

describe("GET /api/models/[version]/files/[file]", () => {
  it("302 a la URL firmada del archivo del paquete", async () => {
    const res = await call("1.0.0", "weights.pt");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3.example/firmada");
    expect(objectExists).toHaveBeenCalledWith(
      expect.anything(),
      "models/clasificador/1.0.0/weights.pt",
    );
  });

  it("404 si el objeto no existe en S3 (no se firma nada)", async () => {
    objectExists.mockResolvedValue(false);
    const res = await call("1.0.0", "weights.pt");
    expect(res.status).toBe(404);
    expect(presignedGetUrl).not.toHaveBeenCalled();
  });

  it("400 para archivos fuera del paquete", async () => {
    const res = await call("1.0.0", "..%2F.env");
    expect(res.status).toBe(400);
    expect(requirePublishedRow).not.toHaveBeenCalled();
  });
});
