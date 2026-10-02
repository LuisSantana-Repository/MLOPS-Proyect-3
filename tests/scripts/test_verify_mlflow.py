"""scripts/verify_mlflow.py: el MLflow compartido tiene las corridas de selection.json (P0-1)."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from mlflow.tracking import MlflowClient

from scripts.verify_mlflow import main, verify
from trainer.sweep import SweepSpec

MANIFEST = "0bdf" * 16
RUNS = {  # config_id: (best_val_loss, best_val_acc)
    "exp-01": (0.06, 0.97),
    "exp-02": (0.05, 0.98),
    "exp-03": (0.07, 0.96),
}


def failed(checks: list[Any]) -> set[str]:
    return {c.name for c in checks if not c.ok}


@pytest.fixture
def store(tmp_path: Path) -> dict[str, Any]:
    uri = f"sqlite:///{(tmp_path / 'mlflow.db').as_posix()}"
    client = MlflowClient(uri)
    exp = client.create_experiment("exp-prueba", artifact_location=(tmp_path / "artifacts").as_uri())
    ids: dict[str, str] = {}
    weights: dict[str, str] = {}
    for config_id, (loss, acc) in RUNS.items():
        rid = client.create_run(exp, run_name=f"tx-{config_id}").info.run_id
        payload = f"pesos de {config_id}".encode()
        weights[config_id] = hashlib.sha256(payload).hexdigest()
        tags = {
            "sweep": "tx",
            "config_id": config_id,
            "manifest_sha256": MANIFEST,
            "classes": '["person", "car"]',
            "weights_sha256": weights[config_id],
        }
        for key, value in tags.items():
            client.set_tag(rid, key, value)
        for step, value in enumerate([0.5, 0.2, loss], start=1):
            client.log_metric(rid, "val_loss", value, step=step)
        for key, value in {"best_val_loss": loss, "best_val_acc": acc, "best_epoch": 3, "stopped_epoch": 3}.items():
            client.log_metric(rid, key, value)
        files = tmp_path / "pkg" / config_id
        files.mkdir(parents=True)
        (files / "weights.pt").write_bytes(payload)
        (files / "curves.png").write_bytes(b"png")
        (files / "history.json").write_text("[]")
        for f in files.iterdir():
            client.log_artifact(rid, str(f))
        client.set_terminated(rid)
        ids[config_id] = rid

    winner = ids["exp-02"]
    client.create_registered_model("clasificador")
    client.create_model_version("clasificador", f"runs:/{winner}", winner)
    client.set_registered_model_alias("clasificador", "champion", "1")

    selection = {
        "sweep": "tx",
        "run_id": winner,
        "checkpoint": {"artifact": "weights.pt", "sha256": weights["exp-02"]},
        "data": {"manifest_sha256": MANIFEST},
        "candidates": [ids["exp-02"], ids["exp-01"], ids["exp-03"]],
    }
    spec = SweepSpec(
        name="tx",
        base_config=Path("configs/baseline.yaml"),
        output_dir=tmp_path / "runs",
        metric="best_val_loss",
        mode="min",
        tie_breakers=[("best_val_acc", "max"), ("start_time", "min")],
        experiments=[],
        min_valid_runs=3,
        experiment_name="exp-prueba",
    )
    return {"uri": uri, "client": client, "ids": ids, "selection": selection, "spec": spec, "tmp": tmp_path}


def run_verify(store: dict[str, Any], selection: dict[str, Any] | None = None, **kwargs: Any) -> list[Any]:
    return verify(
        store["client"], selection or store["selection"], store["spec"], download_dir=store["tmp"] / "dl", **kwargs
    )


def test_all_checks_pass_on_the_original_runs(store: dict[str, Any]) -> None:
    checks = run_verify(store)
    assert failed(checks) == set(), [c for c in checks if not c.ok]
    assert {c.name for c in checks} >= {
        "runs",
        "finished",
        "sweep",
        "manifest",
        "curvas",
        "artefactos",
        "seleccion",
        "pesos",
        "registry",
    }


def test_a_missing_run_is_reported(store: dict[str, Any]) -> None:
    selection = copy.deepcopy(store["selection"])
    selection["candidates"].append("0" * 32)
    assert "runs" in failed(run_verify(store, selection))


def test_a_run_that_did_not_finish_is_reported(store: dict[str, Any]) -> None:
    store["client"].set_terminated(store["ids"]["exp-03"], status="KILLED")
    assert "finished" in failed(run_verify(store))


def test_a_different_manifest_is_reported(store: dict[str, Any]) -> None:
    store["client"].set_tag(store["ids"]["exp-01"], "manifest_sha256", "otro")
    assert "manifest" in failed(run_verify(store))


def test_weights_that_do_not_match_the_frozen_checkpoint_are_reported(store: dict[str, Any]) -> None:
    selection = copy.deepcopy(store["selection"])
    selection["checkpoint"]["sha256"] = "e5aa" * 16
    assert "pesos" in failed(run_verify(store, selection))


def test_a_ranking_that_no_longer_picks_the_frozen_candidate_is_reported(store: dict[str, Any]) -> None:
    selection = copy.deepcopy(store["selection"])
    selection["run_id"] = store["ids"]["exp-01"]
    selection["candidates"] = [store["ids"]["exp-01"], store["ids"]["exp-02"], store["ids"]["exp-03"]]
    assert "seleccion" in failed(run_verify(store, selection))


def test_registry_without_champion_alias_is_reported(store: dict[str, Any]) -> None:
    store["client"].delete_registered_model_alias("clasificador", "champion")
    assert "registry" in failed(run_verify(store))


def test_without_artifacts_only_metadata_is_checked(store: dict[str, Any]) -> None:
    checks = run_verify(store, check_artifacts=False)
    assert "artefactos" not in {c.name for c in checks}
    assert failed(checks) == set()


def test_cli_exits_non_zero_when_a_check_fails(
    store: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_URI", store["uri"])
    monkeypatch.setattr("scripts.verify_mlflow.load_sweep", lambda _path: store["spec"])
    selection = copy.deepcopy(store["selection"])
    path = tmp_path / "selection.json"
    path.write_text(json.dumps(selection))
    assert main(["--selection", str(path), "--spec", "ignorado.yaml"]) == 0
    assert "OK" in capsys.readouterr().out

    selection["candidates"].append("0" * 32)
    path.write_text(json.dumps(selection))
    assert main(["--selection", str(path), "--spec", "ignorado.yaml"]) == 1
    assert "FALLA" in capsys.readouterr().out
