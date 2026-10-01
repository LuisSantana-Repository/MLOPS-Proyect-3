import { describe, expect, it } from "vitest";
import { parseManifest } from "./crop-catalog";

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
      },
    ]);
  });

  it("falla con un mensaje claro si faltan columnas", () => {
    expect(() => parseManifest("crop_path,split\ncrops/a.jpg,train")).toThrow("category_name");
  });
});
