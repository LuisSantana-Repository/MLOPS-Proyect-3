# MLOPS-Proyect-3

Monorepo MLOps de extremo a extremo para un **clasificador de recortes COCO**:
un **portal Next.js** lanza y observa entrenamientos, y un **worker Python**
(PyTorch) entrena, registra en MLflow, publica el modelo ganador en S3 y lo sirve
para inferencia.

```text
portal/     Portal Next.js (App Router, TypeScript, Biome, Vitest) — API del portal
trainer/    Entrenador PyTorch (dataset, modelo, tracking MLflow, barridos)
serving/    Publicación en S3 + servicio de inferencia FastAPI (T10)
ml/         Recortes y manifiesto 70/20/10 sin fuga (split versionado con DVC)
tests/      Pytest del worker (trainer + serving)
configs/    Config de entrenamiento y su JSON Schema (fuente de verdad de contratos)
infra/      Terraform del bucket de modelos en AWS
worker.py   Consumidor de la cola Redis que ejecuta los jobs del portal
```

## Requisitos

- **Node.js 22** y **npm** (portal)
- **Python 3.11** (worker; el proyecto fija `>=3.11,<3.12`)
- **Docker** + Docker Compose (MariaDB, MinIO, MLflow, Redis)

## Puesta en marcha

### 1. Variables de entorno

```bash
cp .env.example .env          # raíz: MariaDB, MinIO, Redis, bucket de modelos
```

Rellena en `.env` las credenciales reales del bucket de modelos AWS
(`S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). **El `.env` real no
se versiona** (lo ignora `.gitignore`); en Git solo viven las plantillas
`*.example`.

### 2. Infraestructura

```bash
docker compose up -d          # MariaDB (host:3307), MinIO, MLflow, Redis, worker
```

### 3. Portal (Next.js)

```bash
cd portal
cp .env.example .env
npm install
npm run db:migrate            # crea la tabla training_jobs en MariaDB
npm run dev                   # http://localhost:3000
```

### 4. Worker (Python)

```bash
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu

# Entrenamiento de humo (dataset sintético, 2 épocas, sin datos reales ni internet)
python -m trainer --smoke
```

En Linux/macOS usa `python3.11 -m venv .venv` y `.venv/bin/python`.

## Comprobación rápida

```bash
# Portal
cd portal && npm run test && npm run build

# Worker (toda la suite: fuga, reproducibilidad, recarga S3, contratos)
pip install -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu
pytest -q
```

## Calidad

| Ámbito | Comando | Herramienta |
|--------|---------|-------------|
| Portal — lint | `cd portal && npm run lint` | Biome |
| Portal — tipos | `cd portal && npm run typecheck` | tsc |
| Portal — tests | `cd portal && npm run test` | Vitest |
| Portal — build | `cd portal && npm run build` | Next.js |
| Worker — lint | `ruff check .` | Ruff |
| Worker — tests | `pytest -q` | Pytest |

## Publicación e inferencia del modelo (T10)

```bash
# Publica el run ganador (reports/t07/selection.json) al bucket AWS real
pip install -r requirements-serving.txt --extra-index-url https://download.pytorch.org/whl/cpu
python publish_model.py

# Servicio de inferencia
uvicorn serving.app:app --host 0.0.0.0 --port 8000
curl -F "version=1.0.0" -F "file=@recorte.jpg" http://localhost:8000/predict
```

Detalles en [`serving/README.md`](serving/README.md), [`trainer/README.md`](trainer/README.md)
y [`portal/README.md`](portal/README.md).

## Integración continua (Bloque Release — T14, depende de T10)

El workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre en cada
push y PR a `main`:

| Job | Qué corre |
|-----|-----------|
| `biome-lint` | Biome sobre el portal |
| `portal-tests` | `typecheck` + Vitest (contratos de API) + `build` de Next.js |
| `worker-tests` | Ruff + `pytest`: fuga del manifiesto, reproducibilidad por semilla con smoke train en CPU, recarga del modelo publicado desde S3 (simulado con moto) e inferencia, y contratos de la API FastAPI |
| `gitleaks` | Escaneo de secretos en todo el historial de Git |
| `s3-inference-smoke` | *(opcional)* descarga el modelo publicado de **S3 real** e infiere, usando secretos de Actions. Solo corre si el secreto `MODELS_S3_BUCKET` está configurado, para no romper el CI cuando no hay infraestructura |

Usa caché de **npm** y **pip**, y PyTorch en su rueda **CPU**.

### Secretos de Actions (para el job opcional de S3 real)

En **Settings → Secrets and variables → Actions**:

- `MODELS_S3_BUCKET`, `MODELS_AWS_ACCESS_KEY_ID`, `MODELS_AWS_SECRET_ACCESS_KEY`
- *(opcional)* `MODELS_AWS_REGION` (default `us-east-1`)
- *(opcional, variable)* `MODEL_VERSION` (default `1.0.0`)

Las credenciales viven **solo** en los Secrets de GitHub, nunca en el repositorio.

## Escaneo de secretos

```bash
# Local (Docker), misma config que el CI
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest \
  detect --source /repo --config /repo/.gitleaks.toml --verbose
```

La config [`.gitleaks.toml`](.gitleaks.toml) usa el conjunto de reglas por defecto
y solo exime las plantillas `*.example` (placeholders, no secretos reales).

## Tests mínimos por requisito crítico

El mapeo de cada requisito crítico a sus pruebas está en
[`docs/tests-minimos.md`](docs/tests-minimos.md).
