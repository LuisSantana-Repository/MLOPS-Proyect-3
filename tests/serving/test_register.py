"""Registro de una versión ya publicada en S3 sin el run de MLflow (T15)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from serving import register, storage
from serving.register import register_existing
from serving.storage import IntegrityError


@pytest.fixture
def published(trained_package: Path, s3_bucket):
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")
    summary = json.loads((trained_package / "summary.json").read_text(encoding="utf-8"))
    return settings, storage.sha256_file(trained_package / "weights.pt"), summary["data"]["manifest_sha256"]


@pytest.fixture
def inserted(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    rows: list[dict] = []
    monkeypatch.setattr(register.db, "connect", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(register.db, "insert_model_version", lambda conn, **row: rows.append(row))
    return rows


def _selection(tmp_path: Path, sha: str, manifest: str) -> Path:
    path = tmp_path / "selection.json"
    path.write_text(
        json.dumps({"run_id": "run-ganador", "checkpoint": {"sha256": sha}, "data": {"manifest_sha256": manifest}})
    )
    return path


def _release(tmp_path: Path) -> Path:
    path = tmp_path / "release_info.json"
    path.write_text(json.dumps({"release_tag": "proyecto2 v1.1.0@dc9376e"}))
    return path


def test_registers_the_published_package_with_its_real_hash(published, inserted, tmp_path: Path) -> None:
    settings, sha, manifest = published
    row = register_existing(
        "1.0.0",
        settings=settings,
        selection_path=_selection(tmp_path, sha, manifest),
        release_info_path=_release(tmp_path),
    )
    assert inserted == [row]
    assert row == {
        "version": "1.0.0",
        "name": "clasificador",
        "run_id": "run-ganador",
        "dvc_release": "proyecto2 v1.1.0@dc9376e",
        "s3_key": "models/clasificador/1.0.0",
        "sha256": sha,
    }


def test_rejects_a_package_that_is_not_the_frozen_checkpoint(published, inserted, tmp_path: Path) -> None:
    settings, _, manifest = published
    with pytest.raises(IntegrityError):
        register_existing(
            "1.0.0",
            settings=settings,
            selection_path=_selection(tmp_path, "0" * 64, manifest),
            release_info_path=_release(tmp_path),
        )
    assert inserted == []


def test_rejects_a_package_trained_on_another_manifest(published, inserted, tmp_path: Path) -> None:
    settings, sha, _ = published
    with pytest.raises(IntegrityError, match="manifiesto"):
        register_existing(
            "1.0.0",
            settings=settings,
            selection_path=_selection(tmp_path, sha, "otro"),
            release_info_path=_release(tmp_path),
        )
    assert inserted == []


def test_rejects_a_version_that_is_not_in_s3(published, inserted, tmp_path: Path) -> None:
    settings, sha, manifest = published
    with pytest.raises(storage.ModelNotFoundError):
        register_existing("2.0.0", settings=settings, selection_path=_selection(tmp_path, sha, manifest))
    assert inserted == []
