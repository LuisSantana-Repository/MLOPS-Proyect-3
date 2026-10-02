import { type Response, Router } from 'express';
import { ZodError } from 'zod';
import { NotFoundError } from '../logic/errors.js';
import {
  getAnalyzers,
  getEmbeddings,
  getOverview,
  getReannotationQueue,
  getSplits,
  getVersionDiff,
  getVersions,
} from '../logic/quality/quality-artifacts.service.js';
import {
  getQualitySettings,
  updateQualitySettings,
} from '../logic/quality/quality-settings.service.js';

/**
 * SPEC-QUALITY-API-007 — Endpoints de solo lectura para el portal de calidad.
 *
 * La UI no conoce rutas de archivos: recibe el directorio de artefactos ya
 * resuelto desde `env` y delega todo a la capa Logic. Un artefacto ausente
 * es 404 ("sin datos"); un contrato roto es 500 ("error"), nunca un 200 con
 * cifras a medias.
 */

export interface QualityRouterOptions {
  /** Directorio donde el pipeline escribe release.json / versions.json. */
  artifactsDir: string;
  /** Ruta a quality.yaml, que la pantalla Settings puede editar. */
  configPath: string;
}

export function createQualityRouter({ artifactsDir, configPath }: QualityRouterOptions): Router {
  const router = Router();

  async function respond<T>(res: Response, producer: () => Promise<T>): Promise<void> {
    try {
      const data = await producer();
      res.status(200).json(data);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }

      console.error('Error al leer los artefactos de calidad:', error);
      res.status(500).json({
        error: 'Los artefactos de calidad existen pero no cumplen el contrato esperado.',
      });
    }
  }

  router.get('/quality/overview', (_req, res) => respond(res, () => getOverview(artifactsDir)));

  router.get('/quality/analyzers', (_req, res) => respond(res, () => getAnalyzers(artifactsDir)));

  router.get('/quality/splits', (_req, res) => respond(res, () => getSplits(artifactsDir)));

  router.get('/quality/reannotation-queue', (_req, res) =>
    respond(res, () => getReannotationQueue(artifactsDir)),
  );

  router.get('/quality/embeddings', (_req, res) => respond(res, () => getEmbeddings(artifactsDir)));

  router.get('/quality/versions', (_req, res) => respond(res, () => getVersions(artifactsDir)));

  router.get('/quality/versions/diff', (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';

    if (!from || !to) {
      res.status(400).json({ error: 'Los parámetros "from" y "to" son obligatorios.' });
      return;
    }

    void respond(res, () => getVersionDiff(artifactsDir, from, to));
  });

  router.get('/quality/settings', (_req, res) =>
    respond(res, () => getQualitySettings(configPath)),
  );

  router.put('/quality/settings', (req, res) => {
    void (async () => {
      try {
        const updated = await updateQualitySettings(configPath, req.body);
        res.status(200).json(updated);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            error: 'La política de calidad es inválida. Revisa umbrales y proporciones.',
            issues: error.issues,
          });
          return;
        }

        console.error('Error al guardar la política de calidad:', error);
        res.status(500).json({ error: 'No se pudo guardar la política de calidad.' });
      }
    })();
  });

  return router;
}
