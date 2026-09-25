"""Lectura del manifiesto, transforms y DataLoaders.

Reglas que se prueban en ``tests/trainer``:
- Las filas ``split=test`` se descartan al leer; el entrenador nunca abre esas imágenes.
- Solo train usa transforms aleatorios; val (y luego test/inferencia) usa el
  transform determinista descrito por ``preprocess.json``.
- La aumentación usa su propia semilla (``aug_seed``) por muestra y época, así que
  no depende del orden del shuffle ni del número de workers.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

from trainer.config import TrainConfig

log = logging.getLogger(__name__)

REQUIRED_COLUMNS = ("crop_path", "category_name", "split")
VALID_SPLITS = ("train", "val", "test")
TRAINING_SPLITS = ("train", "val")

# Estadísticas de ImageNet: las esperan los pesos preentrenados de torchvision.
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

PREPROCESS_FORMAT_VERSION = 1


class DataError(ValueError):
    """El manifiesto o el mapa de clases no cumplen el contrato."""


# --- Preprocesamiento ---------------------------------------------------------


def preprocess_spec(img_size: int) -> dict[str, Any]:
    """Descripción serializable del preprocesamiento de evaluación (preprocess.json)."""
    return {
        "format_version": PREPROCESS_FORMAT_VERSION,
        "color_mode": "RGB",
        "resize": {"height": img_size, "width": img_size, "interpolation": "bilinear", "antialias": True},
        "scale": "pixel / 255 -> [0, 1]",
        "normalize": {"mean": IMAGENET_MEAN, "std": IMAGENET_STD},
        "input_layout": "NCHW float32",
    }


def build_eval_transform(spec: dict[str, Any]) -> transforms.Compose:
    """Transform determinista para val, test e inferencia a partir de preprocess.json."""
    if spec.get("format_version") != PREPROCESS_FORMAT_VERSION:
        raise DataError(f"preprocess.json con format_version no soportado: {spec.get('format_version')}")
    resize = spec["resize"]
    if resize["interpolation"] != "bilinear":
        raise DataError(f"interpolación no soportada: {resize['interpolation']}")
    return transforms.Compose(
        [
            transforms.Resize(
                (resize["height"], resize["width"]),
                interpolation=transforms.InterpolationMode.BILINEAR,
                antialias=resize["antialias"],
            ),
            transforms.ToTensor(),
            transforms.Normalize(spec["normalize"]["mean"], spec["normalize"]["std"]),
        ]
    )


def build_train_transform(img_size: int) -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0), antialias=True),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


# --- Dataset ------------------------------------------------------------------


def _sample_seed(aug_seed: int, epoch: int, index: int) -> int:
    digest = hashlib.sha256(f"{aug_seed}:{epoch}:{index}".encode()).digest()
    return int.from_bytes(digest[:8], "little") & 0x7FFF_FFFF_FFFF_FFFF


class CropDataset(Dataset):
    """Devuelve ``(tensor, etiqueta, índice)``; el índice permite auditar el orden."""

    def __init__(
        self,
        paths: list[Path],
        labels: list[int],
        transform: transforms.Compose,
        aug_seed: int | None = None,
    ) -> None:
        if len(paths) != len(labels):
            raise ValueError("paths y labels deben tener la misma longitud")
        self.paths = paths
        self.labels = labels
        self.transform = transform
        self.aug_seed = aug_seed
        self.epoch = 0

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int, int]:
        with Image.open(self.paths[index]) as img:
            img = img.convert("RGB")
            if self.aug_seed is None:
                tensor = self.transform(img)
            else:
                with torch.random.fork_rng(devices=[]):
                    torch.manual_seed(_sample_seed(self.aug_seed, self.epoch, index))
                    tensor = self.transform(img)
        return tensor, self.labels[index], index


# --- Manifiesto y clases ------------------------------------------------------


def read_manifest(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise DataError(f"no existe el manifiesto: {path}")
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise DataError(f"al manifiesto le faltan columnas {missing}; tiene {list(df.columns)}")
    if df.empty:
        raise DataError("el manifiesto está vacío")
    bad = sorted(set(df["split"].astype(str)) - set(VALID_SPLITS))
    if bad:
        raise DataError(f"valores de split no válidos {bad}; se esperan {list(VALID_SPLITS)}")
    return df


def read_classes(path: Path) -> list[str]:
    """Lee classes.json de T03: ``{"0": "clase", ...}`` o una lista ordenada."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        classes = [str(c) for c in data]
    elif isinstance(data, dict):
        try:
            indexed = {int(k): str(v) for k, v in data.items()}
        except ValueError as exc:
            raise DataError(f"las llaves de {path} deben ser índices enteros") from exc
        if sorted(indexed) != list(range(len(indexed))):
            raise DataError(f"los índices de {path} deben ser 0..n-1 sin huecos")
        classes = [indexed[i] for i in range(len(indexed))]
    else:
        raise DataError(f"{path} debe ser un objeto índice→clase o una lista")
    if len(set(classes)) != len(classes):
        raise DataError(f"{path} tiene clases repetidas")
    return classes


def classes_to_json(classes: list[str]) -> dict[str, str]:
    return {str(i): name for i, name in enumerate(classes)}


@dataclass
class PreparedData:
    classes: list[str]
    classes_source: str
    train: pd.DataFrame
    val: pd.DataFrame
    test_rows_ignored: int
    excluded_by_class: dict[str, int] = field(default_factory=dict)

    def counts(self) -> dict[str, dict[str, int]]:
        return {
            split: {c: int((df["category_name"] == c).sum()) for c in self.classes}
            for split, df in (("train", self.train), ("val", self.val))
        }


def prepare_data(cfg: TrainConfig) -> PreparedData:
    df = read_manifest(cfg.manifest_path)
    test_rows = int((df["split"] == "test").sum())
    df = df[df["split"].isin(TRAINING_SPLITS)].copy()  # el test no sale de aquí

    if cfg.classes_path is not None:
        classes = read_classes(cfg.classes_path)
        classes_source = str(cfg.classes_path)
    else:
        classes = sorted(df.loc[df["split"] == "train", "category_name"].astype(str).unique())
        classes_source = "derivadas de train (orden alfabético)"
        log.warning("sin classes_path: las clases se derivan del manifiesto; usa el classes.json de T03")
    if len(classes) < 2:
        raise DataError(f"se necesitan al menos 2 clases; hay {len(classes)}")

    df["category_name"] = df["category_name"].astype(str)
    outside = df[~df["category_name"].isin(classes)]
    excluded = {str(k): int(v) for k, v in outside["category_name"].value_counts().items()}
    if excluded:
        log.info("filas excluidas por no estar en classes.json: %s", excluded)
    df = df[df["category_name"].isin(classes)]

    if cfg.max_samples_per_class is not None:
        df = df.groupby(["split", "category_name"], sort=False).head(cfg.max_samples_per_class)

    root = cfg.data_root if cfg.data_root is not None else cfg.manifest_path.parent
    df["abs_path"] = [p if p.is_absolute() else root / p for p in map(Path, df["crop_path"])]
    missing = [str(p) for p in df["abs_path"] if not p.is_file()]
    if missing:
        raise DataError(f"{len(missing)} recortes no existen, por ejemplo: {missing[:3]}")

    train = df[df["split"] == "train"].reset_index(drop=True)
    val = df[df["split"] == "val"].reset_index(drop=True)
    empty_train = [c for c in classes if not (train["category_name"] == c).any()]
    if empty_train:
        raise DataError(f"clases sin muestras en train: {empty_train}")
    if val.empty:
        raise DataError("el split val está vacío; early stopping necesita validación")
    empty_val = [c for c in classes if not (val["category_name"] == c).any()]
    if empty_val:
        log.warning("clases sin muestras en val: %s", empty_val)

    return PreparedData(
        classes=classes,
        classes_source=classes_source,
        train=train,
        val=val,
        test_rows_ignored=test_rows,
        excluded_by_class=excluded,
    )


# --- DataLoaders --------------------------------------------------------------


def _seed_worker(_worker_id: int) -> None:
    seed = torch.initial_seed() % 2**32
    np.random.seed(seed)
    random.seed(seed)


def build_datasets(data: PreparedData, cfg: TrainConfig) -> tuple[CropDataset, CropDataset]:
    index = {name: i for i, name in enumerate(data.classes)}

    def split_arrays(df: pd.DataFrame) -> tuple[list[Path], list[int]]:
        return list(df["abs_path"]), [index[c] for c in df["category_name"]]

    train_ds = CropDataset(*split_arrays(data.train), build_train_transform(cfg.img_size), aug_seed=cfg.aug_seed)
    val_ds = CropDataset(*split_arrays(data.val), build_eval_transform(preprocess_spec(cfg.img_size)))
    return train_ds, val_ds


def build_loaders(train_ds: CropDataset, val_ds: CropDataset, cfg: TrainConfig) -> tuple[DataLoader, DataLoader]:
    generator = torch.Generator()
    generator.manual_seed(cfg.shuffle_seed)
    common: dict[str, Any] = {
        "batch_size": cfg.batch_size,
        "num_workers": cfg.num_workers,
        "worker_init_fn": _seed_worker,
        "pin_memory": torch.cuda.is_available(),
    }
    train_loader = DataLoader(train_ds, shuffle=True, generator=generator, **common)
    val_loader = DataLoader(val_ds, shuffle=False, **common)
    return train_loader, val_loader
