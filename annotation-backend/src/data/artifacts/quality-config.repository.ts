import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Lectura y escritura del archivo de política `quality.yaml`. Igual que el
 * repositorio de artefactos, es la única capa con I/O; la validación vive en
 * Logic.
 */

export async function readQualityConfigText(configPath: string): Promise<string | null> {
  try {
    return await readFile(configPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeQualityConfigText(configPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, content, 'utf-8');
}
