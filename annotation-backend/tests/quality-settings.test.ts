import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getQualitySettings,
  updateQualitySettings,
} from '../src/logic/quality/quality-settings.service.js';

const VALID_YAML = `# Politica de calidad (fixture de prueba)
checks:
  min_images_per_class:
    threshold: 300
    min_classes: 2
    severity: fail
  small_objects:
    threshold: 32
    severity: warn
  class_imbalance:
    threshold: 10
    severity: warn
  duplicates:
    threshold: 8
    severity: warn
  invalid_boxes:
    threshold: 0
    severity: fail
  spatial_bias:
    threshold: 0.5
    severity: warn
splits:
  train: 0.7
  val: 0.15
  test: 0.15
  seed: 42
`;

let dir: string;
let configPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'quality-settings-'));
  configPath = path.join(dir, 'quality.yaml');
  await writeFile(configPath, VALID_YAML, 'utf-8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * SPEC-QUALITY-API-008 — Settings persiste quality.yaml.
 *
 * Cambiar un umbral en la UI debe reescribir el archivo que consume la
 * compuerta, y un valor inválido debe rechazarse sin tocar el archivo.
 */
describe('SPEC-QUALITY-API-008 — lectura de la política', () => {
  it('lee umbral, severidad y min_classes', async () => {
    const config = await getQualitySettings(configPath);

    expect(config.checks.min_images_per_class?.threshold).toBe(300);
    expect(config.checks.min_images_per_class?.min_classes).toBe(2);
    expect(config.checks.small_objects?.threshold).toBe(32);
    expect(config.splits.seed).toBe(42);
  });

  it('devuelve error si el archivo no existe', async () => {
    await expect(getQualitySettings(path.join(dir, 'no-existe.yaml'))).rejects.toThrow(
      /no-existe\.yaml/,
    );
  });
});

describe('SPEC-QUALITY-API-008 — persistencia', () => {
  it('escribe el cambio en el archivo y se vuelve a leer', async () => {
    const config = await getQualitySettings(configPath);
    const smallObjects = config.checks.small_objects;
    if (!smallObjects) throw new Error('fixture sin small_objects');
    config.checks.small_objects = { ...smallObjects, threshold: 48 };

    await updateQualitySettings(configPath, config);

    const persisted = await getQualitySettings(configPath);
    expect(persisted.checks.small_objects?.threshold).toBe(48);

    const raw = await readFile(configPath, 'utf-8');
    expect(raw).toContain('threshold: 48');
  });

  it('rechaza una severidad inválida sin tocar el archivo', async () => {
    const before = await readFile(configPath, 'utf-8');
    const config = await getQualitySettings(configPath);
    // @ts-expect-error: se inyecta a propósito un valor inválido
    config.checks.duplicates.severity = 'error';

    await expect(updateQualitySettings(configPath, config)).rejects.toThrow(/severity/i);
    expect(await readFile(configPath, 'utf-8')).toBe(before);
  });

  it('rechaza proporciones que no suman 1 sin tocar el archivo', async () => {
    const before = await readFile(configPath, 'utf-8');
    const config = await getQualitySettings(configPath);
    config.splits.train = 0.9;

    await expect(updateQualitySettings(configPath, config)).rejects.toThrow(/sum/i);
    expect(await readFile(configPath, 'utf-8')).toBe(before);
  });
});
