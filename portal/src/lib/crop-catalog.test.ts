import { describe, expect, it } from "vitest";
import { parseManifest, parseSourceBoxes } from "./crop-catalog";

const MANIFEST = [
  "crop_path,ann_id,image_id,category_id,category_name,class_index,group_id,split",
  "crops/70_94.jpg,94,70,2,car,1,img000070,test",
].join("\r\n");

describe("parseManifest", () => {
  it("lee clase, split e IDs y arma la URL de /api/crops de T12", () => {
    expect(parseManifest(MANIFEST)).toEqual([
      {
        cropPath: "crops/70_94.jpg",
        className: "car",
        split: "test",
        imageId: "70",
        annId: "94",
        url: "/api/crops/crops/70_94.jpg",
        sourceBox: null,
      },
    ]);
  });

  it("falla con un mensaje claro si faltan columnas", () => {
    expect(() => parseManifest("crop_path,split\ncrops/a.jpg,train")).toThrow("category_name");
  });
});

describe("P2-1: coordenadas de origen de cada recorte", () => {
  const BOXES = [
    "ann_id,image_id,category_id,bbox_x,bbox_y,bbox_w,bbox_h,crop_left,crop_top,crop_right,crop_bottom",
    "94,70,2,10.6,20.2,30.1,15.5,10,20,41,36",
  ].join("\n");

  it("lee la caja COCO y el rectángulo recortado por ann_id", () => {
    expect(parseSourceBoxes(BOXES).get("94")).toEqual({
      categoryId: 2,
      bbox: { x: 10.6, y: 20.2, w: 30.1, h: 15.5 },
      crop: { left: 10, top: 20, right: 41, bottom: 36 },
    });
  });

  it("la API de recortes expone la caja de origen de cada recorte", () => {
    const [crop] = parseManifest(MANIFEST, parseSourceBoxes(BOXES));
    expect(crop.annId).toBe("94");
    expect(crop.sourceBox?.bbox).toEqual({ x: 10.6, y: 20.2, w: 30.1, h: 15.5 });
    expect(crop.sourceBox?.crop).toEqual({ left: 10, top: 20, right: 41, bottom: 36 });
  });

  it("falla con un mensaje claro si faltan columnas", () => {
    expect(() => parseSourceBoxes("ann_id,bbox_x\n1,2")).toThrow("bbox_y");
  });
});
