import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/crops (T13): catálogo de recortes del manifiesto de T04 con filtros y paginación. */

const readCropCatalog = vi.fn();
vi.mock("@/lib/crop-catalog", () => ({
  readCropCatalog: (...a: unknown[]) => readCropCatalog(...a),
}));

import { GET } from "./route";

const crop = (cropPath: string, className: string, split: string) => ({
  cropPath,
  className,
  split,
  imageId: "1",
  annId: "1",
  url: `/api/crops/${cropPath}`,
});

const call = (qs = "") => GET(new Request(`http://localhost/api/crops${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  readCropCatalog.mockResolvedValue([
    crop("crops/3_2.jpg", "person", "train"),
    crop("crops/70_94.jpg", "car", "test"),
    crop("crops/61_80.jpg", "person", "test"),
  ]);
});

describe("GET /api/crops", () => {
  it("200: filtra por clase y split, y lista las opciones disponibles", async () => {
    const body = await (await call("?className=person&split=test")).json();
    expect(body.total).toBe(1);
    expect(body.crops.map((c: { cropPath: string }) => c.cropPath)).toEqual(["crops/61_80.jpg"]);
    expect(body.classes).toEqual(["car", "person"]);
    expect(body.splits).toEqual(["test", "train"]);
  });

  it("200: pagina con offset y limit", async () => {
    const body = await (await call("?offset=1&limit=1")).json();
    expect(body.total).toBe(3);
    expect(body.crops).toHaveLength(1);
    expect(body.crops[0].cropPath).toBe("crops/70_94.jpg");
  });

  it("400: límite fuera de rango", async () => {
    expect((await call("?limit=1000")).status).toBe(400);
  });
});
