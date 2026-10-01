import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cola de anotación (T13): solo entra una imagen que existe, clasificada por una
 * versión publicada, con la clase sugerida igual a la de mayor probabilidad.
 */

const requirePublishedRow = vi.fn();
const objectExists = vi.fn();
const insertValues = vi.fn();

vi.mock("@/lib/published-models", () => ({
  requirePublishedRow: (...a: unknown[]) => requirePublishedRow(...a),
}));
vi.mock("@/lib/s3", () => ({
  annotationStore: () => ({ bucket: "annotation-images" }),
  objectExists: (...a: unknown[]) => objectExists(...a),
  getObjectBytes: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ insert: () => ({ values: (...a: unknown[]) => insertValues(...a) }) }),
}));

import { notFound } from "@/lib/http";
import { createAnnotationItem, toItem } from "./annotation-queue";

const SHA = "b".repeat(64);
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

beforeEach(() => {
  vi.clearAllMocks();
  requirePublishedRow.mockResolvedValue({ version: "1.0.0" });
  objectExists.mockResolvedValue(true);
  insertValues.mockResolvedValue(undefined);
});

describe("createAnnotationItem", () => {
  it("inserta un elemento pending con la imagen y la predicción", async () => {
    const item = await createAnnotationItem(INPUT);
    expect(item).toMatchObject({
      status: "pending",
      modelVersion: "1.0.0",
      suggestedClass: "car",
      image: INPUT.image,
    });
    expect(item.imageUrl).toBe(`/api/annotation-queue/${item.id}/image`);
    expect(objectExists).toHaveBeenCalledWith(expect.anything(), INPUT.image.key);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ imageKind: "upload", imageKey: INPUT.image.key, imageSha256: SHA }),
    );
  });

  it("rechaza una clase sugerida que no es la de mayor probabilidad", async () => {
    await expect(
      createAnnotationItem({ ...INPUT, suggestedClass: "person" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rechaza una imagen que no existe en MinIO", async () => {
    objectExists.mockResolvedValue(false);
    await expect(createAnnotationItem(INPUT)).rejects.toMatchObject({ status: 400 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rechaza una versión de modelo no publicada", async () => {
    requirePublishedRow.mockRejectedValue(notFound("no publicada"));
    await expect(createAnnotationItem(INPUT)).rejects.toMatchObject({ status: 404 });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rechaza un recorte inexistente en data/crops", async () => {
    const crop = { kind: "crop" as const, cropPath: "crops/no_existe_999.jpg" };
    await expect(createAnnotationItem({ ...INPUT, image: crop })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("toItem", () => {
  it("reconstruye la referencia de un recorte", () => {
    const item = toItem({
      id: "id-1",
      status: "pending",
      imageKind: "crop",
      imageKey: "crops/3_2.jpg",
      imageSha256: null,
      imageContentType: null,
      modelVersion: "1.0.0",
      suggestedClass: "person",
      probabilities: { person: 0.9, car: 0.1 },
      createdAt: new Date("2026-09-30T00:00:00Z"),
    });
    expect(item.image).toEqual({ kind: "crop", cropPath: "crops/3_2.jpg" });
    expect(item.createdAt).toBe("2026-09-30T00:00:00.000Z");
  });
});
