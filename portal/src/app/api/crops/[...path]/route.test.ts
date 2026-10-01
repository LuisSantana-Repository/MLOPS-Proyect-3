import { beforeEach, describe, expect, it, vi } from "vitest";
import { badRequest, notFound } from "@/lib/http";

/** Contrato de GET /api/crops/[...path] (T12): sirve los recortes para la galería de errores. */

const readCropImage = vi.fn();
vi.mock("@/lib/crops", () => ({
  readCropImage: (...a: unknown[]) => readCropImage(...a),
}));

import { GET } from "./route";

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = () => new Request("http://localhost/api/crops/x");

describe("GET /api/crops/[...path]", () => {
  beforeEach(() => {
    readCropImage.mockReset();
  });

  it("200 con la imagen y content-type jpeg", async () => {
    readCropImage.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const res = await GET(req(), ctx(["crops", "12_345.jpg"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(readCropImage.mock.calls[0][1]).toEqual(["crops", "12_345.jpg"]);
  });

  it("400 si la ruta no es un recorte válido", async () => {
    readCropImage.mockRejectedValue(badRequest("ruta inválida"));
    expect((await GET(req(), ctx(["..", "x"]))).status).toBe(400);
  });

  it("404 si el recorte no existe", async () => {
    readCropImage.mockRejectedValue(notFound("no existe"));
    const res = await GET(req(), ctx(["crops", "9_9.jpg"]));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
