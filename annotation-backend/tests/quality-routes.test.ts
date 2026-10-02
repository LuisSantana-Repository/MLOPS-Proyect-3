import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQualityRouter } from '../src/ui/quality.routes.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

let baseUrl: string;
let closeServer: () => Promise<void>;

async function listenWithArtifacts(
  artifactsDir: string,
  configPath: string,
): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(createQualityRouter({ artifactsDir, configPath }));
  const listener = app.listen(0);
  await once(listener, 'listening');
  const address = listener.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      listener.close();
      await once(listener, 'close');
    },
  };
}

beforeAll(async () => {
  const instance = await listenWithArtifacts(FIXTURES, path.join(FIXTURES, 'quality.yaml'));
  baseUrl = instance.baseUrl;
  closeServer = instance.close;
});

afterAll(async () => {
  await closeServer();
});

/**
 * SPEC-QUALITY-API-007 — Pruebas de los endpoints HTTP reales contra los
 * fixtures tipados. Se levanta un servidor efímero y se consume con fetch,
 * así que se valida el contrato de red, los códigos de estado y el estado
 * "sin datos" sin mocks.
 */
describe('SPEC-QUALITY-API-007 — endpoints /quality', () => {
  it('GET /quality/overview devuelve totales y estado del gate', async () => {
    const response = await fetch(`${baseUrl}/quality/overview`);
    const body = (await response.json()) as {
      totals: { images: number };
      gate: { overallStatus: string; failCount: number };
      datasetVersion: string;
    };

    expect(response.status).toBe(200);
    expect(body.datasetVersion).toBe('v1.0.0-demo');
    expect(body.totals.images).toBe(12);
    expect(body.gate.overallStatus).toBe('fail');
    expect(body.gate.failCount).toBe(1);
  });

  it('GET /quality/analyzers devuelve los cinco reportes', async () => {
    const response = await fetch(`${baseUrl}/quality/analyzers`);
    const body = (await response.json()) as {
      smallObjects: { small_count: number };
      duplicates: { duplicate_groups: number[][] };
      invalidBoxes: { invalid_count: number };
    };

    expect(response.status).toBe(200);
    expect(body.smallObjects.small_count).toBe(2);
    expect(body.duplicates.duplicate_groups).toEqual([[11, 12]]);
    expect(body.invalidBoxes.invalid_count).toBe(1);
  });

  it('GET /quality/splits devuelve distribución y leakage', async () => {
    const response = await fetch(`${baseUrl}/quality/splits`);
    const body = (await response.json()) as {
      leakage: { cross_split_duplicate_pairs: number };
      distribution: { split: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.leakage.cross_split_duplicate_pairs).toBe(0);
    expect(body.distribution.map((entry) => entry.split)).toEqual(['train', 'val', 'test']);
  });

  it('GET /quality/versions devuelve las versiones con estado DEV/PROD', async () => {
    const response = await fetch(`${baseUrl}/quality/versions`);
    const body = (await response.json()) as { versions: { version: string }[] };

    expect(response.status).toBe(200);
    expect(body.versions.map((entry) => entry.version)).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('GET /quality/versions/diff calcula el diff entre dos versiones', async () => {
    const response = await fetch(`${baseUrl}/quality/versions/diff?from=v1.0.0&to=v1.1.0`);
    const body = (await response.json()) as {
      imagesAdded: number;
      classesThatLeftMinimum: number[];
    };

    expect(response.status).toBe(200);
    expect(body.imagesAdded).toBe(370);
    expect(body.classesThatLeftMinimum).toEqual([3]);
  });

  it('GET /quality/versions/diff sin parámetros responde 400', async () => {
    const response = await fetch(`${baseUrl}/quality/versions/diff`);

    expect(response.status).toBe(400);
  });

  it('GET /quality/versions/diff con una versión inexistente responde 404', async () => {
    const response = await fetch(`${baseUrl}/quality/versions/diff?from=v1.0.0&to=v9.9.9`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/v9\.9\.9/);
  });

  it('GET /quality/overview sin artefactos responde 404 (estado "sin datos")', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'quality-empty-'));
    const instance = await listenWithArtifacts(emptyDir, path.join(FIXTURES, 'quality.yaml'));
    try {
      const response = await fetch(`${instance.baseUrl}/quality/overview`);
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(body.error).toMatch(/release\.json/);
    } finally {
      await instance.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('GET /quality/embeddings devuelve los puntos precomputados con categorías', async () => {
    const response = await fetch(`${baseUrl}/quality/embeddings`);
    const body = (await response.json()) as {
      method: string;
      points: unknown[];
      categories: unknown[];
      datasetVersion: string;
    };

    expect(response.status).toBe(200);
    expect(body.method).toBe('pca');
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.datasetVersion).toBe('v1.0.0-demo');
  });

  it('GET /quality/settings devuelve la política de calidad', async () => {
    const response = await fetch(`${baseUrl}/quality/settings`);
    const body = (await response.json()) as {
      checks: Record<string, { threshold: number; severity: string }>;
      splits: { seed: number };
    };

    expect(response.status).toBe(200);
    expect(body.checks.min_images_per_class?.threshold).toBe(300);
    expect(body.splits.seed).toBe(42);
  });

  it('PUT /quality/settings con una política inválida responde 400', async () => {
    const response = await fetch(`${baseUrl}/quality/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checks: {},
        splits: { train: 0.9, val: 0.15, test: 0.15, seed: 42 },
      }),
    });

    expect(response.status).toBe(400);
  });
});
