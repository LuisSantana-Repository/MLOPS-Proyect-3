import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { badRequest } from "@/lib/http";

/**
 * Validación del manifiesto 70/20/10 ACTUAL antes de encolar un job (Actividad A, 6.1).
 *
 * No se confía en `leakage_report.json` (un reporte escrito cuando se generó el split):
 * se lee el `manifest.csv` que el worker va a usar y se recalculan las intersecciones
 * entre train, val y test por `image_id`, `group_id` y `ann_id`. Un mismo original, un
 * mismo grupo de casi-duplicados o una misma anotación en dos particiones es fuga.
 */

export const LEAK_KEYS = ["image_id", "group_id", "ann_id"] as const;
export type LeakKey = (typeof LEAK_KEYS)[number];

export interface ManifestLeak {
  key: LeakKey;
  value: string;
  splits: string[];
}

export interface ManifestCheck {
  rows: number;
  splits: Record<string, number>;
  leaks: ManifestLeak[];
}

/** manifest.csv → filas por partición y cruces entre particiones. */
export function findManifestLeaks(text: string): ManifestCheck {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0]?.split(",") ?? [];
  const column = (name: string) => header.indexOf(name);
  const missing = ["split", ...LEAK_KEYS].filter((name) => column(name) < 0);
  if (missing.length > 0) {
    throw badRequest(`El manifiesto no tiene las columnas: ${missing.join(", ")}`, {
      release: [`manifest.csv sin ${missing.join(", ")}`],
    });
  }

  const splitIndex = column("split");
  const splits: Record<string, number> = {};
  const seen = Object.fromEntries(
    LEAK_KEYS.map((key) => [key, new Map<string, Set<string>>()]),
  ) as Record<LeakKey, Map<string, Set<string>>>;

  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const split = cells[splitIndex];
    splits[split] = (splits[split] ?? 0) + 1;
    for (const key of LEAK_KEYS) {
      const value = cells[column(key)];
      const where = seen[key].get(value) ?? new Set<string>();
      where.add(split);
      seen[key].set(value, where);
    }
  }

  const leaks: ManifestLeak[] = [];
  for (const key of LEAK_KEYS) {
    for (const [value, where] of seen[key]) {
      if (where.size > 1) leaks.push({ key, value, splits: [...where].sort() });
    }
  }
  return { rows: lines.length - 1, splits, leaks };
}

function describe(leaks: ManifestLeak[]): string {
  const shown = leaks.slice(0, 5).map((l) => `${l.key} ${l.value} en ${l.splits.join(" y ")}`);
  const rest = leaks.length > shown.length ? ` (y ${leaks.length - shown.length} más)` : "";
  return `${shown.join("; ")}${rest}`;
}

/**
 * Verifica el manifiesto con el que se va a entrenar. Lanza 400 si falta, si tiene fuga
 * entre particiones o si no es el versionado en DVC (`expectedMd5` de `manifest.csv.dvc`).
 */
export async function verifyManifest(
  root: string,
  manifestPath: string,
  expectedMd5: string | null,
): Promise<ManifestCheck> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, manifestPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    throw badRequest(
      `No está el manifiesto ${manifestPath}: ejecuta \`dvc pull\` antes de entrenar`,
      {
        release: [`Falta ${manifestPath}`],
      },
    );
  }

  const check = findManifestLeaks(bytes.toString("utf-8"));
  if (check.leaks.length > 0) {
    throw badRequest(
      `El manifiesto ${manifestPath} tiene fuga entre particiones: ${describe(check.leaks)}`,
      {
        release: check.leaks.slice(0, 20).map((l) => `${l.key}=${l.value}: ${l.splits.join(", ")}`),
      },
    );
  }

  const md5 = createHash("md5").update(bytes).digest("hex");
  if (expectedMd5 && md5 !== expectedMd5) {
    throw badRequest(
      `El manifiesto ${manifestPath} no es el versionado en DVC (md5 ${md5}, se esperaba ${expectedMd5})`,
      { release: [`md5 ${md5} ≠ ${expectedMd5}`] },
    );
  }
  return check;
}
