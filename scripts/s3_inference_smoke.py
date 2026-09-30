"""Smoke de inferencia contra el bucket S3 REAL de modelos (T10 / T14 CI).

Reutiliza la misma ruta de código que sirve el servicio de inferencia
(``serving.inference.ModelCache`` + ``serving.storage.S3Settings.from_env``):

    1. Construye la config de S3 desde el entorno (MODELS_S3_BUCKET,
       MODELS_AWS_ACCESS_KEY_ID, MODELS_AWS_SECRET_ACCESS_KEY, MODELS_AWS_REGION).
    2. Descarga el paquete de la versión pedida (MODEL_VERSION, por defecto 1.0.0)
       a una caché temporal limpia.
    3. Verifica el SHA-256 de weights.pt (fail-closed salvo ALLOW_UNVERIFIED=1).
    4. Corre una inferencia sobre una imagen sintética y valida el contrato de la
       predicción (clase válida, probabilidades en [0,1] que suman ~1).

Este script es la contraparte "S3 real con secretos de Actions" del test
``tests/serving/test_inference.py::test_clean_download_and_predict``, que cubre lo
mismo con un S3 simulado (moto) para mantener el CI verde sin infraestructura.

Salida: 0 = OK, 1 = fallo. Pensado para correr en un job opcional de CI que solo
se activa cuando los secretos de S3 están configurados.
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

from serving.inference import ModelCache
from serving.storage import S3Settings


def _sample_image_bytes(size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), (120, 200, 90)).save(buf, format="JPEG")
    return buf.getvalue()


def main() -> int:
    version = os.environ.get("MODEL_VERSION", "1.0.0")
    # require_hash=False solo si se pide explícitamente (por defecto fail-closed).
    require_hash = os.environ.get("ALLOW_UNVERIFIED", "") not in {"1", "true", "yes"}

    settings = S3Settings.from_env()
    print(f"Bucket de modelos: s3://{settings.bucket} (region={settings.region})")
    print(f"Versión objetivo: {version}  (require_hash={require_hash})")

    with tempfile.TemporaryDirectory(prefix="s3-smoke-") as tmp:
        cache = ModelCache(cache_dir=Path(tmp) / "cache", s3_settings=settings, require_hash=require_hash)

        print("1. Descargando el paquete publicado desde S3 y cargándolo...")
        loaded = cache.get(version)
        assert loaded is not None, "load_model devolvió None"
        print(f"   clases del modelo: {loaded.classes}")

        print("2. Ejecutando inferencia sobre una imagen sintética...")
        result = cache.predict(version, _sample_image_bytes())

        classes = set(result.probabilities)
        assert result.version == version, f"versión inesperada: {result.version}"
        assert result.predicted_class in classes, f"clase predicha fuera del set: {result.predicted_class}"
        total = sum(result.probabilities.values())
        assert abs(total - 1.0) < 1e-4, f"las probabilidades no suman ~1 (suma={total})"
        assert all(0.0 <= p <= 1.0 for p in result.probabilities.values()), "probabilidad fuera de [0,1]"

        print(f"   clase predicha: {result.predicted_class}  (suma probs={total:.6f})")

    print("\n✓ Smoke de inferencia contra S3 real superado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
