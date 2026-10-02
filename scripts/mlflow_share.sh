#!/usr/bin/env bash
# Comparte el MLflow del stack con el equipo (P0-1): versiona mlflow-store/ con DVC.
#
#   scripts/mlflow_share.sh            # espeja artefactos, dvc add y dvc push
#   git add mlflow-store.dvc && git commit -m "data: runs nuevos en mlflow-store"
#
# mlflow-store/mlflow.db ya recibe los runs nuevos (es el backend del servicio mlflow).
# Los artefactos de esos runs viven en el bucket `mlflow` de MinIO: aquí se copian a
# mlflow-store/artifacts para que viajen en el mismo .dvc. Nada se borra ni se reescribe.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f mlflow-store/mlflow.db ] || { echo "falta mlflow-store/mlflow.db: dvc pull mlflow-store.dvc" >&2; exit 1; }

# Artefactos nuevos de MinIO -> mlflow-store/artifacts (solo agrega).
docker compose run --rm --no-deps -v "$(pwd)/mlflow-store/artifacts:/out" --entrypoint /bin/sh createbuckets -c \
  "aws --endpoint-url http://minio:9000 s3 sync s3://mlflow /out --only-show-errors"

# Se detiene MLflow para versionar un SQLite consistente (sin escrituras a medias).
docker compose stop mlflow
trap 'docker compose start mlflow' EXIT
dvc add mlflow-store
dvc push mlflow-store.dvc
echo "Listo. Ahora: git add mlflow-store.dvc .gitignore && git commit"
