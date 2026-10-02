import { NotFoundError } from '../errors.js';
import type {
  AnalyzersBundle,
  CategoryRef,
  CheckResult,
  ClassCountComparison,
  DatasetTotals,
  EmbeddingBundle,
  LeakageReport,
  ReleaseBundle,
  SplitDistribution,
  VersionEntry,
  VersionsFile,
} from './contracts.js';

/**
 * SPEC-QUALITY-API-002..005 — Proyecciones puras del artefacto de calidad.
 *
 * Igual que `dashboard.builder.ts`: estas funciones reciben datos ya
 * validados y devuelven exactamente el contrato que consume el frontend.
 * No leen archivos, no leen el entorno y no abren conexiones, así que se
 * prueban con fixtures sin servicios externos (CAL 00 aplicado al portal).
 */

export interface GateSummary {
  overallStatus: 'pass' | 'fail';
  exitCode: number;
  passCount: number;
  warnCount: number;
  failCount: number;
}

export interface OverviewView {
  datasetVersion: string;
  generatedAt: string;
  totals: DatasetTotals;
  gate: GateSummary;
  checks: CheckResult[];
}

export interface AnalyzersView {
  datasetVersion: string;
  categories: CategoryRef[];
  smallObjects: AnalyzersBundle['small_objects'];
  classImbalance: AnalyzersBundle['class_imbalance'];
  duplicates: AnalyzersBundle['duplicates'];
  invalidBoxes: AnalyzersBundle['invalid_boxes'];
  spatialBias: AnalyzersBundle['spatial_bias'];
}

export interface SplitsView {
  datasetVersion: string;
  seed: number;
  proportions: Record<string, number>;
  assignment: ReleaseBundle['splits']['assignment'];
  distribution: SplitDistribution[];
  leakage: LeakageReport;
  classCounts: ClassCountComparison[];
  categories: CategoryRef[];
}

export interface VersionDiff {
  from: string;
  to: string;
  imagesAdded: number;
  annotationsAdded: number;
  smallObjectsPercentDelta: number;
  classImbalanceRatioDelta: number;
  duplicateGroupsDelta: number;
  invalidBoxesDelta: number;
  classesThatLeftMinimum: number[];
  classesThatEnteredMinimum: number[];
  classCountChanges: ClassCountChange[];
  totals: { from: DatasetTotals; to: DatasetTotals };
}

export interface ClassCountChange {
  categoryId: number;
  from: number;
  to: number;
  delta: number;
}

export interface EmbeddingsView {
  datasetVersion: string;
  method: EmbeddingBundle['method'];
  generatedAt: string;
  explainedVariance: number[];
  categories: CategoryRef[];
  points: EmbeddingBundle['points'];
}

function summarizeGate(bundle: ReleaseBundle): GateSummary {
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const check of bundle.quality.checks) {
    if (check.status === 'pass') passCount += 1;
    else if (check.status === 'warn') warnCount += 1;
    else failCount += 1;
  }

  return {
    overallStatus: bundle.quality.overall_status,
    exitCode: bundle.quality.exit_code,
    passCount,
    warnCount,
    failCount,
  };
}

export function buildOverview(bundle: ReleaseBundle): OverviewView {
  return {
    datasetVersion: bundle.dataset_version,
    generatedAt: bundle.generated_at,
    totals: bundle.totals,
    gate: summarizeGate(bundle),
    checks: bundle.quality.checks,
  };
}

export function buildAnalyzers(bundle: ReleaseBundle): AnalyzersView {
  return {
    datasetVersion: bundle.dataset_version,
    categories: bundle.categories,
    smallObjects: bundle.analyzers.small_objects,
    classImbalance: bundle.analyzers.class_imbalance,
    duplicates: bundle.analyzers.duplicates,
    invalidBoxes: bundle.analyzers.invalid_boxes,
    spatialBias: bundle.analyzers.spatial_bias,
  };
}

export function buildSplits(bundle: ReleaseBundle): SplitsView {
  return {
    datasetVersion: bundle.dataset_version,
    seed: bundle.splits.seed,
    proportions: bundle.splits.proportions,
    assignment: bundle.splits.assignment,
    distribution: bundle.splits.distribution,
    leakage: bundle.splits.leakage,
    classCounts: bundle.class_counts,
    categories: bundle.categories,
  };
}

/**
 * Enriquiece las coordenadas precomputadas con la versión y los nombres de
 * categoría del release, para que el frontend no tenga que hacer una segunda
 * llamada solo para etiquetar los puntos.
 */
export function buildEmbeddingsView(
  embeddings: EmbeddingBundle,
  release: ReleaseBundle,
): EmbeddingsView {
  return {
    datasetVersion: release.dataset_version,
    method: embeddings.method,
    generatedAt: embeddings.generated_at,
    explainedVariance: embeddings.explained_variance,
    categories: release.categories,
    points: embeddings.points,
  };
}

function findVersion(versions: VersionsFile, version: string): VersionEntry {
  const entry = versions.versions.find((candidate) => candidate.version === version);
  if (!entry) {
    throw new NotFoundError(
      `La versión "${version}" no existe en versions.json (disponibles: ${versions.versions
        .map((candidate) => candidate.version)
        .join(', ')})`,
    );
  }
  return entry;
}

function classCountById(entry: VersionEntry): Map<number, number> {
  return new Map(entry.classCounts.map((row) => [row.categoryId, row.distinctImages]));
}

export function diffVersions(versions: VersionsFile, from: string, to: string): VersionDiff {
  const fromEntry = findVersion(versions, from);
  const toEntry = findVersion(versions, to);
  const minimum = versions.minimumImagesPerClass;

  const fromCounts = classCountById(fromEntry);
  const toCounts = classCountById(toEntry);
  const allCategoryIds = new Set([...fromCounts.keys(), ...toCounts.keys()]);

  const classesThatLeftMinimum: number[] = [];
  const classesThatEnteredMinimum: number[] = [];
  for (const categoryId of [...allCategoryIds].sort((a, b) => a - b)) {
    const before = fromCounts.get(categoryId) ?? 0;
    const after = toCounts.get(categoryId) ?? 0;
    if (before >= minimum && after < minimum) classesThatLeftMinimum.push(categoryId);
    if (before < minimum && after >= minimum) classesThatEnteredMinimum.push(categoryId);
  }

  return {
    from,
    to,
    imagesAdded: toEntry.totals.images - fromEntry.totals.images,
    annotationsAdded: toEntry.totals.annotations - fromEntry.totals.annotations,
    smallObjectsPercentDelta:
      toEntry.metrics.smallObjectsPercent - fromEntry.metrics.smallObjectsPercent,
    classImbalanceRatioDelta:
      toEntry.metrics.classImbalanceRatio - fromEntry.metrics.classImbalanceRatio,
    duplicateGroupsDelta: toEntry.metrics.duplicateGroups - fromEntry.metrics.duplicateGroups,
    invalidBoxesDelta: toEntry.metrics.invalidBoxes - fromEntry.metrics.invalidBoxes,
    classesThatLeftMinimum,
    classesThatEnteredMinimum,
    classCountChanges: [...allCategoryIds]
      .sort((a, b) => a - b)
      .map((categoryId) => {
        const before = fromCounts.get(categoryId) ?? 0;
        const after = toCounts.get(categoryId) ?? 0;
        return { categoryId, from: before, to: after, delta: after - before };
      }),
    totals: { from: fromEntry.totals, to: toEntry.totals },
  };
}
