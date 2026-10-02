"""Recorrido E2E del modelo con IDs coherentes de punta a punta (T16/7.2).

Cubre, en un entorno hermético (S3 simulado con moto, sin servicios externos), el
tramo que SÍ puede correr en CI del recorrido completo:

    entrenamiento -> paquete del run -> publicación en S3 (aislado) -> registro ->
    descarga limpia -> inferencia

verificando que el **mismo** run_id, versión y SHA-256 fluyen coherentes por todas
las etapas. El tramo que necesita servicios que CI no tiene (worker + MLflow + portal
+ cola de anotación) está en `scripts/e2e_recorrido.sh` y se documenta con evidencia.

Es la contraparte "en CI" del recorrido; `scripts/e2e_recorrido.sh` lo corre completo
contra el stack real.
"""

from __future__ import annotations

import io
import shutil
from pathlib import Path

import pytest
from PIL import Image

from serving import publish, storage
from serving.inference import ModelCache

RUN_ID = "e2e-run-0001"
VERSION = "1.2.3"


def _sample_image_bytes(size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), (120, 200, 90)).save(buf, format="JPEG")
    return buf.getvalue()


def test_recorrido_entrenar_publicar_descargar_inferir(
    s3_bucket, trained_package: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    client, settings = s3_bucket

    # (1) Entrenamiento: ya está hecho por la fixture `trained_package` (pipeline real
    #     del trainer sobre dataset sintético). Su weights.pt tiene un SHA-256 real.
    weights_sha = storage.sha256_file(trained_package / "weights.pt")
    print(f"[1] entrenamiento -> run_id={RUN_ID} sha256(weights.pt)={weights_sha[:12]}")

    # (2) Publicación en S3 AISLADO (moto): parcheamos la descarga del run de MLflow
    #     para usar el paquete entrenado, y no escribimos en DB ni Registry (no hay).
    def fake_download(run_id: str, dest_dir: Path, tracking_uri=None) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        for name in publish.RUN_ARTIFACTS:
            shutil.copy(trained_package / name, dest_dir / name)
        return dest_dir

    monkeypatch.setattr(publish, "download_run_package", fake_download)
    monkeypatch.setattr(publish, "run_tag", lambda *a, **k: None)

    pkg = publish.publish(
        run_id=RUN_ID,
        version=VERSION,
        s3_settings=settings,
        write_db=False,
        register_mlflow=False,
    )
    print(f"[2] publicación -> {pkg.s3_uri} sha256={pkg.sha256[:12]}")

    # IDs coherentes: el run y el hash de la publicación son los del entrenamiento.
    assert pkg.run_id == RUN_ID
    assert pkg.version == VERSION
    assert pkg.sha256 == weights_sha

    # El paquete COMPLETO está en S3 (incluye config/env/requirements.lock).
    for name in storage.FULL_PACKAGE_FILES:
        client.head_object(Bucket=settings.bucket, Key=f"models/clasificador/{VERSION}/{name}")

    # (3) Inferencia desde un entorno LIMPIO: descarga de S3 y predice, con el hash
    #     esperado = el de la publicación (como haría el servicio desde published_models).
    cache = ModelCache(cache_dir=tmp_path / "clean", s3_settings=settings)
    # El hash esperado se verifica al cargar (como el servicio desde published_models).
    loaded = cache.get(VERSION, expected_sha256=weights_sha)
    assert loaded is not None
    result = cache.predict(VERSION, _sample_image_bytes())
    print(f"[3] inferencia -> versión={result.version} clase={result.predicted_class}")

    # El contrato de la predicción es coherente y la versión usada es la publicada.
    assert result.version == VERSION
    assert result.predicted_class in set(result.probabilities)
    assert abs(sum(result.probabilities.values()) - 1.0) < 1e-4

    # El paquete quedó materializado en la caché limpia con el MISMO hash.
    downloaded = tmp_path / "clean" / VERSION / "weights.pt"
    assert storage.sha256_file(downloaded) == weights_sha

    out = capsys.readouterr().out
    assert RUN_ID in out and VERSION in out  # IDs trazables impresos de punta a punta
