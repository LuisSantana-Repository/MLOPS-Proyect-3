import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeEmbeddings } from '../logic/quality/embeddings.generator.js';

/**
 * SPEC-APP06-001 — CLI reproducible para generar `embeddings.json`.
 *
 * Lee el export COCO y escribe el artefacto que consume el portal. Pensado
 * para correr offline (y como etapa de DVC), nunca por request.
 *
 * Uso:
 *   npm run embeddings -- --coco data/annotations/coco-dataset.json \
 *     --output reports/embeddings.json
 */

export interface PrecomputeEmbeddingsOptions {
  cocoPath: string;
  outputPath: string;
  /** Opcional: fija la fecha para que la salida sea 100% determinista. */
  generatedAt?: string;
}

export async function runPrecomputeEmbeddings(options: PrecomputeEmbeddingsOptions): Promise<void> {
  const raw = JSON.parse(await readFile(options.cocoPath, 'utf-8')) as unknown;
  const bundle = computeEmbeddings(raw, {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  });

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');
}

interface ParsedArgs {
  cocoPath: string;
  outputPath: string;
  generatedAt?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) {
      values.set(token, value);
      index += 1;
    }
  }

  const cocoPath = values.get('--coco');
  const outputPath = values.get('--output');
  if (!cocoPath || !outputPath) {
    throw new Error(
      'Uso: precompute-embeddings --coco <ruta> --output <ruta> [--generated-at <ISO>]',
    );
  }
  return { cocoPath, outputPath, generatedAt: values.get('--generated-at') };
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  runPrecomputeEmbeddings(parseArgs(process.argv.slice(2)))
    .then(() => {
      console.log('embeddings.json generado.');
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
