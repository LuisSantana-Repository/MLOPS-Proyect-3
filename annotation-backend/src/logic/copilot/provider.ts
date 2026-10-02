import type { CopilotProvider } from './copilot.service.js';

/**
 * Proveedores de LLM para redactar la respuesta del Copilot.
 *
 * La API key sale SIEMPRE de configuración de entorno (nunca del repo) y los
 * errores del proveedor se propagan como errores genéricos: no incluyen la
 * key ni el body de la respuesta. El Copilot los captura y cae al modo
 * anclado, así que una caída del proveedor no rompe la pantalla.
 */

export interface CopilotProviderConfig {
  provider: 'none' | 'anthropic' | 'mistral';
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODELS = {
  anthropic: 'claude-3-5-sonnet-latest',
  mistral: 'mistral-large-latest',
} as const;

function buildPrompt(input: {
  question: string;
  toolResults: unknown;
  datasetVersion: string | null;
}): string {
  return [
    'Eres el Dataset Copilot de un dataset COCO. Responde en español y usa',
    'EXCLUSIVAMENTE las cifras de los resultados de herramientas. Si la',
    'información no está en los resultados, dilo; no inventes números. Cita la',
    'versión del dataset consultada.',
    `Pregunta: ${input.question}`,
    `Versión del dataset: ${input.datasetVersion ?? 'desconocida'}`,
    `Resultados de herramientas (JSON): ${JSON.stringify(input.toolResults)}`,
  ].join('\n');
}

function anthropicProvider(apiKey: string, model: string): CopilotProvider {
  return {
    name: 'anthropic',
    complete: async (input) => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [{ role: 'user', content: buildPrompt(input) }],
        }),
      });

      if (!response.ok) {
        throw new Error(`El proveedor respondió con estado ${response.status}.`);
      }

      const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = body.content?.find((block) => block.type === 'text')?.text;
      if (!text) throw new Error('El proveedor no devolvió texto.');
      return text;
    },
  };
}

function mistralProvider(apiKey: string, model: string): CopilotProvider {
  return {
    name: 'mistral',
    complete: async (input) => {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt(input) }],
        }),
      });

      if (!response.ok) {
        throw new Error(`El proveedor respondió con estado ${response.status}.`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content;
      if (!text) throw new Error('El proveedor no devolvió texto.');
      return text;
    },
  };
}

export function buildProvider(config: CopilotProviderConfig): CopilotProvider | undefined {
  if (config.provider === 'none' || !config.apiKey) return undefined;

  if (config.provider === 'anthropic') {
    return anthropicProvider(config.apiKey, config.model ?? DEFAULT_MODELS.anthropic);
  }
  if (config.provider === 'mistral') {
    return mistralProvider(config.apiKey, config.model ?? DEFAULT_MODELS.mistral);
  }
  return undefined;
}
