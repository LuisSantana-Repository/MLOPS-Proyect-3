# Tests mínimos por requisito crítico (Bloque Release — T14 / T10)

Este documento mapea los **4 requisitos críticos** a las pruebas que los cubren.
Para cada uno se indica qué pruebas **ya existen** (y las corre el CI) y cuáles
**faltan** para cerrar el requisito de punta a punta.

Leyenda: ✅ existe y corre en CI · ⚠️ recomendado / faltante.

---

## 1. README funciona

> Cualquiera puede clonar el repo, seguir el README y dejar el sistema corriendo.

Es el requisito más difícil de "testear" con unit tests: se valida ejecutando las
instrucciones. Lo que el CI sí puede garantizar es que los comandos del README
compilan/corren.

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | El portal compila con el comando del README (`npm run build`) | job `portal-tests` |
| ✅ | El portal pasa typecheck y Vitest (`npm run typecheck`, `npm test`) | job `portal-tests` |
| ✅ | El worker instala sus deps (torch CPU) y corre `pytest` | job `worker-tests` |
| ✅ | El smoke train del README corre sin datos reales (`python -m trainer --smoke`) | `tests/trainer/test_train.py::test_cli_smoke_runs_two_epochs_on_synthetic_data` |
| ⚠️ | **Test de humo del README end-to-end**: `docker compose up`, `db:migrate`, `POST /api/training/jobs` responde `201` | *falta* — job de integración con servicios (ver "Faltantes") |
| ⚠️ | **Linkcheck del README**: que los enlaces relativos (`serving/README.md`, `docs/…`, `.github/workflows/ci.yml`) existan | *falta* — paso simple en CI |

---

## 2. Release aprobado

> Solo se publica el run seleccionado como candidato; la selección queda congelada
> y es la que consume la publicación.

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | El barrido corre, reportea y **congela** `selection.json` con el ganador (`candidate=true`, el resto `false`) | `tests/trainer/test_sweep.py::test_sweep_runs_resumes_reports_and_freezes_the_selection` |
| ✅ | La selección congelada no cambia de candidato sin `--force` | mismo test (bloque "congelada") |
| ✅ | Se excluyen runs `FAILED` y `smoke` de la selección | `tests/trainer/test_sweep.py::test_report_excludes_failed_and_smoke_runs` |
| ✅ | No se selecciona con menos runs válidos de los exigidos | `tests/trainer/test_sweep.py::test_report_refuses_to_select_with_too_few_valid_runs` |
| ✅ | `publish` resuelve el run ganador **desde `selection.json`** (run_id, sha256, release DVC) | `tests/serving/test_publish.py::test_resolve_winning_run_from_selection` |
| ✅ | `publish` verifica el sha256 declarado y **falla si no coincide** | `tests/serving/test_publish.py::test_publish_detects_hash_mismatch` |
| ✅ | `publish` **no sobrescribe** una versión existente sin `--overwrite` | `tests/serving/test_publish.py::test_publish_refuses_to_overwrite_existing_version` |
| ⚠️ | **Gate explícito "solo publica el candidato aprobado"**: que `publish` rechace un `run_id` que no es el de `selection.json` (a menos que se fuerce) | *falta* — endurecer `publish.resolve_winning_run` + test |

---

## 3. Fuga = 0

> El split train/val/test no tiene fuga entre particiones, y el detector de fuga
> realmente detecta fuga (si no, "fuga = 0" no probaría nada).

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | El manifiesto generado tiene `fuga.total == 0` y ningún grupo cae en más de un split | `ml/tests/test_make_split.py::test_fuga_cero` |
| ✅ | El detector **sí detecta** fuga inyectada (grupos, imágenes y duplicados cercanos) | `ml/tests/test_make_split.py::test_find_leakage_detecta_fuga_inyectada` |
| ✅ | Duplicados cercanos caen en el mismo grupo y split | `ml/tests/test_make_split.py` (cadena de duplicados 1/41/42) |
| ✅ | El split `test` **nunca se abre** durante el entrenamiento | `tests/trainer/test_data.py::test_test_split_is_never_opened` |
| ⚠️ | **Test guardián en CI sobre el manifiesto versionado real** (no solo el sintético): correr `find_leakage` sobre `data/splits/manifest.csv` y exigir `total == 0` | *falta* — requiere `dvc pull` en CI o un manifiesto de muestra commiteado |

---

## 4. Modelo recargable

> El paquete publicado se descarga de S3 en un entorno limpio, se verifica su hash
> y produce inferencia válida.

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | El paquete recién entrenado **recarga en un proceso limpio** y reproduce las probabilidades | `tests/trainer/test_train.py::test_package_reloads_in_a_clean_process` |
| ✅ | Descarga desde S3 (simulado con moto) a una caché limpia + inferencia con contrato válido | `tests/serving/test_inference.py::test_clean_download_and_predict` |
| ✅ | Verificación de integridad: un hash esperado incorrecto **falla** | `tests/serving/test_inference.py::test_predict_verifies_hash_from_argument` |
| ✅ | Fail-closed: sin hash disponible no se sirve el modelo | `tests/serving/test_inference.py::test_fail_closed_without_hash` |
| ✅ | Recuperación de una descarga interrumpida (paquete incompleto) | `tests/serving/test_inference.py::test_recovers_from_half_downloaded_cache` |
| ✅ | Rechazo de versiones no semver / path traversal antes de tocar disco o S3 | `tests/serving/test_inference.py::test_rejects_non_semver_version_path_traversal` |
| ✅ | Contrato HTTP de `POST /predict` (respuesta y errores 400) | `tests/serving/test_app.py` |
| ✅ | `load_model` rechaza un `classes.json` que no coincide con los pesos | `tests/trainer/test_train.py::test_load_model_rejects_mismatched_classes` |
| ⚠️ | **Recarga desde S3 REAL** (no moto), con secretos de Actions | ✅ cubierto por el job opcional `s3-inference-smoke` (`scripts/s3_inference_smoke.py`), pero **no es bloqueante**: solo corre si `MODELS_S3_BUCKET` está configurado |

---

## Reproducibilidad por semilla (transversal, exigido por el prompt)

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | Misma config y semillas ⇒ mismo orden, métricas por época y **pesos idénticos** | `tests/trainer/test_train.py::test_same_seeds_reproduce_order_metrics_and_weights` |
| ✅ | El orden de shuffle es reproducible por `shuffle_seed` | `tests/trainer/test_data.py::test_shuffle_order_is_reproducible_by_shuffle_seed` |
| ✅ | La augmentación depende solo de `aug_seed` y época (no del RNG global) | `tests/trainer/test_data.py::test_augmentation_depends_only_on_aug_seed_and_epoch` |
| ✅ | Mismo split reproducible por semilla; semillas distintas ⇒ test distinto | `ml/tests/test_make_split.py` (reproducibilidad por semilla) |

---

## Contratos de API (transversal, exigido por el prompt)

| Estado | Prueba | Dónde |
|--------|--------|-------|
| ✅ | Los rangos/enums/defaults de Zod del portal coinciden con `configs/train-config.schema.json` | `portal/src/contracts/training.schema.test.ts` |
| ✅ | Contrato de `POST /predict` (FastAPI): forma de respuesta y errores | `tests/serving/test_app.py` |
| ✅ | **Un test por endpoint del portal** (route handlers): 201/400/502, 404, filtros y forma de respuesta | `portal/src/app/api/**/route.test.ts` (training jobs POST y GET/[id], experiments, experiments/[runId]/metrics, models, evaluation/[modelVersion]) |

---

## Resumen de faltantes (priorizado)

1. ✅ **Test por endpoint del portal** (Vitest sobre los route handlers) —
   **hecho**: un archivo `route.test.ts` por endpoint, cubriendo respuesta,
   validación (400), 404 y errores de upstream (502).
2. **Gate de publicación "solo el candidato aprobado"** — endurecer `publish` para
   rechazar un run que no sea el de `selection.json` salvo `--force`, con su test.
   (Hoy `publish` verifica el sha256 del run; el gate estricto por run_id es la
   mejora pendiente.)
3. **Guardián de fuga sobre el manifiesto versionado real** en CI (requiere
   `dvc pull` o un manifiesto de muestra commiteado). La lógica ya está cubierta
   por `ml/tests/test_make_split.py` sobre un dataset sintético.
4. **Smoke end-to-end del README** con servicios (`docker compose`) que verifique
   `POST /api/training/jobs → 201`.
5. **Linkcheck del README** (paso barato en CI).

Los 4 requisitos críticos tienen cobertura de test para su núcleo; el faltante #1
(contratos de API del portal) quedó cerrado. Los faltantes #2–#5 son refuerzos de
"punta a punta", no bloqueantes del pipeline de release.
