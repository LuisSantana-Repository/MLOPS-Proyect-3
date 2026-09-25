"""Punto de entrada del entrenamiento: ``train(cfg)`` arma datos, modelo y paquete de salida.

Paquete que queda en ``cfg.output_dir`` (lo consumen T06, T08 y T10):

- ``weights.pt``      checkpoint de la mejor época: state_dict + arquitectura + clases
- ``classes.json``    mapa índice→clase (copia del de T03)
- ``preprocess.json`` preprocesamiento determinista de val/test/inferencia
- ``history.json``    métricas por época (curvas train/val)
- ``config.json``     configuración efectiva validada
- ``env.json``        versiones de librerías y ajustes de determinismo
- ``summary.json``    mejor época, parada, conteos, procedencia de datos y pesos
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path
from typing import Any

import torch

from trainer.config import TrainConfig
from trainer.data import build_datasets, build_loaders, classes_to_json, prepare_data, preprocess_spec
from trainer.engine import EpochCallback, evaluate, fit
from trainer.model import CropClassifier, arch_spec, pretrained_source, save_checkpoint

log = logging.getLogger(__name__)

PACKAGE_FILES = (
    "weights.pt",
    "classes.json",
    "preprocess.json",
    "history.json",
    "config.json",
    "env.json",
    "summary.json",
)
RESTORE_TOLERANCE = 1e-5


@dataclass
class TrainResult:
    output_dir: Path
    best_epoch: int
    best_value: float
    stopped_epoch: int
    stop_reason: str
    history: list[dict[str, Any]]
    summary: dict[str, Any]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("se pidió device=cuda pero CUDA no está disponible")
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(requested)


def configure_determinism(enabled: bool) -> None:
    torch.backends.cudnn.benchmark = not enabled
    torch.backends.cudnn.deterministic = enabled
    if enabled:
        os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    torch.use_deterministic_algorithms(enabled, warn_only=True)


def _version(package: str) -> str | None:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None


def environment_info(device: torch.device) -> dict[str, Any]:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            name: _version(name) for name in ("torch", "torchvision", "numpy", "pandas", "pillow", "pydantic")
        },
        "device": str(device),
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda,
        "cudnn_version": torch.backends.cudnn.version() if torch.backends.cudnn.is_available() else None,
        "gpu_name": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "torch_num_threads": torch.get_num_threads(),
        "deterministic_algorithms": torch.are_deterministic_algorithms_enabled(),
        "cudnn_benchmark": torch.backends.cudnn.benchmark,
        "notes": "En CPU las corridas con las mismas semillas son reproducibles; en GPU algunas "
        "operaciones de cuDNN pueden variar en los últimos decimales aun en modo determinista.",
    }


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def train(cfg: TrainConfig, on_epoch_end: EpochCallback | None = None, overwrite: bool = False) -> TrainResult:
    """Entrena con ``cfg`` y escribe el paquete del mejor checkpoint en ``cfg.output_dir``."""
    started = time.perf_counter()
    out = cfg.output_dir
    if (out / "weights.pt").exists() and not overwrite:
        raise FileExistsError(f"{out} ya contiene un modelo; usa otra carpeta o overwrite=True")
    out.mkdir(parents=True, exist_ok=True)

    configure_determinism(cfg.deterministic)
    device = resolve_device(cfg.device)

    data = prepare_data(cfg)
    counts = data.counts()
    log.info("clases (%s): %s", data.classes_source, data.classes)
    log.info("recortes train=%d val=%d; test ignorado=%d", len(data.train), len(data.val), data.test_rows_ignored)
    train_ds, val_ds = build_datasets(data, cfg)
    train_loader, val_loader = build_loaders(train_ds, val_ds, cfg)

    torch.manual_seed(cfg.init_seed)  # inicialización de la cabeza (y del backbone si no es preentrenado)
    model = CropClassifier(
        num_classes=len(data.classes),
        hidden_layers=cfg.hidden_layers,
        dropout=cfg.dropout,
        pretrained=cfg.pretrained,
        trainable_backbone=cfg.trainable_backbone,
    ).to(device)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())

    result = fit(model, train_loader, val_loader, cfg, device, on_epoch_end=on_epoch_end)

    # Evidencia de que quedaron los pesos de la mejor época y no los de la última.
    restored_loss, restored_acc = evaluate(model, val_loader, torch.nn.CrossEntropyLoss(), device)
    best_row = next(r for r in result.history if r["epoch"] == result.best_epoch)
    restored_ok = (
        abs(restored_loss - best_row["val_loss"]) <= RESTORE_TOLERANCE
        and abs(restored_acc - best_row["val_acc"]) <= RESTORE_TOLERANCE
    )
    if not restored_ok:
        log.warning(
            "las métricas tras restaurar (%.6f, %.6f) difieren de la época %d (%.6f, %.6f)",
            restored_loss,
            restored_acc,
            result.best_epoch,
            best_row["val_loss"],
            best_row["val_acc"],
        )

    arch = arch_spec(len(data.classes), cfg.hidden_layers, cfg.dropout, cfg.trainable_backbone)
    weights_source = pretrained_source(cfg.pretrained)
    save_checkpoint(
        out / "weights.pt",
        model,
        arch,
        data.classes,
        extra={
            "best_epoch": result.best_epoch,
            "monitor": cfg.monitor,
            "best_value": result.best_value,
            "pretrained_weights": weights_source,
        },
    )
    _write_json(out / "classes.json", classes_to_json(data.classes))
    _write_json(out / "preprocess.json", preprocess_spec(cfg.img_size))
    _write_json(out / "history.json", {"monitor": cfg.monitor, "epochs": result.history})
    _write_json(out / "config.json", cfg.to_json_dict())
    _write_json(out / "env.json", environment_info(device))

    duration = time.perf_counter() - started
    summary = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "best_epoch": result.best_epoch,
        "stopped_epoch": result.stopped_epoch,
        "stop_reason": result.stop_reason,
        "early_stopping": {"monitor": cfg.monitor, "patience": cfg.patience, "min_delta": cfg.min_delta},
        "best_value": result.best_value,
        "best_metrics": {k: best_row[k] for k in ("train_loss", "train_acc", "val_loss", "val_acc")},
        "restored_check": {"val_loss": restored_loss, "val_acc": restored_acc, "matches_best_epoch": restored_ok},
        "seeds": {"shuffle_seed": cfg.shuffle_seed, "aug_seed": cfg.aug_seed, "init_seed": cfg.init_seed},
        "data": {
            "manifest_path": str(cfg.manifest_path),
            "manifest_sha256": sha256_file(cfg.manifest_path),
            "classes_source": data.classes_source,
            "classes": data.classes,
            "counts": counts,
            "test_rows_ignored": data.test_rows_ignored,
            "excluded_by_class": data.excluded_by_class,
            "max_samples_per_class": cfg.max_samples_per_class,
        },
        "model": {
            "arch": arch,
            "pretrained_weights": weights_source,
            "trainable_params": trainable,
            "total_params": total,
        },
        "device": str(device),
        "duration_seconds": round(duration, 3),
        "files": list(PACKAGE_FILES),
    }
    _write_json(out / "summary.json", summary)
    log.info("paquete escrito en %s (%.1f s)", out, duration)

    return TrainResult(
        output_dir=out,
        best_epoch=result.best_epoch,
        best_value=result.best_value,
        stopped_epoch=result.stopped_epoch,
        stop_reason=result.stop_reason,
        history=result.history,
        summary=summary,
    )
