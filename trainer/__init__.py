"""Entrenador del clasificador de recortes (T05)."""

from trainer.config import TrainConfig, load_config
from trainer.model import LoadedModel, load_model
from trainer.train import TrainResult, train

__all__ = ["LoadedModel", "TrainConfig", "TrainResult", "load_config", "load_model", "train"]
