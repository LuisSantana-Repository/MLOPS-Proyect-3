import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { askCopilot, selectToolsForQuestion } from '../src/logic/copilot/copilot.service.js';
import { buildQualityTools } from '../src/logic/copilot/tools.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

/**
 * SPEC-COPILOT-002 — Cada cifra de la respuesta sale de la herramienta.
 *
 * `copilot.test.ts` comprueba que el total de imágenes cambia con la fuente.
 * Aquí se cubren las demás cifras que el Copilot dice en voz alta (objetos
 * pequeños, cajas inválidas) y el enrutado de cada pregunta a SU herramienta:
 * sin esto, una respuesta con la cifra equivocada, o mandada a otra
 * herramienta, pasaba todas las pruebas.
 */

interface ReleaseShape {
  analyzers: {
    small_objects: { small_count: number };
    invalid_boxes: { invalid_count: number };
  };
}

const tempDirs: string[] = [];

async function artifactsWith(mutate: (release: ReleaseShape) => void): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'copilot-grounding-'));
  tempDirs.push(dir);
  await cp(FIXTURES, dir, { recursive: true });
  const releasePath = path.join(dir, 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf-8')) as ReleaseShape;
  mutate(release);
  await writeFile(releasePath, JSON.stringify(release), 'utf-8');
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('SPEC-COPILOT-002 — cada pregunta va a su herramienta', () => {
  it.each([
    ['¿Hay objetos pequeños?', 'get_small_objects'],
    ['¿Cuántos objetos small hay?', 'get_small_objects'],
    ['¿Hay duplicados?', 'get_duplicates'],
    ['¿Hay cajas inválidas?', 'get_invalid_boxes'],
    ['¿Qué hay en la cola de reanotación?', 'get_reannotation_queue'],
    ['¿Hay fuga entre las particiones?', 'get_splits'],
    ['¿Qué versiones existen?', 'get_versions'],
    ['¿Cómo está el desbalance de clases?', 'get_class_distribution'],
    ['Dame un resumen del dataset', 'get_dataset_overview'],
  ])('%s -> %s', (question, tool) => {
    expect(selectToolsForQuestion(question)).toEqual([tool]);
  });

  it('una pregunta que no toca ninguna herramienta no selecciona ninguna', () => {
    expect(selectToolsForQuestion('¿Cuál es la capital de Francia?')).toEqual([]);
  });
});

describe('SPEC-COPILOT-002 — las cifras de la respuesta son las de la fuente', () => {
  it('objetos pequeños: dice la cifra, el porcentaje y el umbral del release', async () => {
    const answer = await askCopilot('¿Hay objetos pequeños?', buildQualityTools(FIXTURES));

    expect(answer.toolsUsed).toEqual(['get_small_objects']);
    expect(answer.answer).toContain('2 de 15 objetos (13.33%)');
    expect(answer.answer).toContain('32px');
  });

  it('cajas inválidas: dice la cifra y el total del release', async () => {
    const answer = await askCopilot('¿Hay cajas inválidas?', buildQualityTools(FIXTURES));

    expect(answer.toolsUsed).toEqual(['get_invalid_boxes']);
    expect(answer.answer).toContain('1 cajas inválidas de 15 anotaciones');
  });

  it('si cambia la cantidad de objetos pequeños en la fuente, cambia la respuesta', async () => {
    const dir = await artifactsWith((release) => {
      release.analyzers.small_objects.small_count = 9;
    });

    const answer = await askCopilot('¿Hay objetos pequeños?', buildQualityTools(dir));

    expect(answer.answer).toContain('9 de 15 objetos');
    expect(answer.answer).not.toContain('2 de 15 objetos');
  });

  it('si cambian las cajas inválidas en la fuente, cambia la respuesta', async () => {
    const dir = await artifactsWith((release) => {
      release.analyzers.invalid_boxes.invalid_count = 7;
    });

    const answer = await askCopilot('¿Hay cajas inválidas?', buildQualityTools(dir));

    expect(answer.answer).toContain('7 cajas inválidas de 15 anotaciones');
    expect(answer.answer).not.toContain('1 cajas inválidas');
  });
});
