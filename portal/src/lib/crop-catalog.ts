import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CropInfo } from "@/contracts";
import { ApiError, notFound } from "@/lib/http";
import { cropUrl } from "@/lib/ui/evaluation";

/**
 * Catálogo de recortes para /inference (T13): `data/splits/manifest.csv` de T04,
 * que trae clase y partición de cada recorte de T03. Los recortes se sirven con
 * `GET /api/crops/...` de T12.
 */

export const MANIFEST = join("data", "splits", "manifest.csv");
const REQUIRED = ["crop_path", "category_name", "split", "image_id", "ann_id"] as const;

/** manifest.csv → recortes. El CSV de T04 no tiene comillas ni comas en los campos. */
export function parseManifest(text: string): CropInfo[] {
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
    cache.__cropCatalog = { mtimeMs, crops: parseManifest(await readFile(file, "utf-8")) };
  }
  return cache.__cropCatalog.crops;
}
