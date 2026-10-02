# Portal MLOps — Proyecto 3 (T09)

Monolito Next.js (App Router, TypeScript) con los route handlers de la API del
portal. Validación con **Zod 4**, persistencia de jobs con **Drizzle + MariaDB**,
cola con **Redis** (la consume `worker.py`) y lectura de experimentos/modelos
desde la **REST API de MLflow**.

## Requisitos y arranque

```bash
cd portal
cp .env.example .env      # ajusta credenciales si hace falta
npm install
npm run db:migrate        # crea la tabla training_jobs en MariaDB
npm run dev               # http://localhost:3000
```

La infraestructura (MariaDB, MinIO, MLflow, Redis, worker) se levanta desde la
raíz del repo con `docker compose up`. En `docker-compose.yml` MariaDB expone el
puerto **3307** hacia el host, que es el default de `.env.example`.

## Contrato (kickoff)

Los tipos e IDs compartidos con el frontend viven en `src/contracts/` y se
reexportan desde `src/contracts/index.ts`. Los rangos de los hiperparámetros
replican `trainer/config.py::TrainConfig`.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/training/jobs` | Valida release + 7 hiperparámetros + 3 semillas, persiste el job (`queued`) y lo encola en Redis (`ml_jobs`) para el worker. Responde `201`. |
| `GET` | `/api/training/jobs/[id]` | Estado y logs persistentes del job. |
| `GET` | `/api/experiments` | Runs del experimento (`?experiment=`, `?maxResults=`, `?pageToken=`) con parámetros y métricas finales, desde MLflow. |
| `GET` | `/api/experiments/[runId]/metrics` | Historial por época; por defecto `train_loss` y `val_loss` (`?keys=train_acc,val_acc`). |
| `GET` | `/api/evaluation/[modelVersion]` | Métricas de evaluación (test/eval), matriz de confusión y clases. Acepta `nombre:version` en la ruta o `?name=` + versión. |
| `GET` | `/api/releases` | Releases del Proyecto 2 con **compuerta de calidad aprobada** (P1-1): procedencia (commit, md5 de anotaciones, recortes y manifiesto), evidencia `quality` (reporte + MD5, política + SHA-256, checks) y conteos 70/20/10 por clase. Un release con compuerta fallida o sin reporte no aparece. `POST /api/training/jobs` valida contra esta lista antes de crear el job (400 si no). |
| `GET` | `/api/experiments/selection` | Run candidato congelado por T07 (`reports/t07/selection.json`) (T11). |
| `GET` | `/api/models` | Versiones publicadas (tabla `published_models` de T10): run de origen y enlace a MLflow, release DVC, llave/URI S3, SHA-256 de pesos, fecha, métricas de validación y test, y estado **verificado en S3** (`published` / `incomplete` / `unverified`). Completa con el Model Registry si existe (T13). |
| `GET` | `/api/models/[version]/card` | Tarjeta del modelo en Markdown: `model_card.md` del paquete (T15) o, si no existe, generada desde `summary.json` (T13). |
| `GET` | `/api/models/[version]/files/[file]` | `302` a una URL firmada de S3 para descargar un archivo del paquete; `404` si el objeto no existe (T13). |
| `POST` | `/api/inference` | `multipart/form-data` con `version` y `file`. Valida que la versión esté publicada y completa en S3, y que la imagen sea JPEG/PNG (por firma de bytes, máx. 5 MB); reenvía a `POST /predict` de T10, valida que las probabilidades sumen ≈ 1 y guarda la imagen en MinIO (T13). |
| `POST` | `/api/annotation` | Envía una imagen clasificada al flujo de anotación del portal (Proyecto 1): la registra en `annotation-api` (`POST /images`) como `pending`, con la clase sugerida, las probabilidades y la versión del modelo. Verifica versión publicada, imagen existente y clase = argmax. Responde `201` con `imageId` y `annotateUrl` (P0-3). |

Los errores siguen la forma `ApiErrorBody`:

```json
{ "error": { "code": "bad_request", "message": "...", "details": { "lr": ["..."] } } }
```

Códigos: `bad_request` (400), `not_found` (404), `upstream_error` (502, MLflow/Redis/S3/inferencia
caídos), `integrity_error` (502, el modelo no pasó la verificación de hash), `schema_missing`
(500, faltan migraciones: `npm run db:migrate`), `internal_error` (500).

## Páginas (T11, T13)

| Ruta | Qué hace |
| --- | --- |
| `/training` | Selector del release aprobado (hash, procedencia y split 70/20/10), formulario de los 7 hiperparámetros y 3 semillas validado con el mismo `createTrainingJobSchema` del backend, y panel de progreso que consulta `GET /api/training/jobs/[id]` cada 3 s hasta que el job termina. |
| `/experiments` | Tabla ordenable de runs (parámetros, mejor `val_loss`, `val_acc`) con el candidato de T07 marcado con ★, y curvas train/val por época del run elegido. `?run=<runId>` abre ese run. Por defecto muestra todos los runs; el filtro "Solo runs de selección" aplica el de T07. |
| `/models` | Versiones publicadas: versión de **modelo** y release DVC del **dataset** en columnas separadas, run con enlace a MLflow, llave S3, SHA-256, fecha, estado verificado en S3, descargas firmadas y tarjeta del modelo renderizada desde Markdown. Un paquete incompleto en S3 no se ofrece para descargar ni para inferir (T13). |
| `/inference` | Elige una versión publicada (`?version=` la preselecciona) y sube una imagen; muestra clase, barras de probabilidad y la versión y hash de pesos usados. "Enviar a anotación" crea un elemento real en la cola (T13). |

Sin datos simulados: cada vista tiene estados de carga, vacío y error (con reintento).
Las gráficas son SVG propio (`src/lib/ui/chart.ts`), sin librería de gráficas.

`REPO_ROOT` (opcional) indica la raíz del repo para `/api/releases`; por defecto es la
carpeta padre de `portal/`.

## Ejemplo: lanzar un entrenamiento

```bash
curl -X POST http://localhost:3000/api/training/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "release": "proyecto2 v1.1.0@dc9376e",
    "optimizer": "adamw", "batch_size": 32, "max_epochs": 30,
    "lr": 0.001, "img_size": 224, "hidden_layers": [256], "dropout": 0.3,
    "shuffle_seed": 42, "aug_seed": 43, "init_seed": 44
  }'
```

Solo `release` es obligatorio; el resto toma los defaults del baseline (T05).

## Calidad

```bash
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (al menos un test por endpoint)
npm run lint        # Biome
npm run build       # next build
```
