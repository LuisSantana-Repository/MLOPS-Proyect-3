# Variables para correr el pipeline DESDE EL HOST contra el stack de docker compose (T15).
#
# Uso (bash o Git Bash en Windows, desde la raíz del repo):
#     source scripts/host-env.sh
#
# Resuelve el choque de nombres de .env: ahí AWS_* son las credenciales del bucket de
# modelos (AWS real), pero el cliente de MLflow usa AWS_* para el artifact store (MinIO).
# Este script deja:
#   - AWS_* y MLFLOW_S3_ENDPOINT_URL -> MinIO (artefactos de MLflow)
#   - MODELS_*                        -> bucket de modelos en AWS (publicación, inferencia, tarjeta)
#   - MLFLOW_TRACKING_URI y MYSQL_*   -> servicios del stack expuestos en localhost
# Si en .env no pusiste las llaves de AWS, define antes MODELS_AWS_PROFILE=<perfil> para
# tomarlas de tu perfil del AWS CLI. No imprime ningún secreto.

if [ ! -f .env ]; then
  echo "host-env: no hay .env en $(pwd); copia .env.example a .env y complétalo" >&2
  return 1 2>/dev/null || exit 1
fi

set -a
# shellcheck disable=SC1091
. <(tr -d '\r' < .env)
set +a

export MODELS_S3_BUCKET="${MODELS_S3_BUCKET:-$S3_BUCKET}"
export MODELS_AWS_ACCESS_KEY_ID="${MODELS_AWS_ACCESS_KEY_ID:-$AWS_ACCESS_KEY_ID}"
export MODELS_AWS_SECRET_ACCESS_KEY="${MODELS_AWS_SECRET_ACCESS_KEY:-$AWS_SECRET_ACCESS_KEY}"
export MODELS_AWS_REGION="${MODELS_AWS_REGION:-us-east-1}"
if [ -z "$MODELS_AWS_ACCESS_KEY_ID" ] && [ -n "$MODELS_AWS_PROFILE" ]; then
  MODELS_AWS_ACCESS_KEY_ID="$(aws configure get aws_access_key_id --profile "$MODELS_AWS_PROFILE")"
  MODELS_AWS_SECRET_ACCESS_KEY="$(aws configure get aws_secret_access_key --profile "$MODELS_AWS_PROFILE")"
  export MODELS_AWS_ACCESS_KEY_ID MODELS_AWS_SECRET_ACCESS_KEY
fi
# Un endpoint residual mandaría la "publicación en AWS" a MinIO.
unset MODELS_S3_ENDPOINT_URL MODELS_S3_USE_MINIO

export AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER"
export AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD"
export MLFLOW_S3_ENDPOINT_URL=http://localhost:9000
export MLFLOW_TRACKING_URI=http://localhost:5000
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3307
unset AWS_PROFILE

echo "host-env: MLflow=$MLFLOW_TRACKING_URI · artefactos=MinIO · bucket de modelos=${MODELS_S3_BUCKET:-<sin definir>}" \
  "· llaves de AWS: $([ -n "$MODELS_AWS_ACCESS_KEY_ID" ] && echo cargadas || echo FALTAN)"
