import { z } from "zod";
import { apiRequest, jsonBody } from "../lib/api/client";

/**
 * SPEC-COPILOT-004 — Contrato de red del Dataset Copilot.
 *
 * El backend declara las herramientas read-only y devuelve, por cada
 * respuesta, las tool calls con su resultado, la versión consultada y el
 * proveedor usado. La UI solo pinta eso: nunca inventa cifras.
 */

export const copilotToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type CopilotTool = z.infer<typeof copilotToolSchema>;

export const copilotToolsResponseSchema = z.object({ tools: z.array(copilotToolSchema) });

export const copilotToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  datasetVersion: z.string().nullable(),
  source: z.string(),
  data: z.unknown(),
});
export type CopilotToolCall = z.infer<typeof copilotToolCallSchema>;

export const copilotAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  grounded: z.boolean(),
  datasetVersion: z.string().nullable(),
  toolsUsed: z.array(z.string()),
  toolCalls: z.array(copilotToolCallSchema),
  provider: z.string(),
});
export type CopilotAnswer = z.infer<typeof copilotAnswerSchema>;

export function fetchCopilotTools(): Promise<CopilotTool[]> {
  return apiRequest("/copilot/tools", copilotToolsResponseSchema).then(
    (response) => response.tools,
  );
}

export function askCopilot(question: string): Promise<CopilotAnswer> {
  return apiRequest("/copilot/ask", copilotAnswerSchema, {
    method: "POST",
    ...jsonBody({ question }),
  });
}
