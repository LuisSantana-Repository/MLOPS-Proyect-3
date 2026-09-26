from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from trainer.config import TrainConfig
from trainer.synthetic import make_synthetic_dataset


@pytest.fixture(scope="session")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """(manifest, classes) de un dataset sintético pequeño con filas de test incluidas."""
    root = tmp_path_factory.mktemp("synthetic")
    return make_synthetic_dataset(root, per_split={"train": 6, "val": 3, "test": 3}, size=48)


@pytest.fixture
def cfg_dict(synthetic: tuple[Path, Path], tmp_path: Path) -> dict[str, Any]:
    manifest, classes = synthetic
    return {
        "manifest_path": str(manifest),
        "classes_path": str(classes),
        "output_dir": str(tmp_path / "model"),
        "optimizer": "adam",
        "batch_size": 4,
        "max_epochs": 2,
        "lr": 1e-3,
        "img_size": 32,
        "hidden_layers": [16],
        "dropout": 0.1,
        "pretrained": False,
        "trainable_backbone": "all",
    }


@pytest.fixture
def cfg(cfg_dict: dict[str, Any]) -> TrainConfig:
    return TrainConfig.model_validate(cfg_dict)
