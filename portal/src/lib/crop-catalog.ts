import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CropInfo, CropSourceBox } from "@/contracts";
import { ApiError, notFound } from "@/lib/http";
import { cropUrl } from "@/lib/ui/evaluation";

/**
 * Catálogo de recortes para /inference (T13): `data/splits/manifest.csv` de T04,
 * que trae clase y partición de cada recorte de T03. Los recortes se sirven con
 * `GET /api/crops/...` de T12.
 */

export const MANIFEST = join("data", "splits", "manifest.csv");
/** Coordenadas de origen de cada recorte (P2-1), versionadas junto a crops.csv. */
export const SOURCE_BOXES = join("data", "crops", "crops_source_boxes.csv");
const BOX_COLUMNS = [
  "ann_id",
  "category_id",
  "bbox_x",
  "bbox_y",
  "bbox_w",
  "bbox_h",
  "crop_left",
  "crop_top",
  "crop_right",
  "crop_bottom",
] as const;

/** crops_source_boxes.csv → caja de origen por `ann_id`. */
export function parseSourceBoxes(text: string): Map<string, CropSourceBox> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",") ?? [];
  const idx = Object.fromEntries(BOX_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof BOX_COLUMNS)[number],
    number
  >;
  const missing = BOX_COLUMNS.filter((c) => idx[c] < 0);
  if (missing.length > 0) {
    throw new ApiError(
      500,
      "internal_error",
      `crops_source_boxes.csv sin columnas: ${missing.join(", ")}`,
    );
  }
  const boxes = new Map<string, CropSourceBox>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const n = (column: (typeof BOX_COLUMNS)[number]) => Number(cells[idx[column]]);
    boxes.set(cells[idx.ann_id], {
      categoryId: n("category_id"),
      bbox: { x: n("bbox_x"), y: n("bbox_y"), w: n("bbox_w"), h: n("bbox_h") },
      crop: {
        left: n("crop_left"),
        top: n("crop_top"),
        right: n("crop_right"),
        bottom: n("crop_bottom"),
      },
    });
  }
  return boxes;
}
const REQUIRED = ["crop_path", "category_name", "split", "image_id", "ann_id"] as const;

/** manifest.csv → recortes. El CSV de T04 no tiene comillas ni comas en los campos. */
export function parseManifest(
  text: string,
  boxes: Map<string, CropSourceBox> = new Map(),
): CropInfo[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",") ?? [];
  const idx = Object.fromEntries(REQUIRED.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof REQUIRED)[number],
    number
  >;
  const missing = REQUIRED.filter((c) => idx[c] < 0);
  if (missing.length > 0) {
    throw new ApiError(500, "internal_error", `manifest.csv sin columnas: ${missing.join(", ")}`);
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const cropPath = cells[idx.crop_path];
    return {
      cropPath,
      className: cells[idx.category_name],
      split: cells[idx.split],
      imageId: cells[idx.image_id],
      annId: cells[idx.ann_id],
      url: cropUrl(cropPath),
      sourceBox: boxes.get(cells[idx.ann_id]) ?? null,
    };
  });
}

const cache = globalThis as unknown as { __cropCatalog?: { mtimeMs: number; crops: CropInfo[] } };

export async function readCropCatalog(root: string): Promise<CropInfo[]> {
  const file = join(root, MANIFEST);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    throw notFound(`No hay recortes: falta ${MANIFEST} (¿falta dvc pull?)`);
  }
  if (cache.__cropCatalog?.mtimeMs !== mtimeMs) {
    const boxesText = await readFile(join(root, SOURCE_BOXES), "utf-8").catch(() => null);
    const boxes =
      boxesText === null ? new Map<string, CropSourceBox>() : parseSourceBoxes(boxesText);
    cache.__cropCatalog = { mtimeMs, crops: parseManifest(await readFile(file, "utf-8"), boxes) };
  }
  return cache.__cropCatalog.crops;
}
