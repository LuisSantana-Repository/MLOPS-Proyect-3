import { describe, expect, it } from 'vitest';
import { computeEmbeddings } from '../src/logic/quality/embeddings.generator.js';

/**
 * SPEC-APP06-001 — La matemática del PCA, contra valores calculados aparte.
 *
 * Los valores de referencia salen de un PCA hecho con NumPy (`numpy.linalg.eigh`
 * sobre la misma matriz de features), no de esta implementación: así una
 * prueba que solo comparara la salida contra sí misma no puede ocultar un
 * error de fórmula. Los tests anteriores de `embeddings-generator.test.ts`
 * miden forma y reproducibilidad, no los números.
 */

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

// |x|, |y| por imagen según NumPy. Se compara el valor absoluto porque el
// signo de un autovector es arbitrario y no es parte del contrato.
const EXPECTED_ABS_SCORES: Record<number, [number, number]> = {
  1: [0.011735, 0.540201],
  2: [1.0, 0.537495],
  3: [0.948072, 0.598897],
  4: [0.040193, 0.596191],
};

// Autovalores 0.335730, 0.228726, 0.009523 y traza 0.573980 (NumPy).
const EXPECTED_EXPLAINED_VARIANCE: [number, number] = [0.5849157919612035, 0.3984922010383814];

const bundle = computeEmbeddings(COCO, { generatedAt: 'x' });

describe('SPEC-APP06-001 — varianza explicada', () => {
  it('es la fracción de la varianza TOTAL, no de la suma de los dos componentes', () => {
    expect(bundle.explained_variance[0]).toBeCloseTo(EXPECTED_EXPLAINED_VARIANCE[0], 6);
    expect(bundle.explained_variance[1]).toBeCloseTo(EXPECTED_EXPLAINED_VARIANCE[1], 6);
  });

  it('dos componentes dejan varianza sin explicar cuando hay un tercer autovalor', () => {
    const explained = bundle.explained_variance.reduce((acc, value) => acc + value, 0);

    expect(explained).toBeLessThan(1);
    expect(explained).toBeCloseTo(0.9834079929995849, 6);
  });

  it('el primer componente explica al menos tanto como el segundo', () => {
    const [first = 0, second = 0] = bundle.explained_variance;

    expect(first).toBeGreaterThanOrEqual(second);
  });
});

describe('SPEC-APP06-001 — coordenadas', () => {
  it('coinciden en valor absoluto con el PCA de referencia', () => {
    for (const point of bundle.points) {
      const [x, y] = EXPECTED_ABS_SCORES[point.image_id] ?? [Number.NaN, Number.NaN];

      expect(Math.abs(point.x)).toBeCloseTo(x, 5);
      expect(Math.abs(point.y)).toBeCloseTo(y, 5);
    }
  });

  it('están centradas: cada componente suma cero', () => {
    const sumX = bundle.points.reduce((acc, point) => acc + point.x, 0);
    const sumY = bundle.points.reduce((acc, point) => acc + point.y, 0);

    expect(sumX).toBeCloseTo(0, 9);
    expect(sumY).toBeCloseTo(0, 9);
  });

  it('están escaladas para que el máximo absoluto sea exactamente 1', () => {
    const maxAbs = Math.max(
      ...bundle.points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]),
    );

    expect(maxAbs).toBeCloseTo(1, 12);
  });
});
