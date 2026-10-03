"""Pruebas de publish_model: descarga del run (simulada), hash, subida a S3 y versión."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from serving import publish, storage
from serving.storage import StorageError


@pytest.fixture
def patched_publish(monkeypatch, trained_package):
    """Parcha la descarga de MLflow (usa el paquete entrenado) y desactiva DB/registry."""

    def fake_download(run_id: str, dest_dir: Path, tracking_uri=None) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        # El run trae todos los artefactos del paquete menos requirements.lock, que
        # lo genera la publicación a partir de env.json (igual que download_run_package).
        for name in publish.RUN_ARTIFACTS:
            shutil.copy(trained_package / name, dest_dir / name)
        return dest_dir

    monkeypatch.setattr(publish, "download_run_package", fake_download)
    monkeypatch.setattr(publish, "run_tag", lambda *a, **k: None)
    return trained_package


def test_publish_uploads_and_versions(s3_bucket, patched_publish) -> None:
    client, settings = s3_bucket
    expected_sha = storage.sha256_file(patched_publish / "weights.pt")

    pkg = publish.publish(
        run_id="run-xyz",
        bump="minor",
        s3_settings=settings,
        write_db=False,
        register_mlflow=False,
    )

    assert pkg.version == "1.0.0"
    assert pkg.sha256 == expected_sha
    assert pkg.s3_key == "models/clasificador/1.0.0"
    # El paquete COMPLETO existe en el bucket: mínimo + entorno + requirements.lock.
    listed = storage.list_existing_versions(client, settings.bucket)
    assert listed == ["1.0.0"]
    for name in storage.FULL_PACKAGE_FILES:
        client.head_object(Bucket=settings.bucket, Key=f"models/clasificador/1.0.0/{name}")


def test_publish_includes_env_config_and_requirements_lock(s3_bucket, patched_publish) -> None:
    """T16/5.1: el paquete publicado incluye env.json, config.json y requirements.lock."""
    client, settings = s3_bucket
    publish.publish(run_id="run-xyz", version="2.0.0", s3_settings=settings, write_db=False, register_mlflow=False)
    for name in ("config.json", "env.json", "requirements.lock"):
        client.head_object(Bucket=settings.bucket, Key=f"models/clasificador/2.0.0/{name}")

    # requirements.lock trae versiones fijadas derivadas de env.json (torch==..., etc.).
    obj = client.get_object(Bucket=settings.bucket, Key="models/clasificador/2.0.0/requirements.lock")
    lock = obj["Body"].read().decode("utf-8")
    assert "torch==" in lock
    assert "# Python" in lock


def test_publish_autoincrements_over_existing(s3_bucket, patched_publish) -> None:
    _client, settings = s3_bucket
    # Pre-siembra una 1.0.0 "mínima" (como la congelada, sin los archivos de entorno)
    # solo para que exista; la siguiente publicación debe autoincrementar a 1.1.0.
    storage.upload_package(_client, settings.bucket, patched_publish, "1.0.0", files=storage.REQUIRED_PACKAGE_FILES)

    pkg = publish.publish(
        run_id="run-xyz",
        s3_settings=settings,
        write_db=False,
        register_mlflow=False,
    )
    assert pkg.version == "1.1.0"


def test_publish_refuses_to_overwrite_existing_version(s3_bucket, patched_publish) -> None:
    _client, settings = s3_bucket
    # Publica 1.0.0 y luego intenta re-publicar la MISMA versión sin --overwrite.
    publish.publish(run_id="run-xyz", version="1.0.0", s3_settings=settings, write_db=False, register_mlflow=False)
    with pytest.raises(StorageError):
        publish.publish(run_id="run-xyz", version="1.0.0", s3_settings=settings, write_db=False, register_mlflow=False)


def test_publish_overwrite_allows_replacing_version(s3_bucket, patched_publish) -> None:
    _client, settings = s3_bucket
    publish.publish(run_id="run-xyz", version="1.0.0", s3_settings=settings, write_db=False, register_mlflow=False)
    # Con overwrite=True sí reemplaza.
    pkg = publish.publish(
        run_id="run-xyz",
        version="1.0.0",
        s3_settings=settings,
        write_db=False,
        register_mlflow=False,
        overwrite=True,
    )
    assert pkg.version == "1.0.0"


def test_publish_detects_hash_mismatch(monkeypatch, s3_bucket, patched_publish) -> None:
    _client, settings = s3_bucket
    # El run declara un sha256 que no coincide con el weights.pt real → falla.
    monkeypatch.setattr(publish, "run_tag", lambda *a, **k: "0" * 64)
    with pytest.raises(StorageError):
        publish.publish(run_id="run-xyz", s3_settings=settings, write_db=False, register_mlflow=False)


def test_resolve_winning_run_from_selection(tmp_path: Path) -> None:
    selection = tmp_path / "selection.json"
    selection.write_text(
        '{"run_id": "abc123", "checkpoint": {"sha256": "deadbeef"}, '
        '"data": {"dvc_release": "proyecto2 v1.1.0@dc9376e"}}',
        encoding="utf-8",
    )
    winning = publish.resolve_winning_run(None, selection)
    assert winning.run_id == "abc123"
    assert winning.expected_sha256 == "deadbeef"
    assert winning.dvc_release == "proyecto2 v1.1.0@dc9376e"
