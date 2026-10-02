import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateReleaseFile } from '../src/tools/validate-release.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

/**
 * SPEC-QUALITY-API-001 — Validador del contrato de release.json.
 */
describe('SPEC-QUALITY-API-001 — validate-release', () => {
  it('acepta el release.json que cumple el contrato', async () => {
    const result = await validateReleaseFile(path.join(FIXTURES, 'release.json'));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('12 imágenes');
  });

  it('rechaza un release.json incompleto', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'validate-release-'));
    const file = path.join(dir, 'release.json');
    await writeFile(file, JSON.stringify({ schema_version: 1 }), 'utf-8');

    try {
      const result = await validateReleaseFile(file);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/no cumple el contrato/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
