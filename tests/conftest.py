from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_mlflow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ninguna prueba puede escribir en un MLflow real.

    Si la terminal trae ``MLFLOW_TRACKING_URI`` del stack (p. ej. tras ``source
    scripts/host-env.sh``) o un script usa ``http://127.0.0.1:5000`` por defecto, los runs
    de prueba acabarían junto a las corridas reales del barrido. Cada prueba arranca con un
    store propio en ``tmp_path``; las que necesitan otro lo fijan con su propio monkeypatch.
    """
    monkeypatch.setenv("MLFLOW_TRACKING_URI", (tmp_path / "mlruns-aislado").resolve().as_uri())
    monkeypatch.delenv("MLFLOW_REGISTRY_URI", raising=False)
