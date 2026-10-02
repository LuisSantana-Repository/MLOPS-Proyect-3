import { z } from 'zod';

/**
 * SPEC-QUALITY-API-001 — Contrato de los artefactos del pipeline de calidad.
 *
 * Este archivo es la frontera entre Frente 2 (pipeline) y Frente 3 (portal).
 * Todo lo que el portal muestra sale de aquí: si un artefacto no cumple el
 * contrato, se rechaza ruidosamente en vez de renderizar `undefined`/`NaN`.
 *
 * Los artefactos viven en `QUALITY_ARTIFACTS_DIR` y los produce el pipeline
 * (release.json, embeddings.json) o el proceso de release (versions.json).
 */

export const severitySchema = z.enum(['warn', 'fail']);
export type Severity = z.infer<typeof severitySchema>;

export const checkStatusSchema = z.enum(['pass', 'warn', 'fail']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const categoryRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type CategoryRef = z.infer<typeof categoryRefSchema>;

export const datasetTotalsSchema = z.object({
  images: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
});
export type DatasetTotals = z.infer<typeof datasetTotalsSchema>;

/** `observed` y `samples` son diccionarios con forma distinta por check:
 * se validan como JSON genérico para no acoplar el portal a cada analizador. */
const observedSchema = z.record(z.string(), z.unknown());
const sampleSchema = z.record(z.string(), z.unknown());

export const checkResultSchema = z.object({
  name: z.string(),
  status: checkStatusSchema,
  severity: severitySchema,
  threshold: z.number(),
  observed: observedSchema,
  samples: z.array(sampleSchema),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const qualityGateSchema = z.object({
  checks: z.array(checkResultSchema),
  overall_status: z.enum(['pass', 'fail']),
  exit_code: z.number().int(),
});
export type QualityGate = z.infer<typeof qualityGateSchema>;

// ---------------------------------------------------------------------------
// Reportes de los cinco analizadores (CAL 03-07)
// ---------------------------------------------------------------------------

export const offendingSampleSchema = z.object({
  annotation_id: z.number().int(),
  image_id: z.number().int(),
  category_id: z.number().int(),
  width: z.number(),
  height: z.number(),
});
export type OffendingSample = z.infer<typeof offendingSampleSchema>;

export const smallObjectsReportSchema = z.object({
  threshold_px: z.number(),
  severity: severitySchema,
  total_annotations: z.number().int(),
  small_count: z.number().int(),
  small_percent: z.number(),
  percent_by_category: z.record(z.string(), z.number()),
  most_affected_category_id: z.number().int().nullable(),
  offending_samples: z.array(offendingSampleSchema),
});
export type SmallObjectsReport = z.infer<typeof smallObjectsReportSchema>;

export const classDistributionSchema = z.object({
  category_id: z.number().int(),
  distinct_image_count: z.number().int(),
  box_count: z.number().int(),
});
export type ClassDistribution = z.infer<typeof classDistributionSchema>;

export const classImbalanceReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  distributions: z.array(classDistributionSchema),
  majority_category_id: z.number().int().nullable(),
  minority_category_id: z.number().int().nullable(),
  ratio: z.number().nullable(),
  classes_below_min_images: z.array(z.number().int()),
});
export type ClassImbalanceReport = z.infer<typeof classImbalanceReportSchema>;

export const duplicatePairSchema = z.object({
  image_id_a: z.number().int(),
  image_id_b: z.number().int(),
  distance: z.number().int(),
  similarity_percent: z.number(),
});
export type DuplicatePair = z.infer<typeof duplicatePairSchema>;

export const duplicatesReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  pairs: z.array(duplicatePairSchema),
  duplicate_groups: z.array(z.array(z.number().int())),
});
export type DuplicatesReport = z.infer<typeof duplicatesReportSchema>;

export const invalidBoxSchema = z.object({
  annotation_id: z.number().int(),
  image_id: z.number().int(),
  bbox: z.array(z.number()),
  reasons: z.array(z.string()),
});
export type InvalidBox = z.infer<typeof invalidBoxSchema>;

export const invalidBoxesReportSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  total_annotations: z.number().int(),
  invalid_count: z.number().int(),
  invalid_boxes: z.array(invalidBoxSchema),
});
export type InvalidBoxesReport = z.infer<typeof invalidBoxesReportSchema>;

export const spatialStatsSchema = z.object({
  count: z.number().int(),
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

export const analyzersBundleSchema = z.object({
  small_objects: smallObjectsReportSchema,
  class_imbalance: classImbalanceReportSchema,
  duplicates: duplicatesReportSchema,
  invalid_boxes: invalidBoxesReportSchema,
  spatial_bias: spatialBiasReportSchema,
});
export type AnalyzersBundle = z.infer<typeof analyzersBundleSchema>;

// ---------------------------------------------------------------------------
// Splits (CAL 09) y conteo antes/después de duplicados (CAL 10)
// ---------------------------------------------------------------------------

export const classCountComparisonSchema = z.object({
  category_id: z.number().int(),
  distinct_images_before: z.number().int(),
  distinct_images_after: z.number().int(),
});
export type ClassCountComparison = z.infer<typeof classCountComparisonSchema>;

export const reannotationQueueItemSchema = z.object({
  annotation_id: z.number().int(),
  image_id: z.number().int(),
  reason: z.string(),
  analyzer: z.string(),
  severity: severitySchema,
});
export type ReannotationQueueItem = z.infer<typeof reannotationQueueItemSchema>;

export const splitDistributionSchema = z.object({
  split: z.enum(['train', 'val', 'test']),
  total_images: z.number().int(),
  category_counts: z.record(z.string(), z.number().int()),
});
export type SplitDistribution = z.infer<typeof splitDistributionSchema>;

export const leakageReportSchema = z.object({
  id_intersection_size: z.number().int(),
  cross_split_duplicate_pairs: z.number().int(),
  duplicate_groups_within_one_split: z.number().int(),
  leaked_image_ids: z.array(z.number().int()),
  all_classes_in_val: z.boolean(),
  all_classes_in_test: z.boolean(),
});
export type LeakageReport = z.infer<typeof leakageReportSchema>;

export const splitsBundleSchema = z.object({
  seed: z.number().int(),
  proportions: z.record(z.string(), z.number()),
  assignment: z.object({
    train: z.array(z.number().int()),
    val: z.array(z.number().int()),
    test: z.array(z.number().int()),
  }),
  distribution: z.array(splitDistributionSchema),
  leakage: leakageReportSchema,
});
export type SplitsBundle = z.infer<typeof splitsBundleSchema>;

// ---------------------------------------------------------------------------
// release.json — documento raíz de Frente 2
// ---------------------------------------------------------------------------

export const releaseBundleSchema = z.object({
  schema_version: z.literal(1),
  dataset_version: z.string(),
  generated_at: z.string(),
  seed: z.number().int(),
  totals: datasetTotalsSchema,
  categories: z.array(categoryRefSchema),
  quality: qualityGateSchema,
  analyzers: analyzersBundleSchema,
  class_counts: z.array(classCountComparisonSchema),
  splits: splitsBundleSchema,
  reannotation_queue: z.array(reannotationQueueItemSchema),
});
export type ReleaseBundle = z.infer<typeof releaseBundleSchema>;

// ---------------------------------------------------------------------------
// embeddings.json — APP 06 (coordenadas precomputadas offline)
// ---------------------------------------------------------------------------

export const embeddingPointSchema = z.object({
  image_id: z.number().int(),
  file_name: z.string(),
  x: z.number(),
  y: z.number(),
  category_ids: z.array(z.number().int()),
  box_count: z.number().int(),
});
export type EmbeddingPoint = z.infer<typeof embeddingPointSchema>;

export const embeddingBundleSchema = z.object({
  schema_version: z.literal(1),
  method: z.enum(['pca', 'tsne', 'umap']),
  generated_at: z.string(),
  explained_variance: z.array(z.number()),
  feature_names: z.array(z.string()),
  points: z.array(embeddingPointSchema),
});
export type EmbeddingBundle = z.infer<typeof embeddingBundleSchema>;

// ---------------------------------------------------------------------------
// versions.json — handoff de release (Andrés / REL 02)
// ---------------------------------------------------------------------------

export const versionEnvironmentSchema = z.object({
  status: z.enum(['pushed', 'not_pushed']),
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
  totals: datasetTotalsSchema,
  metrics: z.object({
    smallObjectsPercent: z.number(),
    classImbalanceRatio: z.number(),
    duplicateGroups: z.number().int(),
    invalidBoxes: z.number().int(),
  }),
  classCounts: z.array(
    z.object({
      categoryId: z.number().int(),
      distinctImages: z.number().int(),
    }),
  ),
});
export type VersionEntry = z.infer<typeof versionEntrySchema>;

export const versionsFileSchema = z.object({
  minimumImagesPerClass: z.number().int(),
  versions: z.array(versionEntrySchema),
});
export type VersionsFile = z.infer<typeof versionsFileSchema>;

// ---------------------------------------------------------------------------
// quality.yaml — política editable desde Settings (APP 05)
// ---------------------------------------------------------------------------

/** Los seis checks que la compuerta exige siempre (espejo de Frente 2). */
export const REQUIRED_CHECK_NAMES = [
  'min_images_per_class',
  'small_objects',
  'class_imbalance',
  'duplicates',
  'invalid_boxes',
  'spatial_bias',
] as const;

export const checkConfigSchema = z.object({
  threshold: z.number(),
  severity: severitySchema,
  min_classes: z.number().int().min(1).optional(),
});
export type CheckConfig = z.infer<typeof checkConfigSchema>;

export const splitConfigSchema = z
  .object({
    train: z.number().gt(0).lt(1),
    val: z.number().gt(0).lt(1),
    test: z.number().gt(0).lt(1),
    seed: z.number().int(),
  })
  .superRefine((value, context) => {
    const total = value.train + value.val + value.test;
    if (Math.abs(total - 1) > 1e-6) {
      context.addIssue({
        code: 'custom',
        path: ['train'],
        message: `train + val + test deben sumar 1.0 (suman ${total})`,
      });
    }
  });
export type SplitConfig = z.infer<typeof splitConfigSchema>;

export const qualityConfigSchema = z
  .object({
    checks: z.record(z.string(), checkConfigSchema),
    splits: splitConfigSchema,
  })
  .superRefine((value, context) => {
    const missing = REQUIRED_CHECK_NAMES.filter((name) => !(name in value.checks));
    if (missing.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: `Faltan checks obligatorios: ${missing.join(', ')}`,
      });
    }
  });
export type QualityConfig = z.infer<typeof qualityConfigSchema>;

// ---------------------------------------------------------------------------
// Parseo (lanza ZodError con la ruta del campo inválido)
// ---------------------------------------------------------------------------

export function parseReleaseBundle(raw: unknown): ReleaseBundle {
  return releaseBundleSchema.parse(raw);
}

export function parseEmbeddings(raw: unknown): EmbeddingBundle {
  return embeddingBundleSchema.parse(raw);
}

export function parseVersions(raw: unknown): VersionsFile {
  return versionsFileSchema.parse(raw);
}

export function parseQualityConfig(raw: unknown): QualityConfig {
  return qualityConfigSchema.parse(raw);
}
