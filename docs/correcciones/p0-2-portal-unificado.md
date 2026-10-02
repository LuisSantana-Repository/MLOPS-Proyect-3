# P0-2 — Las cinco páginas viven dentro del portal de los Proyectos 1 y 2

**Hallazgo:** Training, Experiments, Evaluation, Models e Inference estaban en un portal
aparte, sin el portal de anotación y calidad de los Proyectos 1 y 2.

**Corrección:** ahora es una sola aplicación (`portal/`, Next.js), con un solo menú y los
mismos pasos de arranque (`docker compose up -d --build` + `npm run dev`).

| Qué | Dónde |
|---|---|
| Pantallas de anotación (P1) y calidad (P2), traídas de `ikramzaldivar/proyecto2@3ac21d2` | `portal/src/p2/` |
| Rutas de esas pantallas en la misma app | `portal/src/app/(annotation)/*/page.tsx` |
| Menú único (anotación · calidad · modelo) | `portal/src/p2/components/layout/GlobalNav.tsx` |
| Shell que pone ese menú a las cinco páginas del modelo | `portal/src/components/portal/PortalShell.tsx` |
| Un solo router (Next.js) para todas las pantallas | `portal/src/components/portal/NextRouterBridge.tsx` |
| Backend de anotación (Express + Drizzle) | `annotation-backend/` |
| Servicios `annotation-db-init` y `annotation-api` (misma MariaDB y MinIO) | `docker-compose.yml` |
| El portal reenvía `/api/p2/*` al backend de anotación | `portal/next.config.mjs` |

## Evidencia

- Tests: `portal/src/components/portal/routes.test.ts` y `unified-nav.test.tsx` (menú único,
  rutas en la misma app, shell común, reenvío `/api/p2`). Los 9 archivos de test de las
  pantallas del Proyecto 2 corren ahora en el portal (`portal/src/p2/tests/`).
- `cd portal && npm test && npm run lint && npm run typecheck && npm run build` en verde.
- `cd annotation-backend && npm ci && npm test` en verde.
- Captura: abrir http://localhost:3000 → Tablero; en el menú lateral, "Training" abre la
  página del modelo sin salir del portal. (Agregar captura en `docs/correcciones/img/`.)

## Qué NO cambió

El manifiesto, los recortes, los `.dvc`, los runs de MLflow, el modelo publicado y el test
congelado no se tocaron. Las cinco páginas del modelo conservan su código y sus tests.

## Pendiente relacionado

- Las vistas de calidad muestran estado vacío hasta copiar los reportes del pipeline del
  Proyecto 2 (`release.json`, `embeddings.json`) a `annotation-backend/quality/reports/` (P1-1).
- "Enviar a anotación" desde Inference todavía usa `annotation_queue`; pasa al flujo de
  anotación de este backend en P0-3.
