from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from pydantic import ValidationError

from trainer.cli import main
from trainer.config import TrainConfig, export_json_schema, load_config

SEVEN_PARAMS = ("optimizer", "batch_size", "max_epochs", "lr", "img_size", "hidden_layers", "dropout")


def test_valid_config_accepts_the_seven_params_and_three_seeds(cfg_dict: dict[str, Any]) -> None:
    cfg = TrainConfig.model_validate(cfg_dict | {"shuffle_seed": 1, "aug_seed": 2, "init_seed": 3})
    assert (cfg.shuffle_seed, cfg.aug_seed, cfg.init_seed) == (1, 2, 3)
    for name in SEVEN_PARAMS:
        assert name in TrainConfig.model_fields


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("optimizer", "rmsprop"),
        ("batch_size", 0),
        ("max_epochs", 0),
        ("lr", 0),
        ("lr", -0.1),
        ("img_size", 16),
        ("hidden_layers", [0]),
        ("hidden_layers", [64, 64, 64, 64, 64]),
        ("dropout", 1.0),
        ("dropout", -0.1),
        ("shuffle_seed", -1),
        ("patience", 0),
        ("min_delta", -0.01),
        ("monitor", "train_loss"),
    ],
)
def test_invalid_values_are_rejected_with_the_field_name(cfg_dict: dict[str, Any], field: str, value: Any) -> None:
    with pytest.raises(ValidationError) as exc:
        TrainConfig.model_validate(cfg_dict | {field: value})
    assert field in str(exc.value)


def test_unknown_fields_are_rejected(cfg_dict: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="learning_rate"):
        TrainConfig.model_validate(cfg_dict | {"learning_rate": 0.1})


@pytest.mark.parametrize("suffix", [".yaml", ".json"])
def test_load_config_from_yaml_and_json(cfg_dict: dict[str, Any], tmp_path: Path, suffix: str) -> None:
    path = tmp_path / f"cfg{suffix}"
    path.write_text(yaml.safe_dump(cfg_dict) if suffix == ".yaml" else json.dumps(cfg_dict), encoding="utf-8")
    cfg = load_config(path, {"batch_size": 8})
    assert cfg.batch_size == 8
    assert cfg.hidden_layers == [16]


def test_cli_rejects_invalid_config_before_training(cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(cfg_dict | {"dropout": 1.5}), encoding="utf-8")
    assert main(["--config", str(path)]) == 2
    assert not Path(cfg_dict["output_dir"]).exists()


def test_exported_schema_lists_the_contract_fields(tmp_path: Path) -> None:
    path = tmp_path / "schema.json"
    export_json_schema(path)
    schema = json.loads(path.read_text(encoding="utf-8"))
    for name in (*SEVEN_PARAMS, "shuffle_seed", "aug_seed", "init_seed", "patience", "min_delta"):
        assert name in schema["properties"]
    assert schema["additionalProperties"] is False


def test_committed_schema_is_up_to_date(tmp_path: Path) -> None:
    """Si falla, regenera con: python -m trainer --export-schema configs/train-config.schema.json"""
    committed = Path(__file__).resolve().parents[2] / "configs" / "train-config.schema.json"
    fresh = tmp_path / "schema.json"
    export_json_schema(fresh)
    assert json.loads(committed.read_text(encoding="utf-8")) == json.loads(fresh.read_text(encoding="utf-8"))
