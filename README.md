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
```text
data/       Release del Proyecto 2, recortes y manifiesto (contenido en DVC, metadatos en Git)
reports/    Selección del candidato (t07), evaluación final (t08) y tarjeta del modelo
scripts/    Utilidades: variables para el host, smoke de inferencia contra S3
```

El flujo completo, y la tarea que produce cada pieza:

```text
release DVC del Proyecto 2 ─► recortes (T03) ─► manifiesto 70/20/10 (T04) ─► entrenamiento (T05/T06)
  ─► 10 corridas en MLflow + candidato por validación (T07) ─► evaluación única en test (T08)
  ─► versión + tarjeta en AWS S3 (T10/T15) ─► Models / Inference / cola de anotación en el portal (T13)
```

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Git + **Git Bash** (en Windows) | — | Los comandos de este README son de bash |
| **Docker** + Docker Compose | Docker Desktop 4.x | MariaDB, MinIO, MLflow, Redis, worker e inferencia |
| **Python** | 3.11 (el proyecto fija `>=3.11,<3.12`) | Entrenador, DVC, publicación |
| **Node.js** + npm | 22 | Portal |
| **AWS CLI** | v2 | Credenciales del bucket (datos DVC y modelos) |

Credenciales: el **usuario IAM del bucket del proyecto** (lo crea Terraform en `infra/`,
salida `terraform output`). Da acceso a `s3://ml-models-proyecto3-2c1a70d3`, que guarda
los datos de DVC (`dvc/`) y los modelos publicados (`models/`). Nunca van a Git.

## Recorrido desde un clon limpio

Cada paso termina con una **comprobación**: si no da lo indicado, no sigas al siguiente.

### 1. Clonar y crear el entorno de Python

```bash
git clone https://github.com/LuisSantana-Repository/MLOPS-Proyect-3.git
cd MLOPS-Proyect-3
py -3.11 -m venv .venv                      # Linux/macOS: python3.11 -m venv .venv
source .venv/Scripts/activate               # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

`requirements-dev.txt` instala el entrenador, el servicio, `ml/`, DVC y las
herramientas de prueba. **Comprobación:** `python -c "import torch, mlflow, dvc; print('ok')"`.

### 2. Credenciales y variables de entorno

```bash
aws configure --profile p3                  # Access Key, Secret, región us-east-1 (tecléalas tú)
aws s3 ls s3://ml-models-proyecto3-2c1a70d3/ --profile p3
dvc remote modify --local storage profile p3   # va a .dvc/config.local, no se versiona

cp .env.example .env
```

En `.env` llena las contraseñas locales (MariaDB y MinIO: cualquier valor sirve en tu
máquina) y `S3_BUCKET=ml-models-proyecto3-2c1a70d3`. Las llaves `AWS_ACCESS_KEY_ID` y
`AWS_SECRET_ACCESS_KEY` del bucket son opcionales en el host si usas el perfil (paso 5),
pero las necesitan los contenedores `worker` e `inference`.

**Comprobación:** `aws s3 ls` lista `dvc/` y `models/`.

### 3. Levantar el stack

```bash
GIT_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
docker compose ps
```

La primera vez construye las imágenes (unos minutos). **Comprobación:**

```bash
curl -s http://localhost:5000/health        # MLflow → OK
curl -s http://localhost:8000/health        # inferencia → {"status":"ok"}
```

y `docker compose ps` muestra `db`, `minio`, `mlflow`, `redis`, `worker` e `inference`
arriba (`createbuckets` termina con código 0). MinIO tiene consola en http://localhost:9001.

### 4. Datos del release aprobado (DVC)

```bash
dvc pull                                    # release del P2 (~230 MB), 1349 recortes y el manifiesto
dvc status
```

**Comprobación:** `dvc status` responde `Data and pipelines are up to date.` y existen
`data/source/coco-dataset.json`, `data/crops/crops/` (1349 `.jpg`) y `data/splits/manifest.csv`.
`data/crops/release_info.json` identifica el release: `proyecto2 v1.1.0@dc9376e`.

#### 4b. (Opcional) Reproducir los recortes y el manifiesto

Regenera T03 y T04 en una carpeta aparte y compáralos con lo versionado:

```bash
python ml/make_crops.py --annotations data/source/coco-dataset.json \
  --images-dir data/source/images --out-dir /tmp/repro/crops \
  --release-tag "proyecto2 v1.1.0@dc9376e" --dvc-file data/source/release_p2_dvc.txt
python ml/make_split.py --crops-csv /tmp/repro/crops/crops.csv \
  --annotations data/source/coco-dataset.json --images-dir data/source/images \
  --out-dir /tmp/repro/splits --seed 42 --test-custodian Alejandra

md5sum /tmp/repro/splits/manifest.csv       # = md5 de data/splits/manifest.csv.dvc (e75a07ce…)
diff <(tr -d '\r' < /tmp/repro/crops/crops.csv) <(tr -d '\r' < data/crops/crops.csv) && echo iguales
```

**Comprobación:** mismo md5 del manifiesto, mismos recortes, `Fuga detectada: 0` y la
misma huella de test (`2da09317…`) que `data/splits/leakage_report.json`.

### 5. Variables para correr el pipeline desde el host

```bash
source scripts/host-env.sh                  # o: MODELS_AWS_PROFILE=p3 source scripts/host-env.sh
```

Deja `AWS_*` apuntando a **MinIO** (artefactos de MLflow) y `MODELS_*` al **bucket de
AWS**, que en `.env` comparten nombre. Imprime un resumen sin secretos: debe decir
`llaves de AWS: cargadas`.

### 6. Entrenar (T05/T06)

```bash
python -m trainer --smoke                                   # 2 épocas con datos sintéticos, sin red
python -m trainer.tracking run --config configs/baseline.yaml --run-name baseline
```

La corrida registrada tarda 15–40 min en CPU. **Comprobación:** el run aparece en
http://localhost:5000, experimento `proyecto3-clasificador`, con parámetros, semillas,
`dvc_release`, `manifest_sha256`, métricas por época y artefactos (`weights.pt`,
`curves.png`, …). También se puede lanzar desde la página **Training** del portal
(paso 10): el `worker` lo toma de la cola y reporta progreso.

Detalles del entrenador y del contrato de cada run: [`trainer/README.md`](trainer/README.md).

### 7. Diez experimentos y candidato por validación (T07)

```bash
python -m trainer.sweep run configs/experiments/t07.yaml --dry-run   # valida el diseño sin entrenar
python -m trainer.sweep run configs/experiments/t07.yaml             # 10 corridas, ~2.5 h en CPU, reanudable
python -m trainer.sweep report configs/experiments/t07.yaml
```

**Comprobación:** `reports/t07/experiments.md` lista 10 runs válidos con los 7
hiperparámetros variados y `reports/t07/selection.json` congela el candidato **antes** de
abrir el test (`test_split_used: false`). El candidato versionado es el run
`fe32e1388dbd465cae714a69bf80f685` (exp-07).

### 8. Evaluación final en test (T08) — una sola vez

```bash
python ml/evaluate_final.py --run-id fe32e1388dbd465cae714a69bf80f685
```

Verifica selección, manifiesto, huella del test y SHA-256 de los pesos antes de inferir,
y **se niega a correr dos veces** sobre el mismo run. Si falla, no lo repitas: revisa el
mensaje. **Comprobación:** `reports/t08/` con `predictions.csv`, `metrics.json` y la
matriz de confusión; en MLflow el run tiene métricas `test_*` (accuracy 94.81 %).

### 9. Publicar el modelo y su tarjeta (T10, T15)

```bash
python publish_model.py --run-id fe32e1388dbd465cae714a69bf80f685 --version 1.0.0
python -m serving.model_card --version 1.0.0 --upload
```

`publish_model.py` verifica el SHA-256, sube el paquete a
`s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0/`, lo registra en el Model
Registry y en la tabla `published_models`. `serving.model_card` genera la tarjeta desde
el paquete publicado, el run y los reportes (sin cifras a mano) y la deja en
[`reports/model_card/1.0.0/model_card.md`](reports/model_card/1.0.0/model_card.md) y junto
al paquete en S3. **Comprobación:**

```bash
aws s3 ls s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0/ --profile p3
aws s3 cp s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0/weights.pt - --profile p3 | sha256sum
# e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630
```

Más detalle en [`serving/README.md`](serving/README.md).

#### 9b. Usar el modelo ya publicado en una máquina nueva

`publish_model.py` necesita el run en MLflow, que en un clon nuevo no existe. Para usar el
modelo que el equipo ya publicó (inferencia, Models, Inference) basta registrarlo:

```bash
python -m serving.register --version 1.0.0
```

Descarga el paquete de S3, verifica que el SHA-256 de `weights.pt` sea el del checkpoint
congelado en `reports/t07/selection.json` y que se haya entrenado con el mismo manifiesto, y
escribe la fila en `published_models`. **Comprobación:** imprime
`registrada clasificador 1.0.0 (run fe32e1388dbd…, sha256 e5aa4f73e607)`.

### 10. Portal (Next.js)

```bash
cd portal
cp .env.example .env        # MYSQL_* y MINIO_* iguales al .env raíz; S3_BUCKET y MODELS_AWS_* del bucket
npm ci
npm run db:migrate          # crea training_jobs, published_models y annotation_queue
npm run dev                 # http://localhost:3000
```

| Página | Qué verificar |
|---|---|
| `/training` | Release `proyecto2 v1.1.0@dc9376e`, split 70/20/10 y lanzar un job (estado y logs persisten al recargar) |
| `/experiments` | Las corridas de T07 con curvas train/val; el candidato marcado con ★ |
| `/evaluation` | Abre la versión ganadora: accuracy 94.8 %, matriz y errores desde `predictions.csv` |
| `/models` | Versión `1.0.0` "Publicado en S3", run, release, SHA-256, descargas firmadas y la tarjeta |
| `/inference` | Clasificar una imagen nueva o un recorte; probabilidades, versión y hash usados |
| `/annotation-queue` | El elemento enviado desde Inference, pendiente de anotar |

`/experiments` y `/evaluation` leen los runs del MLflow de **esta** máquina: en un clon nuevo
quedan vacías hasta correr los pasos 6–8 (ver "Dónde viven los runs"). `/training`, `/models`,
`/inference` y `/annotation-queue` funcionan desde el paso 9b, con el modelo publicado en S3.

Contratos de la API y detalle de cada página: [`portal/README.md`](portal/README.md).

### 11. Inferencia directa

```bash
curl -F "version=1.0.0" -F "file=@data/crops/crops/70_94.jpg" http://localhost:8000/predict
# {"version":"1.0.0","predicted_class":"car","probabilities":{"person":0.038…,"car":0.961…}}
```

El servicio descarga el paquete de S3 la primera vez, verifica el SHA-256 contra
`published_models` y lo carga con el mismo preprocesamiento de la evaluación.

## Trazabilidad de punta a punta

| Release DVC | Manifiesto 70/20/10 | Run elegido | Checkpoint | Versión | S3 | Predicción |
|---|---|---|---|---|---|---|
| `proyecto2 v1.1.0@dc9376e` | md5 `e75a07ce…` · SHA-256 `0bdfd6d7…` | `fe32e138…` (exp-07) | época 10 · `e5aa4f73…` | `1.0.0` | `models/clasificador/1.0.0/` | `crops/70_94.jpg` → car 96.17 % |

Cada valor se puede volver a obtener con los comandos de arriba; el portal enlaza la
misma cadena (release → run → versión → predicción) entre sus páginas.

> **Dónde viven los runs.** MLflow guarda los runs en la MariaDB y el MinIO del stack
> (volúmenes de Docker de la máquina que los ejecutó). En un clon nuevo el MLflow arranca
> vacío: los pasos 6–8 vuelven a generar los runs, mientras que los resultados de T07/T08,
> el modelo publicado (S3) y su tarjeta ya están versionados y no dependen de ese MLflow.

## Calidad

| Ámbito | Comando | Herramienta |
|--------|---------|-------------|
| Portal — lint | `cd portal && npm run lint` | Biome |
| Portal — tipos | `cd portal && npm run typecheck` | tsc |
| Portal — tests | `cd portal && npm run test` | Vitest |
| Portal — build | `cd portal && npm run build` | Next.js |
| Worker — lint | `ruff check .` | Ruff |
| Worker — tests | `pytest -q` | Pytest |

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `dvc pull` → `403 Forbidden` | El perfil no tiene acceso al bucket: revisa `aws s3 ls … --profile p3` y `dvc remote modify --local storage profile p3`. |
| MLflow no arranca (`FallbackAsyncAdaptedQueuePool`) | Imagen vieja de antes de fijar `sqlalchemy<2.1`: `docker compose build mlflow`. |
| La imagen de MinIO no descarga (401) | MinIO dejó de publicar imágenes oficiales; el compose usa `pgsty/minio`. Actualiza tu rama. |
| El puerto 3307, 5000, 8000 o 9000 está ocupado | Otro servicio local lo usa; detenlo o cambia el puerto en `docker-compose.yml`. |
| `/models` dice "La tabla published_models no existe" | Falta `npm run db:migrate` en `portal/`. |
| Un run sube artefactos a AWS o falla al subirlos | Las variables `AWS_*` apuntan al bucket en vez de a MinIO: usa `source scripts/host-env.sh`. |

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
