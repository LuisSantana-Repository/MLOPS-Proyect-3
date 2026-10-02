"""portal/scripts/seed_mlflow_run.py no puede mezclarse con las corridas reales del barrido t07."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from mlflow.tracking import MlflowClient

SCRIPT = Path(__file__).resolve().parents[2] / "portal" / "scripts" / "seed_mlflow_run.py"


def load_seed_module():
    spec = importlib.util.spec_from_file_location("seed_mlflow_run", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # no debe crear runs al importarse
    return module


def test_importing_the_script_does_not_log_anything(tmp_path: Path, monkeypatch) -> None:
    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    load_seed_module()
    assert not (tmp_path / "mlruns").exists()


def test_seed_run_goes_to_an_isolated_experiment_without_the_t07_tag(tmp_path: Path) -> None:
    uri = (tmp_path / "mlruns").resolve().as_uri()
    run_id = load_seed_module().seed(uri)

    client = MlflowClient(uri)
    run = client.get_run(run_id)
    assert client.get_experiment(run.info.experiment_id).name != "proyecto3-clasificador"
    assert run.data.tags.get("sweep") != "t07"
    assert run.data.tags["smoke"] == "true"
