# Correcciones de la evaluación (commit evaluado `3a85a81`)

Por cada hallazgo: commits RED → GREEN, la prueba que lo cubre y la evidencia (comando y
salida resumida). Los valores congelados **no cambiaron**: candidato `fe32e1388dbd465cae714a69bf80f685`
(exp-07), pesos SHA-256 `e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630`,
manifiesto md5 `e75a07ce3b75455514f044b23e0d1b29` / SHA-256 `0bdfd6d7…`, huella de test
`2da09317…` y accuracy de test 128/135 = 0.948148.

## P0-1. MLflow persistente y compartido con las 10 corridas reales (secciones 3.1, 3.2, 3.3)

**Qué se hizo.** Las corridas originales existían en el MariaDB + MinIO de la máquina que
corrió el barrido. Se copiaron, sin reentrenar ni reescribir nada, a `mlflow-store/`,
versionado con DVC en el remoto del proyecto (`s3://ml-models-proyecto3-2c1a70d3/dvc`, el
mismo prefijo y la misma política IAM que ya usan los datos; no hizo falta infraestructura
nueva):

- `mlflow-store/mlflow.db`: backend SQLite creado con el esquema de MLflow 2.11.1 (misma
  revisión de alembic que el servidor) y llenado fila por fila desde el MariaDB original.
- `mlflow-store/artifacts/`: espejo byte a byte del bucket `mlflow` (116 objetos, 564 MB).
  `createbuckets` lo carga en MinIO al arrancar, así que las URIs originales
  `s3://mlflow/1/<run>/artifacts` (las de `selection.json`) resuelven sin reescribirse.
- El servicio `mlflow` de `docker-compose.yml` usa ese SQLite. Ya no depende de MariaDB.

La alternativa con RDS y un servidor siempre encendido queda descartada por costo. Con
`dvc pull mlflow-store.dvc` + `docker compose up`, cualquier máquina con lectura al bucket
levanta el mismo MLflow.

| Commit | Qué |
|---|---|
| `3af2bf1` test (RED) | `tests/scripts/test_mlflow_snapshot.py`, `test_verify_mlflow.py`, `test_seed_mlflow_run.py`, split en `test_tracking.py` |
| `dd53b3c` feat (GREEN) | `scripts/mlflow_snapshot.py`, `scripts/verify_mlflow.py`, procedencia del split, seed aislado |
| `b78e5b3` test | `tests/conftest.py`: ninguna prueba puede escribir en un MLflow real |
| `59226f2` test (RED) | La copia conserva la precisión `double` de las métricas |
| `8d8a353` fix (GREEN) | Copiar valores sin el tipo reflejado (DOUBLE de MariaDB se redondeaba a 10 dígitos) |
| `5065c68` feat | `docker-compose.yml` sobre `mlflow-store/`, `scripts/mlflow_share.sh` |
| `e028671` data | `mlflow-store.dvc` (+ `dvc push`) |

**Fidelidad de la copia.** Comparación fila por fila contra el respaldo del MariaDB
original (cargado en una MariaDB temporal y leído con `pymysql`, sin SQLAlchemy):

```text
runs                    13 vs    13  IDENTICAS
metrics                680 vs   680  IDENTICAS
latest_metrics         160 vs   160  IDENTICAS
params                 338 vs   338  IDENTICAS
tags                   414 vs   414  IDENTICAS
experiments              2 vs     2  IDENTICAS
model_versions           1 vs     1  IDENTICAS
model_version_tags       1 vs     1  IDENTICAS
TODO IGUAL
```

Los 13 runs son los 10 de T07, el intento de exp-03 detenido a mano (`a5d81871…`, KILLED,
ya declarado como excluido en `reports/t07/experiments.md`), `baseline-t06` y
`smoke-stack`. No falta ninguna corrida y no se agregó ninguna. Único cambio sobre el
original: el alias `clasificador@champion` → versión 1 (run `fe32e138…`), que pide la
corrección (tabla `registered_model_aliases`, aparte).

**Evidencia desde un clon limpio** (clon nuevo de la rama, `dvc pull mlflow-store.dvc`,
MinIO y MLflow aislados en otros puertos, sin usar el stack de la máquina del barrido):

```text
$ dvc pull mlflow-store.dvc
74 files fetched and 117 files added            # mlflow.db md5 2b011d0e… = el versionado

$ MLFLOW_TRACKING_URI=http://localhost:5055 python -m scripts.verify_mlflow
OK    runs        10/10 runs de selection.json
OK    finished    todos FINISHED
OK    sweep       tags.sweep=t07
OK    manifest    manifest_sha256 0bdfd6d7efd4… en todos
OK    curvas      val_loss por época en todos
OK    artefactos  weights.pt, curves.png, history.json en todos
OK    seleccion   min best_val_loss vuelve a elegir fe32e138 con el mismo orden
OK    pesos       SHA-256 e5aa4f73e607… = congelado
OK    registry    clasificador v1 @champion → run fe32e138
Resultado: OK

$ python -m trainer.sweep report configs/experiments/t07.yaml
candidato exp-07 · run fe32e1388dbd465cae714a69bf80f685 · best_val_loss=0.0463; reporte en reports/t07
$ git status --short reports/t07                # vacío: selection.json, experiments.md y .csv idénticos

$ curl -s localhost:5055/api/2.0/mlflow/registered-models/search
clasificador  aliases=[champion → 1]  versiones=[1 → run fe32e138]

$ curl "localhost:3055/api/experiments?sweep=t07&onlySelected=true"   # portal contra ese MLflow
10 runs: t07-exp-07 ★, exp-09, exp-10, exp-06, exp-01, exp-02, exp-03, exp-04, exp-05, exp-08
```

En `/experiments` del portal, «Ver» en exp-07 dibuja las curvas loss y accuracy (train y
val) de sus 15 épocas desde el MLflow compartido.

**Para compartir runs nuevos:** `scripts/mlflow_share.sh` (espeja artefactos de MinIO a
`mlflow-store/artifacts`, `dvc add`, `dvc push`) y commit de `mlflow-store.dvc`.

**Nota de transparencia.** Durante esta corrección, la prueba RED de `seed_mlflow_run.py`
ejecutó la versión anterior del script, que al importarse escribía en
`http://127.0.0.1:5000`, y creó un run de prueba `smoke-t09` (`8d4dbcf1…`, `sweep=t07`) y
el modelo `clasificador-recortes` en el MariaDB local. `mlflow-store/` se generó desde el
respaldo tomado **antes** de ese run, así que no lo contiene, y `tests/conftest.py` impide
que vuelva a pasar. El MariaDB local ya no es el backend de MLflow.

## P2-2. Semilla del split en cada run nuevo y worker con el commit correcto (2.3, 3.2)

| Commit | Prueba | Qué |
|---|---|---|
| `3af2bf1` / `dd53b3c` | `test_split_seed_method_and_test_fingerprint_come_from_the_leakage_report`, `test_without_leakage_report_the_split_tags_say_not_available` | `collect_provenance` registra `split_seed=42`, `split_method` y `test_fingerprint` desde `leakage_report.json`. Los runs históricos no se tocan. |
| `02a18bb` / `c01ca71` | `test_startup_fails_when_the_image_was_built_from_another_commit`, `test_startup_accepts_an_image_built_from_head`, `test_startup_warns_when_the_commit_cannot_be_compared` | El worker compara el `GIT_COMMIT` horneado en la imagen con `EXPECTED_GIT_COMMIT` (de `GIT_COMMIT=$(git rev-parse HEAD) docker compose up -d --build`): sale si difieren, avisa si no se pueden comparar. |

## P2-4 (parcial). `seed_mlflow_run.py` aislado

`portal/scripts/seed_mlflow_run.py` ahora va al experimento `portal-smoke`, con `smoke=true` y
`sweep=smoke-t09`, y no crea nada al importarse (`test_seed_mlflow_run.py`).

## Pendiente (otros bloques)

P0-2 y P0-3 (portal unificado y cola de anotación: rama `feature/p0-2-portal-unificado`),
P1-1, P1-2, P1-3, P1-4, P2-1, P2-3, el resto de P2-4 y P2-5.
