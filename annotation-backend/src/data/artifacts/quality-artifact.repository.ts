import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Acceso a los artefactos del pipeline de calidad en disco.
 *
 * Vive en la capa `data` porque es la única que toca I/O. Devuelve el JSON
 * crudo (sin validar): quien decide si el contrato es válido es `logic`, que
 * lo parsea con Zod. Así la UI nunca confía en un archivo sin validar y la
 * capa de datos no se acopla al contrato del pipeline.
 */

export type QualityArtifactName = 'release.json' | 'embeddings.json' | 'versions.json';

/**
 * Lee y parsea un artefacto. Devuelve `null` si no existe (estado "sin
 * datos", que la UI muestra de forma explícita) y lanza si el archivo existe
 * pero no es JSON válido (estado "error", que no debe silenciarse).
 */
export async function readQualityArtifact(
  artifactsDir: string,
  name: QualityArtifactName,
): Promise<unknown | null> {
  let content: string;
  try {
    content = await readFile(path.join(artifactsDir, name), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  return JSON.parse(content) as unknown;
}
