"""Prueba del endpoint FastAPI POST /predict (capa HTTP).

Llama a la corrutina del handler directamente con una caché parcheada, así no
requiere un servidor ni httpx/TestClient. Verifica el contrato de respuesta y el
manejo de errores (400 cuando la imagen o la versión son inválidas).
"""

from __future__ import annotations

import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from serving import app as app_module
from serving.inference import Prediction
from serving.storage import StorageError


def _upload(name: str = "crop.jpg") -> UploadFile:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="JPEG")
    buf.seek(0)
    return UploadFile(filename=name, file=buf)


def test_predict_returns_contract(monkeypatch) -> None:
    monkeypatch.setattr(
        app_module._cache,
        "predict",
        lambda version, data: Prediction(
            version=version,
            predicted_class="car",
            probabilities={"person": 0.1, "car": 0.9},
        ),
    )
    body = asyncio.run(app_module.predict(version="1.0.0", file=_upload()))
    assert body == {
        "version": "1.0.0",
        "predicted_class": "car",
        "probabilities": {"person": 0.1, "car": 0.9},
    }


def test_predict_rejects_empty_file() -> None:
    empty = UploadFile(filename="empty.jpg", file=io.BytesIO(b""))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(app_module.predict(version="1.0.0", file=empty))
    assert exc.value.status_code == 400


def test_predict_maps_storage_error_to_400(monkeypatch) -> None:
    def boom(version, data):
        raise StorageError("no existe la versión 9.9.9")

    monkeypatch.setattr(app_module._cache, "predict", boom)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(app_module.predict(version="9.9.9", file=_upload()))
    assert exc.value.status_code == 400


def test_health() -> None:
    assert app_module.health() == {"status": "ok"}
