"""Servicio de inferencia FastAPI (T10).

``POST /predict`` recibe una imagen y una versión de modelo, descarga esa versión
de S3 si no está en caché, verifica el hash y devuelve la clase predicha, las
probabilidades por clase y la versión usada.

Arranque local:
    uvicorn serving.app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from serving.inference import ModelCache
from serving.storage import IntegrityError, ModelNotFoundError, StorageError

log = logging.getLogger(__name__)

app = FastAPI(title="Inferencia clasificador de recortes (T10)")

# Caché compartida entre peticiones; el directorio se puede fijar por entorno.
_cache = ModelCache(cache_dir=os.environ.get("MODEL_CACHE_DIR", "/tmp/model-cache"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
async def predict(
    version: str = Form(..., description="versión semántica del modelo, p. ej. 1.0.0"),  # noqa: B008
    file: UploadFile = File(..., description="imagen del recorte a clasificar"),  # noqa: B008
) -> dict[str, object]:
    """Clasifica una imagen con la versión de modelo indicada."""
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="el archivo de imagen está vacío")

    try:
        result = _cache.predict(version, image_bytes)
    except ModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IntegrityError as exc:
        # Fallo de integridad: es una señal de alerta, no un error de cliente.
        log.error("integridad del modelo comprometida: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except StorageError as exc:
        # Imagen ilegible u otro problema de la petición.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("fallo al predecir")
        raise HTTPException(status_code=500, detail=f"error de inferencia: {exc}") from exc

    return {
        "version": result.version,
        "predicted_class": result.predicted_class,
        "probabilities": result.probabilities,
    }
