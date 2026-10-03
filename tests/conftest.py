from __future__ import annotations

from pathlib import Path

import boto3
import pytest
from moto import mock_aws

from serving import storage
from trainer.config import TrainConfig
from trainer.synthetic import make_synthetic_dataset
from trainer.train import train

# Bucket del S3 simulado compartido por las pruebas de serving y del E2E.
TEST_BUCKET = "test-models-bucket"


@pytest.fixture(scope="session")
def trained_package(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Entrena un modelo mínimo real y devuelve el directorio de su paquete.

    Reusa el pipeline del trainer (dataset sintético, img_size pequeño) para que
    weights.pt/classes.json/preprocess.json sean auténticos y cargables por load_model.
    Definido una sola vez aquí (nivel raíz de tests) para que tanto tests/serving como
    tests/e2e compartan la MISMA instancia y no colisionen entre conftests.
    """
    root = tmp_path_factory.mktemp("pkg")
    manifest, classes = make_synthetic_dataset(root, per_split={"train": 6, "val": 3, "test": 3}, size=48)
    cfg = TrainConfig.model_validate(
        {
            "manifest_path": str(manifest),
            "classes_path": str(classes),
            "output_dir": str(root / "out"),
            "optimizer": "adam",
            "batch_size": 4,
            "max_epochs": 1,
            "lr": 1e-3,
            "img_size": 32,  # análogo al 160 del ganador: se lee de preprocess.json
            "hidden_layers": [16],
            "dropout": 0.1,
            "pretrained": False,
            "trainable_backbone": "all",
        }
    )
    result = train(cfg)
    return result.output_dir


@pytest.fixture
def s3_bucket():
    """Bucket S3 simulado y limpio con moto; devuelve (client, S3Settings)."""
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=TEST_BUCKET)
        settings = storage.S3Settings(bucket=TEST_BUCKET, region="us-east-1")
        yield client, settings


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
