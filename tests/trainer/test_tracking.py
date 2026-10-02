from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from mlflow.entities import RunStatus
from mlflow.tracking import MlflowClient

from trainer.config import TrainConfig
from trainer.data import DataError
from trainer.tracking import (
    DEFAULT_EXPERIMENT,
    EPOCH_METRICS,
    ProvenanceError,
    collect_provenance,
    compare_runs,
    git_info,
    main,
    md5_file,
    run_tracked,
    source_patch,
)
from trainer.train import sha256_file

SEVEN_PARAMS = ("optimizer", "batch_size", "max_epochs", "lr", "img_size", "hidden_layers", "dropout")
EXPECTED_EPOCH_METRICS = ("train_loss", "train_acc", "val_loss", "val_acc")
PACKAGE = ("weights.pt", "classes.json", "preprocess.json", "history.json", "config.json", "env.json", "summary.json")


@pytest.fixture
def mlflow_uri(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    return uri


@pytest.fixture
def release_info(tmp_path: Path) -> Path:
    path = tmp_path / "release_info.json"
    path.write_text(json.dumps({"release_tag": "proyecto2 v9.9.9@abc1234", "annotations_md5": "f" * 32}))
    return path


def test_run_logs_params_seeds_provenance_metrics_and_artifacts(
    cfg: TrainConfig, mlflow_uri: str, release_info: Path, tmp_path: Path
) -> None:
    tracked = run_tracked(cfg, release_info=release_info, tags={"job_id": "job-1"})
    client = MlflowClient(mlflow_uri)
    run = client.get_run(tracked.run_id)

    assert run.info.status == "FINISHED"
    assert client.get_experiment(run.info.experiment_id).name == DEFAULT_EXPERIMENT

    params = run.data.params
    for name in (*SEVEN_PARAMS, "shuffle_seed", "aug_seed", "init_seed", "patience", "min_delta"):
        assert name in params, name
    assert json.loads(params["hidden_layers"]) == cfg.hidden_layers
    assert params["output_dir"].endswith(tracked.run_id)

    tags = run.data.tags
    assert tags["dvc_release"] == "proyecto2 v9.9.9@abc1234"
    assert tags["manifest_sha256"] == sha256_file(cfg.manifest_path)
    assert tags["git_commit"] == tags["mlflow.source.git.commit"] != ""
    assert json.loads(tags["classes"]) == ["circle", "square", "triangle"]
    assert tags["job_id"] == "job-1"
    assert tags["restored_matches_best_epoch"] == "true"
    assert tags["torch_version"]

    stopped = tracked.result.stopped_epoch
    for key in (*EXPECTED_EPOCH_METRICS, "epoch_seconds"):
        history = client.get_metric_history(tracked.run_id, key)
        assert sorted(m.step for m in history) == list(range(1, stopped + 1)), key
    for key in ("best_val_loss", "best_val_acc", "best_epoch", "stopped_epoch", "duration_seconds"):
        assert key in run.data.metrics
    assert run.data.metrics["best_epoch"] == tracked.result.best_epoch

    artifacts = {a.path for a in client.list_artifacts(tracked.run_id)}
    assert {*PACKAGE, "curves.png"} <= artifacts
    local = Path(client.download_artifacts(tracked.run_id, "weights.pt", str(tmp_path)))
    assert sha256_file(local) == tags["weights_sha256"]


def test_epoch_metrics_match_the_saved_history(cfg: TrainConfig, mlflow_uri: str) -> None:
    tracked = run_tracked(cfg)
    client = MlflowClient(mlflow_uri)
    for key in EXPECTED_EPOCH_METRICS:
        logged = [m.value for m in sorted(client.get_metric_history(tracked.run_id, key), key=lambda m: m.step)]
        assert logged == pytest.approx([row[key] for row in tracked.result.history])


def test_manifest_that_differs_from_dvc_is_rejected_before_creating_a_run(
    cfg: TrainConfig, mlflow_uri: str, tmp_path: Path
) -> None:
    manifest = tmp_path / "manifest.csv"
    shutil.copy(cfg.manifest_path, manifest)
    (tmp_path / "manifest.csv.dvc").write_text("outs:\n- md5: 00000000000000000000000000000000\n  path: manifest.csv\n")
    bad = cfg.model_copy(update={"manifest_path": manifest, "data_root": cfg.manifest_path.parent})

    with pytest.raises(ProvenanceError, match="dvc"):
        run_tracked(bad)
    assert MlflowClient(mlflow_uri).search_experiments(filter_string=f"name = '{DEFAULT_EXPERIMENT}'") == []


def test_manifest_matching_its_dvc_file_is_accepted(cfg: TrainConfig, mlflow_uri: str, tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.csv"
    shutil.copy(cfg.manifest_path, manifest)
    md5 = md5_file(manifest)
    (tmp_path / "manifest.csv.dvc").write_text(f"outs:\n- md5: {md5}\n  path: manifest.csv\n")
    tracked = run_tracked(cfg.model_copy(update={"manifest_path": manifest, "data_root": cfg.manifest_path.parent}))
    assert MlflowClient(mlflow_uri).get_run(tracked.run_id).data.tags["manifest_dvc_md5"] == md5


def test_split_seed_method_and_test_fingerprint_come_from_the_leakage_report(
    cfg: TrainConfig, mlflow_uri: str, tmp_path: Path
) -> None:
    manifest = tmp_path / "manifest.csv"
    shutil.copy(cfg.manifest_path, manifest)
    report = {"semilla": 42, "metodo": "StratifiedGroupKFold(n_splits=10, shuffle=True)", "test_huella_sha256": "2da0"}
    (tmp_path / "leakage_report.json").write_text(json.dumps(report), encoding="utf-8")
    moved = cfg.model_copy(update={"manifest_path": manifest, "data_root": cfg.manifest_path.parent})

    tags = collect_provenance(moved, None, strict=False)
    assert tags["split_seed"] == "42"
    assert tags["split_method"] == "StratifiedGroupKFold(n_splits=10, shuffle=True)"
    assert tags["test_fingerprint"] == "2da0"

    tracked = run_tracked(moved)
    logged = MlflowClient(mlflow_uri).get_run(tracked.run_id).data.tags
    assert (logged["split_seed"], logged["test_fingerprint"]) == ("42", "2da0")


def test_without_leakage_report_the_split_tags_say_not_available(cfg: TrainConfig) -> None:
    tags = collect_provenance(cfg, None, strict=False)
    assert tags["split_seed"] == tags["split_method"] == tags["test_fingerprint"] == "no disponible"


def test_failed_training_leaves_a_failed_run_with_the_error(cfg: TrainConfig, mlflow_uri: str, tmp_path: Path) -> None:
    classes = tmp_path / "classes.json"
    classes.write_text(json.dumps({"0": "circle", "1": "hexagon"}))
    with pytest.raises(DataError):
        run_tracked(cfg.model_copy(update={"classes_path": classes}))

    client = MlflowClient(mlflow_uri)
    experiment = client.get_experiment_by_name(DEFAULT_EXPERIMENT)
    [run] = client.search_runs([experiment.experiment_id])
    assert run.info.status == RunStatus.to_string(RunStatus.FAILED)
    assert "hexagon" in run.data.tags["error"]


def test_same_seeds_are_reproducible_and_a_different_seed_is_not(cfg: TrainConfig, mlflow_uri: str) -> None:
    a = run_tracked(cfg)
    b = run_tracked(cfg)
    c = run_tracked(cfg.model_copy(update={"shuffle_seed": 7}))

    same = compare_runs(a.run_id, b.run_id)
    assert same["reproducible"] is True
    assert same["max_abs_diff_per_metric"] == dict.fromkeys(EPOCH_METRICS, 0.0)

    different = compare_runs(a.run_id, c.run_id)
    assert different["reproducible"] is False
    assert different["different_params"] == ["shuffle_seed"]


def test_without_tracking_uri_runs_go_to_local_mlruns(
    cfg: TrainConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    monkeypatch.chdir(tmp_path)
    tracked = run_tracked(cfg)
    assert tracked.tracking_uri == (tmp_path / "mlruns").resolve().as_uri()
    assert (tmp_path / "mlruns").is_dir()


def test_git_commit_falls_back_to_env_outside_a_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GIT_COMMIT", "abc123")
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
    assert git_info(tmp_path) == ("abc123", "no disponible")


def test_cli_smoke_run_and_compare(mlflow_uri: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "smoke"
    assert main(["run", "--smoke", "--output-dir", str(out), "--tag", "origen=test"]) == 0
    assert main(["run", "--smoke", "--output-dir", str(out)]) == 0

    client = MlflowClient(mlflow_uri)
    experiment = client.get_experiment_by_name(DEFAULT_EXPERIMENT)
    runs = client.search_runs([experiment.experiment_id], order_by=["attributes.start_time ASC"])
    assert len(runs) == 2
    assert runs[0].data.tags["smoke"] == "true"
    assert runs[0].data.tags["origen"] == "test"

    capsys.readouterr()
    assert main(["compare", runs[0].info.run_id, runs[1].info.run_id]) == 0
    assert json.loads(capsys.readouterr().out)["reproducible"] is True


def test_cli_rejects_malformed_tag(mlflow_uri: str, tmp_path: Path) -> None:
    assert main(["run", "--smoke", "--output-dir", str(tmp_path / "s"), "--tag", "sin-igual"]) == 2


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def test_source_patch_rebuilds_uncommitted_and_new_files(tmp_path: Path) -> None:
    repo, clone = tmp_path / "repo", tmp_path / "clone"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "core.autocrlf", "false")
    (repo / "a.py").write_bytes(b"x = 1\r\n")  # CRLF: el parche debe conservarlo
    _git(repo, "add", "a.py")
    _git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base")
    (repo / "a.py").write_bytes(b"x = 2  # cambio sin commit\r\n")
    (repo / "nuevo.py").write_text("y = 'ñ'\n", encoding="utf-8", newline="")

    patch = source_patch(repo)
    _git(tmp_path, "clone", "-q", "-c", "core.autocrlf=false", str(repo), str(clone))
    (tmp_path / "p.patch").write_bytes(patch)
    _git(clone, "apply", str(tmp_path / "p.patch"))
    for name in ("a.py", "nuevo.py"):
        assert (clone / name).read_bytes() == (repo / name).read_bytes()


def test_dirty_runs_log_the_source_patch(cfg: TrainConfig, mlflow_uri: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("trainer.tracking.git_info", lambda cwd=None: ("abc123", "true"))
    patch = b"diff --git a/x b/x\r\n+\xc3\xb1\r\n"
    monkeypatch.setattr("trainer.tracking.source_patch", lambda cwd=None: patch)
    tracked = run_tracked(cfg)
    client = MlflowClient(mlflow_uri)
    tags = client.get_run(tracked.run_id).data.tags
    assert tags["git_dirty"] == "true"
    assert tags["source_diff_sha256"] == hashlib.sha256(patch).hexdigest()
    assert [a.path for a in client.list_artifacts(tracked.run_id, "source")] == ["source/source_diff.patch"]
    downloaded = client.download_artifacts(tracked.run_id, "source/source_diff.patch", str(cfg.output_dir.parent))
    assert Path(downloaded).read_bytes() == patch  # byte a byte, sin convertir CRLF


def test_clean_runs_do_not_log_a_patch(cfg: TrainConfig, mlflow_uri: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("trainer.tracking.git_info", lambda cwd=None: ("abc123", "false"))
    tracked = run_tracked(cfg)
    client = MlflowClient(mlflow_uri)
    assert "source_diff_sha256" not in client.get_run(tracked.run_id).data.tags
    assert client.list_artifacts(tracked.run_id, "source") == []
