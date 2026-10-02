"""P1-2: un job corto REAL registra en MLflow los mismos valores que pidió el portal."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from mlflow.tracking import MlflowClient

import worker
from trainer.synthetic import make_synthetic_dataset

JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
RELEASE = "proyecto2 v9.9.9@abc1234"

# Lo que encola POST /api/training/jobs: los 17 campos de trainingParamsSchema + release.
PORTAL_PARAMS = {
    "release": RELEASE,
    "optimizer": "sgd",
    "batch_size": 4,
    "max_epochs": 2,
    "lr": 0.01,
    "img_size": 32,
    "hidden_layers": [16],
    "dropout": 0.1,
    "shuffle_seed": 7,
    "aug_seed": 8,
    "init_seed": 9,
    "monitor": "val_acc",
    "patience": 1,
    "min_delta": 0.5,
    "pretrained": False,
    "trainable_backbone": "none",
    "momentum": 0.8,
    "weight_decay": 0.01,
}


class MemoryStore:
    def __init__(self) -> None:
        self.statuses: list[dict] = []
        self.logs: list[str] = []

    def set_status(self, job_id, status, *, run_id=None, error=None):
        self.statuses.append({"status": status, "run_id": run_id, "error": error})

    def log(self, job_id, level, message):
        self.logs.append(message)


@pytest.fixture
def base_config(tmp_path: Path) -> Path:
    """Dataset sintético pequeño con su release_info.json, y una config base distinta a lo pedido."""
    manifest, classes = make_synthetic_dataset(tmp_path / "data", per_split={"train": 6, "val": 3, "test": 3}, size=48)
    (classes.parent / "release_info.json").write_text(
        json.dumps({"release_tag": RELEASE, "annotations_md5": "f" * 32}), encoding="utf-8"
    )
    path = tmp_path / "baseline.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "manifest_path": str(manifest),
                "classes_path": str(classes),
                "output_dir": str(tmp_path / "runs" / "baseline"),
                # Los valores con los que terminó el job del hallazgo (los de la config base).
                "monitor": "val_loss",
                "patience": 5,
                "min_delta": 0.001,
                "trainable_backbone": "layer4",
            }
        ),
        encoding="utf-8",
    )
    return path


def test_un_job_corto_real_registra_en_mlflow_lo_que_pidio_el_portal(base_config, tmp_path, monkeypatch):
    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    store = MemoryStore()

    ok = worker.run_job(
        JOB_ID, dict(PORTAL_PARAMS), store, base_config=base_config, output_root=tmp_path / "runs" / "jobs"
    )

    assert ok is True, store.statuses[-1]
    run_id = store.statuses[-1]["run_id"]
    logged = MlflowClient(uri).get_run(run_id).data.params
    for name, requested in PORTAL_PARAMS.items():
        if name == "release":
            continue
        expected = json.dumps(requested) if isinstance(requested, list) else str(requested)
        assert logged[name] == expected, f"MLflow registró {name}={logged[name]!r}, el portal pidió {expected!r}"
    assert MlflowClient(uri).get_run(run_id).data.tags["job_id"] == JOB_ID
