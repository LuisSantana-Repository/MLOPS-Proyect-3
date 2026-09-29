"""Prueba principal de T10: un entorno limpio descarga el paquete de S3 e infiere.

Cubre el criterio de aceptación: subir el paquete a S3, descargarlo en un directorio
temporal limpio, verificar el hash y predecir una imagen correctamente.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from serving import storage
from serving.inference import ModelCache
from serving.storage import IntegrityError, ModelNotFoundError, StorageError


def _sample_image_bytes(size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), (120, 200, 90)).save(buf, format="JPEG")
    return buf.getvalue()


def test_clean_download_and_predict(s3_bucket, trained_package, tmp_path: Path) -> None:
    client, settings = s3_bucket
    sha256 = storage.sha256_file(trained_package / "weights.pt")
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")

    # Entorno limpio: caché vacía en un tmp aislado, sin el paquete local.
    # Sin DB en el test, el hash esperado se provee explícitamente (como haría el
    # servicio a partir de published_models).
    cache = ModelCache(cache_dir=tmp_path / "clean-cache", s3_settings=settings)
    loaded = cache.get("1.0.0", expected_sha256=sha256)
    assert loaded is not None
    result = cache.predict("1.0.0", _sample_image_bytes())

    assert result.version == "1.0.0"
    # La clase predicha es una de las clases del paquete.
    classes = set(result.probabilities)
    assert result.predicted_class in classes
    # Probabilidades válidas (suman ~1, todas en [0,1]).
    assert abs(sum(result.probabilities.values()) - 1.0) < 1e-4
    assert all(0.0 <= p <= 1.0 for p in result.probabilities.values())

    # El paquete quedó materializado en la caché limpia y su hash coincide.
    downloaded = tmp_path / "clean-cache" / "1.0.0" / "weights.pt"
    assert downloaded.is_file()
    assert storage.sha256_file(downloaded) == sha256


def test_predict_verifies_hash_from_argument(s3_bucket, trained_package, tmp_path: Path) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")

    cache = ModelCache(cache_dir=tmp_path / "cache", s3_settings=settings)
    # Un hash esperado incorrecto debe hacer fallar la carga (integridad).
    with pytest.raises(IntegrityError):
        cache.get("1.0.0", expected_sha256="0" * 64)


def test_fail_closed_without_hash(monkeypatch, s3_bucket, trained_package, tmp_path: Path) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")

    # Sin DB (from_env fallaría) y sin hash explícito: fail-closed por defecto.
    cache = ModelCache(cache_dir=tmp_path / "cache", s3_settings=settings)
    monkeypatch.setattr(cache, "_expected_hash", lambda version: None)
    with pytest.raises(StorageError):
        cache.get("1.0.0")


def test_allow_unverified_opt_out(monkeypatch, s3_bucket, trained_package, tmp_path: Path) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")

    # Con require_hash=False y sin hash disponible, carga igual (modo relajado).
    cache = ModelCache(cache_dir=tmp_path / "cache", s3_settings=settings, require_hash=False)
    monkeypatch.setattr(cache, "_expected_hash", lambda version: None)
    assert cache.get("1.0.0") is not None


def test_missing_version_raises(s3_bucket, tmp_path: Path) -> None:
    _client, settings = s3_bucket
    cache = ModelCache(cache_dir=tmp_path / "cache", s3_settings=settings)
    with pytest.raises(ModelNotFoundError):
        cache.predict("9.9.9", _sample_image_bytes())
