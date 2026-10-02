import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildQualityTools } from '../src/logic/copilot/tools.js';
import { handleMcpMessage } from '../src/mcp/server.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

/**
 * SPEC-COPILOT-003 — Servidor MCP de solo lectura.
 *
 * Se prueba el manejador JSON-RPC (puro) del servidor: initialize, tools/list
 * y tools/call. Las tools expuestas son las mismas del registry read-only.
 */
describe('SPEC-COPILOT-003 — servidor MCP', () => {
  it('responde initialize anunciando la capability de tools', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      buildQualityTools(FIXTURES),
    );

    expect(response.id).toBe(1);
    expect(response.result).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: expect.any(String) },
    });
  });

  it('tools/list declara las herramientas con su inputSchema', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      buildQualityTools(FIXTURES),
    );

    const tools = (response.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(8);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('description');
    expect(tools[0]).toHaveProperty('inputSchema');
  });

  it('tools/call ejecuta una tool y devuelve contenido de texto', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_dataset_overview', arguments: {} },
      },
      buildQualityTools(FIXTURES),
    );

    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('12');
  });

  it('tools/call con una tool inexistente responde con error', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'no_existe', arguments: {} },
      },
      buildQualityTools(FIXTURES),
    );

    expect(response.error).toBeDefined();
    expect(response.result).toBeUndefined();
  });

  it('un método desconocido responde con error de método no encontrado', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'resources/list', params: {} },
      buildQualityTools(FIXTURES),
    );

    expect(response.error?.code).toBe(-32601);
  });

  it('tools/call con fuente vacía responde con error sin romper el protocolo', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'mcp-empty-'));
    try {
      const response = await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'get_dataset_overview', arguments: {} },
        },
        buildQualityTools(emptyDir),
      );

      expect(response.error).toBeDefined();
      expect(response.error?.message).toMatch(/release\.json/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
