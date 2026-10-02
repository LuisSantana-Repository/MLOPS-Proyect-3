import { pathToFileURL } from 'node:url';
import { DEFAULT_QUALITY_ARTIFACTS_DIR } from '../config/quality-paths.js';
import { askCopilot } from '../logic/copilot/copilot.service.js';
import { buildQualityTools } from '../logic/copilot/tools.js';

/**
 * SPEC-COPILOT-002 — Demostración del Dataset Copilot.
 *
 * Corre preguntas contra los artefactos reales (o fixtures) y muestra, por
 * cada una, la respuesta, la versión citada, las tools usadas y el proveedor.
 * Incluye una pregunta fuera de alcance para evidenciar que no inventa.
 *
 * Uso:
 *   npm run copilot:demo
 *   QUALITY_ARTIFACTS_DIR=path/to/artifacts npm run copilot:demo
 */

export const DEMO_QUESTIONS = [
  '¿Cuántas imágenes tiene el dataset?',
  '¿Cómo está el desbalance de clases?',
  '¿Hay objetos pequeños?',
  '¿Hay duplicados?',
  '¿Hay fuga entre las particiones?',
  '¿Qué versiones existen?',
  '¿Cuál es la capital de Francia?',
];

export async function runCopilotDemo(artifactsDir: string): Promise<void> {
  const tools = buildQualityTools(artifactsDir);

  for (const question of DEMO_QUESTIONS) {
    const answer = await askCopilot(question, tools);
    console.log(`\nP: ${question}`);
    console.log(`R: ${answer.answer}`);
    console.log(
      `   versión=${answer.datasetVersion ?? '—'} | grounded=${answer.grounded} | ` +
        `tools=[${answer.toolsUsed.join(', ')}] | proveedor=${answer.provider}`,
    );
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  const artifactsDir = process.env.QUALITY_ARTIFACTS_DIR ?? DEFAULT_QUALITY_ARTIFACTS_DIR;
  runCopilotDemo(artifactsDir).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
