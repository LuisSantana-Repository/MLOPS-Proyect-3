import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCopilotRouter } from '../src/ui/copilot.routes.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

let baseUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createCopilotRouter({ artifactsDir: FIXTURES }));
  const listener = app.listen(0);
  await once(listener, 'listening');
  baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  closeServer = async () => {
    listener.close();
    await once(listener, 'close');
  };
});

afterAll(async () => {
  await closeServer();
});

/**
 * SPEC-COPILOT-004 — API del Dataset Copilot.
 */
describe('SPEC-COPILOT-004 — rutas del Copilot', () => {
  it('GET /copilot/tools lista las herramientas de solo lectura', async () => {
    const response = await fetch(`${baseUrl}/copilot/tools`);
    const body = (await response.json()) as { tools: unknown[] };

    expect(response.status).toBe(200);
    expect(body.tools.length).toBeGreaterThanOrEqual(8);
  });

  it('POST /copilot/ask responde con answer, tool calls y versión', async () => {
    const response = await fetch(`${baseUrl}/copilot/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿cuántas imágenes tiene el dataset?' }),
    });
    const body = (await response.json()) as {
      answer: string;
      toolCalls: unknown[];
      datasetVersion: string;
    };

    expect(response.status).toBe(200);
    expect(body.toolCalls.length).toBeGreaterThan(0);
    expect(body.datasetVersion).toBe('v1.0.0-demo');
    expect(body.answer).toContain('12');
  });

  it('POST /copilot/ask rechaza una pregunta vacía con 400', async () => {
    const response = await fetch(`${baseUrl}/copilot/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it('POST /copilot/ask sin artefactos responde 200 (no 500)', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'copilot-routes-empty-'));
    const app = express();
    app.use(express.json());
    app.use(createCopilotRouter({ artifactsDir: emptyDir }));
    const listener = app.listen(0);
    await once(listener, 'listening');
    const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${url}/copilot/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: '¿cuántas imágenes?' }),
      });
      const body = (await response.json()) as { grounded: boolean; answer: string };

      expect(response.status).toBe(200);
      expect(body.grounded).toBe(false);
      expect(body.answer).toMatch(/no pude consultar/i);
    } finally {
      listener.close();
      await once(listener, 'close');
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
