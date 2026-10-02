import { Router } from 'express';
import { askCopilot, type CopilotProvider } from '../logic/copilot/copilot.service.js';
import { buildQualityTools } from '../logic/copilot/tools.js';

/**
 * SPEC-COPILOT-004 — Rutas del Dataset Copilot.
 *
 * Solo lectura: `GET /copilot/tools` documenta el catálogo y
 * `POST /copilot/ask` responde una pregunta. El proveedor de LLM es opcional;
 * sin él (o si falla) el Copilot responde en modo anclado.
 */

export interface CopilotRouterOptions {
  artifactsDir: string;
  provider?: CopilotProvider;
}

export function createCopilotRouter({ artifactsDir, provider }: CopilotRouterOptions): Router {
  const router = Router();
  const tools = buildQualityTools(artifactsDir);

  router.get('/copilot/tools', (_req, res) => {
    res.status(200).json({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  });

  router.post('/copilot/ask', (req, res) => {
    void (async () => {
      const body = req.body as { question?: unknown } | undefined;
      const question = typeof body?.question === 'string' ? body.question.trim() : '';

      if (!question) {
        res.status(400).json({ error: 'La pregunta es obligatoria.' });
        return;
      }

      try {
        const answer = await askCopilot(question, tools, provider);
        res.status(200).json(answer);
      } catch (error) {
        console.error('Error al procesar la pregunta del Copilot:', error);
        res.status(500).json({ error: 'No se pudo procesar la pregunta.' });
      }
    })();
  });

  return router;
}
