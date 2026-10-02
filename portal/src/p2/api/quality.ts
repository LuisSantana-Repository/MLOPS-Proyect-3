import { z } from "zod";
import { apiRequest, jsonBody } from "../lib/api/client";

/**
 * SPEC-QUALITY-UI-000 — Contrato de red del portal de calidad.
 *
 * Espejo de `backend/src/logic/quality/contracts.ts`. Todo lo que llega del
 * API se valida aquí antes de tocar un componente: si el backend cambia una
 * cifra o un campo, la pantalla falla ruidosamente en desarrollo en vez de
 * mostrar `undefined`/`NaN`.
 */

export const severitySchema = z.enum(["warn", "fail"]);
export type Severity = z.infer<typeof severitySchema>;

export const checkStatusSchema = z.enum(["pass", "warn", "fail"]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const categoryRefSchema = z.object({ id: z.number(), name: z.string() });
export type CategoryRef = z.infer<typeof categoryRefSchema>;

const totalsSchema = z.object({
  images: z.number(),
  annotations: z.number(),
  categories: z.number(),
});
export type DatasetTotals = z.infer<typeof totalsSchema>;

export const checkResultSchema = z.object({
  name: z.string(),
  status: checkStatusSchema,
  severity: severitySchema,
  threshold: z.number(),
  observed: z.record(z.string(), z.unknown()),
  samples: z.array(z.record(z.string(), z.unknown())),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const overviewViewSchema = z.object({
  datasetVersion: z.string(),
  generatedAt: z.string(),
  totals: totalsSchema,
  gate: z.object({
    overallStatus: z.enum(["pass", "fail"]),
    exitCode: z.number(),
    passCount: z.number(),
    warnCount: z.number(),
    failCount: z.number(),
  }),
  checks: z.array(checkResultSchema),
});
export type OverviewView = z.infer<typeof overviewViewSchema>;

// ---------------------------------------------------------------------------
// Analyzers
// ---------------------------------------------------------------------------

export const smallObjectsReportSchema = z.object({
  threshold_px: z.number(),
  severity: severitySchema,
  total_annotations: z.number(),
  small_count: z.number(),
  small_percent: z.number(),
  percent_by_category: z.record(z.string(), z.number()),
  most_affected_category_id: z.number().nullable(),
  offending_samples: z.array(
    z.object({
      annotation_id: z.number(),
      image_id: z.number(),
      category_id: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
});
export type SmallObjectsReport = z.infer<typeof smallObjectsReportSchema>;

export const classImbalanceReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  distributions: z.array(
    z.object({
      category_id: z.number(),
      distinct_image_count: z.number(),
      box_count: z.number(),
    }),
  ),
  majority_category_id: z.number().nullable(),
  minority_category_id: z.number().nullable(),
  ratio: z.number().nullable(),
  classes_below_min_images: z.array(z.number()),
});
export type ClassImbalanceReport = z.infer<typeof classImbalanceReportSchema>;

export const duplicatesReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  pairs: z.array(
    z.object({
      image_id_a: z.number(),
      image_id_b: z.number(),
      distance: z.number(),
      similarity_percent: z.number(),
    }),
  ),
  duplicate_groups: z.array(z.array(z.number())),
});
export type DuplicatesReport = z.infer<typeof duplicatesReportSchema>;

export const invalidBoxesReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  total_annotations: z.number(),
  invalid_count: z.number(),
  invalid_boxes: z.array(
    z.object({
      annotation_id: z.number(),
      image_id: z.number(),
      bbox: z.array(z.number()),
      reasons: z.array(z.string()),
    }),
  ),
});
export type InvalidBoxesReport = z.infer<typeof invalidBoxesReportSchema>;

export const spatialStatsSchema = z.object({
  count: z.number(),
  mean_x: z.number(),
  mean_y: z.number(),
  median_x: z.number(),
  median_y: z.number(),
  std_x: z.number(),
  std_y: z.number(),
  p25_x: z.number(),
  p75_x: z.number(),
  p25_y: z.number(),
  p75_y: z.number(),
});
export type SpatialStats = z.infer<typeof spatialStatsSchema>;

export const spatialBiasReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  global_stats: spatialStatsSchema,
  stats_by_category: z.record(z.string(), spatialStatsSchema),
});
export type SpatialBiasReport = z.infer<typeof spatialBiasReportSchema>;

export const analyzersViewSchema = z.object({
  datasetVersion: z.string(),
  categories: z.array(categoryRefSchema),
  smallObjects: smallObjectsReportSchema,
  classImbalance: classImbalanceReportSchema,
  duplicates: duplicatesReportSchema,
  invalidBoxes: invalidBoxesReportSchema,
  spatialBias: spatialBiasReportSchema,
});
export type AnalyzersView = z.infer<typeof analyzersViewSchema>;

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

export const splitsViewSchema = z.object({
  datasetVersion: z.string(),
  seed: z.number(),
  proportions: z.record(z.string(), z.number()),
  assignment: z.object({
    train: z.array(z.number()),
    val: z.array(z.number()),
    test: z.array(z.number()),
  }),
  distribution: z.array(
    z.object({
      split: z.enum(["train", "val", "test"]),
      total_images: z.number(),
      category_counts: z.record(z.string(), z.number()),
    }),
  ),
  leakage: z.object({
    id_intersection_size: z.number(),
    cross_split_duplicate_pairs: z.number(),
    duplicate_groups_within_one_split: z.number(),
    leaked_image_ids: z.array(z.number()),
    all_classes_in_val: z.boolean(),
    all_classes_in_test: z.boolean(),
  }),
  classCounts: z.array(
    z.object({
      category_id: z.number(),
      distinct_images_before: z.number(),
      distinct_images_after: z.number(),
    }),
  ),
  categories: z.array(categoryRefSchema),
});
export type SplitsView = z.infer<typeof splitsViewSchema>;

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const versionEnvironmentSchema = z.object({
  status: z.enum(["pushed", "not_pushed"]),
  contentHash: z.string().nullable(),
});
export type VersionEnvironment = z.infer<typeof versionEnvironmentSchema>;

export const versionEntrySchema = z.object({
  version: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
  dvcRevision: z.string().nullable(),
  parentVersion: z.string().nullable(),
  environments: z.object({
    dev: versionEnvironmentSchema,
    prod: versionEnvironmentSchema,
  }),
  totals: totalsSchema,
  metrics: z.object({
    smallObjectsPercent: z.number(),
    classImbalanceRatio: z.number(),
    duplicateGroups: z.number(),
    invalidBoxes: z.number(),
  }),
  classCounts: z.array(
    z.object({
      categoryId: z.number(),
      distinctImages: z.number(),
    }),
  ),
});
export type VersionEntry = z.infer<typeof versionEntrySchema>;

export const versionsFileSchema = z.object({
  minimumImagesPerClass: z.number(),
  versions: z.array(versionEntrySchema),
});
export type VersionsFile = z.infer<typeof versionsFileSchema>;

export const versionDiffSchema = z.object({
  from: z.string(),
  to: z.string(),
  imagesAdded: z.number(),
  annotationsAdded: z.number(),
  smallObjectsPercentDelta: z.number(),
  classImbalanceRatioDelta: z.number(),
  duplicateGroupsDelta: z.number(),
  invalidBoxesDelta: z.number(),
  classesThatLeftMinimum: z.array(z.number()),
  classesThatEnteredMinimum: z.array(z.number()),
  classCountChanges: z.array(
    z.object({
      categoryId: z.number(),
      from: z.number(),
      to: z.number(),
      delta: z.number(),
    }),
  ),
  totals: z.object({ from: totalsSchema, to: totalsSchema }),
});
export type VersionDiff = z.infer<typeof versionDiffSchema>;

// ---------------------------------------------------------------------------
// Settings (quality.yaml)
// ---------------------------------------------------------------------------

export const checkConfigSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  min_classes: z.number().int().min(1).optional(),
});
export type CheckConfig = z.infer<typeof checkConfigSchema>;

export const qualitySettingsSchema = z.object({
  checks: z.record(z.string(), checkConfigSchema),
  splits: z.object({
    train: z.number(),
    val: z.number(),
    test: z.number(),
    seed: z.number().int(),
  }),
});
export type QualitySettings = z.infer<typeof qualitySettingsSchema>;

// ---------------------------------------------------------------------------
// Reannotation queue
// ---------------------------------------------------------------------------

export const reannotationItemSchema = z.object({
  annotation_id: z.number(),
  image_id: z.number(),
  reason: z.string(),
  analyzer: z.string(),
  severity: severitySchema,
});
export type ReannotationItem = z.infer<typeof reannotationItemSchema>;

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export function fetchOverview(): Promise<OverviewView> {
  return apiRequest("/quality/overview", overviewViewSchema);
}

export function fetchAnalyzers(): Promise<AnalyzersView> {
  return apiRequest("/quality/analyzers", analyzersViewSchema);
}

export function fetchSplits(): Promise<SplitsView> {
  return apiRequest("/quality/splits", splitsViewSchema);
}

export function fetchVersions(): Promise<VersionsFile> {
  return apiRequest("/quality/versions", versionsFileSchema);
}

export function fetchVersionDiff(from: string, to: string): Promise<VersionDiff> {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiRequest(`/quality/versions/diff?${query}`, versionDiffSchema);
}

export function fetchQualitySettings(): Promise<QualitySettings> {
  return apiRequest("/quality/settings", qualitySettingsSchema);
}

export function updateQualitySettings(settings: QualitySettings): Promise<QualitySettings> {
  return apiRequest("/quality/settings", qualitySettingsSchema, {
    method: "PUT",
    ...jsonBody(settings),
  });
}

export function fetchReannotationQueue(): Promise<ReannotationItem[]> {
  return apiRequest("/quality/reannotation-queue", z.array(reannotationItemSchema));
}

// ---------------------------------------------------------------------------
// Analítica exploratoria (APP 06)
// ---------------------------------------------------------------------------

export const embeddingPointSchema = z.object({
  image_id: z.number(),
  file_name: z.string(),
  x: z.number(),
  y: z.number(),
  category_ids: z.array(z.number()),
  box_count: z.number(),
});
export type EmbeddingPoint = z.infer<typeof embeddingPointSchema>;

export const embeddingsViewSchema = z.object({
  datasetVersion: z.string(),
  method: z.enum(["pca", "tsne", "umap"]),
  generatedAt: z.string(),
  explainedVariance: z.array(z.number()),
  categories: z.array(categoryRefSchema),
  points: z.array(embeddingPointSchema),
});
export type EmbeddingsView = z.infer<typeof embeddingsViewSchema>;

export function fetchEmbeddings(): Promise<EmbeddingsView> {
  return apiRequest("/quality/embeddings", embeddingsViewSchema);
}
