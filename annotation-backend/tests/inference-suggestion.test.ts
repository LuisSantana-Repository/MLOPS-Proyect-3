import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P0-3 — «Enviar a anotación» desde Inference entra al flujo de anotación del
 * portal (Proyecto 1): la imagen queda registrada en `images` como `pending`,
 * con la clase sugerida por el modelo y sus probabilidades como metadato, y se
 * encuentra desde la búsqueda que alimenta la vista de anotación.
 *
 * Prueba de integración de la capa Logic (subida + búsqueda + detalle) sobre
 * una capa Data en memoria: no necesita MariaDB ni MinIO.
 */

interface Row {
  id: number;
  filename: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: 'pending' | 'in_progress' | 'completed';
  suggestedCategory: string | null;
  suggestedProbabilities: string | null;
  suggestedModelVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const store = vi.hoisted(() => ({
  rows: [] as unknown[],
  objects: new Map<string, Buffer>(),
}));

vi.mock('../src/config/env.js', () => ({
  env: { MAX_UPLOAD_SIZE_BYTES: 5 * 1024 * 1024 },
}));

vi.mock('../src/data/index.js', () => {
  const rows = () => store.rows as Row[];
  return {
    uploadImageObject: async (key: string, buffer: Buffer) => {
      store.objects.set(key, buffer);
    },
    deleteImageObject: async (key: string) => {
      store.objects.delete(key);
    },
    // Igual que la tabla real: `status` nace en 'pending' (default de la columna).
    createImageMetadata: async (image: Partial<Row>) => {
      const id = rows().length + 1;
      const now = new Date();
      rows().push({
        suggestedCategory: null,
        suggestedProbabilities: null,
        suggestedModelVersion: null,
        ...image,
        id,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      } as Row);
      return id;
    },
    findImageById: async (id: number) => rows().find((row) => row.id === id) ?? null,
    deleteImageRow: async () => undefined,
    findImages: async (options: { status?: string | string[] }) => {
      const statuses = options.status ? [options.status].flat() : null;
      const data = rows().filter((row) => !statuses || statuses.includes(row.status));
      return { data, total: data.length };
    },
    countAnnotationsForImages: async () => new Map(),
    findCategoriesForImages: async () => new Map(),
  };
});

import { searchImages } from '../src/logic/image-search.service.js';
import { parseModelSuggestion } from '../src/logic/image-suggestion.js';
import { getImageDetail, uploadImage } from '../src/logic/image-upload.service.js';

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 6, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer();
}

/** El cuerpo multipart que manda el portal desde Inference. */
const FROM_INFERENCE = {
  suggestedCategory: 'car',
  suggestedProbabilities: JSON.stringify({ car: 0.92, person: 0.08 }),
  suggestedModelVersion: '1.0.0',
};

beforeEach(() => {
  store.rows = [];
  store.objects.clear();
});

describe('P0-3 — la imagen enviada desde Inference entra al flujo de anotación', () => {
  it('queda registrada como pendiente, con la clase sugerida y las probabilidades', async () => {
    const buffer = await jpeg();
    const uploaded = await uploadImage({
      filename: 'inference-car.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: buffer.length,
      buffer,
      suggestion: parseModelSuggestion(FROM_INFERENCE),
    });

    expect(uploaded).toMatchObject({
      id: 1,
      status: 'pending',
      suggestion: {
        category: 'car',
        probabilities: { car: 0.92, person: 0.08 },
        modelVersion: '1.0.0',
      },
    });
    // El binario quedó guardado en el almacenamiento de objetos del portal.
    expect(store.objects.has(uploaded.storageKey)).toBe(true);
  });

  it('aparece en la búsqueda de pendientes que alimenta la vista de anotación', async () => {
    const buffer = await jpeg();
    const uploaded = await uploadImage({
      filename: 'inference-car.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: buffer.length,
      buffer,
      suggestion: parseModelSuggestion(FROM_INFERENCE),
    });

    const pending = await searchImages({
      status: ['pending', 'in_progress'],
      page: 1,
      pageSize: 50,
    });

    expect(pending.pagination.total).toBe(1);
    expect(pending.data[0]).toMatchObject({
      id: uploaded.id,
      status: 'pending',
      annotationsCount: 0,
      thumbnailUrl: `/images/${uploaded.id}/file`,
      suggestion: { category: 'car', modelVersion: '1.0.0' },
    });
    // Ya completadas no: sigue pendiente de que una persona la anote.
    const completed = await searchImages({ status: 'completed', page: 1, pageSize: 50 });
    expect(completed.pagination.total).toBe(0);
  });

  it('la pantalla de anotación puede leer la sugerencia de esa imagen', async () => {
    const buffer = await jpeg();
    const uploaded = await uploadImage({
      filename: 'inference-car.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: buffer.length,
      buffer,
      suggestion: parseModelSuggestion(FROM_INFERENCE),
    });

    const detail = await getImageDetail(uploaded.id);

    expect(detail.status).toBe('pending');
    expect(detail.suggestion).toEqual({
      category: 'car',
      probabilities: { car: 0.92, person: 0.08 },
      modelVersion: '1.0.0',
    });
  });

  it('una subida manual (sin sugerencia) sigue funcionando igual', async () => {
    const buffer = await jpeg();
    const uploaded = await uploadImage({
      filename: 'manual.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: buffer.length,
      buffer,
    });

    expect(uploaded.suggestion).toBeNull();
    expect((await getImageDetail(uploaded.id)).suggestion).toBeNull();
  });
});

describe('P0-3 — validación de la sugerencia en POST /images', () => {
  it('sin campos de sugerencia devuelve null', () => {
    expect(parseModelSuggestion({})).toBeNull();
    expect(parseModelSuggestion(undefined)).toBeNull();
  });

  it.each([
    ['falta la versión del modelo', { ...FROM_INFERENCE, suggestedModelVersion: '' }],
    ['probabilidades que no son JSON', { ...FROM_INFERENCE, suggestedProbabilities: '{car' }],
    [
      'probabilidad fuera de [0, 1]',
      { ...FROM_INFERENCE, suggestedProbabilities: JSON.stringify({ car: 1.5, person: 0 }) },
    ],
    ['una sola clase', { ...FROM_INFERENCE, suggestedProbabilities: JSON.stringify({ car: 1 }) }],
    [
      'clase sugerida que no está en las probabilidades',
      { ...FROM_INFERENCE, suggestedCategory: 'dog' },
    ],
  ])('rechaza: %s', (_name, body) => {
    expect(() => parseModelSuggestion(body)).toThrow(/Sugerencia del modelo|JSON válido/);
  });
});
