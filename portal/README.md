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
| `GET` | `/api/models` | Versiones del Model Registry: versión, run de origen, llave S3 (MinIO) y hash de pesos (`weights_sha256`). |

Los errores siguen la forma `ApiErrorBody`:

```json
{ "error": { "code": "bad_request", "message": "...", "details": { "lr": ["..."] } } }
```

Códigos: `bad_request` (400), `not_found` (404), `upstream_error` (502, MLflow/Redis
caídos), `internal_error` (500).

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
