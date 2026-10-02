import { pathToFileURL } from 'node:url';
import { DEFAULT_QUALITY_ARTIFACTS_DIR } from '../config/quality-paths.js';
import { buildQualityTools, type CopilotTool } from '../logic/copilot/tools.js';

/**
 * SPEC-COPILOT-003 — Servidor MCP (Model Context Protocol) de solo lectura.
 *
 * Implementa el subset necesario del protocolo sobre JSON-RPC 2.0 por stdio:
 * `initialize`, `tools/list` y `tools/call`. Expone exactamente el mismo
 * registry read-only que usa el Copilot, así que ninguna herramienta puede
 * modificar el dataset.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const SERVER_INFO = { name: 'dataset-quality-mcp', version: '1.0.0' } as const;
export const PROTOCOL_VERSION = '2024-11-05';

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleMcpMessage(
  message: JsonRpcRequest,
  tools: CopilotTool[],
): Promise<JsonRpcResponse> {
  const id = message.id ?? null;

  try {
    switch (message.method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case 'notifications/initialized':
      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });

      case 'tools/call': {
        const params = message.params ?? {};
        const name = typeof params.name === 'string' ? params.name : '';
        const rawArguments = params.arguments;
        const args =
          rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
            ? (rawArguments as Record<string, unknown>)
            : {};

        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) {
          return fail(id, INVALID_PARAMS, `Tool desconocida: ${name}`);
        }

        const output = await tool.run(args);
        return ok(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                datasetVersion: output.datasetVersion,
                source: output.source,
                data: output.data,
              }),
            },
          ],
        });
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Método no soportado: ${message.method}`);
    }
  } catch (error) {
    return fail(id, INTERNAL_ERROR, error instanceof Error ? error.message : 'Error interno');
  }
}

async function handleLine(line: string, tools: CopilotTool[]): Promise<void> {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(line) as JsonRpcRequest;
  } catch {
    // Línea que no es JSON: se ignora (protocolo tolerante).
    return;
  }

  // Las notificaciones (sin id) no reciben respuesta.
  if (message.id === undefined || message.id === null) {
    if (message.method.startsWith('notifications/')) return;
  }

  const response = await handleMcpMessage(message, tools);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export function runStdioServer(tools: CopilotTool[]): void {
  let buffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) void handleLine(line, tools);
      newlineIndex = buffer.indexOf('\n');
    }
  });
}

// Entrypoint: solo necesita el directorio de artefactos, no la config de la
// base de datos ni MinIO (por eso no usa el schema completo de `env`).
const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  const artifactsDir = process.env.QUALITY_ARTIFACTS_DIR ?? DEFAULT_QUALITY_ARTIFACTS_DIR;
  runStdioServer(buildQualityTools(artifactsDir));
}
