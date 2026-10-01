"""Registra en ``published_models`` una versión que YA está publicada en S3 (T15).

``publish_model.py`` (T10) publica desde el run de MLflow y escribe la fila de
``published_models``. En una máquina nueva (un clon limpio, la del evaluador) ese
run no existe en su MLflow, pero el modelo sí está en el bucket: este comando
registra la versión leyendo el paquete de S3, sin MLflow, para que el servicio de
inferencia y las páginas Models/Inference del portal funcionen.

Antes de insertar verifica que el paquete publicado sea el candidato congelado:
el SHA-256 de ``weights.pt`` descargado debe coincidir con ``selection.json`` (T07)
y ``summary.json`` debe apuntar al mismo manifiesto.

Uso:
    python -m serving.register --version 1.0.0
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from serving import db, storage
from serving.storage import IntegrityError, S3Settings, StorageError

SELECTION_DEFAULT = Path("reports/t07/selection.json")
RELEASE_INFO_DEFAULT = Path("data/crops/release_info.json")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise StorageError(f"falta {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def register_existing(
    version: str,
    *,
    settings: S3Settings,
    selection_path: Path = SELECTION_DEFAULT,
    release_info_path: Path = RELEASE_INFO_DEFAULT,
    name: str = storage.MODEL_NAME,
) -> dict[str, str]:
    """Verifica el paquete publicado contra la selección y escribe su fila. Devuelve la fila."""
    storage.parse_semver(version)
    selection = _read_json(selection_path)
    expected_sha = selection.get("checkpoint", {}).get("sha256")
    if not expected_sha:
        raise StorageError(f"{selection_path} no tiene checkpoint.sha256")

    client = storage.make_s3_client(settings)
    with tempfile.TemporaryDirectory() as tmp:
        pkg = storage.download_package(client, settings.bucket, version, Path(tmp), name)
        sha = storage.verify_checkpoint_hash(pkg, expected_sha)
        summary = json.loads((pkg / "summary.json").read_text(encoding="utf-8"))

    manifest = summary.get("data", {}).get("manifest_sha256")
    expected_manifest = selection.get("data", {}).get("manifest_sha256")
    if expected_manifest and manifest != expected_manifest:
        raise IntegrityError(
            f"el paquete {version} se entrenó con el manifiesto {manifest}, no con el de la selección "
            f"({expected_manifest})"
        )

    release = _read_json(release_info_path).get("release_tag") if release_info_path.is_file() else None
    row = {
        "version": version,
        "name": name,
        "run_id": selection["run_id"],
        "dvc_release": release or selection.get("data", {}).get("dvc_release"),
        "s3_key": storage.model_prefix(version, name),
        "sha256": sha,
    }
    conn = db.connect()
    try:
        db.insert_model_version(conn, **row)
    finally:
        conn.close()
    return row


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m serving.register", description=__doc__.split("\n")[0])
    parser.add_argument("--version", required=True, help="versión ya publicada en S3, p. ej. 1.0.0")
    parser.add_argument("--selection", type=Path, default=SELECTION_DEFAULT, help="selection.json de T07")
    parser.add_argument("--use-minio", action="store_true", help="lee el paquete de MinIO (pruebas)")
    args = parser.parse_args(argv)
    try:
        settings = S3Settings.from_env(use_minio=args.use_minio)
        row = register_existing(args.version, settings=settings, selection_path=args.selection)
    except (StorageError, db.DBError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(
        f"registrada {row['name']} {row['version']} (run {row['run_id']}, sha256 {row['sha256'][:12]}) "
        f"desde s3://{settings.bucket}/{row['s3_key']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
