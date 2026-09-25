from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
import torch
from torchvision import transforms

from trainer.config import TrainConfig
from trainer.data import (
    DataError,
    build_datasets,
    build_eval_transform,
    build_loaders,
    prepare_data,
    preprocess_spec,
    read_classes,
)


def _write_manifest(tmp_path: Path, df: pd.DataFrame) -> Path:
    path = tmp_path / "manifest.csv"
    df.to_csv(path, index=False)
    return path


def _loader_order(loader: torch.utils.data.DataLoader) -> list[int]:
    return [i for _, _, idx in loader for i in idx.tolist()]


def test_missing_required_column_is_rejected(synthetic, cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    df = pd.read_csv(synthetic[0]).drop(columns=["split"])
    cfg = TrainConfig.model_validate(
        cfg_dict | {"manifest_path": _write_manifest(tmp_path, df), "data_root": synthetic[0].parent}
    )
    with pytest.raises(DataError, match="split"):
        prepare_data(cfg)


def test_unknown_split_value_is_rejected(synthetic, cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    df = pd.read_csv(synthetic[0])
    df.loc[0, "split"] = "validation"
    cfg = TrainConfig.model_validate(
        cfg_dict | {"manifest_path": _write_manifest(tmp_path, df), "data_root": synthetic[0].parent}
    )
    with pytest.raises(DataError, match="validation"):
        prepare_data(cfg)


def test_test_split_is_never_opened(synthetic, cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    df = pd.read_csv(synthetic[0])
    # Si el entrenador intentara abrir el test, estas rutas inexistentes lo harían fallar.
    df.loc[df["split"] == "test", "crop_path"] = "no/existe.jpg"
    cfg = TrainConfig.model_validate(
        cfg_dict | {"manifest_path": _write_manifest(tmp_path, df), "data_root": synthetic[0].parent}
    )
    data = prepare_data(cfg)
    assert data.test_rows_ignored == int((df["split"] == "test").sum()) > 0
    assert set(data.train["split"]) == {"train"}
    assert set(data.val["split"]) == {"val"}
    train_ds, val_ds = build_datasets(data, cfg)
    assert not any("no/existe" in str(p) for p in [*train_ds.paths, *val_ds.paths])


def test_class_order_comes_from_classes_json(synthetic, cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    classes = read_classes(synthetic[1])
    reversed_path = tmp_path / "classes.json"
    reversed_path.write_text(json.dumps({str(i): c for i, c in enumerate(reversed(classes))}), encoding="utf-8")
    cfg = TrainConfig.model_validate(cfg_dict | {"classes_path": str(reversed_path)})
    data = prepare_data(cfg)
    assert data.classes == list(reversed(classes))
    train_ds, _ = build_datasets(data, cfg)
    first = data.train.iloc[0]["category_name"]
    assert train_ds.labels[0] == data.classes.index(first)


def test_rows_outside_classes_json_are_excluded_and_reported(
    synthetic, cfg_dict: dict[str, Any], tmp_path: Path
) -> None:
    classes = read_classes(synthetic[1])
    subset = tmp_path / "classes.json"
    subset.write_text(json.dumps({"0": classes[0], "1": classes[1]}), encoding="utf-8")
    data = prepare_data(TrainConfig.model_validate(cfg_dict | {"classes_path": str(subset)}))
    assert data.classes == classes[:2]
    assert classes[2] not in set(data.train["category_name"]) | set(data.val["category_name"])
    assert data.excluded_by_class[classes[2]] == 9  # 6 train + 3 val


@pytest.mark.parametrize("content", [{"0": "a", "2": "b"}, {"x": "a"}, ["a", "a"]])
def test_malformed_classes_json_is_rejected(tmp_path: Path, content: Any) -> None:
    path = tmp_path / "classes.json"
    path.write_text(json.dumps(content), encoding="utf-8")
    with pytest.raises(DataError):
        read_classes(path)


def test_missing_crop_file_is_reported(synthetic, cfg_dict: dict[str, Any], tmp_path: Path) -> None:
    df = pd.read_csv(synthetic[0])
    df.loc[df["split"] == "train", "crop_path"] = "falta.jpg"
    cfg = TrainConfig.model_validate(
        cfg_dict | {"manifest_path": _write_manifest(tmp_path, df), "data_root": synthetic[0].parent}
    )
    with pytest.raises(DataError, match="no existen"):
        prepare_data(cfg)


def test_validation_has_no_random_transforms(cfg: TrainConfig) -> None:
    train_ds, val_ds = build_datasets(prepare_data(cfg), cfg)
    val_ops = val_ds.transform.transforms
    assert val_ds.aug_seed is None
    assert not any(type(op).__name__.startswith("Random") or isinstance(op, transforms.ColorJitter) for op in val_ops)
    assert any(type(op).__name__.startswith("Random") for op in train_ds.transform.transforms)

    torch.manual_seed(0)
    first = val_ds[0][0]
    torch.manual_seed(1)
    assert torch.equal(first, val_ds[0][0])


def test_validation_transform_matches_preprocess_json(cfg: TrainConfig) -> None:
    _, val_ds = build_datasets(prepare_data(cfg), cfg)
    from PIL import Image

    with Image.open(val_ds.paths[0]) as img:
        expected = build_eval_transform(json.loads(json.dumps(preprocess_spec(cfg.img_size))))(img.convert("RGB"))
    assert torch.equal(val_ds[0][0], expected)


def test_augmentation_depends_only_on_aug_seed_and_epoch(cfg: TrainConfig) -> None:
    data = prepare_data(cfg)
    train_ds, _ = build_datasets(data, cfg)
    train_ds.set_epoch(1)
    torch.manual_seed(0)
    a = train_ds[0][0]
    torch.manual_seed(999)  # el RNG global no debe influir
    assert torch.equal(a, train_ds[0][0])

    train_ds.set_epoch(2)
    assert not torch.equal(a, train_ds[0][0])

    other_ds, _ = build_datasets(data, cfg.model_copy(update={"aug_seed": cfg.aug_seed + 1}))
    other_ds.set_epoch(1)
    assert not torch.equal(a, other_ds[0][0])


def test_shuffle_order_is_reproducible_by_shuffle_seed(cfg: TrainConfig) -> None:
    data = prepare_data(cfg)

    def order(seed: int) -> list[int]:
        c = cfg.model_copy(update={"shuffle_seed": seed})
        train_ds, val_ds = build_datasets(data, c)
        train_loader, _ = build_loaders(train_ds, val_ds, c)
        return _loader_order(train_loader)

    assert order(7) == order(7)
    assert order(7) != order(8)
    assert sorted(order(7)) == list(range(len(data.train)))


def test_minibatches_have_configured_size(cfg: TrainConfig) -> None:
    data = prepare_data(cfg)
    train_ds, val_ds = build_datasets(data, cfg)
    train_loader, _ = build_loaders(train_ds, val_ds, cfg)
    sizes = [len(targets) for _, targets, _ in train_loader]
    assert sizes[:-1] == [cfg.batch_size] * (len(sizes) - 1)
    assert sum(sizes) == len(data.train)
