import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de POST /api/inference (T13). La validación de la imagen es real;
 * se simulan la base de datos, S3 y el servicio de T10.
 */

const requirePublishedRow = vi.fn();
const checkPublication = vi.fn();
const predictImage = vi.fn();
const storeUpload = vi.fn();

vi.mock("@/lib/published-models", () => ({
  requirePublishedRow: (...a: unknown[]) => requirePublishedRow(...a),
  checkPublication: (...a: unknown[]) => checkPublication(...a),
}));
vi.mock("@/lib/s3", () => ({ modelStore: () => ({ bucket: "b", label: "s3://b" }) }));
vi.mock("@/lib/inference", () => ({ predictImage: (...a: unknown[]) => predictImage(...a) }));
const readCropImage = vi.fn();
vi.mock("@/lib/crops", () => ({ readCropImage: (...a: unknown[]) => readCropImage(...a) }));
vi.mock("@/lib/images", async () => {
  const actual = await vi.importActual<typeof import("@/lib/images")>("@/lib/images");
  return { ...actual, storeUpload: (...a: unknown[]) => storeUpload(...a) };
});

import { notFound, upstreamError } from "@/lib/http";
import { POST } from "./route";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const SHA = "e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630";

function req(fields: Record<string, string | File>): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/api/inference", { method: "POST", body: form });
}

const image = () => new File([JPEG], "recorte.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  requirePublishedRow.mockResolvedValue({ version: "1.0.0", sha256: SHA });
  checkPublication.mockResolvedValue({ status: "published", missingFiles: [], message: null });
  predictImage.mockResolvedValue({
    version: "1.0.0",
    predictedClass: "car",
    probabilities: [
      { className: "car", probability: 0.92 },
      { className: "person", probability: 0.08 },
    ],
  });
  storeUpload.mockResolvedValue("uploads/x.jpg");
  readCropImage.mockResolvedValue(Buffer.from(JPEG));
});

describe("POST /api/inference", () => {
  it("200: predice con la versión publicada y devuelve hash de pesos e imagen guardada", async () => {
    const res = await POST(req({ version: "1.0.0", file: image() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      version: "1.0.0",
      weightsSha256: SHA,
      predictedClass: "car",
      image: { kind: "upload", contentType: "image/jpeg" },
    });
    expect(body.image.key).toMatch(/^uploads\/[0-9a-f]{64}\.jpg$/);
    expect(predictImage).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1.0.0", contentType: "image/jpeg" }),
    );
    expect(storeUpload).toHaveBeenCalledOnce();
  });

  it("400: versión con formato inválido, sin consultar nada", async () => {
    const res = await POST(req({ version: "../../x", file: image() }));
    expect(res.status).toBe(400);
    expect(requirePublishedRow).not.toHaveBeenCalled();
  });

  it("404: versión no publicada", async () => {
    requirePublishedRow.mockRejectedValue(notFound("La versión de modelo 9.9.9 no está publicada"));
    const res = await POST(req({ version: "9.9.9", file: image() }));
    expect(res.status).toBe(404);
    expect(predictImage).not.toHaveBeenCalled();
  });

  it("400: paquete incompleto en S3, no se usa para predecir", async () => {
    checkPublication.mockResolvedValue({
      status: "incomplete",
      missingFiles: ["weights.pt"],
      message: "Faltan en s3://b: weights.pt",
    });
    const res = await POST(req({ version: "1.0.0", file: image() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("weights.pt");
    expect(predictImage).not.toHaveBeenCalled();
  });

  it("400: archivo que no es imagen, sin llegar al modelo", async () => {
    const txt = new File([new TextEncoder().encode("hola")], "a.jpg", { type: "image/jpeg" });
    const res = await POST(req({ version: "1.0.0", file: txt }));
    expect(res.status).toBe(400);
    expect(predictImage).not.toHaveBeenCalled();
  });

  it("502: si el servicio falla, no se guarda la imagen", async () => {
    predictImage.mockRejectedValue(upstreamError("Las probabilidades suman 1.1000, no 1"));
    const res = await POST(req({ version: "1.0.0", file: image() }));
    expect(res.status).toBe(502);
    expect(storeUpload).not.toHaveBeenCalled();
  });

  it("200: recorte del portal (T03/T12) sin copiarlo a MinIO", async () => {
    const res = await POST(req({ version: "1.0.0", cropPath: "crops/70_94.jpg" }));
    expect(res.status).toBe(200);
    expect((await res.json()).image).toEqual({ kind: "crop", cropPath: "crops/70_94.jpg" });
    expect(readCropImage).toHaveBeenCalledWith(expect.any(String), ["crops", "70_94.jpg"]);
    expect(predictImage).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1.0.0",
        filename: "70_94.jpg",
        contentType: "image/jpeg",
      }),
    );
    expect(storeUpload).not.toHaveBeenCalled();
  });

  it("400: recorte con ruta fuera de crops/", async () => {
    const res = await POST(req({ version: "1.0.0", cropPath: "../../.env" }));
    expect(res.status).toBe(400);
    expect(readCropImage).not.toHaveBeenCalled();
  });

  it("400: archivo y recorte a la vez", async () => {
    const res = await POST(req({ version: "1.0.0", file: image(), cropPath: "crops/70_94.jpg" }));
    expect(res.status).toBe(400);
    expect(predictImage).not.toHaveBeenCalled();
  });

  it("400: cuerpo que no es multipart", async () => {
    const res = await POST(
      new Request("http://localhost/api/inference", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });
});
