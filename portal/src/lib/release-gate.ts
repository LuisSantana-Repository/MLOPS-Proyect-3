import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { QualityGateEvidence } from "@/contracts";

/**
 * Compuerta de calidad del Proyecto 2 para un release (P1-1).
 *
 * Fuentes (los mismos artefactos que sirve el backend de calidad del Proyecto 2,
 * `annotation-api`, en las vistas Resumen y Versiones):
 * - `versions.json`  registro de releases del Proyecto 2 (`pipeline/register_version.py`):
 *                    versión, commit y hash DVC de los datos de cada release.
 * - `release.json`   resultado de la compuerta (`dvc repro release` en el Proyecto 2):
 *                    estado de cada check y veredicto global.
 * - `quality.yaml`   política de calidad con la que se evaluó.
 *
 * Un release se aprueba solo si está en el registro, sus datos son los mismos que los
 * del registro (mismo hash DVC) y el reporte de la compuerta de ESA versión dice `pass`.
 */

export const QUALITY_ARTIFACTS = {
  registry: "annotation-backend/quality/reports/versions.json",
  /** Reporte del release vigente del Proyecto 2 (el que sirven las vistas de calidad). */
  gateReport: "annotation-backend/quality/reports/release.json",
  /** Reportes de otros releases: `<releasesDir>/<versión>/release.json`. */
  releasesDir: "annotation-backend/quality/releases",
  policy: "annotation-backend/quality/quality.yaml",
} as const;

/** Reporte de la compuerta guardado por versión (p. ej. `v1.0.0`). */
export function gateReportPath(version: string): string {
  return `${QUALITY_ARTIFACTS.releasesDir}/${version}/release.json`;
}

interface RegistryFile {
  versions?: { version: string; commit?: string; dvcRevision?: string }[];
}

interface GateReportFile {
  dataset_version?: string;
  generated_at?: string;
  quality?: {
    overall_status?: string;
    exit_code?: number;
    checks?: { name: string; status: string; severity: string; threshold?: number }[];
  };
}

export type GateDecision =
  | { approved: true; evidence: QualityGateEvidence }
  | { approved: false; reason: string };

async function readBytes(root: string, path: string): Promise<Buffer | null> {
  try {
    return await readFile(join(root, path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function parseJson<T>(bytes: Buffer): T | null {
  try {
    return JSON.parse(bytes.toString("utf-8")) as T;
  } catch {
    return null;
  }
}

/** "proyecto2 v1.1.0@dc9376e" → "v1.1.0". */
export function releaseVersion(tag: string): string | null {
  return tag.match(/\bv\d+\.\d+\.\d+\b/)?.[0] ?? null;
}

/**
 * Evalúa la compuerta de calidad de un release.
 * @param dataHash hash DVC de los datos del release con los que se generaron los recortes.
 */
export async function evaluateQualityGate(
  root: string,
  tag: string,
  dataHash: string | null,
): Promise<GateDecision> {
  const version = releaseVersion(tag);
  if (!version) return { approved: false, reason: `el tag "${tag}" no trae una versión vX.Y.Z` };

  const registryBytes = await readBytes(root, QUALITY_ARTIFACTS.registry);
  const registry = registryBytes ? parseJson<RegistryFile>(registryBytes) : null;
  const entry = registry?.versions?.find((v) => v.version === version);
  if (!entry) {
    return {
      approved: false,
      reason: `${version} no está en el registro de releases del Proyecto 2`,
    };
  }
  if (!dataHash || !entry.dvcRevision || entry.dvcRevision !== dataHash) {
    return {
      approved: false,
      reason: `los datos del release (${dataHash ?? "sin hash"}) no son los de ${version} en el registro (${entry.dvcRevision ?? "sin hash"})`,
    };
  }

  // Cada versión tiene su propio reporte; el del release vigente vive en `reports/`.
  let reportFile: string = gateReportPath(version);
  let reportBytes = await readBytes(root, reportFile);
  if (!reportBytes) {
    reportFile = QUALITY_ARTIFACTS.gateReport;
    reportBytes = await readBytes(root, reportFile);
  }
  const report = reportBytes ? parseJson<GateReportFile>(reportBytes) : null;
  if (!reportBytes || !report) {
    return { approved: false, reason: `${version} no tiene reporte de la compuerta de calidad` };
  }
  if (report.dataset_version !== version) {
    return {
      approved: false,
      reason: `el reporte de la compuerta es de ${report.dataset_version ?? "otra versión"}, no de ${version}`,
    };
  }
  const status = report.quality?.overall_status;
  const exitCode = report.quality?.exit_code;
  if (status !== "pass" || exitCode !== 0) {
    return {
      approved: false,
      reason: `la compuerta de calidad de ${version} no pasó (${status ?? "sin estado"}, exit ${exitCode ?? "?"})`,
    };
  }

  const policyBytes = await readBytes(root, QUALITY_ARTIFACTS.policy);
  return {
    approved: true,
    evidence: {
      status: "pass",
      exitCode,
      version,
      registryCommit: entry.commit ?? null,
      dataHash: entry.dvcRevision,
      generatedAt: report.generated_at ?? null,
      registryFile: QUALITY_ARTIFACTS.registry,
      reportFile,
      reportMd5: createHash("md5").update(reportBytes).digest("hex"),
      policyFile: QUALITY_ARTIFACTS.policy,
      policySha256: policyBytes ? createHash("sha256").update(policyBytes).digest("hex") : null,
      checks: (report.quality?.checks ?? []).map((c) => ({
        name: c.name,
        status: c.status,
        severity: c.severity,
        threshold: c.threshold ?? null,
      })),
    },
  };
}
