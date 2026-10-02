import { parse } from 'yaml';
import {
  readQualityConfigText,
  writeQualityConfigText,
} from '../../data/artifacts/quality-config.repository.js';
import { NotFoundError } from '../errors.js';
import { parseQualityConfig, type QualityConfig } from './contracts.js';
import { serializeQualityConfig, stringifyQualityConfig } from './quality-yaml.js';

/**
 * SPEC-QUALITY-API-008 — Settings lee y persiste la política de calidad.
 *
 * `updateQualitySettings` valida ANTES de escribir: si la política es
 * inválida, lanza y el archivo queda intacto. La UI mapea el error a 400.
 */

export async function getQualitySettings(configPath: string): Promise<QualityConfig> {
  const text = await readQualityConfigText(configPath);
  if (text === null) {
    throw new NotFoundError(`No hay archivo de política de calidad en "${configPath}".`);
  }
  return parseQualityConfig(parse(text));
}

export async function updateQualitySettings(
  configPath: string,
  raw: unknown,
): Promise<QualityConfig> {
  // Valida primero: si falla, no se toca el archivo (el error sube tal cual).
  const config = parseQualityConfig(raw);

  const existing = await readQualityConfigText(configPath);
  const content =
    existing === null ? stringifyQualityConfig(config) : serializeQualityConfig(existing, config);

  await writeQualityConfigText(configPath, content);
  return config;
}
