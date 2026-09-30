/**
 * Contrato de releases aprobados y selección del candidato (T11).
 *
 * Se sirven desde archivos versionados en Git por T03/T04/T07, así que no
 * dependen de MLflow ni de la base de datos:
 * - `data/crops/release_info.json`   release DVC del Proyecto 2 y hash de anotaciones (T03)
 * - `data/crops/classes.json`        clases congeladas (T03)
 * - `data/splits/split_report.csv`   conteos 70/20/10 por clase (T04)
 * - `data/splits/leakage_report.json` semilla, fuga y huella del test (T04)
 * - `data/splits/manifest.csv.dvc`   hash DVC del manifiesto (T04)
 * - `reports/t07/selection.json`     run candidato congelado (T07)
 */

export const SPLIT_NAMES = ["train", "val", "test"] as const;
export type SplitName = (typeof SPLIT_NAMES)[number];

export type SplitCounts = Record<SplitName, number> & { total: number };

/** Un release aprobado con su procedencia y el split que lo acompaña. */
export interface ApprovedRelease {
  /** Tag del release, p. ej. "proyecto2 v1.1.0@dc9376e". Es el `release` del job. */
  tag: string;
  provenance: {
    /** Commit del Proyecto 2 donde se aprobó el release (si está registrado). */
    sourceCommit: string | null;
    /** MD5 del COCO de anotaciones usado para los recortes. */
    annotationsMd5: string;
    /** MD5 DVC del manifiesto 70/20/10. */
    manifestMd5: string | null;
    /** MD5 DVC de la carpeta de recortes. */
    cropsMd5: string | null;
  };
  classes: string[];
  split: {
    seed: number | null;
    totals: SplitCounts;
    byClass: Record<string, SplitCounts>;
    leakage: number | null;
    testFingerprint: string | null;
  };
}

/** Respuesta de GET /api/releases. */
export interface ListReleasesResponse {
  releases: ApprovedRelease[];
}

/** Respuesta de GET /api/experiments/selection. */
export interface CandidateSelectionResponse {
  runId: string;
  runName: string | null;
  selectedAt: string | null;
  criterion: { metric: string; mode: string; split: string } | null;
  testSplitUsed: boolean;
}
