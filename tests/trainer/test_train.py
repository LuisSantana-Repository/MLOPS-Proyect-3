from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
import torch
from PIL import Image

from trainer.cli import main
from trainer.config import TrainConfig
from trainer.model import load_model
from trainer.train import PACKAGE_FILES, train

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_train_writes_a_complete_package(cfg: TrainConfig) -> None:
    result = train(cfg)
    out = cfg.output_dir
    assert sorted(p.name for p in out.iterdir()) == sorted(PACKAGE_FILES)

    summary = _read(out / "summary.json")
    assert summary["restored_check"]["matches_best_epoch"] is True
    assert summary["best_epoch"] == result.best_epoch
    assert summary["data"]["test_rows_ignored"] == 9
    assert summary["seeds"] == {"shuffle_seed": 42, "aug_seed": 43, "init_seed": 44}
    assert summary["model"]["pretrained_weights"]["pretrained"] is False

    history = _read(out / "history.json")
    assert history["monitor"] == "val_loss"
    assert len(history["epochs"]) == result.stopped_epoch
    assert _read(out / "classes.json") == {"0": "circle", "1": "square", "2": "triangle"}
    assert _read(out / "config.json")["hidden_layers"] == [16]
    env = _read(out / "env.json")
    assert env["packages"]["torch"] and env["packages"]["torchvision"]
    assert env["deterministic_algorithms"] is True


def test_same_seeds_reproduce_order_metrics_and_weights(cfg: TrainConfig, tmp_path: Path) -> None:
    a = train(cfg.model_copy(update={"output_dir": tmp_path / "a"}))
    b = train(cfg.model_copy(update={"output_dir": tmp_path / "b"}))
    c = train(cfg.model_copy(update={"output_dir": tmp_path / "c", "shuffle_seed": 7}))

    def strip(history: list[dict]) -> list[dict]:
        return [{k: v for k, v in row.items() if k != "seconds"} for row in history]

    assert strip(a.history) == strip(b.history)
    assert [r["train_order_sha256"] for r in a.history] != [r["train_order_sha256"] for r in c.history]
    wa = torch.load(tmp_path / "a" / "weights.pt", weights_only=True)["state_dict"]
    wb = torch.load(tmp_path / "b" / "weights.pt", weights_only=True)["state_dict"]
    assert all(torch.equal(wa[k], wb[k]) for k in wa)


def test_package_reloads_in_a_clean_process(cfg: TrainConfig) -> None:
    train(cfg)
    image = next(Path(cfg.manifest_path).parent.glob("crops/*.jpg"))

    loaded = load_model(cfg.output_dir)
    with Image.open(image) as img:
        expected = torch.softmax(loaded.model(loaded.transform(img.convert("RGB")).unsqueeze(0)), dim=1)[0]

    script = (
        "import json, sys, torch; from PIL import Image; from trainer import load_model; "
        "m = load_model(sys.argv[1]); "
        "x = m.transform(Image.open(sys.argv[2]).convert('RGB')).unsqueeze(0); "
        "p = torch.softmax(m.model(x), dim=1)[0].tolist(); "
        "print(json.dumps({'classes': m.classes, 'probs': p}))"
    )
    out = subprocess.run(
        [sys.executable, "-c", script, str(cfg.output_dir), str(image)],
        capture_output=True,
        text=True,
        check=True,
        cwd=REPO_ROOT,
    )
    reply = json.loads(out.stdout)
    assert reply["classes"] == loaded.classes
    assert sum(reply["probs"]) == pytest.approx(1.0, abs=1e-5)
    assert reply["probs"] == pytest.approx(expected.tolist(), abs=1e-6)


def test_load_model_rejects_mismatched_classes(cfg: TrainConfig) -> None:
    train(cfg)
    (cfg.output_dir / "classes.json").write_text(json.dumps({"0": "x", "1": "y", "2": "z"}), encoding="utf-8")
    with pytest.raises(ValueError, match="no coincide"):
        load_model(cfg.output_dir)


def test_existing_package_is_not_overwritten_by_default(cfg: TrainConfig) -> None:
    train(cfg)
    with pytest.raises(FileExistsError):
        train(cfg)
    train(cfg, overwrite=True)


def test_cli_smoke_runs_two_epochs_on_synthetic_data(tmp_path: Path) -> None:
    out = tmp_path / "smoke"
    assert main(["--smoke", "--output-dir", str(out)]) == 0
    summary = _read(out / "summary.json")
    assert summary["stopped_epoch"] == 2
    assert summary["data"]["test_rows_ignored"] > 0
