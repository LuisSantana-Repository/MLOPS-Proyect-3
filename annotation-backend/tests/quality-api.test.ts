import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseEmbeddings,
  parseReleaseBundle,
  parseVersions,
} from '../src/logic/quality/contracts.js';
import {
  buildAnalyzers,
  buildOverview,
  buildSplits,
  diffVersions,
} from '../src/logic/quality/quality.service.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'));
}

/**
 * SPEC-QUALITY-API-001 — Contratos y proyecciones del pipeline de calidad.
 *
 * Se prueban las funciones puras (parseo con Zod + transformación a los
 * view models que consume el portal) contra fixtures tipados que respetan el
 * contrato acordado con Frente 2. Nada de mocks de fetch: si el contrato
 * cambia, estas pruebas fallan antes de tocar el frontend.
 */

describe('SPEC-QUALITY-API-001 — contrato release.json', () => {
  it('acepta un release.json válido y expone totales y categorías', () => {
    const bundle = parseReleaseBundle(readFixture('release.json'));

    expect(bundle.schema_version).toBe(1);
    expect(bundle.dataset_version).toBe('v1.0.0-demo');
    expect(bundle.totals).toEqual({ images: 12, annotations: 15, categories: 3 });
    expect(bundle.categories).toEqual([
      { id: 1, name: 'person' },
      { id: 2, name: 'car' },
      { id: 3, name: 'dog' },
    ]);
  });

  it('rechaza un release.json sin campos obligatorios', () => {
    const raw = readFixture('release.json') as Record<string, unknown>;
    delete raw.quality;

    expect(() => parseReleaseBundle(raw)).toThrowError(/quality/i);
  });

  it('rechaza una severidad inválida en un check', () => {
    const raw = readFixture('release.json') as {
      quality: { checks: { severity: string }[] };
    };
    const firstCheck = raw.quality.checks[0];
    if (!firstCheck) throw new Error('fixture sin checks');
    firstCheck.severity = 'error';

    expect(() => parseReleaseBundle(raw)).toThrowError(/severity/i);
  });
});

describe('SPEC-QUALITY-API-002 — Overview', () => {
  it('cuenta pass/warn/fail y refleja el estado global del gate', () => {
    const overview = buildOverview(parseReleaseBundle(readFixture('release.json')));

    expect(overview.datasetVersion).toBe('v1.0.0-demo');
    expect(overview.totals.images).toBe(12);
    expect(overview.gate.overallStatus).toBe('fail');
    expect(overview.gate.exitCode).toBe(1);
    expect(overview.gate.passCount).toBe(4);
    expect(overview.gate.warnCount).toBe(1);
    expect(overview.gate.failCount).toBe(1);
  });

  it('expone cada check con su umbral y valor observado', () => {
    const overview = buildOverview(parseReleaseBundle(readFixture('release.json')));
    const invalid = overview.checks.find((check) => check.name === 'invalid_boxes');

    expect(invalid?.status).toBe('fail');
    expect(invalid?.threshold).toBe(0);
    expect(invalid?.observed.invalid_count).toBe(1);
  });
});

describe('SPEC-QUALITY-API-003 — Analyzers', () => {
  it('entrega los cinco reportes completos con nombres de categoría', () => {
    const analyzers = buildAnalyzers(parseReleaseBundle(readFixture('release.json')));

    expect(analyzers.datasetVersion).toBe('v1.0.0-demo');
    expect(analyzers.smallObjects.small_count).toBe(2);
    expect(analyzers.classImbalance.distributions).toHaveLength(3);
    expect(analyzers.duplicates.duplicate_groups).toEqual([[11, 12]]);
    expect(analyzers.invalidBoxes.invalid_count).toBe(1);
    expect(analyzers.spatialBias.global_stats.count).toBe(15);
    expect(analyzers.categories.find((c) => c.id === 3)?.name).toBe('dog');
  });
});

describe('SPEC-QUALITY-API-004 — Splits', () => {
  it('expone distribución, conteo antes/después y leakage', () => {
    const splits = buildSplits(parseReleaseBundle(readFixture('release.json')));

    expect(splits.seed).toBe(42);
    expect(splits.distribution.map((d) => d.split)).toEqual(['train', 'val', 'test']);
    expect(splits.leakage.cross_split_duplicate_pairs).toBe(0);
    expect(splits.leakage.all_classes_in_val).toBe(true);
    expect(splits.classCounts.find((c) => c.category_id === 1)).toEqual({
      category_id: 1,
      distinct_images_before: 6,
      distinct_images_after: 5,
    });
  });
});

describe('SPEC-QUALITY-API-005 — Versions', () => {
  it('parsea el archivo de versiones con estado DEV/PROD', () => {
    const versions = parseVersions(readFixture('versions.json'));

    expect(versions.minimumImagesPerClass).toBe(300);
    expect(versions.versions).toHaveLength(2);
    expect(versions.versions[0]?.environments.prod.status).toBe('not_pushed');
    expect(versions.versions[1]?.environments.prod.contentHash).toBe('aa99be71');
  });

  it('calcula el diff entre dos versiones', () => {
    const versions = parseVersions(readFixture('versions.json'));
    const diff = diffVersions(versions, 'v1.0.0', 'v1.1.0');

    expect(diff.from).toBe('v1.0.0');
    expect(diff.to).toBe('v1.1.0');
    expect(diff.imagesAdded).toBe(370);
    expect(diff.annotationsAdded).toBe(2400);
    expect(diff.smallObjectsPercentDelta).toBeCloseTo(-2.6, 5);
    expect(diff.classesThatLeftMinimum).toEqual([3]);
    expect(diff.classesThatEnteredMinimum).toEqual([]);
    expect(diff.classCountChanges).toEqual([
      { categoryId: 1, from: 1400, to: 1600, delta: 200 },
      { categoryId: 2, from: 1300, to: 1500, delta: 200 },
      { categoryId: 3, from: 320, to: 290, delta: -30 },
    ]);
  });

  it('falla con un mensaje claro si la versión no existe', () => {
    const versions = parseVersions(readFixture('versions.json'));

    expect(() => diffVersions(versions, 'v1.0.0', 'v9.9.9')).toThrowError(/v9\.9\.9/);
  });
});

describe('SPEC-QUALITY-API-006 — Embeddings', () => {
  it('parsea los puntos PCA precomputados', () => {
    const embeddings = parseEmbeddings(readFixture('embeddings.json'));

    expect(embeddings.method).toBe('pca');
    expect(embeddings.points).toHaveLength(12);
    expect(embeddings.points[0]?.image_id).toBe(1);
  });
});
