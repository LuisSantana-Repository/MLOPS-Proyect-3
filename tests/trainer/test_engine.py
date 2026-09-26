from __future__ import annotations

import math
from collections.abc import Iterator

import pytest
import torch

from trainer.config import TrainConfig
from trainer.data import build_datasets, build_loaders, prepare_data
from trainer.engine import EarlyStopping, build_optimizer, fit
from trainer.model import CropClassifier


def _run(stopper: EarlyStopping, values: list[float]) -> int:
    """Alimenta la secuencia y devuelve la época en que se detiene (o la última)."""
    for epoch, value in enumerate(values, start=1):
        stopper.step(value, epoch)
        if stopper.should_stop:
            return epoch
    return len(values)


def test_early_stopping_waits_patience_epochs_after_the_best() -> None:
    stopper = EarlyStopping("val_loss", patience=3)
    assert _run(stopper, [1.0, 0.8, 0.85, 0.9, 0.95, 0.1]) == 5
    assert (stopper.best_epoch, stopper.best) == (2, 0.8)


def test_min_delta_ignores_tiny_improvements() -> None:
    stopper = EarlyStopping("val_loss", patience=2, min_delta=0.1)
    assert _run(stopper, [1.0, 0.95, 0.91, 0.5]) == 3
    assert stopper.best_epoch == 1


def test_val_acc_is_maximized() -> None:
    stopper = EarlyStopping("val_acc", patience=2)
    assert _run(stopper, [0.5, 0.7, 0.6, 0.65]) == 4
    assert (stopper.best_epoch, stopper.best) == (2, 0.7)


def test_nan_never_counts_as_improvement() -> None:
    stopper = EarlyStopping("val_loss", patience=5)
    stopper.step(1.0, 1)
    assert stopper.step(math.nan, 2) is False
    assert stopper.best_epoch == 1


def _setup(cfg: TrainConfig):
    data = prepare_data(cfg)
    train_ds, val_ds = build_datasets(data, cfg)
    train_loader, val_loader = build_loaders(train_ds, val_ds, cfg)
    torch.manual_seed(cfg.init_seed)
    model = CropClassifier(
        len(data.classes), cfg.hidden_layers, cfg.dropout, pretrained=False, trainable_backbone="all"
    )
    return model, train_loader, val_loader, len(data.train)


def _scripted(values: list[float]):
    it: Iterator[float] = iter(values)
    return lambda *_: (next(it), 0.0)


def test_fit_restores_the_best_epoch_not_the_last(cfg: TrainConfig) -> None:
    cfg = cfg.model_copy(update={"max_epochs": 10, "patience": 3})
    model, train_loader, val_loader, _ = _setup(cfg)
    snapshots: dict[int, dict[str, torch.Tensor]] = {}

    def remember(row: dict) -> None:
        snapshots[row["epoch"]] = {k: v.clone() for k, v in model.state_dict().items()}

    result = fit(
        model,
        train_loader,
        val_loader,
        cfg,
        torch.device("cpu"),
        evaluate_fn=_scripted([1.0, 0.5, 0.7, 0.8, 0.9, 0.1]),
        on_epoch_end=remember,
    )

    assert (result.best_epoch, result.stopped_epoch, result.stop_reason) == (2, 5, "early_stopping")
    final = model.state_dict()
    assert all(torch.equal(final[k], snapshots[2][k]) for k in final)
    assert not all(torch.equal(final[k], snapshots[5][k]) for k in final)


def test_fit_runs_to_max_epochs_when_always_improving(cfg: TrainConfig) -> None:
    cfg = cfg.model_copy(update={"max_epochs": 3, "patience": 1})
    model, train_loader, val_loader, _ = _setup(cfg)
    result = fit(model, train_loader, val_loader, cfg, torch.device("cpu"), evaluate_fn=_scripted([3.0, 2.0, 1.0]))
    assert (result.best_epoch, result.stopped_epoch, result.stop_reason) == (3, 3, "max_epochs")


def test_history_has_train_and_val_curves_and_minibatch_steps(cfg: TrainConfig) -> None:
    model, train_loader, val_loader, n_train = _setup(cfg)
    result = fit(model, train_loader, val_loader, cfg, torch.device("cpu"))
    assert [row["epoch"] for row in result.history] == list(range(1, cfg.max_epochs + 1))
    for row in result.history:
        for key in ("train_loss", "train_acc", "val_loss", "val_acc"):
            assert math.isfinite(row[key])
        assert row["optimizer_steps"] == math.ceil(n_train / cfg.batch_size)
        assert row["train_samples"] == n_train


def test_training_actually_updates_the_weights(cfg: TrainConfig) -> None:
    model, train_loader, val_loader, _ = _setup(cfg)
    before = {k: v.clone() for k, v in model.state_dict().items()}
    fit(model, train_loader, val_loader, cfg, torch.device("cpu"))
    after = model.state_dict()
    assert not torch.equal(before["head.0.weight"], after["head.0.weight"])
    assert not torch.equal(before["backbone.conv1.weight"], after["backbone.conv1.weight"])


@pytest.mark.parametrize(
    ("name", "cls"), [("sgd", torch.optim.SGD), ("adam", torch.optim.Adam), ("adamw", torch.optim.AdamW)]
)
def test_optimizer_choice_is_applied(cfg: TrainConfig, name: str, cls: type) -> None:
    model = CropClassifier(3, [8], 0.0, pretrained=False, trainable_backbone="none")
    optimizer = build_optimizer(model, cfg.model_copy(update={"optimizer": name, "lr": 0.0123}))
    assert type(optimizer) is cls
    assert optimizer.param_groups[0]["lr"] == 0.0123
    assert sum(p.numel() for g in optimizer.param_groups for p in g["params"]) == sum(
        p.numel() for p in model.head.parameters()
    )
