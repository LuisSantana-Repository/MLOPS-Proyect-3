from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from mlflow.tracking import MlflowClient

from trainer.config import TrainConfig
from trainer.sweep import (
    SEVEN_PARAMS,
    Row,
    SweepError,
    build_configs,
    check_design,
    load_sweep,
    main,
    rank,
    run_sweep,
    write_report,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# Dos experimentos pequeños que mueven los 7 parámetros a la vez (mínimo para cubrir la regla).
TINY_A = {"optimizer": "adam", "batch_size": 4, "max_epochs": 2, "lr": 0.001, "img_size": 32}
TINY_B = {"optimizer": "sgd", "batch_size": 6, "max_epochs": 3, "lr": 0.01, "img_size": 40}
TINY_B |= {"hidden_layers": [8], "dropout": 0.2}


@pytest.fixture
def mlflow_uri(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    return uri


@pytest.fixture
def tiny_spec(cfg_dict: dict[str, Any], tmp_path: Path) -> Path:
    base = tmp_path / "base.yaml"
    base.write_text(yaml.safe_dump(cfg_dict), encoding="utf-8")
    spec = {
        "sweep": "mini",
        "base_config": str(base),
        "output_dir": str(tmp_path / "runs"),
        "report_dir": str(tmp_path / "reports"),
        "min_valid_runs": 2,
        "selection": {"metric": "best_val_loss", "mode": "min", "tie_breakers": ["best_val_acc:max"]},
        "experiments": [
            {"id": "a", "question": "base", "overrides": TINY_A},
            {"id": "b", "question": "variante", "overrides": TINY_B},
        ],
    }
    path = tmp_path / "mini.yaml"
    path.write_text(yaml.safe_dump(spec, allow_unicode=True), encoding="utf-8")
    return path


# --- Diseño -------------------------------------------------------------------


def test_t07_design_has_ten_valid_configs_covering_the_seven_params() -> None:
    spec = load_sweep(REPO_ROOT / "configs" / "experiments" / "t07.yaml")
    spec.base_config = REPO_ROOT / spec.base_config
    configs = build_configs(spec)
    assert len(configs) == 10
    assert check_design(configs, spec.min_valid_runs) == []
    assert (spec.metric, spec.mode) == ("best_val_loss", "min")


def _cfgs(cfg: TrainConfig, variants: list[dict[str, Any]]) -> dict[str, TrainConfig]:
    return {f"e{i}": cfg.model_copy(update=v) for i, v in enumerate(variants)}


def test_design_flags_a_parameter_with_a_single_value(cfg: TrainConfig) -> None:
    variants = [TINY_A, {**TINY_B, "dropout": cfg.dropout}]
    problems = check_design(_cfgs(cfg, variants), min_runs=2)
    assert any("'dropout'" in p for p in problems)


def test_design_flags_duplicates_and_too_few_runs(cfg: TrainConfig) -> None:
    problems = check_design(_cfgs(cfg, [TINY_A, TINY_A]), min_runs=10)
    assert any("repite exactamente" in p for p in problems)
    assert any("al menos 10" in p for p in problems)


def test_design_flags_adam_equal_to_adamw_without_weight_decay(cfg: TrainConfig) -> None:
    base = cfg.model_copy(update={"optimizer": "adamw", "weight_decay": 0.0})
    configs = {"base": base, "adam": base.model_copy(update={"optimizer": "adam"})}
    assert any("adam repite exactamente la config de base" in p for p in check_design(configs, min_runs=2))

    configs["adam"] = base.model_copy(update={"optimizer": "adam", "weight_decay": 0.01})
    assert not any("repite" in p for p in check_design(configs, min_runs=2))


def test_invalid_experiment_is_rejected_before_training(tiny_spec: Path, mlflow_uri: str) -> None:
    data = yaml.safe_load(tiny_spec.read_text(encoding="utf-8"))
    data["experiments"][1]["overrides"]["dropout"] = 1.5
    tiny_spec.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(SweepError, match="dropout"):
        run_sweep(load_sweep(tiny_spec))
    assert MlflowClient(mlflow_uri).search_experiments(filter_string="name = 'proyecto3-clasificador'") == []


# --- Ranking ------------------------------------------------------------------


def _row(config_id: str, loss: float, acc: float, start: int) -> Row:
    params = dict.fromkeys(SEVEN_PARAMS, "x")
    metrics = {"best_val_loss": loss, "best_val_acc": acc}
    return Row(config_id, f"run-{config_id}", config_id, "", params, metrics, {}, start, "")


def test_rank_uses_metric_then_tie_breakers(tiny_spec: Path) -> None:
    spec = load_sweep(tiny_spec)
    spec.tie_breakers = [("best_val_acc", "max"), ("start_time", "min")]
    rows = [
        _row("late", 0.10, 0.95, 3),
        _row("tie-acc", 0.10, 0.97, 2),
        _row("best", 0.05, 0.90, 5),
        _row("early", 0.10, 0.97, 1),
    ]
    assert [r.config_id for r in rank(rows, spec)] == ["best", "early", "tie-acc", "late"]


# --- Integración --------------------------------------------------------------


def test_sweep_runs_resumes_reports_and_freezes_the_selection(tiny_spec: Path, mlflow_uri: str) -> None:
    spec = load_sweep(tiny_spec)
    first = run_sweep(spec)
    assert set(first) == {"a", "b"} and not any(v.startswith(("error", "omitido")) for v in first.values())

    second = run_sweep(spec)  # reanudar: nada que correr
    assert all(v.startswith("omitido") for v in second.values())

    client = MlflowClient(mlflow_uri)
    run_a = client.get_run(first["a"])
    assert run_a.data.tags["sweep"] == "mini"
    assert run_a.data.tags["config_id"] == "a"
    assert run_a.data.tags["question"] == "base"

    selection = write_report(spec)
    reports = spec.reports()
    frozen = json.loads((reports / "selection.json").read_text(encoding="utf-8"))
    assert frozen == selection
    assert frozen["test_split_used"] is False
    assert frozen["criterion"]["split"] == "val"
    assert set(frozen["candidates"]) == set(first.values())
    winner = client.get_run(frozen["run_id"])
    assert frozen["checkpoint"]["sha256"] == winner.data.tags["weights_sha256"]
    losses = {rid: client.get_run(rid).data.metrics["best_val_loss"] for rid in first.values()}
    assert frozen["run_id"] == min(losses, key=losses.get)

    assert winner.data.tags["candidate"] == "true"
    other = next(r for r in first.values() if r != frozen["run_id"])
    assert client.get_run(other).data.tags["candidate"] == "false"

    table = (reports / "experiments.md").read_text(encoding="utf-8")
    assert frozen["run_id"] in table and other in table and "★" in table
    assert len((reports / "experiments.csv").read_text(encoding="utf-8").strip().splitlines()) == 3

    # Congelada: volver a reportar con el mismo ranking conserva la fecha original.
    assert write_report(spec)["selected_at"] == frozen["selected_at"]

    # Cambiar el criterio después no puede cambiar el candidato sin --force.
    spec.mode = "max"
    with pytest.raises(SweepError, match="congelada"):
        write_report(spec)
    assert write_report(spec, force=True)["run_id"] == other


def test_report_excludes_failed_and_smoke_runs(tiny_spec: Path, mlflow_uri: str, tmp_path: Path) -> None:
    spec = load_sweep(tiny_spec)
    run_sweep(spec)

    client = MlflowClient(mlflow_uri)
    experiment = client.get_experiment_by_name(spec.experiment_name)
    failed = client.create_run(experiment.experiment_id, tags={"sweep": "mini", "config_id": "c", "error": "boom"})
    client.set_terminated(failed.info.run_id, status="FAILED")
    smoke = client.create_run(experiment.experiment_id, tags={"sweep": "mini", "config_id": "d", "smoke": "true"})
    client.log_metric(smoke.info.run_id, "best_val_loss", 0.0)
    client.set_terminated(smoke.info.run_id)

    write_report(spec)
    table = (spec.reports() / "experiments.md").read_text(encoding="utf-8")
    assert f"`{failed.info.run_id}`: estado FAILED (boom)" in table
    assert f"`{smoke.info.run_id}`: corrida smoke" in table
    assert json.loads((spec.reports() / "selection.json").read_text(encoding="utf-8"))["run_id"] != smoke.info.run_id


def test_table_shows_changes_outside_the_seven_params(tiny_spec: Path, mlflow_uri: str) -> None:
    data = yaml.safe_load(tiny_spec.read_text(encoding="utf-8"))
    data["experiments"][1]["overrides"]["weight_decay"] = 0.01
    data["experiments"].append({"id": "c", "question": "otra", "overrides": {**TINY_A, "batch_size": 5}})
    tiny_spec.write_text(yaml.safe_dump(data), encoding="utf-8")
    spec = load_sweep(tiny_spec)
    spec.min_valid_runs = 3
    run_sweep(spec)
    write_report(spec)
    rows = [line for line in (spec.reports() / "experiments.md").read_text(encoding="utf-8").splitlines()]
    assert sum("weight_decay=0.01" in line for line in rows if line.startswith("| ")) == 1


def test_report_refuses_to_select_with_too_few_valid_runs(tiny_spec: Path, mlflow_uri: str) -> None:
    spec = load_sweep(tiny_spec)
    run_sweep(spec, only=["a"])
    with pytest.raises(SweepError, match="1 runs válidos"):
        write_report(spec)
    assert not (spec.reports() / "selection.json").exists()


def test_cli_dry_run_and_report_exit_codes(
    tiny_spec: Path, mlflow_uri: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["run", str(tiny_spec), "--dry-run"]) == 0
    assert "a: pendiente" in capsys.readouterr().out
    assert main(["report", str(tiny_spec)]) == 2
    assert main(["run", str(tiny_spec), "--only", "zzz"]) == 2
