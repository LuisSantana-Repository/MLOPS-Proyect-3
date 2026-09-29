"""Pruebas de la capa de almacenamiento S3 (versionado, hash, layout)."""

from __future__ import annotations

import pytest

from serving import storage
from serving.storage import StorageError


def test_next_semver_from_empty_is_1_0_0() -> None:
    assert storage.next_semver([]) == "1.0.0"


def test_next_semver_bumps() -> None:
    assert storage.next_semver(["1.0.0", "1.1.0"]) == "1.2.0"
    assert storage.next_semver(["1.2.0"], bump="major") == "2.0.0"
    assert storage.next_semver(["1.2.0"], bump="patch") == "1.2.1"


def test_parse_semver_rejects_garbage() -> None:
    with pytest.raises(StorageError):
        storage.parse_semver("no-soy-semver")


def test_model_key_layout() -> None:
    assert storage.model_prefix("1.0.0") == "models/clasificador/1.0.0"
    assert storage.model_key("1.0.0", "weights.pt") == "models/clasificador/1.0.0/weights.pt"


def test_upload_then_list_versions_roundtrip(s3_bucket, trained_package) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")
    storage.upload_package(client, settings.bucket, trained_package, "1.1.0")
    assert storage.list_existing_versions(client, settings.bucket) == ["1.0.0", "1.1.0"]
    assert storage.next_semver(storage.list_existing_versions(client, settings.bucket)) == "1.2.0"


def test_verify_checkpoint_hash_detects_mismatch(trained_package) -> None:
    good = storage.sha256_file(trained_package / "weights.pt")
    assert storage.verify_checkpoint_hash(trained_package, good) == good
    with pytest.raises(StorageError):
        storage.verify_checkpoint_hash(trained_package, "0" * 64)
