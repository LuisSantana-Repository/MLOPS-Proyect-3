import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { askCopilot, type CopilotProvider } from '../src/logic/copilot/copilot.service.js';
import { buildQualityTools } from '../src/logic/copilot/tools.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

/**
 * SPEC-COPILOT-001 — Tools de solo lectura y Dataset Copilot.
 *
 * Cada cifra que el Copilot responde proviene de una tool; el agente no
 * inventa y cita la versión del dataset consultada.
 */

async function writeReleaseInTempDir(mutate: (release: { totals: { images: number } }) => void) {
  const dir = await mkdtemp(path.join(tmpdir(), 'copilot-src-'));
  const release = JSON.parse(await readFile(path.join(FIXTURES, 'release.json'), 'utf-8')) as {
    totals: { images: number };
  };
  mutate(release);
  await writeFile(path.join(dir, 'release.json'), JSON.stringify(release), 'utf-8');
  await writeFile(
    path.join(dir, 'embeddings.json'),
    await readFile(path.join(FIXTURES, 'embeddings.json'), 'utf-8'),
  );
  await writeFile(
    path.join(dir, 'versions.json'),
    await readFile(path.join(FIXTURES, 'versions.json'), 'utf-8'),
  );
  return dir;
}

describe('SPEC-COPILOT-001 — tools read-only', () => {
  it('declara nombre, descripción y schema de entrada por cada tool', () => {
    const tools = buildQualityTools(FIXTURES);

    expect(tools.length).toBeGreaterThanOrEqual(8);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('no expone ninguna tool con efectos de escritura', () => {
    const tools = buildQualityTools(FIXTURES);
    const names = tools.map((tool) => tool.name).join(' ');

    expect(names).not.toMatch(/insert|update|delete|put|create|write|patch/i);
  });

  it('get_dataset_overview devuelve totales, versión y procedencia', async () => {
    const tools = buildQualityTools(FIXTURES);
    const tool = tools.find((candidate) => candidate.name === 'get_dataset_overview');
    if (!tool) throw new Error('falta get_dataset_overview');

    const result = await tool.run({});

    expect(result.datasetVersion).toBe('v1.0.0-demo');
    expect(result.source).toBe('release.json');
    expect((result.data as { totals: { images: number } }).totals.images).toBe(12);
  });

  it('compare_versions devuelve el diff entre dos versiones', async () => {
    const tools = buildQualityTools(FIXTURES);
    const tool = tools.find((candidate) => candidate.name === 'compare_versions');
    if (!tool) throw new Error('falta compare_versions');

    const result = await tool.run({ from: 'v1.0.0', to: 'v1.1.0' });

    expect((result.data as { imagesAdded: number }).imagesAdded).toBe(370);
  });
});

describe('SPEC-COPILOT-002 — el Copilot responde con tools', () => {
  it('usa tool calls, cita la versión y no inventa la cifra', async () => {
    const answer = await askCopilot(
      '¿cuántas imágenes tiene el dataset?',
      buildQualityTools(FIXTURES),
    );

    expect(answer.toolsUsed).toContain('get_dataset_overview');
    expect(answer.toolCalls.length).toBeGreaterThan(0);
    expect(answer.datasetVersion).toBe('v1.0.0-demo');
    expect(answer.answer).toContain('12');
    expect(answer.grounded).toBe(true);
  });

  it('responde honestamente cuando el dataset no puede contestar', async () => {
    const answer = await askCopilot('¿cuál es la capital de Francia?', buildQualityTools(FIXTURES));

    expect(answer.toolCalls).toEqual([]);
    expect(answer.grounded).toBe(false);
    expect(answer.answer).toMatch(/no (puedo|tengo|hay)/i);
  });

  it('cambia la respuesta cuando cambia la fuente', async () => {
    const dir = await writeReleaseInTempDir(() => {});
    const first = await askCopilot('¿cuántas imágenes?', buildQualityTools(dir));
    expect(first.answer).toContain('12');

    const release = JSON.parse(await readFile(path.join(dir, 'release.json'), 'utf-8')) as {
      totals: { images: number };
    };
    release.totals.images = 99;
    await writeFile(path.join(dir, 'release.json'), JSON.stringify(release), 'utf-8');

    const second = await askCopilot('¿cuántas imágenes?', buildQualityTools(dir));
    expect(second.answer).toContain('99');

    await rm(dir, { recursive: true, force: true });
  });

  it('maneja la caída del proveedor sin traceback y cae al modo anclado', async () => {
    const provider: CopilotProvider = {
      name: 'fake-provider',
      complete: async () => {
        throw new Error('proveedor no disponible');
      },
    };

    const answer = await askCopilot('¿cuántas imágenes?', buildQualityTools(FIXTURES), provider);

    expect(answer.provider).toBe('fake-provider');
    expect(answer.answer).toContain('12');
    expect(answer.grounded).toBe(true);
  });
});

describe('SPEC-COPILOT-001 — fuente vacía y versión inexistente', () => {
  it('una tool falla claramente si el directorio de artefactos está vacío', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'copilot-empty-'));
    try {
      const tools = buildQualityTools(emptyDir);
      const overview = tools.find((candidate) => candidate.name === 'get_dataset_overview');
      if (!overview) throw new Error('falta get_dataset_overview');

      await expect(overview.run({})).rejects.toThrow(/release\.json/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('compare_versions falla si la versión no existe', async () => {
    const tools = buildQualityTools(FIXTURES);
    const compare = tools.find((candidate) => candidate.name === 'compare_versions');
    if (!compare) throw new Error('falta compare_versions');

    await expect(compare.run({ from: 'v1.0.0', to: 'v9.9.9' })).rejects.toThrow(/v9\.9\.9/);
  });

  it('responde con honestidad (sin tronar) cuando faltan los artefactos', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'copilot-missing-'));
    try {
      const answer = await askCopilot('¿cuántas imágenes?', buildQualityTools(emptyDir));

      expect(answer.toolCalls).toEqual([]);
      expect(answer.grounded).toBe(false);
      expect(answer.answer).toMatch(/no pude consultar/i);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
