import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseReleaseBundle } from '../logic/quality/contracts.js';

/**
 * SPEC-QUALITY-API-001 — Validador del contrato de `release.json`.
 *
 * Sirve para el handoff con Frente 2: quien genere el artefacto lo corre
 * antes de publicarlo, y verifica que el portal lo pueda consumir sin
 * sorpresas. No lee el entorno ni la base de datos.
 *
 * Uso:
 *   npm run validate:release -- --file reports/release.json
 */

export interface ValidationResult {
  ok: boolean;
  message: string;
}

export async function validateReleaseFile(filePath: string): Promise<ValidationResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch (error) {
    return {
      ok: false,
      message: `No se pudo leer o parsear "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    const bundle = parseReleaseBundle(raw);
    return {
      ok: true,
      message: `release.json válido: ${bundle.totals.images} imágenes, ${bundle.totals.annotations} cajas, ${bundle.totals.categories} categorías, versión ${bundle.dataset_version}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `release.json NO cumple el contrato de la API: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function fileArgument(argv: string[]): string | null {
  const index = argv.indexOf('--file');
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  const file = fileArgument(process.argv.slice(2));
  if (!file) {
    console.error('Uso: validate-release --file <ruta-a-release.json>');
    process.exit(1);
  }

  validateReleaseFile(file).then((result) => {
    console.log(result.message);
    process.exit(result.ok ? 0 : 1);
  });
}
