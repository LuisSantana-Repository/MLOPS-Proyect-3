# T16 — Checklist de entrega del portal

Recorrido que debe poder seguirse en la demo, siempre con **los mismos IDs**:

```
release DVC  →  run de MLflow  →  versión publicada en S3  →  predicción
(T03/T04)        (T06/T07/T08)     (T10)                      (T10/T13)
```

Llena la columna **Evidencia** con una captura (`docs/t16-evidencia/<n>.png`) o un enlace
(PR, commit, URL de MLflow). Un punto se marca `[x]` solo cuando tiene evidencia.

## IDs que deben coincidir en todo el recorrido

| Dato | Valor esperado | Dónde se origina |
|---|---|---|
| Release DVC | `proyecto2 v1.1.0@dc9376e` | `data/crops/release_info.json` (T03) |
| Commit del Proyecto 2 | `dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57` | `release_info.json` |
| MD5 anotaciones | `72e5f4025c4dbe7eb1e2420a9b4dbf9a` | `release_info.json` |
| MD5 DVC del manifiesto | `e75a07ce3b75455514f044b23e0d1b29` | `data/splits/manifest.csv.dvc` (T04) |
| MD5 DVC de los recortes | `f839dd62b048da0186ade1e382bb7f66` | `data/crops/crops.dvc` (T03) |
| Run ganador | `fe32e1388dbd465cae714a69bf80f685` | `reports/t07/selection.json` (T07) |
| SHA-256 de `weights.pt` | `e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630` | tag `weights_sha256` del run (T07) |
| Versión publicada | `clasificador:<versión>` | `published_models` / Model Registry (T10) |

## 1. Calidad automática

| | Comprobación | Comando | Evidencia |
|---|---|---|---|
| [ ] | Sin datos simulados en las 5 páginas | `cd portal && node scripts/audit-mocks.mjs` | |
| [ ] | Tests del portal | `cd portal && npm test` | |
| [ ] | Lint, tipos y build | `npm run lint && npm run typecheck && npm run build` | |
| [ ] | Tests de Python | `pytest tests/trainer tests/worker ml/tests` | |
| [ ] | Datos en su versión | `dvc status` sin cambios | |
| [ ] | Stack arriba | `docker compose up -d` y `docker compose ps` todos `healthy`/`running` | |

## 2. Release DVC → run de MLflow

| | Qué verificar | Dónde | Evidencia |
|---|---|---|---|
| [ ] | El release aprobado aparece con commit, hashes y split 70/20/10 (944/270/135) | `/training` | |
| [ ] | Lanzar un job desde la UI pasa por En cola → Entrenando → Terminado, con logs por época | `/training` | |
| [ ] | El panel del job muestra su `runId` y enlaza a sus curvas | `/training` → `/experiments?run=<runId>` | |
| [ ] | El run nuevo aparece en la tabla con sus parámetros y curvas train/val | `/experiments` | |
| [ ] | En MLflow, el run tiene los tags `dvc_release`, `manifest_md5` y `job_id` iguales a los de arriba | UI de MLflow (`http://localhost:5000`) | |
| [ ] | El ganador `fe32e138…` está marcado con ★ y su criterio es `min best_val_loss` en validación | `/experiments` | |

## 3. Run ganador → evaluación de test

| | Qué verificar | Dónde | Evidencia |
|---|---|---|---|
| [ ] | T08 corrido una sola vez sobre el run ganador (`reports/t08/metrics.json` con su `run_id`) | repo / PR | |
| [ ] | `/evaluation` abre por defecto la versión del run ganador, marcada "Ganador (T07)" | `/evaluation` | |
| [ ] | Accuracy, F1 macro, tabla por clase y matriz salen de `predictions.csv` y coinciden con las `test_*` de MLflow (✓ verde) | `/evaluation` | |
| [ ] | Accuracy ≥ 85% (o, si no, documentado) | `/evaluation` | |
| [ ] | La galería muestra los recortes mal clasificados con real, predicha y probabilidad | `/evaluation` | |

## 4. Run → versión publicada en S3

| | Qué verificar | Dónde | Evidencia |
|---|---|---|---|
| [ ] | La versión publicada apunta al run ganador (`runId = fe32e138…`) | `/models` | |
| [ ] | Muestra la llave S3 `models/clasificador/<versión>/` y el SHA-256 de los pesos (`e5aa4f73…`) | `/models` | |
| [ ] | El objeto existe en el bucket con ese prefijo | consola de AWS S3 o `aws s3 ls` | |
| [ ] | Desde la versión se puede ir a su run (`/experiments?run=`) y a su evaluación (`/evaluation?model=`) | `/models` | |

## 5. Versión → predicción

| | Qué verificar | Dónde | Evidencia |
|---|---|---|---|
| [ ] | Se elige la versión publicada y se sube un recorte | `/inference` | |
| [ ] | La respuesta muestra clase predicha, probabilidades y **la versión usada** | `/inference` | |
| [ ] | La predicción indica el run y el SHA-256 verificado del modelo descargado de S3 | `/inference` | |
| [ ] | Un recorte del test da la misma clase que en `predictions.csv` de T08 | `/inference` vs `/evaluation` | |

## Qué debe mostrar cada página para que el recorrido sea evidente

| Página | IDs visibles | Enlaces hacia |
|---|---|---|
| `/training` | release, commit P2, MD5s, `jobId`, `runId` | `/experiments?run=<runId>` |
| `/experiments` | `runId`, release del run, ganador ★ | UI de MLflow del run, `/evaluation` |
| `/evaluation` | versión, `runId`, "Ganador (T07)" | `/experiments?run=<runId>`, `/models` |
| `/models` | versión, `runId`, release, llave S3, SHA-256 | `/experiments?run=`, `/evaluation?model=`, `/inference?model=` |
| `/inference` | versión, `runId`, SHA-256 verificado | `/models`, `/evaluation?model=` |

## Guion de la demo (jueves)

1. `/training`: mostrar el release y su split; lanzar un job corto (pocas épocas) y ver el progreso.
2. `/experiments`: abrir el run recién creado y sus curvas; mostrar el ganador ★ y por qué ganó.
3. `/evaluation`: métricas de test del ganador, matriz y un error de la galería.
4. `/models`: la versión publicada con su run, llave S3 y SHA-256.
5. `/inference`: subir un recorte y señalar que la respuesta dice qué versión lo predijo.
