"""Loop de entrenamiento por minibatches, early stopping y restauración del mejor checkpoint."""

from __future__ import annotations

import hashlib
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from trainer.config import TrainConfig

log = logging.getLogger(__name__)

EvaluateFn = Callable[[nn.Module, DataLoader, nn.Module, torch.device], tuple[float, float]]
EpochCallback = Callable[[dict[str, Any]], None]


class TrainingError(RuntimeError):
    pass


@dataclass
class EarlyStopping:
    """Vigila una métrica de validación; una mejora debe superar ``min_delta``."""

    monitor: str
    patience: int
    min_delta: float = 0.0
    best: float | None = None
    best_epoch: int | None = None
    bad_epochs: int = 0

    @property
    def mode(self) -> str:
        return "max" if self.monitor.endswith("acc") else "min"

    def step(self, value: float, epoch: int) -> bool:
        """Registra la métrica de la época y devuelve True si es la nueva mejor."""
        if math.isnan(value):
            improved = False
        elif self.best is None:
            improved = True
        elif self.mode == "min":
            improved = value < self.best - self.min_delta
        else:
            improved = value > self.best + self.min_delta
        if improved:
            self.best, self.best_epoch, self.bad_epochs = value, epoch, 0
        else:
            self.bad_epochs += 1
        return improved

    @property
    def should_stop(self) -> bool:
        return self.bad_epochs >= self.patience


@dataclass
class FitResult:
    history: list[dict[str, Any]]
    best_epoch: int
    best_value: float
    stopped_epoch: int
    stop_reason: str
    best_state: dict[str, torch.Tensor] = field(repr=False)


def build_optimizer(model: nn.Module, cfg: TrainConfig) -> torch.optim.Optimizer:
    params = [p for p in model.parameters() if p.requires_grad]
    if not params:
        raise TrainingError("el modelo no tiene parámetros entrenables")
    if cfg.optimizer == "sgd":
        return torch.optim.SGD(params, lr=cfg.lr, momentum=cfg.momentum, weight_decay=cfg.weight_decay)
    if cfg.optimizer == "adam":
        return torch.optim.Adam(params, lr=cfg.lr, weight_decay=cfg.weight_decay)
    return torch.optim.AdamW(params, lr=cfg.lr, weight_decay=cfg.weight_decay)


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> dict[str, Any]:
    model.train()
    total_loss, correct, seen, steps = 0.0, 0, 0, 0
    order: list[int] = []
    for inputs, targets, indices in loader:
        inputs, targets = inputs.to(device), targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(inputs)
        loss = criterion(logits, targets)
        if not torch.isfinite(loss):
            raise TrainingError(f"loss no finita ({loss.item()}) en el paso {steps + 1}; prueba un lr menor")
        loss.backward()
        optimizer.step()
        steps += 1
        batch = targets.size(0)
        total_loss += loss.item() * batch
        correct += (logits.argmax(dim=1) == targets).sum().item()
        seen += batch
        order.extend(indices.tolist())
    return {
        "train_loss": total_loss / seen,
        "train_acc": correct / seen,
        "optimizer_steps": steps,
        "train_samples": seen,
        "train_order_sha256": hashlib.sha256(np.asarray(order, dtype=np.int64).tobytes()).hexdigest(),
    }


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, criterion: nn.Module, device: torch.device) -> tuple[float, float]:
    model.eval()
    total_loss, correct, seen = 0.0, 0, 0
    for inputs, targets, _ in loader:
        inputs, targets = inputs.to(device), targets.to(device)
        logits = model(inputs)
        total_loss += criterion(logits, targets).item() * targets.size(0)
        correct += (logits.argmax(dim=1) == targets).sum().item()
        seen += targets.size(0)
    return total_loss / seen, correct / seen


def _snapshot(model: nn.Module) -> dict[str, torch.Tensor]:
    return {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}


def fit(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    cfg: TrainConfig,
    device: torch.device,
    evaluate_fn: EvaluateFn = evaluate,
    on_epoch_end: EpochCallback | None = None,
) -> FitResult:
    """Entrena hasta ``max_epochs`` o early stopping y deja cargados los pesos de la mejor época."""
    criterion = nn.CrossEntropyLoss()
    optimizer = build_optimizer(model, cfg)
    stopper = EarlyStopping(cfg.monitor, cfg.patience, cfg.min_delta)
    history: list[dict[str, Any]] = []
    best_state: dict[str, torch.Tensor] | None = None
    stop_reason = "max_epochs"

    for epoch in range(1, cfg.max_epochs + 1):
        started = time.perf_counter()
        train_loader.dataset.set_epoch(epoch)
        row: dict[str, Any] = {"epoch": epoch}
        row.update(train_one_epoch(model, train_loader, criterion, optimizer, device))
        row["val_loss"], row["val_acc"] = evaluate_fn(model, val_loader, criterion, device)
        row["improved"] = stopper.step(row[cfg.monitor], epoch)
        if row["improved"]:
            best_state = _snapshot(model)
        row["seconds"] = time.perf_counter() - started
        history.append(row)
        log.info(
            "época %d/%d  train_loss=%.4f train_acc=%.4f  val_loss=%.4f val_acc=%.4f%s",
            epoch,
            cfg.max_epochs,
            row["train_loss"],
            row["train_acc"],
            row["val_loss"],
            row["val_acc"],
            "  *mejor*" if row["improved"] else "",
        )
        if on_epoch_end is not None:
            on_epoch_end(row)
        if stopper.should_stop:
            stop_reason = "early_stopping"
            log.info("early stopping: %d épocas sin mejorar %s", stopper.bad_epochs, cfg.monitor)
            break

    if best_state is None or stopper.best_epoch is None:
        raise TrainingError(f"{cfg.monitor} nunca fue una cifra válida; no hay checkpoint que restaurar")
    model.load_state_dict(best_state)
    log.info("restaurados los pesos de la época %d (%s=%.4f)", stopper.best_epoch, cfg.monitor, stopper.best)
    return FitResult(
        history=history,
        best_epoch=stopper.best_epoch,
        best_value=float(stopper.best),
        stopped_epoch=history[-1]["epoch"],
        stop_reason=stop_reason,
        best_state=best_state,
    )
