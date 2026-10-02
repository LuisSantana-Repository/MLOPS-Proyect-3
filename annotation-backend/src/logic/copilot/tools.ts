import { z } from 'zod';
import {
  getAnalyzers,
  getOverview,
  getReannotationQueue,
  getSplits,
  getVersionDiff,
  getVersions,
} from '../quality/quality-artifacts.service.js';

/**
 * SPEC-COPILOT-001 — Registry de herramientas de SOLO LECTURA.
 *
 * Cada tool consulta los artefactos del pipeline y devuelve su resultado
 * junto con la versión del dataset y el archivo de procedencia. Ninguna
 * función de este módulo escribe: no hay INSERT/UPDATE/DELETE/put_object.
 * El mismo registry lo usan el servidor MCP y el Dataset Copilot, así que
 * las cifras del chat y de las pantallas salen de la misma fuente.
 */

export interface ToolOutput {
  datasetVersion: string | null;
  source: string;
  data: unknown;
}

export interface CopilotTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (raw: unknown) => Promise<ToolOutput>;
}

const noArgs = z.object({});
const compareArgs = z.object({ from: z.string().min(1), to: z.string().min(1) });

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

export function buildQualityTools(artifactsDir: string): CopilotTool[] {
  return [
    {
      name: 'get_dataset_overview',
      description:
        'Resumen del dataset: totales de imágenes, cajas y categorías, y estado de la compuerta de calidad.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const overview = await getOverview(artifactsDir);
        return { datasetVersion: overview.datasetVersion, source: 'release.json', data: overview };
      },
    },
    {
      name: 'get_class_distribution',
      description:
        'Distribución de imágenes distintas y cajas por clase, ratio de desbalance y clases bajo el mínimo.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const analyzers = await getAnalyzers(artifactsDir);
        return {
          datasetVersion: analyzers.datasetVersion,
          source: 'release.json',
          data: {
            categories: analyzers.categories,
            classImbalance: analyzers.classImbalance,
          },
        };
      },
    },
    {
      name: 'get_small_objects',
      description:
        'Porcentaje de objetos por debajo del umbral de tamaño, clase más afectada y muestras ofensoras.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const analyzers = await getAnalyzers(artifactsDir);
        return {
          datasetVersion: analyzers.datasetVersion,
          source: 'release.json',
          data: analyzers.smallObjects,
        };
      },
    },
    {
      name: 'get_duplicates',
      description:
        'Pares y grupos de imágenes duplicadas o visualmente cercanas detectadas por pHash.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const analyzers = await getAnalyzers(artifactsDir);
        return {
          datasetVersion: analyzers.datasetVersion,
          source: 'release.json',
          data: analyzers.duplicates,
        };
      },
    },
    {
      name: 'get_invalid_boxes',
      description: 'Cajas inválidas o degeneradas detectadas, con el motivo de cada una.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const analyzers = await getAnalyzers(artifactsDir);
        return {
          datasetVersion: analyzers.datasetVersion,
          source: 'release.json',
          data: analyzers.invalidBoxes,
        };
      },
    },
    {
      name: 'get_splits',
      description:
        'Particiones train/val/test: distribución por clase, semilla y reporte de fuga entre particiones.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const splits = await getSplits(artifactsDir);
        return { datasetVersion: splits.datasetVersion, source: 'release.json', data: splits };
      },
    },
    {
      name: 'get_versions',
      description: 'Versiones publicadas del dataset con su estado en DEV y PROD y sus métricas.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const versions = await getVersions(artifactsDir);
        return {
          datasetVersion: versions.versions.at(-1)?.version ?? null,
          source: 'versions.json',
          data: versions,
        };
      },
    },
    {
      name: 'compare_versions',
      description: 'Diferencias entre dos versiones: imágenes y cajas añadidas, métricas y clases.',
      inputSchema: objectSchema({ from: { type: 'string' }, to: { type: 'string' } }, [
        'from',
        'to',
      ]),
      run: async (raw) => {
        const args = compareArgs.parse(raw ?? {});
        const diff = await getVersionDiff(artifactsDir, args.from, args.to);
        return { datasetVersion: args.to, source: 'versions.json', data: diff };
      },
    },
    {
      name: 'get_reannotation_queue',
      description: 'Muestras con checks en FAIL que deben volver a anotarse.',
      inputSchema: objectSchema({}),
      run: async (raw) => {
        noArgs.parse(raw ?? {});
        const overview = await getOverview(artifactsDir);
        const queue = await getReannotationQueue(artifactsDir);
        return { datasetVersion: overview.datasetVersion, source: 'release.json', data: queue };
      },
    },
  ];
}
