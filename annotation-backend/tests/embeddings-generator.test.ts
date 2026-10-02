import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeEmbeddings } from '../src/logic/quality/embeddings.generator.js';
import { runPrecomputeEmbeddings } from '../src/tools/precompute-embeddings.js';

const COCO = {
  images: [
    { id: 1, file_name: 'a.jpg', width: 100, height: 100 },
    { id: 2, file_name: 'b.jpg', width: 200, height: 100 },
    { id: 3, file_name: 'c.jpg', width: 100, height: 200 },
    { id: 4, file_name: 'd.jpg', width: 100, height: 100 },
  ],
  categories: [
    { id: 1, name: 'car' },
    { id: 2, name: 'person' },
  ],
  annotations: [
    { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 50, 50], area: 2500, iscrowd: 0 },
    { id: 2, image_id: 1, category_id: 2, bbox: [10, 10, 20, 30], area: 600, iscrowd: 0 },
    { id: 3, image_id: 2, category_id: 1, bbox: [0, 0, 100, 50], area: 5000, iscrowd: 0 },
    { id: 4, image_id: 3, category_id: 2, bbox: [0, 0, 40, 80], area: 3200, iscrowd: 0 },
    { id: 5, image_id: 4, category_id: 1, bbox: [5, 5, 10, 10], area: 100, iscrowd: 0 },
    { id: 6, image_id: 4, category_id: 2, bbox: [5, 5, 10, 10], area: 100, iscrowd: 0 },
  ],
};

/**
 * SPEC-APP06-001 — Generación reproducible de embeddings.json (PCA offline).
 *
 * El artefacto no debe existir solo como fixture: este paso lo produce de
 * forma determinista a partir del COCO, así que puede integrarse al pipeline.
 */
describe('SPEC-APP06-001 — embeddings precomputados', () => {
  it('produce un punto por imagen con coordenadas normalizadas en [-1, 1]', () => {
    const bundle = computeEmbeddings(COCO, { generatedAt: '2026-09-18T00:00:00+00:00' });

    expect(bundle.schema_version).toBe(1);
    expect(bundle.method).toBe('pca');
    expect(bundle.points).toHaveLength(4);
    expect(bundle.explained_variance).toHaveLength(2);
    for (const point of bundle.points) {
      expect(point.x).toBeGreaterThanOrEqual(-1);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(-1);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it('es reproducible: misma entrada, mismas coordenadas', () => {
    const first = computeEmbeddings(COCO, { generatedAt: 'x' });
    const second = computeEmbeddings(COCO, { generatedAt: 'x' });

    expect(first.points).toEqual(second.points);
    expect(first.explained_variance).toEqual(second.explained_variance);
  });

  it('transporta categorías y número de cajas por imagen', () => {
    const bundle = computeEmbeddings(COCO, { generatedAt: 'x' });
    const image1 = bundle.points.find((point) => point.image_id === 1);

    expect(image1?.category_ids).toEqual([1, 2]);
    expect(image1?.box_count).toBe(2);
    expect(image1?.file_name).toBe('a.jpg');
  });

  it('escribe embeddings.json a disco a partir de un COCO', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'embeddings-gen-'));
    const cocoPath = path.join(dir, 'dataset.json');
    const outputPath = path.join(dir, 'embeddings.json');
    await writeFile(cocoPath, JSON.stringify(COCO), 'utf-8');

    try {
      await runPrecomputeEmbeddings({
        cocoPath,
        outputPath,
        generatedAt: '2026-09-18T00:00:00+00:00',
      });

      const written = JSON.parse(await readFile(outputPath, 'utf-8')) as {
        method: string;
        points: unknown[];
      };
      expect(written.method).toBe('pca');
      expect(written.points).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
