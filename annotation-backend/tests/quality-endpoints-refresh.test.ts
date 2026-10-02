import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createQualityRouter } from '../src/ui/quality.routes.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality');

/**
 * SPEC-QUALITY-API-009 — La API lee la fuente real en cada request.
 *
 * El criterio de la story pide "probar que un cambio en la fuente modifica
 * la respuesta". Aquí se escribe un release.json en un directorio temporal,
 * se consulta, se modifica el archivo y se vuelve a consultar: los totales
 * deben cambiar. Si el backend cacheara el artefacto, esta prueba falla.
 */
describe('SPEC-QUALITY-API-009 — un cambio en la fuente cambia la respuesta', () => {
  it('refleja un release.json modificado sin cachear', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'quality-refresh-'));
    const release = JSON.parse(await readFile(path.join(FIXTURES, 'release.json'), 'utf-8')) as {
      totals: { images: number };
    };
    await writeFile(path.join(dir, 'release.json'), JSON.stringify(release), 'utf-8');

    const app = express();
    app.use(
      createQualityRouter({
        artifactsDir: dir,
        configPath: path.join(FIXTURES, 'quality.yaml'),
      }),
    );
    const listener = app.listen(0);
    await once(listener, 'listening');
    const baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

    try {
      const first = (await (await fetch(`${baseUrl}/quality/overview`)).json()) as {
        totals: { images: number };
      };
      expect(first.totals.images).toBe(12);

      release.totals.images = 99;
      await writeFile(path.join(dir, 'release.json'), JSON.stringify(release), 'utf-8');

      const second = (await (await fetch(`${baseUrl}/quality/overview`)).json()) as {
        totals: { images: number };
      };
      expect(second.totals.images).toBe(99);
    } finally {
      listener.close();
      await once(listener, 'close');
      await rm(dir, { recursive: true, force: true });
    }
  });
});
