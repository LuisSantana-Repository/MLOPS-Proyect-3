import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApprovedRelease,
  type CandidateSelectionResponse,
  SPLIT_NAMES,
  type SplitCounts,
} from "@/contracts";
import { ApiError, notFound } from "@/lib/http";

/**
 * Lee los artefactos versionados en Git por T03/T04/T07 (ver `contracts/releases.ts`).
 * Todas las rutas son relativas a la raíz del repo que recibe cada función.
 */

export const ARTIFACTS = {
  releaseInfo: "data/crops/release_info.json",
  classes: "data/crops/classes.json",
  cropsDvc: "data/crops/crops.dvc",
  splitReport: "data/splits/split_report.csv",
  leakageReport: "data/splits/leakage_report.json",
  manifestDvc: "data/splits/manifest.csv.dvc",
  selection: "reports/t07/selection.json",
} as const;

async function readText(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readJson<T>(root: string, path: string): Promise<T | null> {
  const text = await readText(root, path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(500, "internal_error", `${path} no es JSON válido`);
  }
}

/** Primer `md5:` de un archivo .dvc (sin el sufijo `.dir`). */
export function dvcMd5(text: string | null): string | null {
  const match = text?.match(/md5:\s*([0-9a-f]{32})/);
  return match ? match[1] : null;
}

/** Commit del Proyecto 2 anotado en el contenido del .dvc del release (T03). */
export function sourceCommit(dvcFileContent: string | undefined): string | null {
  const match = dvcFileContent?.match(/@\s*([0-9a-f]{7,40})\b/);
  return match ? match[1] : null;
}

/** split_report.csv de T04 → conteos por clase y totales. */
export function parseSplitReport(text: string): {
  totals: SplitCounts;
  byClass: Record<string, SplitCounts>;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const header = lines[0]?.split(",") ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new ApiError(500, "internal_error", `split_report.csv sin columna "${name}"`);
    return i;
  };
  const idx = {
    clase: col("clase"),
    total: col("total"),
    train: col("train"),
    val: col("val"),
    test: col("test"),
  };

  const byClass: Record<string, SplitCounts> = {};
  let totals: SplitCounts | null = null;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const counts = {
      train: Number(cells[idx.train]),
      val: Number(cells[idx.val]),
      test: Number(cells[idx.test]),
      total: Number(cells[idx.total]),
    };
    if (cells[idx.clase] === "TOTAL") totals = counts;
    else byClass[cells[idx.clase]] = counts;
  }
  if (!totals) {
    totals = { train: 0, val: 0, test: 0, total: 0 };
    for (const c of Object.values(byClass)) {
      for (const k of [...SPLIT_NAMES, "total"] as const) totals[k] += c[k];
    }
  }
  return { totals, byClass };
}

interface ReleaseInfoFile {
  release_tag: string;
  annotations_md5: string;
  dvc_file_content?: string;
}

interface LeakageReportFile {
  semilla?: number;
  fuga?: { total?: number };
  test_huella_sha256?: string;
}

/** Releases aprobados (hoy uno: el que T03 congeló en release_info.json). */
export async function readApprovedReleases(root: string): Promise<ApprovedRelease[]> {
  const info = await readJson<ReleaseInfoFile>(root, ARTIFACTS.releaseInfo);
  if (!info) throw notFound(`No hay release aprobado: falta ${ARTIFACTS.releaseInfo}`);

  const splitText = await readText(root, ARTIFACTS.splitReport);
  if (splitText === null)
    throw notFound(`El release no tiene split: falta ${ARTIFACTS.splitReport}`);

  const classesFile = await readJson<Record<string, string> | string[]>(root, ARTIFACTS.classes);
  const classes = Array.isArray(classesFile)
    ? classesFile
    : Object.entries(classesFile ?? {})
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, name]) => name);
  const leakage = await readJson<LeakageReportFile>(root, ARTIFACTS.leakageReport);

  return [
    {
      tag: info.release_tag,
      provenance: {
        sourceCommit: sourceCommit(info.dvc_file_content),
        annotationsMd5: info.annotations_md5,
        manifestMd5: dvcMd5(await readText(root, ARTIFACTS.manifestDvc)),
        cropsMd5: dvcMd5(await readText(root, ARTIFACTS.cropsDvc)),
      },
      classes,
      split: {
        seed: leakage?.semilla ?? null,
        ...parseSplitReport(splitText),
        leakage: leakage?.fuga?.total ?? null,
        testFingerprint: leakage?.test_huella_sha256 ?? null,
      },
    },
  ];
}

interface SelectionFile {
  run_id: string;
  run_name?: string;
  selected_at?: string;
  criterion?: { metric: string; mode: string; split: string };
  test_split_used?: boolean;
}

/** Candidato congelado por T07 (reports/t07/selection.json). */
export async function readCandidateSelection(root: string): Promise<CandidateSelectionResponse> {
  const sel = await readJson<SelectionFile>(root, ARTIFACTS.selection);
  if (!sel) throw notFound(`Todavía no hay candidato congelado: falta ${ARTIFACTS.selection}`);
  return {
    runId: sel.run_id,
    runName: sel.run_name ?? null,
    selectedAt: sel.selected_at ?? null,
    criterion: sel.criterion
      ? { metric: sel.criterion.metric, mode: sel.criterion.mode, split: sel.criterion.split }
      : null,
    testSplitUsed: sel.test_split_used ?? false,
  };
}
