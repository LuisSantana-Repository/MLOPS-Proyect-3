import { z } from 'zod';
import type { EmbeddingBundle } from './contracts.js';

/**
 * SPEC-APP06-001 — Generación reproducible de `embeddings.json` (PCA offline).
 *
 * Este paso NO vive en el request del portal: se corre una vez, sobre el
 * export COCO, y produce las coordenadas 2D que el navegador solo pinta. Es
 * determinista (misma entrada -> mismas coordenadas), así que puede integrarse
 * al pipeline de DVC como una etapa reproducible.
 *
 * La reducción es PCA real: se centran las features por imagen, se calcula la
 * matriz de covarianza y se obtienen los dos componentes principales por
 * iteración de potencias con deflación. Sin dependencias externas.
 */

const cocoInputSchema = z.object({
  images: z.array(
    z.object({
      id: z.number().int(),
      file_name: z.string(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  categories: z.array(z.object({ id: z.number().int(), name: z.string() })),
  annotations: z.array(
    z.object({
      id: z.number().int(),
      image_id: z.number().int(),
      category_id: z.number().int(),
      bbox: z.array(z.number()).length(4),
    }),
  ),
});

type CocoInput = z.infer<typeof cocoInputSchema>;

interface FeatureMatrix {
  rows: number[][];
  featureNames: string[];
  counts: Map<number, number>;
  categoriesByImage: Map<number, Set<number>>;
}

function buildFeatureMatrix(dataset: CocoInput): FeatureMatrix {
  const categoryIds = [...dataset.categories.map((category) => category.id)].sort((a, b) => a - b);
  const imagesById = new Map(dataset.images.map((image) => [image.id, image]));

  const counts = new Map<number, number>();
  const area = new Map<number, number>();
  const centerX = new Map<number, number>();
  const centerY = new Map<number, number>();
  const categoriesByImage = new Map<number, Set<number>>();

  for (const image of dataset.images) {
    counts.set(image.id, 0);
    area.set(image.id, 0);
    centerX.set(image.id, 0);
    centerY.set(image.id, 0);
    categoriesByImage.set(image.id, new Set());
  }

  for (const annotation of dataset.annotations) {
    const image = imagesById.get(annotation.image_id);
    if (!image) continue;
    const [x, y, width, height] = annotation.bbox as [number, number, number, number];
    counts.set(image.id, (counts.get(image.id) ?? 0) + 1);
    area.set(image.id, (area.get(image.id) ?? 0) + (width * height) / (image.width * image.height));
    centerX.set(image.id, (centerX.get(image.id) ?? 0) + (x + width / 2) / image.width);
    centerY.set(image.id, (centerY.get(image.id) ?? 0) + (y + height / 2) / image.height);
    categoriesByImage.get(image.id)?.add(annotation.category_id);
  }

  const featureNames = [
    'log_box_count',
    'mean_relative_area',
    'mean_center_x',
    'mean_center_y',
    ...categoryIds.map((categoryId) => `category_${categoryId}`),
  ];

  const rows = dataset.images.map((image) => {
    const count = counts.get(image.id) ?? 0;
    const divisor = count || 1;
    const present = categoriesByImage.get(image.id) ?? new Set<number>();
    const row = [
      Math.log1p(count),
      (area.get(image.id) ?? 0) / divisor,
      (centerX.get(image.id) ?? 0) / divisor,
      (centerY.get(image.id) ?? 0) / divisor,
    ];
    for (const categoryId of categoryIds) {
      row.push(present.has(categoryId) ? 1 : 0);
    }
    return row;
  });

  return { rows, featureNames, counts, categoriesByImage };
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function matVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(dot(vector, vector));
  if (norm < 1e-12) {
    const value = 1 / Math.sqrt(vector.length || 1);
    return vector.map(() => value);
  }
  return vector.map((component) => component / norm);
}

function covariance(centered: number[][]): number[][] {
  const n = centered.length;
  const d = centered[0]?.length ?? 0;
  const matrix: number[][] = [];
  for (let i = 0; i < d; i++) matrix.push(new Array<number>(d).fill(0));

  for (const row of centered) {
    for (let i = 0; i < d; i++) {
      const rowI = row[i] ?? 0;
      const matrixI = matrix[i];
      if (!matrixI) continue;
      for (let j = 0; j < d; j++) {
        matrixI[j] = (matrixI[j] ?? 0) + rowI * (row[j] ?? 0);
      }
    }
  }

  const denominator = Math.max(1, n - 1);
  for (const row of matrix) {
    for (let j = 0; j < d; j++) row[j] = (row[j] ?? 0) / denominator;
  }
  return matrix;
}

function principalComponents(
  matrix: number[][],
  components: number,
): { vectors: number[][]; values: number[] } {
  const d = matrix.length;
  const working = matrix.map((row) => [...row]);
  const vectors: number[][] = [];
  const values: number[] = [];

  for (let k = 0; k < components; k++) {
    // Inicialización determinista (sin aleatoriedad): reproducible.
    let vector = normalize(Array.from({ length: d }, (_, i) => Math.sin(i + 1 + k) + 0.5));

    for (let iteration = 0; iteration < 1000; iteration++) {
      const next = normalize(matVec(working, vector));
      const delta = next.reduce((acc, value, i) => acc + Math.abs(value - (vector[i] ?? 0)), 0);
      vector = next;
      if (delta < 1e-10) break;
    }

    const value = dot(vector, matVec(working, vector));
    vectors.push(vector);
    values.push(value);

    // Deflación: se elimina el componente encontrado para hallar el siguiente.
    for (let i = 0; i < d; i++) {
      const row = working[i];
      if (!row) continue;
      for (let j = 0; j < d; j++) {
        row[j] = (row[j] ?? 0) - value * (vector[i] ?? 0) * (vector[j] ?? 0);
      }
    }
  }

  return { vectors, values };
}

export interface ComputeEmbeddingsOptions {
  /** Se inyecta para que la generación sea 100% determinista en pruebas. */
  generatedAt: string;
}

export function computeEmbeddings(
  rawCoco: unknown,
  options: ComputeEmbeddingsOptions,
): EmbeddingBundle {
  const dataset = cocoInputSchema.parse(rawCoco);
  const { rows, featureNames, counts, categoriesByImage } = buildFeatureMatrix(dataset);

  let scores: number[][] = [];
  let explainedVariance: number[] = [];

  if (rows.length > 0) {
    const means = (rows[0] ?? []).map((_, columnIndex) => {
      const total = rows.reduce((acc, row) => acc + (row[columnIndex] ?? 0), 0);
      return total / rows.length;
    });
    const centered = rows.map((row) => row.map((value, index) => value - (means[index] ?? 0)));

    const covarianceMatrix = covariance(centered);
    const { vectors, values } = principalComponents(covarianceMatrix, 2);
    scores = centered.map((row) => vectors.map((vector) => dot(row, vector)));

    // La varianza explicada es la fracción de la varianza TOTAL (la traza de la
    // covarianza), no de la suma de los dos componentes retenidos: con esto
    // último los dos siempre sumarían 100% aunque dejaran varianza sin explicar.
    const totalVariance = covarianceMatrix.reduce((acc, row, i) => acc + (row[i] ?? 0), 0);
    explainedVariance = totalVariance > 0 ? values.map((value) => value / totalVariance) : [0, 0];

    // Normaliza a [-1, 1] para que el frontend no tenga que adivinar la escala.
    const maxAbs = Math.max(0, ...scores.flat().map((value) => Math.abs(value)));
    if (maxAbs > 0) {
      scores = scores.map((row) => row.map((value) => value / maxAbs));
    }
  }

  const points = dataset.images.map((image, index) => ({
    image_id: image.id,
    file_name: image.file_name,
    x: scores[index]?.[0] ?? 0,
    y: scores[index]?.[1] ?? 0,
    category_ids: [...(categoriesByImage.get(image.id) ?? new Set<number>())].sort((a, b) => a - b),
    box_count: counts.get(image.id) ?? 0,
  }));

  return {
    schema_version: 1,
    method: 'pca',
    generated_at: options.generatedAt,
    explained_variance: explainedVariance,
    feature_names: featureNames,
    points,
  };
}
