"""Publicación e inferencia del modelo ganador (T10).

- ``serving.storage``: cliente S3 (boto3) parametrizable (AWS real o MinIO),
  cálculo de SHA-256, versión semántica y layout de llaves.
- ``serving.publish``: descarga el paquete del run ganador, lo versiona, lo sube
  a S3 y lo registra en el Model Registry de MLflow y en la tabla ``published_models``.
- ``serving.app``: servicio FastAPI con ``POST /predict``.
"""

from serving.storage import (
    MODEL_NAME,
    PACKAGE_FILES,
    IntegrityError,
    ModelNotFoundError,
    ModelPackage,
    S3Settings,
    StorageError,
    make_s3_client,
    model_prefix,
    next_semver,
    sha256_file,
)

__all__ = [
    "MODEL_NAME",
    "PACKAGE_FILES",
    "IntegrityError",
    "ModelNotFoundError",
    "ModelPackage",
    "S3Settings",
    "StorageError",
    "make_s3_client",
    "model_prefix",
    "next_semver",
    "sha256_file",
]
