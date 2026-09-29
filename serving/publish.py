"""Publicación del run ganador como versión de modelo (T10).

Flujo de ``publish``:
1. Resuelve el run ganador (``--run-id`` o ``reports/t07/selection.json``).
2. Descarga del run de MLflow (MinIO) los artefactos del paquete.
3. Verifica el SHA-256 de ``weights.pt`` contra el tag ``weights_sha256`` del run.
4. Calcula la siguiente versión semántica mirando lo ya publicado en S3.
5. Sube el paquete a ``s3://<bucket>/models/clasificador/<version>/`` (AWS S3).
6. Registra la versión en el Model Registry de MLflow y en la tabla ``published_models``.

Nota sobre el nombre de la tabla: el enunciado de T10 pide una tabla ``model_versions``,
pero el backend store de MLflow ya usa ese nombre (con otro esquema) en la misma base
de datos ``mlflow_db``. Para no chocar, la tabla del portal se llama ``published_models``
y conserva exactamente las columnas pedidas: version, run_id, dvc_release, s3_key,
sha256 y created_at (la "fecha").

El origen (MLflow/MinIO) y el destino (AWS S3) son almacenes S3 distintos: se usan
dos clientes/entornos separados (ver ``serving.storage``).
"""

from __future__ import annotations

import contextlib
import json
import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path

from serving import db, storage
from serving.storage import ModelPackage, S3Settings, StorageError

log = logging.getLogger(__name__)

SELECTION_DEFAULT = Path("reports/t07/selection.json")
WEIGHTS_SHA_TAG = "weights_sha256"
DVC_RELEASE_TAG = "dvc_release"


@dataclass
class WinningRun:
    run_id: str
    expected_sha256: str | None
    dvc_release: str | None


def resolve_winning_run(run_id: str | None, selection_path: Path = SELECTION_DEFAULT) -> WinningRun:
    """Determina el run ganador desde ``--run-id`` o el selection.json de T07."""
    if run_id:
        return WinningRun(run_id=run_id, expected_sha256=None, dvc_release=None)
    if not selection_path.is_file():
        raise StorageError(
            f"no se indicó --run-id y no existe {selection_path}; pasa un run explícito o genera la selección de T07"
        )
    data = json.loads(selection_path.read_text(encoding="utf-8"))
    return WinningRun(
        run_id=data["run_id"],
        expected_sha256=(data.get("checkpoint") or {}).get("sha256"),
        dvc_release=(data.get("data") or {}).get("dvc_release"),
    )


def download_run_package(run_id: str, dest_dir: Path, tracking_uri: str | None = None) -> Path:
    """Baja los artefactos del paquete del run de MLflow a ``dest_dir``."""
    from mlflow.tracking import MlflowClient

    client = MlflowClient(tracking_uri)
    dest_dir.mkdir(parents=True, exist_ok=True)
    for filename in storage.PACKAGE_FILES:
        client.download_artifacts(run_id, filename, str(dest_dir))
    return dest_dir


def run_tag(run_id: str, tag: str, tracking_uri: str | None = None) -> str | None:
    from mlflow.tracking import MlflowClient

    run = MlflowClient(tracking_uri).get_run(run_id)
    return run.data.tags.get(tag)


def register_in_mlflow(name: str, run_id: str, version_label: str, tracking_uri: str | None = None) -> str | None:
    """Registra la versión en el Model Registry de MLflow apuntando al run.

    No es fatal si falla (p. ej. registry deshabilitado): se registra un warning.
    Devuelve la versión asignada por MLflow o None.
    """
    from mlflow.exceptions import MlflowException
    from mlflow.tracking import MlflowClient

    client = MlflowClient(tracking_uri)
    try:
        with contextlib.suppress(MlflowException):
            client.create_registered_model(name)  # ya existe → se ignora
        run = client.get_run(run_id)
        source = f"{run.info.artifact_uri}"
        mv = client.create_model_version(
            name=name,
            source=source,
            run_id=run_id,
            tags={"semver": version_label},
        )
        return mv.version
    except MlflowException as exc:
        log.warning("no se pudo registrar en el Model Registry de MLflow: %s", exc)
        return None


def publish(
    *,
    run_id: str | None = None,
    selection_path: Path = SELECTION_DEFAULT,
    bump: str = "minor",
    version: str | None = None,
    tracking_uri: str | None = None,
    s3_settings: S3Settings | None = None,
    write_db: bool = True,
    register_mlflow: bool = True,
    overwrite: bool = False,
) -> ModelPackage:
    """Publica el run ganador y devuelve el ``ModelPackage`` resultante."""
    winning = resolve_winning_run(run_id, selection_path)
    s3 = s3_settings or S3Settings.from_env()
    s3_client = storage.make_s3_client(s3)

    with tempfile.TemporaryDirectory(prefix="publish-") as tmp:
        package_dir = download_run_package(winning.run_id, Path(tmp), tracking_uri)

        # Hash real del checkpoint descargado; si el run trae el tag, deben coincidir.
        expected = winning.expected_sha256 or run_tag(winning.run_id, WEIGHTS_SHA_TAG, tracking_uri)
        if expected:
            sha256 = storage.verify_checkpoint_hash(package_dir, expected)
        else:
            sha256 = storage.sha256_file(package_dir / storage.CHECKPOINT_FILE)
            log.warning("el run no expone %s; se usa el hash calculado localmente", WEIGHTS_SHA_TAG)

        # Versión semántica: la indicada o la siguiente sobre lo ya publicado.
        chosen_version = version or storage.next_semver(storage.list_existing_versions(s3_client, s3.bucket), bump=bump)

        # No sobrescribir una versión ya publicada salvo que se pida explícitamente.
        # Cierra la ventana entre listar y subir: si otro publicador tomó la misma
        # versión, se aborta en vez de pisar en silencio.
        if not overwrite and storage.version_exists(s3_client, s3.bucket, chosen_version):
            raise StorageError(
                f"la versión {chosen_version} ya existe en s3://{s3.bucket}/{storage.model_prefix(chosen_version)}; "
                "usa --overwrite para reemplazarla o elige otra versión"
            )

        storage.upload_package(s3_client, s3.bucket, package_dir, chosen_version)

    dvc_release = winning.dvc_release or run_tag(winning.run_id, DVC_RELEASE_TAG, tracking_uri)
    package = ModelPackage(
        name=storage.MODEL_NAME,
        version=chosen_version,
        bucket=s3.bucket,
        sha256=sha256,
        run_id=winning.run_id,
        dvc_release=dvc_release,
    )

    if register_mlflow:
        register_in_mlflow(storage.MODEL_NAME, winning.run_id, chosen_version, tracking_uri)

    if write_db:
        conn = db.connect()
        try:
            db.insert_model_version(
                conn,
                version=package.version,
                name=package.name,
                run_id=winning.run_id,
                dvc_release=dvc_release,
                s3_key=package.s3_key,
                sha256=sha256,
            )
        finally:
            conn.close()

    log.info("publicado %s en %s (sha256 %s)", package.version, package.s3_uri, sha256[:12])
    return package
