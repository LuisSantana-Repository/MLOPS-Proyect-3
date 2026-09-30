import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { badRequest, notFound } from "@/lib/http";

/**
 * Recortes de T03 para la galería de errores de /evaluation (T12).
 *
 * Solo se sirven archivos con la forma de `crop_path` de T03 (`crops/<nombre>.jpg`)
 * dentro de `data/crops/` del repo; cualquier otra ruta es 400.
 */

export const CROPS_DIR = join("data", "crops");
const CROP_FILE = /^[A-Za-z0-9_-]+\.jpe?g$/;

export function resolveCropPath(root: string, segments: string[]): string {
  if (segments.length !== 2 || segments[0] !== "crops" || !CROP_FILE.test(segments[1])) {
    throw badRequest("Ruta de recorte inválida: se espera crops/<nombre>.jpg");
  }
  const base = resolve(root, CROPS_DIR);
  const file = resolve(base, segments[0], segments[1]);
  if (!file.startsWith(base + sep)) throw badRequest("Ruta de recorte fuera de data/crops");
  return file;
}

export async function readCropImage(root: string, segments: string[]): Promise<Buffer> {
  const file = resolveCropPath(root, segments);
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw notFound(`No existe el recorte ${segments.join("/")} (¿falta dvc pull?)`);
    }
    throw err;
  }
}
