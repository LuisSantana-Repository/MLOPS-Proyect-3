# T16 — Publicación, versiones y E2E (Actividad C)

Correcciones de 5.1, 5.3 y 7.2. TDD (RED→GREEN), verificado contra MinIO/moto; no se
tocó el bucket AWS real ni la versión `1.0.0` ya publicada.

## 5.1 — Paquete completo en S3

`serving/storage.py` ahora distingue tres conjuntos de archivos:

- `REQUIRED_PACKAGE_FILES` = `weights.pt`, `classes.json`, `preprocess.json`, `summary.json`
  (los que toda versión tiene, incluida la `1.0.0` congelada).
- `ENV_PACKAGE_FILES` = `config.json`, `env.json`, `requirements.lock` (entorno y
  dependencias fijadas para reproducibilidad).
- `FULL_PACKAGE_FILES` = los dos anteriores.

`serving/publish.py` descarga del run los artefactos que el trainer ya escribe
(`config.json`, `env.json`, etc.), genera `requirements.lock` desde `env.json`
(`serving.storage.write_requirements_lock`, con versiones `==` y la versión de Python)
y sube el **paquete completo**. La tarjeta (`serving/model_card.py`) añade la sección
**Contenido del paquete** que lista los archivos realmente presentes por versión.

**Compatibilidad con `1.0.0`:** el criterio de "published" del portal
(`portal/src/lib/published-models.ts::checkPublication`) sigue basándose en
`REQUIRED_PACKAGE_FILES`, así que la `1.0.0` (que no tiene los de entorno) **sigue
"published"**. Además se reporta `envComplete`/`envFiles` para distinguir el paquete
completo de las versiones nuevas.

- Tests: `tests/serving/test_publish.py::test_publish_includes_env_config_and_requirements_lock`,
  `tests/serving/test_model_card.py::test_card_lists_package_files`,
  `portal/src/lib/published-models.test.ts` (envComplete/envFiles).

## 1.2 — crops_source_boxes.csv enlazado en la tarjeta

La tarjeta menciona y **enlaza** `data/crops/crops_source_boxes.csv` en la sección
**Procedencia de los recortes**, pero **solo cuando el archivo existe** en el repo
(`serving/model_card.py::_crops_source_boxes_lines`). No se inventa el enlace.

> **A partir de la versión `1.0.1`.** La tarjeta de la `1.0.0` **no se vuelve a subir**:
> hacerlo cambiaría su `VersionId` (`gVW1GG8U…`) y su SHA-256 (`d8e8f117…`), que el
> evaluador ya verificó. El enlace a `crops_source_boxes.csv` y la sección de entorno
> aplican a las versiones publicadas **a partir de la `1.0.1`**.

- Test: `tests/serving/test_model_card.py::test_full_package_card_lists_env_files_and_links_crops_source_boxes`.

## 5.3 — Segunda versión recuperable en S3 (`0.9.0`)

El código ya soporta publicar una versión que **no es el ganador**:

- `serving/publish.py` acepta `--run-id` arbitrario; verifica el SHA-256 contra el tag
  `weights_sha256` **del propio run** (no contra `selection.json`), así que publica el
  baseline sin tocar la selección congelada.
- `serving/model_card.py` genera una tarjeta **solo validación** cuando el run no tiene
  métricas `test_*`: sección *Desempeño en validación* con una nota de que **no es el
  campeón** y por eso no se evaluó en test (respeta M3). `check_consistency` rechaza dos
  incoherencias: un no-ganador con `test_*`, y el ganador sin `test_*`.
- La línea **Selección (T07)** de la tarjeta depende del run
  (`serving/model_card.py::_selection_line`): para el ganador dice "candidato elegido";
  para cualquier otro run dice "corrida de comparación (no elegida)" y nombra al run que
  sí se congeló (`selection.json`), su criterio y la versión del campeón (`1.0.0`). Así la
  tarjeta de la `0.9.0` no afirma que exp-01 fue el elegido. La tarjeta de la `1.0.0` no
  cambia. Tests: `test_non_winner_card_does_not_claim_it_was_the_selected_candidate` y
  `test_winner_card_keeps_the_selected_candidate_line`.

> ⚠️ **No ejecutado contra AWS.** Publicar `0.9.0` escribe en el bucket real
> `ml-models-proyecto3-2c1a70d3` y requiere el run `exp-01` (`7693ef54…`) en un MLflow
> accesible (hoy no está en el MLflow local; se perdió al recrear volúmenes). El flujo
> está probado contra MinIO/moto. Para publicarlo de verdad, con el run disponible y el
> OK del equipo:
>
> ```bash
> # 1. (una vez) tablas del portal
> cd portal && npm ci && npm run db:migrate && cd ..
> # 2. publicar el baseline exp-01 como 0.9.0 (pesos DISTINTOS a 1.0.0)
> python publish_model.py --run-id 7693ef54d0884ebba1fc40348010bf29 --version 0.9.0
> # 3. tarjeta solo-validación de la 0.9.0 (no toca la 1.0.0)
> python -m serving.model_card --version 0.9.0 --upload
> # 4. comprobar que hay DOS versiones con pesos de distinto SHA-256
> aws s3 ls s3://ml-models-proyecto3-2c1a70d3/models/clasificador/
> aws s3 cp s3://ml-models-proyecto3-2c1a70d3/models/clasificador/0.9.0/weights.pt - | sha256sum
> # (debe diferir de e5aa4f73… que es el de 1.0.0)
> ```
>
> La `1.0.0` sigue como champion: `0.9.0` va en claves nuevas, no sobrescribe nada. **No
> se evalúa el test con el run exp-01** (rompería M3): su tarjeta es solo de validación.

## Nota sobre `crops_source_boxes.csv`

El archivo lo genera la tarea 1.2 (otra actividad) desde el COCO del release, sin tocar
`crops.csv` ni el manifiesto. Aquí solo se añade el **enlace condicional** en la tarjeta:
si la otra tarea ya lo generó, la tarjeta de la versión nueva lo referencia; si no, la
sección se omite.
