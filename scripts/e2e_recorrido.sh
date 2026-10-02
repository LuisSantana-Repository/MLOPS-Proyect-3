#!/usr/bin/env bash
# Recorrido E2E COMPLETO de T16/7.2 contra el stack real, con IDs coherentes de
# punta a punta y publicación en un MinIO AISLADO (no toca AWS):
#
#   training (API) -> job -> run en MLflow -> evaluación -> publicación en MinIO
#   -> inferencia en el portal -> envío a la cola de anotación
#
# El tramo final (inference -> anotación) reutiliza scripts/e2e_inference_anotacion.sh.
#
# Por qué NO corre en CI: necesita MariaDB, Redis, MLflow, MinIO, el worker y el portal
# arriba a la vez (servicios que el runner de CI no tiene). La parte "publicar -> descargar
# limpio -> inferir" sí corre en CI de forma hermética en tests/e2e/test_e2e_recorrido.py
# (S3 simulado con moto). Este script es para reproducirlo en una máquina con el stack.
#
# Requisitos:
#   docker compose up -d            # db, redis, mlflow, minio, worker, inference
#   cd portal && npm run db:migrate && npm run dev   # portal en :3000
#   source scripts/host-env.sh      # AWS_* -> MinIO, MLFLOW_TRACKING_URI, etc.
#   export MODELS_S3_USE_MINIO=1     # publica/lee en MinIO, NO en AWS
#
# Uso:  scripts/e2e_recorrido.sh
set -euo pipefail

PORTAL_URL="${PORTAL_URL:-http://localhost:3000}"
RELEASE="${RELEASE:-proyecto2 v1.1.0@dc9376e}"
VERSION="${VERSION:-0.0.1-e2e}"   # versión efímera del E2E; NO es 1.0.0 ni 0.9.0

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
step() { echo; echo "=== $* ==="; }

step "1) Training: encolar un job corto desde la API (1 época, 32 px)"
JOB=$(curl -fsS -X POST "$PORTAL_URL/api/training/jobs" \
  -H "Content-Type: application/json" \
  -d "{\"release\":\"$RELEASE\",\"max_epochs\":1,\"img_size\":32,\"batch_size\":8}")
JOB_ID=$(echo "$JOB" | json "d['id']")
echo "   job encolado: $JOB_ID"

step "2) Esperar a que el worker lo termine y leer su run de MLflow"
RUN_ID=""
for _ in $(seq 1 120); do
  STATE=$(curl -fsS "$PORTAL_URL/api/training/jobs/$JOB_ID")
  STATUS=$(echo "$STATE" | json "d['status']")
  [ "$STATUS" = "succeeded" ] && { RUN_ID=$(echo "$STATE" | json "d.get('runId') or ''"); break; }
  [ "$STATUS" = "failed" ] && { echo "   el job falló: $(echo "$STATE" | json "d.get('error')")"; exit 1; }
  sleep 5
done
[ -n "$RUN_ID" ] || { echo "   el job no terminó a tiempo"; exit 1; }
echo "   job $JOB_ID -> run de MLflow $RUN_ID"

step "3) Evaluación: métricas del run recién entrenado (no es el ganador congelado)"
curl -fsS "$PORTAL_URL/api/experiments/$RUN_ID/metrics" | json "list(d['metrics'].keys())"

step "4) Publicación en MinIO aislado (MODELS_S3_USE_MINIO=1)"
: "${MODELS_S3_USE_MINIO:?exporta MODELS_S3_USE_MINIO=1 para no tocar AWS}"
python publish_model.py --run-id "$RUN_ID" --version "$VERSION" --use-minio --overwrite --no-registry
echo "   publicado clasificador:$VERSION en MinIO"

step "5) Registrar la versión en published_models (para el portal)"
python -m serving.register --version "$VERSION" --use-minio || \
  python publish_model.py --run-id "$RUN_ID" --version "$VERSION" --use-minio --overwrite --no-registry

step "6) Inferencia + envío a anotación (reusa el E2E de P0-3)"
PORTAL_URL="$PORTAL_URL" scripts/e2e_inference_anotacion.sh "$VERSION"

step "RESUMEN (IDs coherentes de punta a punta)"
echo "  release    : $RELEASE"
echo "  job        : $JOB_ID"
echo "  run MLflow : $RUN_ID"
echo "  versión    : $VERSION  (en MinIO: models/clasificador/$VERSION/)"
echo "OK: recorrido completo entrenamiento -> anotación con el mismo run_id/versión."
