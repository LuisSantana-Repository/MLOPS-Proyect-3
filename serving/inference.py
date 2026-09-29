"""Carga de modelos publicados con caché local y verificación de hash (T10).

``ModelCache`` descarga de S3 la versión pedida (si no está en caché), verifica el
SHA-256 de ``weights.pt`` contra el registrado en la tabla ``published_models`` (o el
pasado explícitamente) y carga el modelo con ``trainer.load_model``. La predicción
usa el transform que devuelve ``load_model`` (respeta el img_size de preprocess.json,
p. ej. 160), sin reimplementar el preprocesamiento.
"""

from __future__ import annotations

import io
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from serving import db, storage
from serving.storage import S3Settings, StorageError

if TYPE_CHECKING:
    from trainer import LoadedModel

log = logging.getLogger(__name__)


@dataclass
class Prediction:
    version: str
    predicted_class: str
    probabilities: dict[str, float]


class ModelCache:
    """Caché en memoria + disco de modelos publicados, indexado por versión."""

    def __init__(
        self,
        cache_dir: str | Path = "/tmp/model-cache",
        s3_settings: S3Settings | None = None,
        require_hash: bool = True,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._s3_settings = s3_settings
        # fail-closed: si no hay hash esperado (p. ej. DB caída), se rechaza en vez
        # de servir un modelo sin verificar. Se puede relajar con require_hash=False.
        self._require_hash = require_hash
        self._loaded: dict[str, LoadedModel] = {}
        self._lock = threading.Lock()

    # --- Configuración diferida ------------------------------------------------

    def s3_settings(self) -> S3Settings:
        if self._s3_settings is None:
            self._s3_settings = S3Settings.from_env()
        return self._s3_settings

    def _expected_hash(self, version: str) -> str | None:
        """Hash esperado de la tabla published_models (si hay DB disponible)."""
        try:
            conn = db.connect()
        except db.DBError as exc:
            log.warning("sin DB para verificar hash de la versión %s: %s", version, exc)
            return None
        try:
            row = db.get_model_version(conn, version)
            return row["sha256"] if row else None
        finally:
            conn.close()

    # --- Descarga y carga ------------------------------------------------------

    def _ensure_downloaded(self, version: str, expected_sha256: str | None) -> Path:
        package_dir = self.cache_dir / version
        settings = self.s3_settings()
        client = storage.make_s3_client(settings)

        # Se re-descarga si falta CUALQUIER archivo del paquete, no solo weights.pt:
        # una descarga previa interrumpida pudo dejar el paquete incompleto.
        complete = all((package_dir / name).is_file() for name in storage.PACKAGE_FILES)
        if not complete:
            log.info("descargando versión %s de s3://%s", version, settings.bucket)
            storage.download_package(client, settings.bucket, version, package_dir)

        expected = expected_sha256 or self._expected_hash(version)
        if expected:
            storage.verify_checkpoint_hash(package_dir, expected)
        elif self._require_hash:
            raise StorageError(
                f"no hay hash esperado para la versión {version} (¿DB no disponible?); "
                "no se sirve un modelo sin verificar (require_hash=True)"
            )
        else:
            log.warning("no hay hash esperado para la versión %s; se omite la verificación", version)
        return package_dir

    def get(self, version: str, expected_sha256: str | None = None) -> LoadedModel:
        """Devuelve el modelo de una versión, descargándolo/cargándolo si hace falta."""
        # Valida el formato de la versión ANTES de usarla en rutas o llaves S3.
        # Rechaza cosas como "../../x" (path traversal): parse_semver solo acepta
        # MAJOR.MINOR.PATCH y lanza StorageError en cualquier otro caso.
        storage.parse_semver(version)
        with self._lock:
            if version in self._loaded:
                return self._loaded[version]
            from trainer import load_model

            package_dir = self._ensure_downloaded(version, expected_sha256)
            loaded = load_model(package_dir)
            self._loaded[version] = loaded
            return loaded

    # --- Inferencia ------------------------------------------------------------

    def predict(self, version: str, image_bytes: bytes) -> Prediction:
        """Predice la clase de una imagen (bytes) con la versión indicada."""
        import torch
        from PIL import Image, UnidentifiedImageError

        loaded = self.get(version)
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                tensor = loaded.transform(img.convert("RGB")).unsqueeze(0)
        except (UnidentifiedImageError, OSError) as exc:
            raise StorageError(f"no se pudo leer la imagen: {exc}") from exc

        with torch.no_grad():
            logits = loaded.model(tensor)
            probs = torch.softmax(logits, dim=1)[0]

        probabilities = {cls: float(probs[i]) for i, cls in enumerate(loaded.classes)}
        top = max(probabilities, key=probabilities.get)
        return Prediction(version=version, predicted_class=top, probabilities=probabilities)
