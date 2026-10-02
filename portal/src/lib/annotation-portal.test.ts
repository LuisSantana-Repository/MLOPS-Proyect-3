import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P0-3 — «Enviar a anotación» desde Inference registra la imagen en el portal de
 * anotación del Proyecto 1 (POST /images de annotation-api), con la clase sugerida y
 * las probabilidades. Ya no existe la tabla `annotation_queue`.
 */

const requirePublishedRow = vi.fn();
const getObjectBytes = vi.fn();

vi.mock("@/lib/published-models", () => ({
  requirePublishedRow: (...a: unknown[]) => requirePublishedRow(...a),
}));
vi.mock("@/lib/s3", () => ({
  annotationStore: () => ({ bucket: "annotation-images" }),
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { notFound } from "@/lib/http";
import { sendToAnnotation } from "./annotation-portal";

const SHA = "b".repeat(64);
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const INPUT = {
  image: {
    kind: "upload" as const,
    key: `uploads/${SHA}.jpg`,
    sha256: SHA,
    contentType: "image/jpeg" as const,
  },
  modelVersion: "1.0.0",
  suggestedClass: "car",
  probabilities: { car: 0.92, person: 0.08 },
};

/** Respuesta de POST /images del portal de anotación. */
function created(id = 41): Response {
  return Response.json(
    {
      id,
      filename: `inference-${SHA.slice(0, 12)}.jpg`,
      storageKey: "images/x",
      status: "pending",
    },
    { status: 201 },
  );
}

const backend = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  requirePublishedRow.mockResolvedValue({ version: "1.0.0" });
  getObjectBytes.mockResolvedValue(BYTES);
  backend.mockResolvedValue(created());
});

describe("sendToAnnotation", () => {
  it("registra la imagen en el portal de anotación con la sugerencia del modelo", async () => {
    const submission = await sendToAnnotation(INPUT, backend);

    expect(backend).toHaveBeenCalledTimes(1);
    const [url, init] = backend.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3100/images");
    expect(init?.method).toBe("POST");

    const form = init?.body as FormData;
    const file = form.get("image") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe(`inference-${SHA.slice(0, 12)}.jpg`);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(BYTES);
    expect(form.get("suggestedCategory")).toBe("car");
    expect(JSON.parse(form.get("suggestedProbabilities") as string)).toEqual(INPUT.probabilities);
    expect(form.get("suggestedModelVersion")).toBe("1.0.0");

    expect(submission).toEqual({
      imageId: 41,
      filename: `inference-${SHA.slice(0, 12)}.jpg`,
      status: "pending",
      modelVersion: "1.0.0",
      suggestedClass: "car",
      probabilities: INPUT.probabilities,
      annotateUrl: "/annotate/41",
      pendingUrl: "/search?status=pending",
    });
  });

  it("rechaza una clase sugerida que no es la de mayor probabilidad", async () => {
    await expect(
      sendToAnnotation({ ...INPUT, suggestedClass: "person" }, backend),
    ).rejects.toMatchObject({ status: 400 });
    expect(backend).not.toHaveBeenCalled();
  });

  it("rechaza una imagen que ya no está en MinIO", async () => {
    getObjectBytes.mockResolvedValue(null);
    await expect(sendToAnnotation(INPUT, backend)).rejects.toMatchObject({ status: 400 });
    expect(backend).not.toHaveBeenCalled();
  });

  it("rechaza una versión de modelo no publicada", async () => {
    requirePublishedRow.mockRejectedValue(notFound("no publicada"));
    await expect(sendToAnnotation(INPUT, backend)).rejects.toMatchObject({ status: 404 });
    expect(backend).not.toHaveBeenCalled();
  });

  it("rechaza un recorte inexistente en data/crops", async () => {
    const crop = { kind: "crop" as const, cropPath: "crops/no_existe_999.jpg" };
    await expect(sendToAnnotation({ ...INPUT, image: crop }, backend)).rejects.toMatchObject({
      status: 400,
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("502 si el portal de anotación no responde", async () => {
    backend.mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendToAnnotation(INPUT, backend)).rejects.toMatchObject({ status: 502 });
  });

  it("502 con el motivo si el portal de anotación rechaza la imagen", async () => {
    backend.mockResolvedValue(
      Response.json({ error: "El archivo no es una imagen válida." }, { status: 400 }),
    );
    await expect(sendToAnnotation(INPUT, backend)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("El archivo no es una imagen válida."),
    });
  });
});
