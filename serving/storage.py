"""Capa de almacenamiento S3 compartida por publish e inferencia (T10).

Un solo lugar decide:
- Cómo se construye el cliente boto3 (AWS S3 real o MinIO según ``endpoint_url``).
- El layout de llaves: ``models/clasificador/<version>/<archivo>``.
- El cálculo de SHA-256 y el versionado semántico.

El bucket de modelos es el bucket AWS S3 real (``S3_BUCKET`` del .env, política IAM
de Terraform con prefijo ``models/*``). Para pruebas locales el mismo código apunta
a MinIO pasando ``endpoint_url`` (p. ej. ``http://127.0.0.1:9000``).
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError

# Nombre del modelo en el registry y en el layout de S3.
MODEL_NAME = "clasificador"

# Archivos del paquete que se versionan y suben (subconjunto de los artefactos del run).
# summary.json hace las veces de "tarjeta" del modelo (model card) del contrato.
PACKAGE_FILES: tuple[str, ...] = (
    "weights.pt",
    "classes.json",
    "preprocess.json",
    "summary.json",
)

# El archivo cuyo SHA-256 identifica al modelo (coincide con el tag weights_sha256).
CHECKPOINT_FILE = "weights.pt"

_SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def _env(name: str) -> str | None:
    """Lee una variable de entorno tratando cadena vacía como ausente (None)."""
    value = os.environ.get(name)
    return value if value else None


class StorageError(RuntimeError):
    """Error de configuración o de acceso a S3."""


class ModelNotFoundError(StorageError):
    """La versión de modelo pedida no existe en S3."""


class IntegrityError(StorageError):
    """El SHA-256 del artefacto descargado no coincide con el esperado."""


@dataclass
class S3Settings:
    """Configuración de acceso a S3 (o MinIO)."""

    bucket: str
    region: str = "us-east-1"
    endpoint_url: str | None = None
    access_key: str | None = None
    secret_key: str | None = None

    @classmethod
    def from_env(cls, *, use_minio: bool = False) -> S3Settings:
        """Construye la config desde variables de entorno.

        - Por defecto (``use_minio=False``) usa el bucket AWS real: ``S3_BUCKET``,
          ``AWS_ACCESS_KEY_ID``, ``AWS_SECRET_ACCESS_KEY`` y sin ``endpoint_url``.
        - Con ``use_minio=True`` (o ``MODELS_S3_USE_MINIO=1``) apunta a MinIO:
          ``MLFLOW_BUCKET_NAME``/``MODELS_S3_BUCKET`` y ``MLFLOW_S3_ENDPOINT_URL``.
        """
        use_minio = use_minio or os.environ.get("MODELS_S3_USE_MINIO", "") in {"1", "true", "yes"}
        if use_minio:
            bucket = _env("MODELS_S3_BUCKET") or _env("MLFLOW_BUCKET_NAME") or "mlflow"
            endpoint = _env("MLFLOW_S3_ENDPOINT_URL") or "http://127.0.0.1:9000"
            return cls(
                bucket=bucket,
                endpoint_url=endpoint,
                access_key=_env("AWS_ACCESS_KEY_ID"),
                secret_key=_env("AWS_SECRET_ACCESS_KEY"),
            )
        bucket = _env("MODELS_S3_BUCKET") or _env("S3_BUCKET")
        if not bucket:
            raise StorageError(
                "falta S3_BUCKET (o MODELS_S3_BUCKET) en el entorno para el bucket de modelos de AWS; "
                "usa MODELS_S3_USE_MINIO=1 para probar contra MinIO"
            )
        # Credenciales dedicadas del bucket de modelos (Terraform crea un usuario IAM
        # propio). Si no están, cae a las AWS_* genéricas. NO se reutilizan las de
        # MinIO, que en el worker viven en AWS_* apuntando al artifact store.
        # Un MODELS_S3_ENDPOINT_URL vacío (p. ej. definido así en .env) se trata como
        # None = AWS real, para no romper el cliente boto3 con endpoint "".
        return cls(
            bucket=bucket,
            region=_env("MODELS_AWS_REGION") or _env("AWS_REGION") or "us-east-1",
            endpoint_url=_env("MODELS_S3_ENDPOINT_URL"),  # None/"" = AWS real
            access_key=_env("MODELS_AWS_ACCESS_KEY_ID") or _env("AWS_ACCESS_KEY_ID"),
            secret_key=_env("MODELS_AWS_SECRET_ACCESS_KEY") or _env("AWS_SECRET_ACCESS_KEY"),
        )


def make_s3_client(settings: S3Settings) -> BaseClient:
    """Cliente boto3 S3. Con ``endpoint_url`` va a MinIO; sin él, a AWS."""
    return boto3.client(
        "s3",
        region_name=settings.region,
        endpoint_url=settings.endpoint_url,
        aws_access_key_id=settings.access_key,
        aws_secret_access_key=settings.secret_key,
    )


def sha256_file(path: str | Path) -> str:
    """SHA-256 hex de un archivo, leído por bloques (no carga todo en memoria)."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_prefix(version: str, name: str = MODEL_NAME) -> str:
    """Prefijo S3 del paquete de una versión: ``models/<name>/<version>``."""
    return f"models/{name}/{version}"


def model_key(version: str, filename: str, name: str = MODEL_NAME) -> str:
    """Llave S3 de un archivo del paquete."""
    return f"{model_prefix(version, name)}/{filename}"


def parse_semver(version: str) -> tuple[int, int, int]:
    match = _SEMVER_RE.match(version.strip())
    if not match:
        raise StorageError(f"versión semántica inválida: {version!r} (usa MAJOR.MINOR.PATCH)")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def list_existing_versions(client: BaseClient, bucket: str, name: str = MODEL_NAME) -> list[str]:
    """Versiones ya publicadas en ``models/<name>/`` (por prefijos de S3)."""
    prefix = f"models/{name}/"
    paginator = client.get_paginator("list_objects_v2")
    versions: set[str] = set()
    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix, Delimiter="/"):
            for cp in page.get("CommonPrefixes", []):
                tail = cp["Prefix"][len(prefix) :].strip("/")
                if _SEMVER_RE.match(tail):
                    versions.add(tail)
    except ClientError as exc:  # bucket inexistente u otros
        raise StorageError(f"no se pudo listar versiones en s3://{bucket}/{prefix}: {exc}") from exc
    return sorted(versions, key=parse_semver)


def version_exists(client: BaseClient, bucket: str, version: str, name: str = MODEL_NAME) -> bool:
    """True si ya hay objetos bajo ``models/<name>/<version>/`` en S3."""
    prefix = f"{model_prefix(version, name)}/"
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
    except ClientError as exc:
        raise StorageError(f"no se pudo comprobar s3://{bucket}/{prefix}: {exc}") from exc
    return resp.get("KeyCount", 0) > 0


def next_semver(existing: list[str], bump: str = "minor") -> str:
    """Siguiente versión semántica a partir de las existentes.

    Sin versiones previas → ``1.0.0``. Con ``bump`` se incrementa major/minor/patch
    sobre la mayor existente.
    """
    if not existing:
        return "1.0.0"
    major, minor, patch = parse_semver(existing[-1])
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    raise StorageError(f"bump inválido: {bump!r} (usa major, minor o patch)")


@dataclass
class ModelPackage:
    """Un paquete de modelo versionado en S3."""

    name: str
    version: str
    bucket: str
    sha256: str
    run_id: str | None = None
    dvc_release: str | None = None
    files: list[str] = field(default_factory=lambda: list(PACKAGE_FILES))

    @property
    def prefix(self) -> str:
        return model_prefix(self.version, self.name)

    @property
    def s3_key(self) -> str:
        """Llave S3 del paquete (el prefijo del directorio de la versión)."""
        return self.prefix

    @property
    def s3_uri(self) -> str:
        return f"s3://{self.bucket}/{self.prefix}"


def upload_package(
    client: BaseClient,
    bucket: str,
    local_dir: str | Path,
    version: str,
    name: str = MODEL_NAME,
    files: tuple[str, ...] = PACKAGE_FILES,
) -> None:
    """Sube los archivos del paquete desde ``local_dir`` a ``models/<name>/<version>/``."""
    local_dir = Path(local_dir)
    for filename in files:
        source = local_dir / filename
        if not source.is_file():
            raise StorageError(f"falta {filename} en el paquete local {local_dir}")
        client.upload_file(str(source), bucket, model_key(version, filename, name))


def download_package(
    client: BaseClient,
    bucket: str,
    version: str,
    dest_dir: str | Path,
    name: str = MODEL_NAME,
    files: tuple[str, ...] = PACKAGE_FILES,
) -> Path:
    """Descarga el paquete de una versión a ``dest_dir``. Devuelve el directorio."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    for filename in files:
        key = model_key(version, filename, name)
        try:
            client.download_file(bucket, key, str(dest_dir / filename))
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NoSuchBucket"}:
                raise ModelNotFoundError(f"no existe la versión {version} del modelo {name} en s3://{bucket}") from exc
            raise StorageError(f"no se pudo descargar s3://{bucket}/{key}: {exc}") from exc
    return dest_dir


def verify_checkpoint_hash(package_dir: str | Path, expected_sha256: str) -> str:
    """Verifica que weights.pt tenga el SHA-256 esperado. Devuelve el hash calculado.

    Normaliza ambos lados (minúsculas, sin espacios) para no fallar por un hash
    copiado con mayúsculas o espacios de más.
    """
    actual = sha256_file(Path(package_dir) / CHECKPOINT_FILE)
    if actual.strip().lower() != expected_sha256.strip().lower():
        raise IntegrityError(f"hash de {CHECKPOINT_FILE} no coincide: esperado {expected_sha256}, calculado {actual}")
    return actual
